/* Where imported chats and settings live.
   - "server" mode: the viewer's own server (server.js / Docker) keeps them in its data folder.
   - "browser" mode: opened as plain static files, everything is kept in this browser (IndexedDB). */
(function (global) {
  'use strict';

  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  let dbp;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('wa-chat-viewer', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = (store, mode, fn) => db().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = t.onabort = () => rej(t.error);
  }));

  function chatId(file) {
    let h = 0x811c9dc5;
    const s = file.name + '|' + file.size;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'c' + h.toString(16) + '-' + file.size.toString(36);
  }

  const api = (path, opts) => fetch('api/' + path, opts).then(r => {
    if (!r.ok) { const e = new Error('Server error ' + r.status); e.status = r.status; throw e; }
    return r;
  });
  const post = (path, body, method) => api(path, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const remoteSource = (id, size) => Object.assign(Zip.fromURL('api/chats/' + encodeURIComponent(id) + '/file', size), {
    recover: () => api('chats/' + encodeURIComponent(id) + '/index', { cache: 'no-store' }).then(r => r.json()),
  });
  // Browser mode: a broken zip index is rebuilt once and kept with the chat.
  const localSource = (id, blob) => Object.assign(Zip.fromBlob(blob), {
    recover: async scan => {
      const key = 'zipidx:' + id + ':' + blob.size;
      try { const hit = await tx('kv', 'readonly', s => s.get(key)); if (hit) return hit; } catch (e) { /* rebuild */ }
      const found = await scan();
      tx('kv', 'readwrite', s => s.put(found, key)).catch(() => {});
      return found;
    },
  });

  // Browser-mode screen lock: a salted PBKDF2 hash kept in localStorage.
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  async function derive(password, saltHex) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256));
  }
  const localLock = () => { try { return JSON.parse(LS.get('wa-lock') || 'null'); } catch (e) { return null; } };
  const session = {
    get() { try { return sessionStorage.getItem('wa-unlocked'); } catch (e) { return null; } },
    set(on) { try { if (on) sessionStorage.setItem('wa-unlocked', '1'); else sessionStorage.removeItem('wa-unlocked'); } catch (e) { /* ignore */ } },
  };

  let wallURL = null;
  const fileURLs = new Map(); // browser mode: name -> object URL

  const Store = {
    mode: 'browser',
    locked: false,   // a password is set
    authed: true,    // this session has entered it
    canLock: true,

    async init() {
      try {
        const r = await fetch('api/health', { cache: 'no-store' });
        const info = r.ok ? await r.json() : null;
        if (info && info.app === 'wa-chat-viewer') {
          this.mode = 'server';
          this.locked = !!info.locked;
          this.authed = !info.locked || !!info.authed;
        }
      } catch (e) { /* static hosting: stay in browser mode */ }
      if (this.mode === 'browser') {
        this.canLock = !!(global.crypto && crypto.subtle);
        this.locked = !!localLock();
        this.authed = !this.locked || !!session.get();
      }
      return this.mode;
    },

    // ---- chats
    async listChats() {
      if (this.mode === 'server') {
        const list = await (await api('chats', { cache: 'no-store' })).json();
        return list.map(c => ({ id: c.id, fileName: c.fileName, addedAt: c.addedAt, size: c.size, source: remoteSource(c.id, c.size) }));
      }
      const recs = await tx('chats', 'readonly', s => s.getAll());
      return recs.map(r => ({ id: r.id, fileName: r.fileName, addedAt: r.addedAt, size: r.blob.size, source: localSource(r.id, r.blob) }));
    },

    // Returns the record straight away for a local read, plus a promise for the save.
    addChat(file) {
      const rec = { id: chatId(file), fileName: file.name, addedAt: Date.now(), size: file.size, source: localSource(chatId(file), file) };
      let saved;
      if (this.mode === 'server') {
        saved = api('chats/' + encodeURIComponent(rec.id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
          body: file,
        }).then(() => { rec.source = remoteSource(rec.id, rec.size); });
      } else {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        saved = tx('chats', 'readwrite', s => s.put({ id: rec.id, fileName: rec.fileName, addedAt: rec.addedAt, blob: file }));
      }
      return { rec, saved };
    },

    delChat(id) {
      if (this.mode === 'server') return api('chats/' + encodeURIComponent(id), { method: 'DELETE' });
      tx('kv', 'readwrite', s => s.delete(IDBKeyRange.bound('zipidx:' + id + ':', 'zipidx:' + id + ':\uffff'))).catch(() => {});
      return tx('chats', 'readwrite', s => s.delete(id));
    },

    // ---- settings
    async loadSettings() {
      let local = null;
      try { local = JSON.parse(LS.get('wa-settings') || 'null'); } catch (e) { /* ignore */ }
      if (this.mode === 'server') {
        try {
          const remote = await (await api('settings', { cache: 'no-store' })).json();
          if (remote && Object.keys(remote).length) return remote;
        } catch (e) { /* fall back to the local copy */ }
      }
      return local || {};
    },

    saveSettings(obj) {
      LS.set('wa-theme', obj.theme || null);
      if (this.mode === 'server') return post('settings', obj, 'PUT');
      LS.set('wa-settings', JSON.stringify(obj));
      return Promise.resolve();
    },

    // ---- small files (contact photos)
    async loadFiles() {
      if (this.mode === 'server') return;
      const [keys, vals] = await Promise.all([tx('kv', 'readonly', s => s.getAllKeys()), tx('kv', 'readonly', s => s.getAll())]);
      keys.forEach((k, i) => { if (String(k).startsWith('file:')) fileURLs.set(String(k).slice(5), URL.createObjectURL(vals[i])); });
    },
    fileURL(name, version) {
      if (this.mode === 'server') return 'api/files/' + encodeURIComponent(name) + '?v=' + encodeURIComponent(version || 0);
      return fileURLs.get(name) || null;
    },
    async putFile(name, blob) {
      if (this.mode === 'server') {
        await api('files/' + encodeURIComponent(name), { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
        return;
      }
      await tx('kv', 'readwrite', s => s.put(blob, 'file:' + name));
      if (fileURLs.has(name)) URL.revokeObjectURL(fileURLs.get(name));
      fileURLs.set(name, URL.createObjectURL(blob));
    },
    async delFile(name) {
      if (this.mode === 'server') { await api('files/' + encodeURIComponent(name), { method: 'DELETE' }); return; }
      await tx('kv', 'readwrite', s => s.delete('file:' + name));
      if (fileURLs.has(name)) { URL.revokeObjectURL(fileURLs.get(name)); fileURLs.delete(name); }
    },

    // ---- custom chat background. Resolves to a URL, or null when none is saved.
    async getWallpaper() {
      if (this.mode === 'server') {
        const r = await fetch('api/wallpaper', { method: 'HEAD', cache: 'no-store' });
        // Absolute, because it is used from CSS where relative URLs resolve against the stylesheet.
        return r.status === 200 ? new URL('api/wallpaper?v=' + Date.now(), location.href).href : null;
      }
      const blob = await tx('kv', 'readonly', s => s.get('wallpaper'));
      if (wallURL) { URL.revokeObjectURL(wallURL); wallURL = null; }
      if (blob) wallURL = URL.createObjectURL(blob);
      return wallURL;
    },

    async setWallpaper(file) {
      if (this.mode === 'server') {
        if (file) await api('wallpaper', { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        else await api('wallpaper', { method: 'DELETE' });
      } else if (file) {
        await tx('kv', 'readwrite', s => s.put(file, 'wallpaper'));
      } else {
        await tx('kv', 'readwrite', s => s.delete('wallpaper'));
      }
      return this.getWallpaper();
    },

    // ---- screen lock. In server mode the server refuses to hand out chats until unlocked;
    // in browser mode it only hides them in this browser.
    async unlock(password) {
      if (this.mode === 'server') {
        try { await post('unlock', { password }); } catch (e) { return false; }
      } else {
        const lock = localLock();
        if (lock && (await derive(password, lock.salt)) !== lock.hash) return false;
        session.set(true);
      }
      this.authed = true;
      return true;
    },
    async setLock(password) {
      if (this.mode === 'server') await post('lock', { password });
      else {
        const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        LS.set('wa-lock', JSON.stringify({ salt, hash: await derive(password, salt) }));
        session.set(true);
      }
      this.locked = true; this.authed = true;
    },
    async removeLock() {
      if (this.mode === 'server') await api('lock', { method: 'DELETE' });
      else { LS.set('wa-lock', null); session.set(false); }
      this.locked = false; this.authed = true;
    },
    async logout() {
      if (this.mode === 'server') await post('logout').catch(() => {});
      else session.set(false);
      this.authed = false;
    },

    // ---- link previews (server mode only): { title, description, site, image } or null
    async preview(url) {
      if (this.mode !== 'server') return null;
      try {
        const info = await (await api('preview?url=' + encodeURIComponent(url))).json();
        if (!info || !info.title) return null;
        if (info.image) info.image = 'api/preview/image?url=' + encodeURIComponent(url);
        return info;
      } catch (e) { return null; }
    },
  };

  global.Store = Store;
  global.LS = LS;
})(window);
