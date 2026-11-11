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
    if (!r.ok) throw new Error('Server error ' + r.status);
    return r;
  });
  const remoteSource = (id, size) => Zip.fromURL('api/chats/' + encodeURIComponent(id) + '/file', size);

  let wallURL = null;

  const Store = {
    mode: 'browser',

    async init() {
      try {
        const r = await fetch('api/health', { cache: 'no-store' });
        if (r.ok && (await r.json()).app === 'wa-chat-viewer') this.mode = 'server';
      } catch (e) { /* static hosting: stay in browser mode */ }
      return this.mode;
    },

    async listChats() {
      if (this.mode === 'server') {
        const list = await (await api('chats', { cache: 'no-store' })).json();
        return list.map(c => ({ id: c.id, fileName: c.fileName, addedAt: c.addedAt, size: c.size, source: remoteSource(c.id, c.size) }));
      }
      const recs = await tx('chats', 'readonly', s => s.getAll());
      return recs.map(r => ({ id: r.id, fileName: r.fileName, addedAt: r.addedAt, size: r.blob.size, source: Zip.fromBlob(r.blob) }));
    },

    // Returns the record straight away for a local read, plus a promise for the save.
    addChat(file) {
      const rec = { id: chatId(file), fileName: file.name, addedAt: Date.now(), size: file.size, source: Zip.fromBlob(file) };
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
      return tx('chats', 'readwrite', s => s.delete(id));
    },

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
      LS.set('wa-settings', JSON.stringify(obj));
      LS.set('wa-theme', obj.theme || null);
      if (this.mode === 'server') {
        return api('settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
      }
      return Promise.resolve();
    },

    // Custom chat background image. Resolves to a URL, or null when none is saved.
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
  };

  global.Store = Store;
  global.LS = LS;
})(window);
