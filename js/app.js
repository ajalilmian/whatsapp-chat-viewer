/* WhatsApp chat export viewer. Read-only: chats are parsed and shown in the browser. */
'use strict';

  // ---------------------------------------------------------------- helpers
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lc = s => String(s).toLowerCase();
  const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;
  const URL_RE = /(?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?)\]'"]/gi;
  const norm = name => name.split('/').pop().replace(BIDI, '').normalize('NFC').trim().toLowerCase();
  const displayName = file => file.replace(/^\d{4,}-/, '');
  const DAY = 86400000;
  const root = document.documentElement;

  function hydrateIcons(scope) {
    scope.querySelectorAll('[data-icon]').forEach(n => { n.innerHTML = ICON[n.dataset.icon] || ''; });
    scope.querySelectorAll('[data-avatar]').forEach(n => { n.innerHTML = AVATAR[n.dataset.avatar] || ''; });
  }

  // ---------------------------------------------------------------- settings and themes
  const settings = {
    me: '',            // your name as it appears in exports; '' = work it out per chat
    theme: '',         // '', 'light' or 'dark'
    chat: { id: 'default', bubble: '', wall: '', doodles: true, image: false },
    chatThemes: {},    // per-chat theme overrides, by chat key
    starred: {},       // starred message keys, by chat key
    contacts: {},      // custom names and photos, by chat key ('@me' is you)
    separate: [],      // imported files the user chose not to merge with a same-named chat
    linkPreviews: false,
  };
  let customWall = null; // URL of the user's own background image, when one is saved

  const G = (...layers) => layers.join(',');
  const THEMES = [
    { id: 'default' },
    { id: 'sky', wall: '#ffffff', doodle: '#f1f1f1', out: '#0a9bdc' },
    { id: 'azure', wall: '#ffffff', doodle: '#f1f1f1', out: '#2a8cf2' },
    { id: 'graphite', wall: '#ffffff', doodle: '#f1f1f1', out: '#33373b' },
    { id: 'indigo', wall: '#ffffff', doodle: '#f1f1f1', out: '#5b4ddb' },
    { id: 'green', wall: '#f3efe7', doodle: '#e4dccf', out: '#1fa85f' },
    { id: 'lavender', wall: '#f6ecfb', doodle: '#ead9f4', out: '#6a4be0' },
    { id: 'rose', wall: '#fdebf0', doodle: '#f6d7e0', out: '#c05bdc' },
    { id: 'peach', wall: '#fdeee3', doodle: '#f5dccb', out: '#e4674f' },
    { id: 'teal', wall: '#eef2ee', doodle: '#dee6de', out: '#0f8a78' },
    { id: 'periwinkle', wall: '#e3edfb', doodle: '#cedef6', out: '#2f6fe8' },
    { id: 'navy', wall: '#edf3f8', doodle: '#dae5ee', out: '#0f4c75' },
    { id: 'forest', wall: '#f0f2ee', doodle: '#dfe4db', out: '#3b4a3c' },
    { id: 'maroon', wall: '#f1ece6', doodle: '#e2dacf', out: '#6b1730' },
    { id: 'stone', wall: '#ececec', doodle: '#dcdcdc', out: '#3a3a3c' },
    { id: 'aurora', wall: '#d9a7f5', out: '#5b47d6', img: G(
      'radial-gradient(60% 50% at 20% 25%, rgba(255,255,255,.75), transparent 70%)',
      'radial-gradient(55% 60% at 85% 70%, rgba(120,110,255,.65), transparent 70%)',
      'radial-gradient(50% 45% at 65% 15%, rgba(255,150,220,.8), transparent 70%)',
      'linear-gradient(135deg, #f3b6f5, #b79cf7)') },
    { id: 'blossom', wall: '#f6a9b8', out: '#b65be0', img: G(
      'radial-gradient(38% 34% at 82% 22%, rgba(255,236,224,.95), transparent 70%)',
      'radial-gradient(40% 40% at 22% 88%, rgba(255,92,170,.85), transparent 70%)',
      'radial-gradient(34% 34% at 92% 92%, rgba(255,158,60,.85), transparent 70%)',
      'radial-gradient(70% 60% at 35% 30%, rgba(255,255,255,.35), transparent 70%)',
      'linear-gradient(160deg, #f8b9c3, #f497ab)') },
    { id: 'sunset', wall: '#fba75c', out: '#e4674f', img: G(
      'radial-gradient(60% 70% at 15% 20%, rgba(255,226,150,.9), transparent 70%)',
      'radial-gradient(60% 60% at 90% 85%, rgba(255,110,70,.75), transparent 70%)',
      'linear-gradient(145deg, #ffc46b, #f98a4b)') },
    { id: 'lagoon', wall: '#8fd6d2', out: '#0f8a78', img:
      'linear-gradient(180deg, #a9d8f0 0%, #cfeaf5 38%, #3fb7b0 46%, #7fd8cf 70%, #f4e3c8 92%, #f0d6b3 100%)' },
    { id: 'glacier', wall: '#9fd3f5', out: '#2f6fe8', img: G(
      'radial-gradient(70% 55% at 30% 30%, rgba(255,255,255,.8), transparent 70%)',
      'radial-gradient(50% 50% at 85% 80%, rgba(90,170,245,.7), transparent 70%)',
      'linear-gradient(160deg, #bfe4fb, #7fc1f1)') },
    { id: 'cobalt', wall: '#1389d6', out: '#0f4c75', img: G(
      'linear-gradient(118deg, transparent 49.6%, rgba(255,255,255,.75) 49.7%, rgba(255,255,255,.75) 50.3%, transparent 50.400%)',
      'linear-gradient(62deg, transparent 29.6%, rgba(255,255,255,.55) 29.7%, rgba(255,255,255,.55) 30.2%, transparent 30.3%)',
      'linear-gradient(150deg, #27a5ec, #0a6fbd)') },
    { id: 'meadow', wall: '#b9cbd9', out: '#46584a', img: G(
      'radial-gradient(45% 40% at 12% 95%, rgba(74,104,66,.9), transparent 70%)',
      'radial-gradient(40% 35% at 95% 90%, rgba(92,120,80,.8), transparent 70%)',
      'radial-gradient(70% 50% at 50% 20%, rgba(255,255,255,.7), transparent 70%)',
      'linear-gradient(180deg, #9db8d3, #d5dfe6)') },
    { id: 'coral', wall: '#f6b3b0', out: '#6b1730', img: G(
      'radial-gradient(30% 80% at 30% 60%, rgba(120,150,90,.75), transparent 70%)',
      'radial-gradient(45% 60% at 80% 40%, rgba(255,235,225,.9), transparent 70%)',
      'linear-gradient(120deg, #f9c9c2, #ef8f95)') },
    { id: 'jungle', wall: '#1e2b27', out: '#7a1f35', img: G(
      'radial-gradient(50% 45% at 85% 15%, rgba(150,60,80,.75), transparent 70%)',
      'linear-gradient(118deg, transparent 39.5%, rgba(120,160,130,.35) 39.7%, rgba(120,160,130,.35) 40.4%, transparent 40.6%)',
      'linear-gradient(150deg, #2e4a3e, #111917)') },
    { id: 'slate', wall: '#5a5a5c', out: '#3a3a3c', img: G(
      'radial-gradient(70% 60% at 80% 10%, rgba(255,255,255,.55), transparent 70%)',
      'linear-gradient(160deg, #8a8a8c, #2c2c2e)') },
    { id: 'onyx', wall: '#111111', out: '#2e2e30', img: G(
      'radial-gradient(60% 50% at 30% 20%, rgba(255,255,255,.14), transparent 70%)',
      'radial-gradient(60% 60% at 80% 90%, rgba(255,255,255,.08), transparent 70%)',
      'linear-gradient(160deg, #262628, #050505)') },
  ];
  const THEME_BY_ID = new Map(THEMES.map(t => [t.id, t]));

  function rgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const lum = hex => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  function shade(hex, amt) {
    const to = amt < 0 ? 0 : 255, t = Math.abs(amt);
    return '#' + rgb(hex).map(c => pad2(Math.round(c + (to - c) * t).toString(16))).join('');
  }
  const pad2 = s => (s.length < 2 ? '0' + s : s);

  const BASE_VARS = {
    light: { '--chat-bg': '#f5f1eb', '--doodle': '#e6ded1', '--out-bg': '#d9fdd3' },
    dark: { '--chat-bg': '#161717', '--doodle': '#232525', '--out-bg': '#144d37' },
  };
  const THEME_KEYS = ['--chat-bg', '--doodle', '--wall-img', '--wall-dim', '--out-bg', '--out-text', '--out-meta', '--out-tick', '--out-link', '--wave-out', '--wave-on-out'];

  // CSS variables for a chat theme choice; null means "leave the app default".
  function themeVars(c, dark) {
    const base = THEME_BY_ID.get(c.id) || THEMES[0];
    const v = {};
    let img = null;
    if (c.image && customWall) img = 'url("' + customWall + '")';
    else if (!c.wall && base.img) img = base.img;

    let wall = null, doodle = null;
    if (c.wall) wall = c.wall;
    else if (img) wall = base.wall || null;
    else if (!dark && base.wall) wall = base.wall;

    if (img || c.doodles === false) doodle = 'transparent';
    else if (c.wall) doodle = shade(c.wall, lum(c.wall) > 0.5 ? -0.07 : 0.1);
    else if (!dark && base.doodle) doodle = base.doodle;

    v['--chat-bg'] = wall;
    v['--doodle'] = doodle;
    v['--wall-img'] = img;
    v['--wall-dim'] = img && dark ? 'rgba(0,0,0,.45)' : null;

    const out = c.bubble || base.out || null;
    if (out) {
      const light = lum(out) > 0.62;
      v['--out-bg'] = out;
      v['--out-text'] = light ? '#0a0a0a' : '#ffffff';
      v['--out-meta'] = light ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.78)';
      v['--out-tick'] = light ? '#53bdeb' : '#ffffff';
      v['--out-link'] = light ? '#017561' : '#ffffff';
      v['--wave-out'] = light ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.45)';
      v['--wave-on-out'] = light ? 'rgba(0,0,0,.62)' : '#ffffff';
    }
    return v;
  }

  // The theme in force: the open chat's own theme if it has one, else the default.
  const themeChoice = () => (view.chat && settings.chatThemes[view.chat.key]) || settings.chat;
  // The theme the Chat theme page is editing ("All chats" or "Only this chat").
  function themeTarget(create) {
    const chat = view.chat;
    if (drawer.themeScope === 'chat' && chat) {
      if (!settings.chatThemes[chat.key] && create) {
        const g = settings.chat;
        settings.chatThemes[chat.key] = { id: g.id, bubble: g.bubble, wall: g.wall, doodles: g.doodles, image: false };
      }
      return settings.chatThemes[chat.key] || settings.chat;
    }
    return settings.chat;
  }
  function applyChatTheme() {
    const v = themeVars(themeChoice(), root.dataset.theme === 'dark');
    for (const k of THEME_KEYS) {
      if (v[k] == null) root.style.removeProperty(k); else root.style.setProperty(k, v[k]);
    }
  }
  function applyAppTheme() {
    root.dataset.theme = settings.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyChatTheme();
  }
  function saveSettings() {
    Store.saveSettings(settings).catch(() => toast("Couldn't save your settings"));
  }
  // Inline style for a theme thumbnail (must not inherit the theme currently applied).
  function thumbStyle(theme) {
    const dark = root.dataset.theme === 'dark';
    const v = Object.assign({ '--wall-img': 'none', '--wall-dim': 'transparent' }, BASE_VARS[dark ? 'dark' : 'light']);
    const t = themeVars({ id: theme.id, doodles: true }, dark);
    for (const k in t) if (t[k] != null) v[k] = t[k];
    return Object.keys(v).map(k => k + ':' + v[k]).join(';');
  }

  // ---------------------------------------------------------------- state
  const state = { parts: [], chats: [], filter: 'all', query: '', tab: 'chats' };
  const view = { chat: null, lo: 0, hi: 0 };
  const drawer = { view: 'main', themeScope: 'all' };
  const CHUNK = 120, INITIAL = 160, MAX_ROWS = 1200, BARS = 40;

  const dom = {
    list: $('#chat-list'), intro: $('#intro'), convo: $('#convo'), preview: $('#theme-preview'),
    scroller: $('#scroller'), msgs: $('#msgs'), floatDate: $('#float-date'), toBottom: $('#to-bottom'),
    searchPanel: $('#search-panel'), results: $('#search-results'), searchInput: $('#search-input'), jumpDate: $('#jump-date'),
    infoPanel: $('#info-panel'), mediaModal: $('#media-modal'), settings: $('#settings'), settingsBody: $('#settings-body'),
    lightbox: $('#lightbox'), modal: $('#modal'), modalBox: $('#modal-box'), toast: $('#toast'),
    fileInput: $('#file-input'), wallInput: $('#wall-input'), veil: $('#drop-veil'),
  };

  const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', bmp: 'image/bmp',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp', mkv: 'video/x-matroska',
    opus: 'audio/ogg', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac', wav: 'audio/wav', amr: 'audio/amr',
    pdf: 'application/pdf', txt: 'text/plain', vcf: 'text/vcard',
  };
  const extOf = f => (f.split('.').pop() || '').toLowerCase();

  // ---------------------------------------------------------------- dates
  const dayStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function numericDate(ts, chat) {
    const d = new Date(ts);
    return chat && chat.monthFirst
      ? (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear()
      : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function dayLabel(ts, chat) {
    const diff = Math.round((dayStart(Date.now()) - dayStart(ts)) / DAY);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return new Date(ts).toLocaleDateString('en-US', { weekday: 'long' });
    return numericDate(ts, chat);
  }
  const longDate = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const monthYear = ts => new Date(ts).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  function fmtDur(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    sec = Math.round(sec);
    return Math.floor(sec / 60) + ':' + pad(sec % 60);
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' kB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  // Section a gallery item falls in: this week, last week, then calendar months.
  function bucketOf(ts) {
    const now = new Date();
    const week0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime();
    const week1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7).getTime();
    const md = t => new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    if (ts >= week0) return { key: 'w0', title: 'This week', sub: md(week0) + ' – ' + md(now.getTime()) + ', ' + now.getFullYear() };
    if (ts >= week1) return { key: 'w1', title: 'Last week', sub: md(week1) + ' – ' + md(week0 - DAY / 2) + ', ' + new Date(week1).getFullYear() };
    const d = new Date(ts), y = d.getFullYear(), mo = d.getMonth();
    const name = d.toLocaleDateString('en-US', { month: 'long' });
    const last = new Date(y, mo + 1, 0).getDate();
    return { key: y + '-' + mo, title: y === now.getFullYear() ? name : name + ' ' + y, sub: name + ' 1 – ' + last + ', ' + y };
  }

  // ---------------------------------------------------------------- chat model
  function baseNameFrom(fileName, txtName) {
    const fromTxt = txtName && /WhatsApp Chat with (.+)\.txt$/i.exec(txtName.split('/').pop());
    if (fromTxt) return fromTxt[1].trim();
    const n = fileName.replace(/\.(zip|txt)$/i, '').replace(/\s*\(\d+\)$/, '')
      .replace(/^WhatsApp Chat\s*(with|-)?\s*/i, '').replace(/^_chat$/i, '').trim();
    return n || 'WhatsApp chat';
  }

  function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h;
  }

  // One imported file. Parts that share a chat name are shown as a single merged chat.
  async function loadPart(rec) {
    const part = { rec, zip: null, files: new Map() };
    let text, txtName = null;
    if (/\.txt$/i.test(rec.fileName)) {
      text = await (await rec.source.blob(0, rec.source.size, 'text/plain')).text();
    } else {
      part.zip = await Zip.open(rec.source);
      const names = [...part.zip.entries.keys()];
      txtName = names.find(n => /(^|\/)_chat\.txt$/i.test(n)) ||
        names.find(n => /\.txt$/i.test(n) && !n.includes('/')) ||
        names.find(n => /\.txt$/i.test(n));
      if (!txtName) throw new Error('No chat text found in "' + rec.fileName + '". Is it a WhatsApp export?');
      text = await part.zip.text(txtName);
      for (const n of names) if (n !== txtName) part.files.set(norm(n), n);
    }
    const parsed = WAParser.parse(text);
    if (!parsed.messages.length) throw new Error('No messages found in "' + rec.fileName + '".');
    part.msgs = parsed.messages;
    part.monthFirst = parsed.monthFirst;
    part.baseName = baseNameFrom(rec.fileName, txtName);
    return part;
  }
  const partKey = part => (settings.separate.includes(part.rec.id) ? lc(part.baseName) + '|' + part.rec.id : lc(part.baseName));

  // Combines several exports of one chat. A message present in more than one export is kept
  // once; where one export left media out and another has it, the one with the file wins.
  function mergeMessages(parts, fileMap) {
    let out;
    if (parts.length === 1) out = parts[0].msgs;
    else {
      const seen = new Map();
      out = [];
      const has = m => !!(m.file && fileMap.has(norm(m.file)));
      for (const part of parts) {
        const nth = new Map();
        for (const m of part.msgs) {
          const what = m.type === 'system' ? 's' + m.text : (m.file || m.type === 'omitted') ? 'media' : m.type + '|' + (m.text || '');
          let k = m.ts + '|' + (m.sender || '') + '|' + what;
          const n = (nth.get(k) || 0) + 1;
          nth.set(k, n);
          k += '#' + n;
          const prev = seen.get(k);
          if (!prev) { seen.set(k, m); out.push(m); }
          else if (has(m) && !has(prev)) Object.assign(prev, m);
        }
      }
      out.sort((a, b) => a.ts - b.ts);
    }
    out.forEach((m, k) => { m.i = k; m.lc = undefined; });
    return out;
  }

  const chatCache = new Map();
  function assembleChat(parts) {
    parts = parts.slice().sort((a, b) => a.rec.addedAt - b.rec.addedAt);
    const sig = parts.map(p => p.rec.id).join('+');
    const cached = chatCache.get(sig);
    if (cached) return cached;
    const chat = {
      id: parts[0].rec.id, sig, key: partKey(parts[0]), parts,
      size: parts.reduce((n, p) => n + (p.rec.size || 0), 0),
      fileMap: new Map(), urls: new Map(), ratios: new Map(), peaks: new Map(), peakJobs: new Map(),
    };
    for (const p of parts) for (const [k, entry] of p.files) if (!chat.fileMap.has(k)) chat.fileMap.set(k, { zip: p.zip, entry });
    chat.msgs = mergeMessages(parts, chat.fileMap);
    chat.monthFirst = parts[0].monthFirst;
    chat.baseName = parts[0].baseName;
    chat.name = chat.baseName;
    chat.me = null;
    chat.counts = new Map();
    chat.visual = []; chat.docs = []; chat.links = []; chat.calls = [];
    chat.linkMap = new Map();
    let groupish = false;
    for (const m of chat.msgs) {
      if (m.type === 'system') {
        if (/created (this )?group|added|joined using|changed the (subject|group)|left$/i.test(m.text)) groupish = true;
        continue;
      }
      chat.counts.set(m.sender, (chat.counts.get(m.sender) || 0) + 1);
      if (m.type === 'call') chat.calls.push(m.i);
      if (m.file && hasFile(chat, m.file)) {
        if (m.type === 'image' || m.type === 'video' || m.type === 'gif') chat.visual.push(m.i);
        else if (m.type === 'document') chat.docs.push(m.i);
      }
      if (m.text && m.type !== 'deleted') {
        const urls = m.text.match(URL_RE);
        if (urls) { chat.links.push(m.i); chat.linkMap.set(m.i, urls); }
      }
    }
    chat.senders = [...chat.counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    chat.isGroup = chat.senders.length > 2 || groupish;
    chat.colors = new Map();
    const palette = ['#1f7aec', '#e542a3', '#02a698', '#d1731b', '#7f66ff', '#c4532d', '#0e8f5a', '#b04ecf', '#d4504e', '#3b8ea5'];
    chat.senders.forEach((name, k) => chat.colors.set(name, palette[k % palette.length]));
    chatCache.set(sig, chat);
    return chat;
  }

  // Regroups every imported file into chats (same-named exports merge) and keeps the open chat open.
  function rebuildChats() {
    const groups = new Map();
    for (const p of state.parts) {
      const k = partKey(p);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    const open = view.chat;
    state.chats = [...groups.values()].map(assembleChat);
    for (const sig of [...chatCache.keys()]) if (!state.chats.some(c => c.sig === sig)) chatCache.delete(sig);
    applyIdentities();
    if (open && !state.chats.includes(open)) {
      const same = state.chats.find(c => c.key === open.key);
      if (same) openChat(same); else closeChat();
    }
  }

  // ---- stars
  function msgKey(m) { return m.ts + ':' + hash32((m.sender || '') + '|' + m.type + '|' + (m.text || '').slice(0, 80)).toString(36); }
  function starSet(chat) { return chat._stars || (chat._stars = new Set(settings.starred[chat.key] || [])); }
  const isStarred = (chat, m) => !!chat.key && starSet(chat).has(msgKey(m));
  function setStar(chat, m, on) {
    const set = starSet(chat), k = msgKey(m);
    if (on) set.add(k); else set.delete(k);
    if (set.size) settings.starred[chat.key] = [...set]; else delete settings.starred[chat.key];
  }
  function rerenderRow(chat, i) {
    if (view.chat !== chat) return;
    const old = dom.msgs.querySelector('.row[data-i="' + i + '"]');
    if (!old) return;
    const fresh = renderMsg(chat, chat.msgs[i], chat.msgs[i - 1]);
    old.replaceWith(fresh);
    observeAll([fresh]);
    syncVoice();
  }
  function toggleStar(chat, m) {
    setStar(chat, m, !isStarred(chat, m));
    saveSettings();
    rerenderRow(chat, m.i);
  }

  // ---- avatars
  const TINTS = ['#e0294a', '#1fa855', '#e2930a', '#1a7fe0', '#7a4fe0', '#0f9d94', '#d6336c', '#c2410c'];
  function initials(name) {
    const words = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
    if (!words[0] || !/\p{L}/u.test(words[0][0])) return '';
    return ([...words[0]][0] + (words[1] ? [...words[1]][0] : '')).toUpperCase();
  }
  const photoName = key => (key === '@me' ? 'av-me' : 'av-' + hash32(key).toString(16));
  function photoOf(key) {
    const c = settings.contacts[key];
    return c && c.photo ? Store.fileURL(photoName(key), c.photo) : null;
  }
  function avatarShell(cls, inner, tint) {
    return '<span class="avatar ' + (tint ? 'tint ' : '') + (cls || '') + '"' + (tint ? ' style="--av:' + tint + '"' : '') + '>' + inner + '</span>';
  }
  function avatarHTML(chat, cls) {
    const url = photoOf(chat.key);
    if (url) return avatarShell(cls, '<img src="' + esc(url) + '" alt="" draggable="false">');
    const ini = chat.isGroup ? '' : initials(chat.name);
    return avatarShell(cls, ini ? '<b>' + esc(ini) + '</b>' : ICON[chat.isGroup ? 'group' : 'person'], TINTS[hash32(chat.key) % TINTS.length]);
  }
  function meAvatarHTML(cls) {
    const url = photoOf('@me');
    return avatarShell(cls, url ? '<img src="' + esc(url) + '" alt="" draggable="false">' : ICON.person);
  }
  function senderAvatar(chat, sender, cls) {
    if (chat.me && sender === chat.me) return meAvatarHTML(cls);
    if (!chat.isGroup) return avatarHTML(chat, cls);
    const ini = initials(sender || '');
    return avatarShell(cls, ini ? '<b>' + esc(ini) + '</b>' : ICON.person, chat.colors.get(sender) || TINTS[0]);
  }
  function refreshAvatars() {
    $('#me-avatar').innerHTML = meAvatarHTML('sm');
    if (view.chat) $('#convo-avatar').innerHTML = avatarHTML(view.chat, 'md');
    renderList();
  }

  // Works out which sender is "you" in every chat. A name picked in Settings wins;
  // otherwise it is whoever the one-to-one chats are not named after.
  let detectedMe = null;
  function applyIdentities() {
    const tally = new Map();
    for (const chat of state.chats) {
      const s = chat.senders;
      const match = s.find(x => lc(x) === lc(chat.baseName));
      let me = settings.me ? s.find(x => lc(x) === lc(settings.me)) || null : null;
      if (!me && !chat.isGroup) {
        let guess = null;
        if (s.length === 2 && match) guess = s.find(x => x !== match);
        else if (s.length === 1 && !match) guess = s[0];
        if (guess) { tally.set(guess, (tally.get(guess) || 0) + 1); if (!settings.me) me = guess; else me = guess; }
      }
      chat.me = me;
    }
    detectedMe = null;
    let best = 0;
    tally.forEach((n, name) => { if (n > best) { best = n; detectedMe = name; } });
    const common = settings.me || detectedMe;
    for (const chat of state.chats) {
      if (!chat.me && common) chat.me = chat.senders.find(x => lc(x) === lc(common)) || null;
      const s = chat.senders;
      chat.name = (!chat.isGroup && s.length === 2 && chat.me) ? s.find(x => x !== chat.me) : chat.baseName;
      const custom = settings.contacts[chat.key];
      if (custom && custom.name) chat.name = custom.name;
      chat.visualItems = null;
    }
  }

  const fileRef = (chat, file) => (file && chat.fileMap ? chat.fileMap.get(norm(file)) : null);
  function hasFile(chat, file) { return !!fileRef(chat, file); }
  function fileSize(chat, file) { const r = fileRef(chat, file); const e = r && r.zip.entries.get(r.entry); return e ? e.size : 0; }
  function mediaBlob(chat, file) { const r = fileRef(chat, file); return r.zip.blob(r.entry, MIME[extOf(file)] || ''); }
  function mediaURL(chat, file) {
    const key = norm(file);
    let p = chat.urls.get(key);
    if (!p) {
      const r = fileRef(chat, file);
      p = r.zip.url(r.entry, MIME[extOf(file)] || 'application/octet-stream');
      chat.urls.set(key, p);
    }
    return p;
  }

  // ---------------------------------------------------------------- text formatting
  const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
  const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[‍️⃣]|\s)+$/u;
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

  function emojiClass(text) {
    if (text.length > 40 || !PICTO.test(text) || !EMOJI_ONLY.test(text)) return '';
    const compact = text.replace(/\s/g, '');
    const count = segmenter ? [...segmenter.segment(compact)].length : Math.ceil([...compact].length / 2);
    return count >= 1 && count <= 3 ? ' emoji-' + count : '';
  }

  function inline(s) {
    return esc(s)
      .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1<strong>$2</strong>')
      .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, '$1<em>$2</em>')
      .replace(/(^|[^\w~])~(?=\S)([^~\n]*?\S)~(?![\w~])/g, '$1<del>$2</del>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/@⁨([^⁩\n]+)⁩/g, '<span class="mention">@$1</span>')
      .replace(/[⁦-⁩]/g, '');
  }
  const hrefOf = u => (/^www\./i.test(u) ? 'http://' + u : u);

  function fmt(text) {
    const re = new RegExp(URL_RE.source, 'gi');
    let out = '', last = 0, m;
    while ((m = re.exec(text))) {
      out += inline(text.slice(last, m.index));
      out += '<a href="' + esc(hrefOf(m[0])) + '" target="_blank" rel="noopener noreferrer">' + esc(m[0]) + '</a>';
      last = m.index + m[0].length;
    }
    return out + inline(text.slice(last));
  }

  // ---------------------------------------------------------------- message rendering
  const OMIT_LABEL = { image: 'Photo', video: 'Video', audio: 'Audio', gif: 'GIF', sticker: 'Sticker', document: 'Document', 'contact card': 'Contact card', 'video note': 'Video note', media: 'Media', contact: 'Contact card' };
  const OMIT_ICON = { image: 'image', video: 'videoFill', gif: 'videoFill', 'video note': 'videoFill', audio: 'headset', document: 'doc', 'contact card': 'person', contact: 'person' };

  function metaHTML(m, out, chat) {
    const star = chat && isStarred(chat, m);
    return '<span class="meta">' + (star ? '<span class="st">' + ICON.star + '</span>' : '') + (m.edited ? '<span>Edited</span>' : '') +
      '<span>' + m.time + '</span>' + (out ? ICON.ticks : '') + '</span>';
  }
  let renderChat = null; // the chat renderMsg is working on, so the spacer can allow for a star
  function ghostHTML(m, out) {
    const star = renderChat && isStarred(renderChat, m);
    return '<span class="ghost">' + (star ? '<i></i>' : '') + (m.edited ? 'Edited ' : '') + m.time + (out ? '<i></i>' : '') + '</span>';
  }
  function captionHTML(m, out) {
    return m.text ? '<div class="caption text">' + fmt(m.text) + ghostHTML(m, out) + '</div>' : '';
  }
  function barsHTML() {
    let s = '';
    for (let k = 0; k < BARS; k++) s += '<i></i>';
    return s;
  }

  function renderMsg(chat, m, prev) {
    if (m.type === 'system') {
      const s = el('div', 'sys', '<span>' + esc(m.text) + '</span>');
      s.dataset.i = m.i;
      return s;
    }
    renderChat = chat;
    const out = !!chat.me && m.sender === chat.me;
    const first = !prev || prev.type === 'system' || prev.sender !== m.sender || prev.day !== m.day;
    const row = el('div', 'row ' + (out ? 'out' : 'in') + (first ? ' first' : ''));
    row.dataset.i = m.i;

    let cls = 'bubble';
    let html = '<span class="tail">' + ICON.tail + '</span>';
    if (chat.isGroup && !out && first) {
      html += '<div class="sender" style="color:' + chat.colors.get(m.sender) + '">' + esc(m.sender) + '</div>';
    }
    const meta = metaHTML(m, out, chat);
    const cap = m.text ? ' has-caption' : '';
    let type = m.type;
    if (m.file && !hasFile(chat, m.file)) type = 'missing';

    switch (type) {
      case 'image':
      case 'video':
      case 'gif':
      case 'sticker': {
        const key = norm(m.file);
        const ratio = chat.ratios.get(key);
        const style = ratio && type !== 'sticker' ? ' style="aspect-ratio:' + ratio + '"' : '';
        const attrs = ' data-file="' + esc(m.file) + '"' + style;
        cls += type === 'sticker' ? ' sticker' : ' media' + cap;
        if (type === 'image' || type === 'sticker') {
          html += '<div class="img" data-load="' + type + '"' + attrs + '><img alt="" draggable="false"></div>';
        } else if (type === 'video') {
          html += '<div class="img" data-load="video"' + attrs + '><video muted playsinline preload="metadata"></video>' +
            '<span class="play-badge">' + ICON.play + '</span><span class="dur-badge">' + ICON.videoFill + '<span></span></span></div>';
        } else {
          html += '<div class="img" data-load="gif"' + attrs + '><video muted loop autoplay playsinline></video></div>';
        }
        html += (type === 'sticker' ? '' : captionHTML(m, out)) + meta;
        break;
      }
      case 'audio':
        cls += ' voice' + cap;
        html += '<div class="voice-box" data-load="voice" data-file="' + esc(m.file) + '" data-i="' + m.i + '">' +
          '<div class="v-side">' + senderAvatar(chat, m.sender, '') + '<span class="mic">' + ICON.mic + '</span>' +
          '<button class="v-speed" title="Playback speed">1×</button></div>' +
          '<button class="v-play" title="Play">' + ICON.play + '</button>' +
          '<div class="v-mid"><div class="v-wave"><div class="v-bars">' + barsHTML() + '</div><div class="v-bars on">' + barsHTML() + '</div>' +
          '<span class="v-knob"></span></div><span class="v-time">&nbsp;</span></div></div>' + captionHTML(m, out) + meta;
        break;
      case 'document': {
        const name = m.title || displayName(m.file);
        const info = [extOf(m.file).toUpperCase(), m.docMeta, fmtSize(fileSize(chat, m.file))].filter(Boolean).join(' · ');
        cls += ' doc' + cap;
        html += '<a class="card" href="#" data-doc="' + esc(m.file) + '" title="' + esc(name) + '"><span class="ico">' + ICON.doc + '</span>' +
          '<span class="info"><div class="title">' + esc(name) + '</div><div class="small">' + esc(info) + '</div></span>' +
          '<span class="dl">' + ICON.download + '</span></a>' + captionHTML(m, out) + meta;
        break;
      }
      case 'contact': {
        const name = displayName(m.file).replace(/\.vcf$/i, '');
        cls += ' contact';
        html += '<div class="card" data-contact="' + esc(m.file) + '">' + avatarShell('', ICON.person) +
          '<span class="info"><div class="title">' + esc(name) + '</div></span></div>' + meta +
          '<div class="contact-actions"><button>Message</button><button>Add to a group</button></div>';
        break;
      }
      case 'location':
        cls += ' loc';
        html += '<a class="plain" href="' + esc(m.url) + '" target="_blank" rel="noopener noreferrer">' +
          '<span class="map"><span class="pin">' + ICON.pin + '</span></span>' +
          '<div class="loc-foot"><div>Location</div><div class="small">' +
          (m.lat != null ? m.lat.toFixed(5) + ', ' + m.lng.toFixed(5) + ' · ' : '') + 'Open in Google Maps</div></div></a>' + meta;
        break;
      case 'call': {
        const title = (m.missed && !/no answer/i.test(m.detail) ? 'Missed ' : '') + (m.group ? 'group ' : '') + (m.video ? 'video' : 'voice') + ' call';
        const detail = /tap to call back/i.test(m.detail) ? '' : m.detail;
        cls += ' callmsg';
        html += '<div class="card"><span class="ico round' + (m.missed ? ' missed' : '') + '">' + (m.video ? ICON.videoFill : ICON.call) + '</span>' +
          '<span class="info"><div class="title">' + esc(title.charAt(0).toUpperCase() + title.slice(1)) + '</div>' +
          '<div class="small">' + esc(detail || (m.missed ? 'No answer' : 'Call')) + '</div></span></div>' + meta;
        break;
      }
      case 'omitted':
      case 'missing': {
        const kind = type === 'missing' ? m.type : m.omitted;
        const label = (OMIT_LABEL[kind] || 'Media') + (type === 'missing' ? ' not found in this export' : ' not included in export');
        html += '<div class="omitted">' + (ICON[OMIT_ICON[kind]] || ICON.doc) + '<span>' + esc(label) + '</span>' + (m.text ? '' : ghostHTML(m, out)) + '</div>' +
          (m.text ? '<div class="text">' + fmt(m.text) + ghostHTML(m, out) + '</div>' : '') + meta;
        break;
      }
      case 'deleted':
        html += '<div class="deleted">' + ICON.ban + '<span>' + esc(m.text) + '</span>' + ghostHTML(m, out) + '</div>' + meta;
        break;
      case 'poll': {
        const max = Math.max(1, ...m.options.map(o => o.votes));
        html += '<div class="poll"><div class="q">' + esc(m.question) + '</div>' + m.options.map(o =>
          '<div class="opt-row"><div class="lbl"><span>' + esc(o.text) + '</span><span>' + o.votes + '</span></div>' +
          '<div class="bar"><i style="width:' + Math.round(o.votes / max * 100) + '%"></i></div></div>').join('') + '</div>' + meta;
        break;
      }
      default:
        html += linkCardSlot(chat, m) + '<div class="text' + emojiClass(m.text) + '">' + fmt(m.text) + ghostHTML(m, out) + '</div>' + meta;
    }

    if (chat.key) html += '<button class="msg-menu" title="Message options">' + ICON.down + '</button>';
    row.appendChild(el('div', cls, html));
    return row;
  }

  function nodesFor(chat, i, into) {
    const m = chat.msgs[i], prev = chat.msgs[i - 1];
    if (!prev || prev.day !== m.day) {
      const d = el('div', 'day', '<span>' + esc(dayLabel(m.ts, chat)) + '</span>');
      d.dataset.i = i;
      into.push(d);
    }
    into.push(renderMsg(chat, m, prev));
  }

  // ---------------------------------------------------------------- windowed list
  let io = null;
  function observer() {
    if (!io) {
      io = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (e.isIntersecting) { io.unobserve(e.target); hydrate(e.target); }
        }
      }, { root: dom.scroller, rootMargin: '900px 0px' });
    }
    return io;
  }
  function observeAll(nodes) {
    const o = observer();
    for (const n of nodes) n.querySelectorAll('[data-load]').forEach(x => o.observe(x));
  }
  function buildRange(chat, from, to) {
    const nodes = [];
    for (let i = from; i < to; i++) nodesFor(chat, i, nodes);
    const frag = document.createDocumentFragment();
    nodes.forEach(n => frag.appendChild(n));
    return { nodes, frag };
  }
  function mountRange(lo, hi) {
    if (io) io.disconnect();
    dom.msgs.textContent = '';
    const { nodes, frag } = buildRange(view.chat, lo, hi);
    dom.msgs.appendChild(frag);
    view.lo = lo; view.hi = hi;
    observeAll(nodes);
    syncVoice();
  }
  function dropNode(n) {
    n.querySelectorAll('[data-load]').forEach(x => io && io.unobserve(x));
    n.remove();
  }
  function prependChunk() {
    const sc = dom.scroller;
    const lo = Math.max(0, view.lo - CHUNK);
    const { nodes, frag } = buildRange(view.chat, lo, view.lo);
    const h0 = sc.scrollHeight, st = sc.scrollTop;
    dom.msgs.insertBefore(frag, dom.msgs.firstChild);
    view.lo = lo;
    sc.scrollTop = st + (sc.scrollHeight - h0);
    observeAll(nodes);
    if (view.hi - view.lo > MAX_ROWS) {
      const hi = view.lo + MAX_ROWS;
      while (dom.msgs.lastChild && +dom.msgs.lastChild.dataset.i >= hi) dropNode(dom.msgs.lastChild);
      view.hi = hi;
    }
    syncVoice();
  }
  function appendChunk() {
    const sc = dom.scroller;
    const hi = Math.min(view.chat.msgs.length, view.hi + CHUNK);
    const { nodes, frag } = buildRange(view.chat, view.hi, hi);
    dom.msgs.appendChild(frag);
    view.hi = hi;
    observeAll(nodes);
    if (view.hi - view.lo > MAX_ROWS) {
      const lo = view.hi - MAX_ROWS;
      const h0 = sc.scrollHeight, st = sc.scrollTop;
      while (dom.msgs.firstChild && +dom.msgs.firstChild.dataset.i < lo) dropNode(dom.msgs.firstChild);
      view.lo = lo;
      sc.scrollTop = st - (h0 - sc.scrollHeight);
    }
    syncVoice();
  }

  // Run a size-changing mutation without the visible messages jumping.
  function keepScroll(node, fn) {
    const sc = dom.scroller;
    if (!node.isConnected || !view.chat) { fn(); return; }
    const pinned = view.hi === view.chat.msgs.length && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 6;
    const above = node.getBoundingClientRect().top < sc.getBoundingClientRect().top;
    const h0 = sc.scrollHeight;
    fn();
    const dh = sc.scrollHeight - h0;
    if (!dh) return;
    if (pinned) sc.scrollTop = sc.scrollHeight;
    else if (above) sc.scrollTop += dh;
  }

  let floatTimer = 0;
  function handleScroll() {
    const chat = view.chat, sc = dom.scroller;
    if (!chat) return;
    if (sc.scrollTop < 1600 && view.lo > 0) prependChunk();
    else if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 1600 && view.hi < chat.msgs.length) appendChunk();
    const fromBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    dom.toBottom.hidden = !(fromBottom > 500 || view.hi < chat.msgs.length);

    // Floating date pill for the topmost visible message.
    const kids = dom.msgs.children;
    if (fromBottom > 60 && kids.length) {
      let a = 0, b = kids.length - 1;
      const top = sc.scrollTop + 4;
      while (a < b) {
        const mid = (a + b) >> 1;
        if (kids[mid].offsetTop + kids[mid].offsetHeight > top) b = mid; else a = mid + 1;
      }
      const m = chat.msgs[+kids[a].dataset.i];
      // A day divider already sitting at the top says the same thing.
      const dup = kids[a].classList.contains('day') || (a > 0 && kids[a - 1].classList.contains('day') && kids[a - 1].offsetTop + 30 > sc.scrollTop);
      if (dup) dom.floatDate.classList.remove('show');
      else if (m) {
        dom.floatDate.firstElementChild.textContent = dayLabel(m.ts, chat);
        dom.floatDate.classList.add('show');
        clearTimeout(floatTimer);
        floatTimer = setTimeout(() => dom.floatDate.classList.remove('show'), 1400);
      }
    } else {
      dom.floatDate.classList.remove('show');
    }
  }

  function scrollToBottom() {
    const chat = view.chat;
    if (!chat) return;
    const n = chat.msgs.length;
    if (view.hi < n) mountRange(Math.max(0, n - INITIAL), n);
    dom.scroller.scrollTop = dom.scroller.scrollHeight;
    dom.toBottom.hidden = true;
  }

  function jumpTo(i) {
    const chat = view.chat;
    if (!chat) return;
    const n = chat.msgs.length;
    if (i < view.lo || i >= view.hi) mountRange(Math.max(0, i - CHUNK), Math.min(n, i + CHUNK));
    const node = dom.msgs.querySelector('[data-i="' + i + '"]:not(.day)') || dom.msgs.querySelector('[data-i="' + i + '"]');
    if (!node) return;
    const sc = dom.scroller;
    sc.scrollTop = Math.max(0, node.offsetTop - (sc.clientHeight - node.offsetHeight) / 2);
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
  }

  function goToMessage(chat, i) {
    closeLightbox();
    dom.mediaModal.hidden = true;
    $('#insights-modal').hidden = true;
    if (state.tab === 'memories' && window.innerWidth <= 760) setTab('chats');
    if (view.chat !== chat) openChat(chat);
    else if (window.innerWidth <= 760) closePanels();
    jumpTo(i);
  }

  // ---------------------------------------------------------------- lazy media
  function applyRatio(node, w, h, file) {
    if (!w || !h) return;
    const ratio = +clamp(w / h, 0.62, 2.4).toFixed(4);
    view.chat.ratios.set(norm(file), ratio);
    if (node.style.aspectRatio === String(ratio)) return;
    keepScroll(node, () => { node.style.aspectRatio = ratio; });
  }

  function hydrate(node) {
    const chat = view.chat;
    if (!chat || !node.isConnected) return;
    const kind = node.dataset.load, file = node.dataset.file;
    if (kind === 'voice') { loadVoice(chat, node, file); return; }
    if (kind === 'preview') { loadLinkCard(node); return; }
    mediaURL(chat, file).then(url => {
      if (!node.isConnected) return;
      const media = node.firstElementChild;
      if (kind === 'image' || kind === 'sticker') {
        media.onload = () => {
          if (kind === 'image') applyRatio(node, media.naturalWidth, media.naturalHeight, file);
          node.classList.add('loaded');
        };
        media.src = url;
      } else {
        media.onloadedmetadata = () => {
          applyRatio(node, media.videoWidth, media.videoHeight, file);
          const badge = node.querySelector('.dur-badge span');
          if (badge) badge.textContent = fmtDur(media.duration);
        };
        media.onloadeddata = () => node.classList.add('loaded');
        media.src = kind === 'video' ? url + '#t=0.1' : url;
      }
    }).catch(() => { node.classList.add('loaded'); });
  }

  // ---- voice messages
  const decodeQueue = [];
  let decoding = 0, liveCtx = null;
  function decodeAudio(buf) {
    let ctx;
    try { ctx = new OfflineAudioContext(1, 1, 8000); }
    catch (e) { ctx = liveCtx || (liveCtx = new (window.AudioContext || window.webkitAudioContext)()); }
    return new Promise((res, rej) => {
      const p = ctx.decodeAudioData(buf, res, rej);
      if (p && p.catch) p.catch(rej);
    });
  }
  function pumpDecodes() {
    while (decoding < 2 && decodeQueue.length) {
      const job = decodeQueue.shift();
      decoding++;
      job().finally(() => { decoding--; pumpDecodes(); });
    }
  }
  function voiceInfo(chat, file) {
    const key = norm(file);
    let p = chat.peakJobs.get(key);
    if (p) return p;
    p = new Promise(resolve => {
      decodeQueue.push(() => mediaBlob(chat, file)
        .then(b => b.arrayBuffer())
        .then(decodeAudio)
        .then(ab => {
          const data = ab.getChannelData(0);
          const step = Math.max(1, Math.floor(data.length / BARS));
          const peaks = [];
          let top = 0;
          for (let k = 0; k < BARS; k++) {
            let sum = 0;
            const from = k * step, to = Math.min(data.length, from + step);
            for (let j = from; j < to; j += 4) sum += data[j] * data[j];
            const v = Math.sqrt(sum / Math.max(1, (to - from) / 4));
            peaks.push(v);
            if (v > top) top = v;
          }
          return { dur: ab.duration, peaks: peaks.map(v => (top ? Math.pow(v / top, 0.7) : 0)) };
        })
        .catch(() => ({ dur: 0, peaks: null }))
        .then(info => { chat.peaks.set(key, info); resolve(info); }));
      pumpDecodes();
    });
    chat.peakJobs.set(key, p);
    return p;
  }
  function paintVoice(node, info) {
    if (info.peaks) {
      node.querySelectorAll('.v-bars').forEach(group => {
        const bars = group.children;
        for (let k = 0; k < bars.length; k++) bars[k].style.height = Math.max(3, Math.round(info.peaks[k] * 26)) + 'px';
      });
    }
    const t = node.querySelector('.v-time');
    if (!node.classList.contains('active')) t.textContent = info.dur ? fmtDur(info.dur) : '';
  }
  function loadVoice(chat, node, file) {
    const ready = chat.peaks.get(norm(file));
    if (ready) { paintVoice(node, ready); return; }
    voiceInfo(chat, file).then(info => { if (node.isConnected) paintVoice(node, info); });
  }

  const audio = new Audio();
  let playing = null, rate = 1, rafId = 0;
  const totalDur = () => (playing && playing.dur) || (isFinite(audio.duration) ? audio.duration : 0);

  function syncVoice() {
    if (!playing || playing.chat !== view.chat) return;
    const node = dom.msgs.querySelector('.voice-box[data-i="' + playing.i + '"]');
    if (!node) return;
    const active = !audio.paused;
    node.classList.add('active');
    node.classList.toggle('playing', active);
    const btn = node.querySelector('.v-play');
    if (btn.dataset.s !== String(active)) { btn.dataset.s = String(active); btn.innerHTML = active ? ICON.pause : ICON.play; }
    const dur = totalDur();
    node.querySelector('.v-wave').style.setProperty('--p', (dur ? clamp(audio.currentTime / dur, 0, 1) * 100 : 0) + '%');
    node.querySelector('.v-time').textContent = fmtDur(audio.currentTime);
    node.querySelector('.v-speed').textContent = rate + '×';
  }
  function resetVoice() {
    if (!playing) return;
    const node = playing.chat === view.chat && dom.msgs.querySelector('.voice-box[data-i="' + playing.i + '"]');
    if (node) {
      node.classList.remove('active', 'playing');
      const btn = node.querySelector('.v-play');
      btn.dataset.s = 'false'; btn.innerHTML = ICON.play;
      node.querySelector('.v-wave').style.setProperty('--p', '0%');
      node.querySelector('.v-time').textContent = playing.dur ? fmtDur(playing.dur) : '';
    }
    playing = null;
  }
  function stopVoice() {
    audio.pause();
    cancelAnimationFrame(rafId);
    resetVoice();
  }
  function loopVoice() {
    syncVoice();
    if (playing && !audio.paused) rafId = requestAnimationFrame(loopVoice);
  }
  function seekVoice(frac) {
    const dur = totalDur();
    if (dur) { audio.currentTime = clamp(frac, 0, 1) * dur; syncVoice(); }
  }
  async function playVoice(chat, i, frac) {
    if (playing && playing.chat === chat && playing.i === i) {
      if (frac != null) seekVoice(frac);
      else if (audio.paused) audio.play(); else audio.pause();
      return;
    }
    stopVoice();
    const m = chat.msgs[i];
    const info = chat.peaks.get(norm(m.file));
    const mine = playing = { chat, i, dur: info ? info.dur : 0 };
    try {
      const url = await mediaURL(chat, m.file);
      if (playing !== mine) return;
      audio.src = url;
      audio.playbackRate = rate;
      if (frac) audio.addEventListener('loadedmetadata', () => { if (playing === mine) seekVoice(frac); }, { once: true });
      await audio.play();
    } catch (e) {
      if (playing === mine) { resetVoice(); toast("Couldn't play this audio in this browser"); }
    }
  }
  audio.addEventListener('play', loopVoice);
  audio.addEventListener('pause', syncVoice);
  audio.addEventListener('ended', () => {
    const done = playing;
    cancelAnimationFrame(rafId);
    resetVoice();
    if (!done) return;
    // Like WhatsApp, continue with the next voice message in a run.
    const cur = done.chat.msgs[done.i], next = done.chat.msgs[done.i + 1];
    if (next && next.type === 'audio' && next.sender === cur.sender && hasFile(done.chat, next.file)) playVoice(done.chat, next.i);
  });

  // ---------------------------------------------------------------- sidebar: chats and calls
  function listWhen(m, chat) {
    const diff = Math.round((dayStart(Date.now()) - dayStart(m.ts)) / DAY);
    return diff === 0 ? m.time : dayLabel(m.ts, chat);
  }
  function previewText(m) {
    switch (m.type) {
      case 'image': return ['image', m.text || 'Photo'];
      case 'video': return ['videoFill', m.text || 'Video'];
      case 'gif': return ['videoFill', m.text || 'GIF'];
      case 'sticker': return [null, 'Sticker'];
      case 'audio': return ['headset', 'Audio'];
      case 'document': return ['doc', m.title || displayName(m.file)];
      case 'contact': return ['person', displayName(m.file).replace(/\.vcf$/i, '')];
      case 'location': return ['pin', 'Location'];
      case 'call': return [m.video ? 'videoFill' : 'call', (m.missed ? 'Missed ' : '') + (m.video ? 'video' : 'voice') + ' call'];
      case 'omitted': return [OMIT_ICON[m.omitted] || null, m.text || OMIT_LABEL[m.omitted] || 'Media'];
      case 'deleted': return ['ban', m.text];
      case 'poll': return [null, 'Poll: ' + m.question];
      default: return [null, m.text];
    }
  }
  function previewHTML(chat, m) {
    const out = !!chat.me && m.sender === chat.me;
    const [icon, text] = previewText(m);
    let h = '';
    if (m.type !== 'system' && out) h += '<span class="ticks">' + ICON.ticks + '</span>';
    if (m.type !== 'system' && chat.isGroup && !out && m.sender) h += '<span>' + esc(m.sender.split(' ')[0]) + ':&nbsp;</span>';
    if (icon) h += ICON[icon];
    return h + '<span class="t">' + esc((text || '').replace(/\s+/g, ' ').slice(0, 140)) + '</span>';
  }
  const lastTs = c => c.msgs[c.msgs.length - 1].ts;

  function renderList() {
    $('#groups-count').textContent = String(state.chats.filter(c => c.isGroup).length || '');
    if (state.tab === 'calls') { renderCalls(); return; }
    if (state.tab === 'memories') { renderMemories(); return; }
    if (globalSearchActive()) { renderGlobalSearch(); return; }
    const q = state.query.trim().toLowerCase();
    let chats = state.chats.slice().sort((a, b) => lastTs(b) - lastTs(a));
    if (q) chats = chats.filter(c => c.name.toLowerCase().includes(q));
    if (state.filter === 'groups') chats = chats.filter(c => c.isGroup);
    if (state.filter === 'unread' || state.filter === 'favorites') chats = [];
    dom.list.textContent = '';
    if (!chats.length) {
      const msg = !state.chats.length ? 'No chats yet.<br>Import an exported WhatsApp chat to get started.'
        : state.filter === 'unread' ? 'No unread chats'
        : state.filter === 'favorites' ? 'No favorites'
        : state.filter === 'groups' ? 'No groups' : 'No chats found';
      dom.list.appendChild(el('div', 'list-empty', msg));
      return;
    }
    for (const chat of chats) {
      const last = chat.msgs[chat.msgs.length - 1];
      const b = el('button', 'chat-item' + (chat === view.chat ? ' on' : ''),
        avatarHTML(chat, 'lg') +
        '<span class="body"><span class="top"><span class="name">' + esc(chat.name) + '</span><span class="when">' + esc(listWhen(last, chat)) + '</span></span>' +
        '<span class="bottom"><span class="preview">' + previewHTML(chat, last) + '</span></span></span>');
      b.addEventListener('click', () => openChat(chat));
      dom.list.appendChild(b);
    }
  }

  function renderCalls() {
    const q = state.query.trim().toLowerCase();
    const calls = [];
    for (const chat of state.chats) {
      if (q && !chat.name.toLowerCase().includes(q)) continue;
      for (const i of chat.calls) calls.push({ chat, m: chat.msgs[i] });
    }
    calls.sort((a, b) => b.m.ts - a.m.ts);
    dom.list.textContent = '';
    if (!calls.length) {
      dom.list.appendChild(el('div', 'list-empty', state.chats.length ? 'No calls found in your imported chats.' : 'No chats yet.<br>Calls from your imported chats will show up here.'));
      return;
    }
    dom.list.appendChild(el('div', 'list-head', 'Recent'));
    for (const { chat, m } of calls) {
      const out = !!chat.me && m.sender === chat.me;
      const missed = m.missed && !out;
      const kind = missed ? 'Missed' : out ? 'Outgoing' : 'Incoming';
      const extra = [m.video ? 'Video' : '', /tap to call back/i.test(m.detail) ? '' : m.detail].filter(Boolean).join(' · ');
      const b = el('button', 'chat-item',
        avatarHTML(chat, 'lg') +
        '<span class="body"><span class="top"><span class="name">' + esc(chat.name) + '</span><span class="when">' + esc(listWhen(m, chat)) + '</span></span>' +
        '<span class="bottom"><span class="preview' + (missed ? ' missed' : '') + '">' + ICON[missed ? 'callMissed' : out ? 'callMade' : 'callReceived'] +
        '<span class="t">' + kind + (extra ? ' · ' + esc(extra) : '') + '</span></span></span></span>');
      b.addEventListener('click', () => goToMessage(chat, m.i));
      dom.list.appendChild(b);
    }
  }

  function setTab(tab) {
    state.tab = tab;
    closeSettings(true);
    $('#side-title').textContent = { calls: 'Calls', memories: 'Memories' }[tab] || 'Chats';
    $('#chips').hidden = tab !== 'chats';
    $('#filter-btn').hidden = tab !== 'chats';
    $('#chat-filter').placeholder = tab === 'chats' ? 'Search or start a new chat' : 'Search name or number';
    setRail('rail-' + tab);
    renderList();
  }
  function setRail(id) {
    ['rail-chats', 'rail-calls', 'rail-memories', 'btn-settings'].forEach(x => $('#' + x).classList.toggle('on', x === id));
    $('#rail-calls').innerHTML = ICON[id === 'rail-calls' ? 'call' : 'callOutline'];
  }

  // ---------------------------------------------------------------- open / close chat
  function updateHeader() {
    const chat = view.chat;
    $('#convo-name').textContent = chat.name;
    $('#convo-avatar').innerHTML = avatarHTML(chat, 'md');
    const n = chat.msgs.length;
    let sub;
    if (chat.isGroup) sub = chat.senders.map(s => (s === chat.me ? 'You' : s)).join(', ');
    else sub = n.toLocaleString() + ' messages · ' + monthYear(chat.msgs[0].ts) + ' – ' + monthYear(chat.msgs[n - 1].ts);
    $('#convo-sub').textContent = sub;
  }

  // Which section fills the main area: a chat, the theme preview, or the start screen.
  function updateMain() {
    const previewing = !dom.settings.hidden && drawer.view === 'theme' && !view.chat;
    dom.preview.hidden = !previewing;
    dom.convo.hidden = !view.chat;
    dom.intro.hidden = !!view.chat || previewing;
    applyChatTheme();
  }

  function openChat(chat) {
    if (view.chat !== chat) stopVoice();
    closePanels();
    view.chat = chat;
    document.body.classList.add('chat-open');
    updateMain();
    updateHeader();
    const n = chat.msgs.length;
    mountRange(Math.max(0, n - INITIAL), n);
    dom.scroller.scrollTop = dom.scroller.scrollHeight;
    dom.toBottom.hidden = true;
    dom.floatDate.classList.remove('show');
    const iso = ts => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    dom.jumpDate.min = iso(chat.msgs[0].ts);
    dom.jumpDate.max = iso(chat.msgs[n - 1].ts);
    dom.jumpDate.value = '';
    renderList();
  }

  function closeChat() {
    stopVoice();
    closePanels();
    view.chat = null;
    if (io) io.disconnect();
    dom.msgs.textContent = '';
    document.body.classList.remove('chat-open');
    updateMain();
    updateIntro();
    renderList();
  }

  // Re-render the open chat in place (after "which side is you" changes).
  function refreshChat() {
    if (!view.chat) return;
    const st = dom.scroller.scrollTop;
    updateHeader();
    mountRange(view.lo, view.hi);
    dom.scroller.scrollTop = st;
  }

  function updateIntro() {
    const has = state.chats.length > 0;
    $('#intro-title').textContent = has ? 'WhatsApp Chat Viewer' : 'Import a WhatsApp chat';
    $('#intro-text').innerHTML = has
      ? 'Select a chat from the list to read it, or import another exported chat.'
      : 'In WhatsApp, open a chat, choose <b>Export chat</b> and pick <b>Attach media</b>. Then drop the exported <b>.zip</b> here.';
    $('#intro-import').textContent = has ? 'Import another chat' : 'Choose .zip file';
    $('#intro-foot-text').textContent = Store.mode === 'server'
      ? 'Your chats are kept only in this viewer\u2019s own data folder. Nothing is sent anywhere else.'
      : 'Your chats never leave this device. Everything is read in your browser.';
  }

  // ---------------------------------------------------------------- import / remove
  function askMerge(twin, part) {
    const span = msgs => monthYear(msgs[0].ts) + ' – ' + monthYear(msgs[msgs.length - 1].ts);
    return new Promise(resolve => {
      const box = showModal('<h3>Merge with the chat you already have?</h3>' +
        '<p>This looks like another export of “' + esc(twin.name) + '”.</p>' +
        '<p>Already here: ' + twin.msgs.length.toLocaleString() + ' messages, ' + span(twin.msgs) + '<br>This file: ' +
        part.msgs.length.toLocaleString() + ' messages, ' + span(part.msgs) + '</p>' +
        '<p>Merging shows them as one chat. Messages that are in both are kept once.</p>' +
        '<div class="foot"><button class="ghost-btn" data-x>Keep separate</button><button class="ok-btn" data-ok>Merge</button></div>');
      $('[data-x]', box).addEventListener('click', () => { closeModal(); resolve(false); });
      $('[data-ok]', box).addEventListener('click', () => { closeModal(); resolve(true); });
    });
  }

  async function importFile(file, opts) {
    if (!/\.(zip|txt)$/i.test(file.name)) { toast('"' + file.name + '" is not a WhatsApp export (.zip or .txt)'); return null; }
    toast('Importing ' + file.name + '…', true);
    try {
      const { rec, saved } = Store.addChat(file);
      saved.catch(e => { console.error(e); toast("Imported, but it couldn't be saved for next time"); });
      const part = await loadPart(rec);
      hideToast();
      state.parts = state.parts.filter(p => p.rec.id !== rec.id); // importing the same file again replaces it
      for (const [sig, c] of chatCache) if (c.parts.some(p => p.rec.id === rec.id)) chatCache.delete(sig); // or the old copy would be reused
      const twin = state.chats.find(c => c.key === lc(part.baseName) && !c.parts.some(p => p.rec.id === rec.id));
      if (twin && !settings.separate.includes(rec.id)) {
        const merge = opts && opts.merge != null ? opts.merge : await askMerge(twin, part);
        if (!merge) { settings.separate.push(rec.id); saveSettings(); }
      }
      const before = twin ? twin.msgs.length : 0;
      state.parts.push(part);
      rebuildChats();
      const chat = state.chats.find(c => c.parts.some(p => p.rec.id === rec.id));
      updateIntro();
      if (state.tab !== 'chats') setTab('chats');
      openChat(chat);
      if (twin && chat.parts.length > 1) {
        toast('Merged into “' + chat.name + '”: ' + (chat.msgs.length - before).toLocaleString() + ' new messages');
      } else if (!chat.me && chat.senders.length >= 2 && !settings.me) {
        toast("Couldn't tell which side is you. Pick your name in Settings.");
        openSettings('main');
      }
      return chat;
    } catch (e) {
      console.error(e);
      toast(e && e.message ? e.message : 'Could not read that file');
      return null;
    }
  }
  function removeChat(chat) {
    if (view.chat === chat) closeChat();
    chat.urls.forEach(p => p.then(u => { if (u.startsWith('blob:')) URL.revokeObjectURL(u); }).catch(() => {}));
    for (const part of chat.parts) Store.delChat(part.rec.id).catch(() => toast("Couldn't delete the saved copy"));
    state.parts = state.parts.filter(p => !chat.parts.includes(p));
    rebuildChats();
    updateIntro();
    renderList();
    if (!dom.settings.hidden) renderSettings();
  }
  async function importFiles(files) {
    for (const f of files) await importFile(f);
  }

  // ---------------------------------------------------------------- toast, menu, modal
  let toastTimer = 0;
  function toast(text, sticky) {
    dom.toast.textContent = text;
    dom.toast.hidden = false;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(hideToast, 4200);
  }
  function hideToast() { dom.toast.hidden = true; }

  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  // items: { label, run, danger?, radio?, on? } | { heading } | '-'
  function openMenu(anchor, items) {
    const wasOpen = menuEl && menuEl.anchor === anchor;
    closeMenu();
    if (wasOpen) return;
    menuEl = el('div', 'menu');
    menuEl.anchor = anchor;
    for (const it of items) {
      if (it === '-') { menuEl.appendChild(el('hr')); continue; }
      if (it.heading) { menuEl.appendChild(el('div', 'mh', esc(it.heading))); continue; }
      const b = el('button', (it.danger ? 'danger' : '') + (it.on ? ' on' : ''), (it.radio ? '<span class="radio"></span>' : '') + '<span>' + esc(it.label) + '</span>');
      b.addEventListener('click', () => { closeMenu(); it.run(); });
      menuEl.appendChild(b);
    }
    document.body.appendChild(menuEl);
    const r = anchor.getBoundingClientRect(), w = menuEl.offsetWidth;
    menuEl.style.top = Math.max(8, Math.min(window.innerHeight - menuEl.offsetHeight - 8, r.bottom + 6)) + 'px';
    menuEl.style.left = clamp(r.right - w, 8, window.innerWidth - w - 8) + 'px';
  }

  function showModal(html) {
    dom.modalBox.innerHTML = html;
    dom.modal.hidden = false;
    return dom.modalBox;
  }
  function closeModal() { dom.modal.hidden = true; dom.modalBox.textContent = ''; }

  function confirmBox(title, text, okLabel, run) {
    const box = showModal('<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' +
      '<div class="foot"><button class="ghost-btn" data-x>Cancel</button><button class="danger-btn" data-ok>' + esc(okLabel) + '</button></div>');
    $('[data-x]', box).addEventListener('click', closeModal);
    $('[data-ok]', box).addEventListener('click', () => { closeModal(); run(); });
  }

  async function showContact(chat, file) {
    const cards = [];
    try {
      const text = await (await mediaBlob(chat, file)).text();
      for (const block of text.split(/END:VCARD/i)) {
        const name = /^FN[^:\n]*:(.*)$/im.exec(block);
        const tels = [...block.matchAll(/^(?:item\d+\.)?TEL[^:\n]*:(.*)$/gim)].map(t => t[1].trim());
        if (name || tels.length) cards.push({ name: name ? name[1].trim() : 'Contact', tels });
      }
    } catch (e) { /* fall through to the empty state */ }
    const body = cards.length
      ? cards.map(c => '<div class="vc"><div class="n">' + esc(c.name) + '</div>' + c.tels.map(t => '<div class="p">' + esc(t) + '</div>').join('') + '</div>').join('')
      : '<p>This contact card could not be read.</p>';
    const box = showModal('<h3>' + (cards.length > 1 ? cards.length + ' contacts' : 'Contact') + '</h3>' + body + '<div class="foot"><button class="ghost-btn" data-x>Close</button></div>');
    $('[data-x]', box).addEventListener('click', closeModal);
  }

  async function openDoc(chat, file) {
    try {
      const url = await mediaURL(chat, file);
      const a = document.createElement('a');
      a.href = url;
      if (extOf(file) === 'pdf') { a.target = '_blank'; a.rel = 'noopener'; }
      else a.download = displayName(file);
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast("Couldn't open that file"); }
  }

  // ---------------------------------------------------------------- settings drawer
  function openSettings(which) {
    drawer.view = which || 'main';
    dom.settings.hidden = false;
    if (drawer.view !== 'starred') setRail('btn-settings');
    renderSettings();
    updateMain();
  }
  // Back goes from the theme page to Settings, then closes the drawer.
  function closeSettings(all) {
    if (dom.settings.hidden) return;
    if (drawer.view !== 'main' && drawer.view !== 'starred' && all !== true) { drawer.view = 'main'; renderSettings(); updateMain(); return; }
    dom.settings.hidden = true;
    drawer.view = 'main';
    setRail('rail-' + state.tab);
    updateMain();
  }

  function renderSettings() {
    $('#settings-title').textContent = { theme: 'Chat theme', help: 'How to use', starred: 'Starred messages' }[drawer.view] || 'Settings';
    $('#theme-reset').hidden = drawer.view !== 'theme';
    if (drawer.view === 'theme') renderThemeSettings();
    else if (drawer.view === 'help') renderHelpSettings();
    else if (drawer.view === 'starred') renderStarred();
    else renderMainSettings();
    dom.settingsBody.scrollTop = 0;
  }

  const DISCLAIMER = '<div class="disclaimer">' + ICON.lock + '<span>This is an independent, read-only viewer for chats you exported yourself. ' +
    'It is not affiliated with, endorsed by or connected to WhatsApp or Meta. “WhatsApp” is a trademark of its owner.</span></div>';

  function renderHelpSettings() {
    const step = (n, title, text) => '<div class="step"><span class="num">' + n + '</span><div><b>' + title + '</b><p>' + text + '</p></div></div>';
    const tip = (icon, title, text) => '<div class="step"><span class="num ico">' + ICON[icon] + '</span><div><b>' + title + '</b><p>' + text + '</p></div></div>';
    dom.settingsBody.innerHTML =
      '<div class="set-sec flat"><h4>1. Export a chat from WhatsApp</h4>' +
      step(1, 'Open the chat on your phone', 'On iPhone, tap the contact or group name at the top. On Android, tap the three dots, then <i>More</i>.') +
      step(2, 'Choose Export chat', 'Pick <i>Attach media</i> (iPhone) or <i>Include media</i> (Android) to keep photos, videos and voice messages.') +
      step(3, 'Save the .zip file', 'Send it to yourself (AirDrop, Files, email, Drive) and get it onto this computer. Do not unzip it.') +
      '</div>' +
      '<div class="set-sec"><h4>2. Import it here</h4>' +
      step(1, 'Add the file', 'Click the <b>+</b> button above the chat list, or drag the .zip anywhere onto this window. You can import as many chats as you like.') +
      step(2, 'Check which side is you', 'Your messages should be green and on the right. If not, pick your name under <i>Settings → Which side is you</i>.') +
      '</div>' +
      '<div class="set-sec"><h4>3. Look around</h4>' +
      tip('search', 'Search and jump to a date', 'The magnifier in a chat searches every message. The calendar next to the search box jumps to any day.') +
      tip('media', 'Media, links and docs', 'Click a chat’s name for everything shared in it, or the gallery icon in the left rail for all chats at once.') +
      tip('call', 'Calls', 'The phone icon in the left rail lists every call found in your chats. Click one to see it in context.') +
      tip('mic', 'Voice messages', 'Press play, drag the waveform to skip, and tap the speed pill for 1.5× or 2×.') +
      tip('wallpaper', 'Themes', '<i>Settings → Chat theme</i> changes the wallpaper and bubble colour, or lets you use your own picture. A chat can also have its own theme.') +
      tip('starBorder', 'Star messages', 'Hover over a message and open its menu to star it. Find them again under <i>Starred messages</i> in the menus.') +
      tip('history', 'Memories', 'The clock icon in the left rail shows what was said on this day in earlier years, or a random day.') +
      tip('chart', 'Insights', 'The chart icon shows who talks most, the busiest days and hours, streaks and top emoji.') +
      tip('person', 'Names and photos', 'Click a chat’s name to rename it or give it a photo. Importing a newer export of the same chat merges the two.') +
      '</div>' +
      '<div class="set-sec"><h4>Good to know</h4>' +
      '<p>This is view only: the message box and call buttons are there for looks. WhatsApp exports do not include reactions, replies-to, read receipts or profile photos, so those cannot be shown.</p>' +
      '<p>' + (Store.mode === 'server'
        ? 'Imported chats are saved in this viewer’s own data folder and nowhere else.'
        : 'Imported chats are saved in this browser on this device and nowhere else.') + '</p></div>' + DISCLAIMER;
  }

  function renderMainSettings() {
    const people = new Map();
    for (const chat of state.chats) {
      for (const s of chat.senders) {
        const p = people.get(lc(s)) || { name: s, chats: 0, msgs: 0 };
        p.chats++; p.msgs += chat.counts.get(s) || 0;
        people.set(lc(s), p);
      }
    }
    const list = [...people.values()].sort((a, b) => b.chats - a.chats || b.msgs - a.msgs);
    const you = settings.me || detectedMe;
    const total = state.chats.reduce((n, c) => n + (c.size || 0), 0);
    const where = Store.mode === 'server'
      ? 'Imported chats are saved by the viewer’s server in its data folder (the Docker volume), so they are there from any browser that opens this address and survive restarts.'
      : 'Imported chats are saved inside this browser on this device (IndexedDB). They stay until you delete them or clear this site’s data, and are not visible from other browsers or devices.';

    let h = '<div class="profile"><button class="avatar-edit" data-photo="@me" title="Change your photo">' + meAvatarHTML('xl') +
      '<span class="cam">' + ICON.camera + '</span></button><div><div class="n">' + esc(you || 'You') + '</div>' +
      '<div class="s">' + (you ? 'Your messages are shown on the right' : 'Not chosen yet') + '</div></div></div>';

    h += '<div class="set-sec"><h3>' + ICON.person + 'Which side is you</h3><p>Applies to every chat. Messages from this name are shown on the right.</p>' +
      '<button class="opt' + (settings.me ? '' : ' on') + '" data-me=""><span class="radio"></span><span class="lbl"><b>Work it out automatically</b>' +
      '<small>' + (detectedMe ? 'Currently: ' + esc(detectedMe) : 'Uses the chat names to tell who you are') + '</small></span></button>';
    for (const p of list) {
      h += '<button class="opt' + (lc(settings.me) === lc(p.name) ? ' on' : '') + '" data-me="' + esc(p.name) + '"><span class="radio"></span><span class="lbl"><b>' + esc(p.name) + '</b>' +
        '<small>' + p.chats + (p.chats === 1 ? ' chat' : ' chats') + ' · ' + p.msgs.toLocaleString() + ' messages</small></span></button>';
    }
    if (!list.length) h += '<p>Import a chat to see the names you can choose from.</p>';
    h += '</div>';

    h += '<div class="set-sec"><h3>' + ICON.wallpaper + 'Chats</h3>' +
      '<button class="opt" data-go="theme"><span class="lbl"><b>Chat theme</b><small>Wallpaper, bubble colour and your own background</small></span>' +
      '<span class="chev">' + ICON.right + '</span></button>' +
      '<button class="opt' + (settings.linkPreviews ? ' on' : '') + '" data-previews><span class="lbl"><b>Link previews</b><small>' +
      (Store.mode === 'server' ? 'Fetches the title and picture of links from the internet. Off by default, because it contacts those sites.'
        : 'Needs the viewer\u2019s server (Docker or node server.js).') + '</small></span><span class="switch"></span></button></div>';

    h += lockSettingsHTML();

    h += '<div class="set-sec"><h3>' + ICON.theme + 'Appearance</h3>';
    for (const [val, label] of [['', 'System default'], ['light', 'Light'], ['dark', 'Dark']]) {
      h += '<button class="opt' + (settings.theme === val ? ' on' : '') + '" data-app-theme="' + val + '"><span class="radio"></span><span class="lbl"><b>' + label + '</b></span></button>';
    }
    h += '</div>';

    h += '<div class="set-sec"><h3>' + ICON.storage + 'Storage</h3><p>' + where + '</p>' +
      '<p>' + state.chats.length + (state.chats.length === 1 ? ' chat' : ' chats') + ' · ' + fmtSize(total) + '</p>' +
      (state.chats.length ? '<button class="soft-btn danger" data-wipe>Delete all chats</button>' : '') + '</div>';

    h += '<div class="set-sec"><h3>' + ICON.help + 'Help</h3>' +
      '<button class="opt" data-go="help"><span class="lbl"><b>How to use</b><small>Exporting a chat, importing it and finding your way around</small></span>' +
      '<span class="chev">' + ICON.right + '</span></button></div>' + DISCLAIMER;

    dom.settingsBody.innerHTML = h;
  }

  function currentColors() {
    const dark = root.dataset.theme === 'dark';
    const v = themeVars(themeTarget(), dark), base = BASE_VARS[dark ? 'dark' : 'light'];
    return { bubble: v['--out-bg'] || base['--out-bg'], wall: v['--chat-bg'] || base['--chat-bg'] };
  }

  function renderThemeSettings() {
    if (!view.chat) drawer.themeScope = 'all';
    const scoped = drawer.themeScope === 'chat';
    const c = themeTarget(), cur = currentColors();
    const own = scoped && !!settings.chatThemes[view.chat.key];
    let h = '';
    if (view.chat) {
      h += '<div class="seg"><button class="' + (scoped ? '' : 'on') + '" data-scope="all">All chats</button>' +
        '<button class="' + (scoped ? 'on' : '') + '" data-scope="chat">Only ' + esc(view.chat.name) + '</button></div>';
      if (scoped) h += '<p class="seg-note">' + (own ? 'This chat has its own theme. Use the reset arrow above to go back to the default.' : 'Pick a theme below to give this chat its own look.') + '</p>';
    }
    h += '<div class="set-sec flat"><h4>Themes</h4><p>The chat colour and wallpaper will both change.</p><div class="th-grid">';
    for (const t of THEMES) {
      const on = c.id === t.id && !c.bubble && !c.wall && !c.image && (!scoped || own);
      h += '<button class="th' + (on ? ' on' : '') + '" data-th="' + t.id + '" title="' + t.id + '" style="' + esc(thumbStyle(t)) + '">' +
        '<span class="wallpaper"></span><i class="b1"></i><i class="b2"></i><span class="chk">' + ICON.check + '</span></button>';
    }
    h += '</div></div>';
    h += '<button class="opt wide' + (c.doodles !== false ? ' on' : '') + '" data-doodles><span class="lead">' + ICON.doodle + '</span><span class="lbl"><b>WhatsApp doodles</b></span><span class="switch"></span></button>';
    h += '<div class="set-sec"><h4>Customize</h4>' +
      '<label class="opt wide"><span class="lead">' + ICON.bubble + '</span><span class="lbl"><b>Chat bubble</b></span>' +
      '<input type="color" class="swatch round" id="c-bubble" value="' + cur.bubble + '"></label>' +
      '<label class="opt wide"><span class="lead">' + ICON.wallpaper + '</span><span class="lbl"><b>Wallpaper</b></span>' +
      '<input type="color" class="swatch" id="c-wall" value="' + (/^#[0-9a-f]{6}$/i.test(cur.wall) ? cur.wall : '#f5f1eb') + '"></label>' +
      (scoped ? '' : '<button class="opt wide' + (c.image && customWall ? ' on' : '') + '" data-wall-pick><span class="lead">' + ICON.image + '</span><span class="lbl"><b>Your own background</b>' +
      '<small>' + (customWall ? (c.image ? 'In use. Click to choose a different image' : 'Click to choose an image') : 'Use any image from your computer') + '</small></span>' +
      (customWall ? '<span class="swatch pic" style="background-image:url(&quot;' + esc(customWall) + '&quot;)"></span>' : '') + '</button>' +
      (customWall ? '<button class="opt wide" data-wall-use><span class="lead"></span><span class="lbl"><b>' + (c.image ? 'Stop using my background' : 'Use my saved background') + '</b></span></button>' +
        '<button class="opt wide danger" data-wall-del><span class="lead">' + ICON.trash + '</span><span class="lbl"><b>Remove my background</b></span></button>' : '')) +
      '</div>';
    dom.settingsBody.innerHTML = h;
  }

  function setChatTheme(patch) {
    Object.assign(themeTarget(true), patch);
    applyChatTheme();
    saveSettings();
  }

  function renderPreview() {
    const fake = { me: 'me', isGroup: false, colors: new Map(), ratios: new Map() };
    const rows = [
      ['them', 'Try out themes! Select one to preview and apply it 🎨✨', '11:30 AM'],
      ['me', 'This is what your chats will look like with this theme', '11:31 AM'],
      ['them', 'Selecting a theme replaces your default chat theme', '11:32 AM'],
      ['me', 'Only you see your chat themes', '11:33 AM'],
    ].map((r, i) => ({ i, sender: r[0], type: 'text', text: r[1], time: r[2], day: 1, edited: false }));
    const box = $('#preview-msgs');
    box.textContent = '';
    rows.forEach((m, i) => box.appendChild(renderMsg(fake, m, rows[i - 1])));
  }

  // ---------------------------------------------------------------- panels: search
  const PANELS = ['#search-panel', '#info-panel', '#contact-panel'];
  const syncPanels = () => document.body.classList.toggle('panel-open', PANELS.some(id => !$(id).hidden));
  function showPanel(id) {
    PANELS.forEach(x => { $(x).hidden = x !== id; });
    syncPanels();
  }
  function closePanels() {
    closeSearch();
    showPanel(null);
  }
  const search = { hits: [], shown: 0, q: '' };

  function openSearch() {
    if (!view.chat) return;
    showPanel('#search-panel');
    runSearch();
    dom.searchInput.focus();
  }
  function closeSearch() {
    dom.searchPanel.hidden = true;
    syncPanels();
    dom.searchInput.value = '';
  }
  function runSearch() {
    const chat = view.chat;
    const q = dom.searchInput.value.trim().toLowerCase();
    dom.results.textContent = '';
    dom.results.scrollTop = 0;
    search.hits = []; search.shown = 0; search.q = q;
    if (!chat) return;
    if (q.length < 2) {
      dom.results.appendChild(el('div', 'hint', 'Search for messages with ' + esc(chat.name) + '.<br>Use the calendar to jump to a date.'));
      return;
    }
    for (let i = chat.msgs.length - 1; i >= 0; i--) {
      const m = chat.msgs[i];
      if (m.type === 'system' || !m.text) continue;
      if (m.lc === undefined) m.lc = m.text.toLowerCase();
      const at = m.lc.indexOf(q);
      if (at >= 0) search.hits.push([m, at]);
    }
    if (!search.hits.length) { dom.results.appendChild(el('div', 'hint', 'No messages found')); return; }
    const n = search.hits.length;
    dom.results.appendChild(el('div', 'count', n.toLocaleString() + (n === 1 ? ' message' : ' messages') + ' found'));
    moreResults();
  }
  // Adds the next page of results; called again as the list is scrolled.
  function moreResults() {
    const chat = view.chat, q = search.q;
    const end = Math.min(search.hits.length, search.shown + 80);
    const frag = document.createDocumentFragment();
    for (let k = search.shown; k < end; k++) {
      const [m, at] = search.hits[k];
      const from = Math.max(0, at - 28);
      const snip = (from ? '…' : '') + esc(m.text.slice(from, at)) + '<b>' + esc(m.text.slice(at, at + q.length)) + '</b>' + esc(m.text.slice(at + q.length, at + q.length + 110));
      const who = m.sender === chat.me ? 'You' : m.sender;
      const b = el('button', 'result', '<div class="when">' + esc(dayLabel(m.ts, chat)) + '</div><div class="snip">' +
        (chat.isGroup || m.sender === chat.me ? '<span class="who">' + esc(who) + ': </span>' : '') + snip + '</div>');
      b.dataset.i = m.i;
      frag.appendChild(b);
    }
    search.shown = end;
    dom.results.appendChild(frag);
  }

  // ---------------------------------------------------------------- lightbox
  const lb = { items: [], pos: -1, showChat: false };
  async function showLightbox(items, pos, showChat) {
    lb.items = items; lb.pos = pos; lb.showChat = !!showChat;
    const { chat, m } = items[pos];
    const out = !!chat.me && m.sender === chat.me;
    $('#lb-avatar').innerHTML = senderAvatar(chat, m.sender, 'md');
    $('#lb-name').textContent = out ? 'You' : m.sender;
    $('#lb-sub').textContent = longDate(m.ts) + ' at ' + m.time + (lb.showChat ? ' · ' + chat.name : '');
    $('#lb-caption').textContent = m.text || '';
    $('#lb-prev').disabled = pos <= 0;
    $('#lb-next').disabled = pos >= items.length - 1;
    const stage = $('#lb-media');
    stage.textContent = '';
    dom.lightbox.hidden = false;
    try {
      const url = await mediaURL(chat, m.file);
      if (lb.pos !== pos || lb.items !== items) return;
      let node;
      if (m.type === 'image') { node = document.createElement('img'); node.alt = ''; }
      else {
        node = document.createElement('video');
        node.autoplay = true; node.playsInline = true;
        if (m.type === 'gif') { node.loop = true; node.muted = true; } else node.controls = true;
      }
      node.src = url;
      stage.appendChild(node);
      const dl = $('#lb-download');
      dl.href = url;
      dl.download = displayName(m.file);
    } catch (e) { toast("Couldn't open this media"); }
  }
  function closeLightbox() {
    dom.lightbox.hidden = true;
    $('#lb-media').textContent = '';
    lb.pos = -1;
  }
  function stepLightbox(d) {
    const next = lb.pos + d;
    if (lb.pos >= 0 && next >= 0 && next < lb.items.length) showLightbox(lb.items, next, lb.showChat);
  }
  function chatVisualItems(chat) {
    return chat.visualItems || (chat.visualItems = chat.visual.map(i => ({ chat, m: chat.msgs[i] })));
  }

  // ---------------------------------------------------------------- events
  function toggleAppTheme() {
    settings.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyAppTheme();
    saveSettings();
    if (!dom.settings.hidden) renderSettings();
  }

  function bind() {
    const pick = () => dom.fileInput.click();
    $('#btn-import').addEventListener('click', pick);
    $('#intro-import').addEventListener('click', pick);
    $('#tile-import').addEventListener('click', pick);
    $('#tile-media').addEventListener('click', () => openGallery('all', 'media'));
    $('#tile-settings').addEventListener('click', () => openSettings('main'));
    $('#tile-insights').addEventListener('click', () => openInsights());
    dom.fileInput.addEventListener('change', () => {
      const files = [...dom.fileInput.files];
      dom.fileInput.value = '';
      importFiles(files);
    });

    $('#rail-chats').addEventListener('click', () => setTab('chats'));
    $('#rail-calls').addEventListener('click', () => setTab('calls'));
    $('#rail-memories').addEventListener('click', () => setTab('memories'));
    $('#rail-insights').addEventListener('click', () => openInsights());
    $('#btn-media').addEventListener('click', () => openGallery('all', 'media'));
    $('#btn-settings').addEventListener('click', () => (dom.settings.hidden ? openSettings('main') : closeSettings(true)));
    $('#btn-profile').addEventListener('click', () => openSettings('main'));
    $('#settings-close').addEventListener('click', () => closeSettings());
    $('#theme-reset').addEventListener('click', () => {
      if (drawer.themeScope === 'chat' && view.chat) {
        delete settings.chatThemes[view.chat.key];
        applyChatTheme();
        saveSettings();
      } else setChatTheme({ id: 'default', bubble: '', wall: '', doodles: true, image: false });
      renderSettings();
    });

    $('#btn-side-menu').addEventListener('click', e => {
      e.stopPropagation();
      openMenu(e.currentTarget, [
        { label: 'Import chat', run: pick },
        { label: 'Starred messages', run: () => openStarred(null) },
        { label: 'Media, links and docs', run: () => openGallery('all', 'media') },
        state.tab === 'calls' ? { label: 'Chats', run: () => setTab('chats') } : { label: 'Calls', run: () => setTab('calls') },
        { label: 'Memories', run: () => setTab('memories') },
        { label: 'Insights', run: () => openInsights() },
        '-',
        { label: 'Settings', run: () => openSettings('main') },
      ]);
    });
    $('#btn-chat-menu').addEventListener('click', e => {
      e.stopPropagation();
      const chat = view.chat;
      openMenu(e.currentTarget, [
        { label: chat.isGroup ? 'Group info' : 'Contact info', run: openInfo },
        { label: 'Search messages', run: openSearch },
        { label: 'Media, links and docs', run: () => openGallery('chat', 'media') },
        { label: 'Starred messages', run: () => openStarred(chat) },
        { label: 'Chat insights', run: () => openInsights(chat) },
        { label: 'Chat theme', run: () => { drawer.themeScope = 'chat'; openSettings('theme'); } },
        { label: 'Close chat', run: closeChat },
        '-',
        { label: 'Delete chat', danger: true, run: () => confirmBox('Delete this chat?', '“' + chat.name + '” will be removed from this viewer. Your exported file is not touched.', 'Delete chat', () => removeChat(chat)) },
      ]);
    });
    document.addEventListener('click', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });

    $('#chat-filter').addEventListener('input', e => { state.query = e.target.value; renderList(); });
    $('#chips').addEventListener('click', e => {
      const chip = e.target.closest('.chip[data-filter]');
      if (!chip) return;
      state.filter = chip.dataset.filter;
      document.querySelectorAll('#chips .chip').forEach(c => c.classList.toggle('on', c === chip));
      renderList();
    });

    // Settings drawer
    dom.settingsBody.addEventListener('click', e => {
      const t = e.target;
      let hit;
      if (extrasSettingsClick(t)) return;
      if ((hit = t.closest('[data-scope]'))) {
        drawer.themeScope = hit.dataset.scope;
        renderSettings();
      } else if (t.closest('[data-previews]')) {
        if (Store.mode !== 'server') { toast('Link previews need the viewer\u2019s server'); return; }
        settings.linkPreviews = !settings.linkPreviews;
        saveSettings();
        renderSettings();
        refreshChat();
      } else if ((hit = t.closest('[data-me]'))) {
        settings.me = hit.dataset.me;
        saveSettings();
        applyIdentities();
        refreshChat();
        refreshAvatars();
        renderSettings();
      } else if ((hit = t.closest('[data-app-theme]'))) {
        settings.theme = hit.dataset.appTheme;
        applyAppTheme();
        saveSettings();
        renderSettings();
      } else if ((hit = t.closest('[data-go]'))) {
        drawer.view = hit.dataset.go;
        renderSettings();
        updateMain();
      } else if (t.closest('[data-wipe]')) {
        confirmBox('Delete all chats?', 'Every imported chat will be removed from this viewer. Your exported files are not touched.', 'Delete all', () => {
          state.chats.slice().forEach(removeChat);
        });
      } else if ((hit = t.closest('[data-th]'))) {
        setChatTheme({ id: hit.dataset.th, bubble: '', wall: '', image: false });
        renderSettings();
      } else if (t.closest('[data-doodles]')) {
        setChatTheme({ doodles: settings.chat.doodles === false });
        renderSettings();
      } else if (t.closest('[data-wall-pick]')) {
        dom.wallInput.click();
      } else if (t.closest('[data-wall-use]')) {
        setChatTheme({ image: !settings.chat.image });
        renderSettings();
      } else if (t.closest('[data-wall-del]')) {
        Store.setWallpaper(null).then(url => { customWall = url; setChatTheme({ image: false }); renderSettings(); })
          .catch(() => toast("Couldn't remove the background"));
      }
    });
    dom.settingsBody.addEventListener('input', e => {
      if (e.target.id === 'c-bubble') setChatTheme({ bubble: e.target.value });
      else if (e.target.id === 'c-wall') setChatTheme({ wall: e.target.value, image: false });
    });
    dom.settingsBody.addEventListener('change', e => {
      if (e.target.id === 'c-bubble' || e.target.id === 'c-wall') renderSettings();
    });
    dom.wallInput.addEventListener('change', () => {
      const file = dom.wallInput.files[0];
      dom.wallInput.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('Please choose an image file'); return; }
      Store.setWallpaper(file).then(url => {
        customWall = url;
        setChatTheme({ image: true, wall: '' });
        renderSettings();
      }).catch(() => toast("Couldn't save that image"));
    });

    $('#btn-back').addEventListener('click', closeChat);
    $('#convo-id').addEventListener('click', () => ($('#contact-panel').hidden ? openInfo() : closePanels()));
    $('#btn-search').addEventListener('click', () => (dom.searchPanel.hidden ? openSearch() : closeSearch()));
    $('#search-close').addEventListener('click', closeSearch);
    let searchTimer = 0;
    dom.searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 140); });
    dom.results.addEventListener('scroll', () => {
      if (search.shown < search.hits.length && dom.results.scrollHeight - dom.results.scrollTop - dom.results.clientHeight < 700) moreResults();
    }, { passive: true });
    dom.results.addEventListener('click', e => {
      const b = e.target.closest('.result');
      if (!b) return;
      if (window.innerWidth <= 760) closeSearch();
      jumpTo(+b.dataset.i);
    });
    dom.jumpDate.addEventListener('change', () => {
      const chat = view.chat;
      if (!chat || !dom.jumpDate.value) return;
      const [y, mo, d] = dom.jumpDate.value.split('-').map(Number);
      const target = new Date(y, mo - 1, d).getTime();
      let a = 0, b = chat.msgs.length - 1;
      while (a < b) { const mid = (a + b) >> 1; if (chat.msgs[mid].ts >= target) b = mid; else a = mid + 1; }
      if (window.innerWidth <= 760) closeSearch();
      jumpTo(a);
    });

    bindGallery(dom.infoPanel);
    bindGallery(dom.mediaModal);
    dom.mediaModal.addEventListener('click', e => { if (e.target === dom.mediaModal) closeGallery(dom.mediaModal); });

    dom.scroller.addEventListener('scroll', handleScroll, { passive: true });
    dom.toBottom.addEventListener('click', scrollToBottom);

    dom.msgs.addEventListener('click', e => {
      const chat = view.chat;
      if (!chat) return;
      const t = e.target;
      const row = t.closest('[data-i]');
      let hit;
      if ((hit = t.closest('.v-play'))) {
        playVoice(chat, +hit.closest('.voice-box').dataset.i);
      } else if ((hit = t.closest('.v-speed'))) {
        rate = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
        audio.playbackRate = rate;
        syncVoice();
      } else if ((hit = t.closest('.img')) && (hit.dataset.load === 'image' || hit.dataset.load === 'video')) {
        const pos = chat.visual.indexOf(+row.dataset.i);
        if (pos >= 0) showLightbox(chatVisualItems(chat), pos, false);
      } else if ((hit = t.closest('[data-doc]'))) {
        e.preventDefault();
        openDoc(chat, hit.dataset.doc);
      } else if ((hit = t.closest('[data-contact]'))) {
        showContact(chat, hit.dataset.contact);
      }
    });

    // Scrub a voice message by pressing or dragging on its waveform.
    let scrub = null;
    const fracAt = (wave, x) => { const r = wave.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1); };
    dom.msgs.addEventListener('pointerdown', e => {
      const wave = e.target.closest('.v-wave');
      if (!wave || !view.chat) return;
      scrub = wave;
      wave.setPointerCapture(e.pointerId);
      playVoice(view.chat, +wave.closest('.voice-box').dataset.i, fracAt(wave, e.clientX));
    });
    dom.msgs.addEventListener('pointermove', e => { if (scrub && playing) seekVoice(fracAt(scrub, e.clientX)); });
    const endScrub = () => { scrub = null; };
    dom.msgs.addEventListener('pointerup', endScrub);
    dom.msgs.addEventListener('pointercancel', endScrub);

    $('#lb-close').addEventListener('click', closeLightbox);
    $('#lb-prev').addEventListener('click', () => stepLightbox(-1));
    $('#lb-next').addEventListener('click', () => stepLightbox(1));
    $('#lb-goto').addEventListener('click', () => { const it = lb.items[lb.pos]; if (it) goToMessage(it.chat, it.m.i); });
    dom.lightbox.addEventListener('click', e => { if (e.target === $('#lb-media') || e.target.classList.contains('lb-stage')) closeLightbox(); });
    dom.modal.addEventListener('click', e => { if (e.target === dom.modal) closeModal(); });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (menuEl) closeMenu();
        else if (!dom.modal.hidden) closeModal();
        else if (!dom.lightbox.hidden) closeLightbox();
        else if (!$('#insights-modal').hidden) $('#insights-modal').hidden = true;
        else if (!dom.mediaModal.hidden) closeGallery(dom.mediaModal);
        else if (!dom.settings.hidden) closeSettings();
        else if (!dom.searchPanel.hidden) closeSearch();
        else if (!dom.infoPanel.hidden) closeGallery(dom.infoPanel);
        else if (!$('#contact-panel').hidden) closePanels();
      } else if (!dom.lightbox.hidden && e.key === 'ArrowLeft') stepLightbox(-1);
      else if (!dom.lightbox.hidden && e.key === 'ArrowRight') stepLightbox(1);
    });

    // Drag and drop import
    let depth = 0;
    const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; dom.veil.hidden = false; e.preventDefault(); } });
    window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; dom.veil.hidden = true; } });
    window.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0; dom.veil.hidden = true;
      importFiles([...e.dataTransfer.files]);
    });

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!settings.theme) applyAppTheme(); });
    bindExtras();
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    hydrateIcons(document);
    bind();
    renderPreview();
    updateIntro();
    renderList();

    await Store.init();
    if (Store.locked && !Store.authed) await lockScreen();
    try {
      const saved = await Store.loadSettings();
      for (const k of ['me', 'theme']) if (typeof saved[k] === 'string') settings[k] = saved[k];
      if (typeof saved.theme !== 'string' && LS.get('wa-theme')) settings.theme = LS.get('wa-theme');
      for (const k of ['chat', 'chatThemes', 'starred', 'contacts']) {
        if (saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k])) Object.assign(settings[k], saved[k]);
      }
      if (Array.isArray(saved.separate)) settings.separate = saved.separate;
      settings.linkPreviews = !!saved.linkPreviews;
    } catch (e) { console.warn('Settings unavailable', e); }
    try { await Store.loadFiles(); } catch (e) { /* photos are optional */ }
    try { customWall = await Store.getWallpaper(); } catch (e) { customWall = null; }
    applyAppTheme();

    try {
      const recs = await Store.listChats();
      recs.sort((a, b) => a.addedAt - b.addedAt);
      for (const rec of recs) {
        try { state.parts.push(await loadPart(rec)); }
        catch (e) { console.warn('Skipping saved chat', rec.fileName, e); }
      }
    } catch (e) { console.warn('Saved chats unavailable', e); }
    rebuildChats();
    refreshAvatars();
    updateIntro();
    if (state.chats.length && window.innerWidth > 760) {
      openChat(state.chats.slice().sort((a, b) => lastTs(b) - lastTs(a))[0]);
    }
  }

  window.WAViewer = { importFile, state, view, settings, jumpTo, Store, boot };
