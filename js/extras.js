'use strict';
/* Link previews, starring, contact info (custom names and photos), the screen lock and
   search across all chats. Uses the helpers defined in app.js. */

// ---------------------------------------------------------------- link previews
const previewCache = new Map(); // url -> info, or null when the page gave nothing
const previewJobs = new Map();
const previewQueue = [];
let previewBusy = 0;
const linkPreviewsOn = () => settings.linkPreviews && Store.mode === 'server';
const linkPreviewNow = url => (url && previewCache.get(url)) || null;

function pumpPreviews() {
  while (previewBusy < 3 && previewQueue.length) {
    previewBusy++;
    previewQueue.shift()().finally(() => { previewBusy--; pumpPreviews(); });
  }
}
function getLinkPreview(url) {
  if (!url || !linkPreviewsOn()) return Promise.resolve(null);
  if (previewCache.has(url)) return Promise.resolve(previewCache.get(url));
  let job = previewJobs.get(url);
  if (!job) {
    job = new Promise(resolve => {
      previewQueue.push(() => Store.preview(hrefOf(url)).then(info => { previewCache.set(url, info); resolve(info); }));
      pumpPreviews();
    });
    previewJobs.set(url, job);
  }
  return job;
}
function linkCardHTML(url, info) {
  let host = info.site || '';
  try { host = new URL(hrefOf(url)).hostname.replace(/^www\./, ''); } catch (e) { /* keep site name */ }
  return '<a class="lp" href="' + esc(hrefOf(url)) + '" target="_blank" rel="noopener noreferrer">' +
    (info.image ? '<span class="lp-img"><img src="' + esc(info.image) + '" alt="" loading="lazy"></span>' : '') +
    '<span class="lp-body"><b>' + esc(info.title) + '</b>' + (info.description ? '<span class="d">' + esc(info.description) + '</span>' : '') +
    '<span class="h">' + esc(host) + '</span></span></a>';
}
// What a text bubble shows above its text: the card if known, a placeholder to fill in later, or nothing.
function linkCardSlot(chat, m) {
  if (!linkPreviewsOn() || !chat.linkMap) return '';
  const urls = chat.linkMap.get(m.i);
  if (!urls) return '';
  if (previewCache.has(urls[0])) {
    const info = previewCache.get(urls[0]);
    return info ? linkCardHTML(urls[0], info) : '';
  }
  return '<span class="lp-slot" data-load="preview" data-url="' + esc(urls[0]) + '"></span>';
}
function loadLinkCard(node) {
  const url = node.dataset.url;
  getLinkPreview(url).then(info => {
    if (!info || !node.isConnected) return;
    const bubble = node.parentNode;
    keepScroll(bubble, () => { node.outerHTML = linkCardHTML(url, info); });
  });
}

// ---------------------------------------------------------------- message menu
function messageMenu(anchor, i) {
  const chat = view.chat, m = chat && chat.msgs[i];
  if (!m || m.type === 'system') return;
  const starred = isStarred(chat, m);
  const items = [{ label: starred ? 'Unstar' : 'Star', run: () => toggleStar(chat, m) }];
  if (m.text) items.push({ label: 'Copy text', run: () => copyText(m.text, 'Copied') });
  if (m.file && hasFile(chat, m.file)) items.push({ label: 'Download', run: () => downloadItems([{ chat, m }]) });
  openMenu(anchor, items);
}

// ---------------------------------------------------------------- starred messages
let starredScope = null, starredItems = [];
function openStarred(chat) {
  starredScope = chat || null;
  openSettings('starred');
}
function renderStarred() {
  const chats = starredScope ? [starredScope] : state.chats;
  starredItems = [];
  for (const chat of chats) {
    if (!starSet(chat).size) continue;
    for (const m of chat.msgs) if (m.type !== 'system' && isStarred(chat, m)) starredItems.push({ chat, m });
  }
  starredItems.sort((a, b) => b.m.ts - a.m.ts);
  if (!starredItems.length) {
    dom.settingsBody.innerHTML = '<div class="empty-note"><span class="big">' + ICON.star + '</span><b>No starred messages</b>' +
      '<p>Hover over a message, open its menu and choose Star. Starred messages are collected here' + (starredScope ? ' for this chat' : '') + '.</p></div>';
    return;
  }
  let h = starredScope ? '<p class="seg-note">Starred in ' + esc(starredScope.name) + '</p>' : '';
  starredItems.forEach(({ chat, m }, k) => {
    const out = !!chat.me && m.sender === chat.me;
    const [icon, text] = previewText(m);
    h += '<div class="star-row" data-star="' + k + '"><div class="sr-head">' + senderAvatar(chat, m.sender, 'sm') +
      '<span class="who">' + esc(out ? 'You' : m.sender) + ' <i>▸</i> ' + esc(out || chat.isGroup ? chat.name : 'You') + '</span>' +
      '<span class="when">' + esc(numericDate(m.ts, chat)) + '</span></div>' +
      '<div class="sr-bubble ' + (out ? 'out' : 'in') + '">' + (icon ? ICON[icon] : '') + '<span>' + esc((text || '').slice(0, 280)) + '</span>' +
      '<em>' + ICON.star + m.time + '</em></div>' +
      '<button class="icon-btn unstar" title="Unstar">' + ICON.starBorder + '</button></div>';
  });
  dom.settingsBody.innerHTML = h;
}

// ---------------------------------------------------------------- contact info
let photoTarget = null;
function openInfo() {
  if (!view.chat) return;
  showPanel('#contact-panel');
  renderInfo();
}
function renderInfo() {
  const chat = view.chat;
  if (!chat || $('#contact-panel').hidden) return;
  const custom = settings.contacts[chat.key] || {};
  const n = chat.msgs.length;
  $('#contact-title').textContent = chat.isGroup ? 'Group info' : 'Contact info';
  const row = (key, icon, title, small) => '<button class="opt wide" data-ci="' + key + '"><span class="lead">' + ICON[icon] + '</span><span class="lbl"><b>' + title + '</b>' +
    (small ? '<small>' + small + '</small>' : '') + '</span><span class="chev">' + ICON.right + '</span></button>';
  let h = '<div class="ci-top"><button class="avatar-edit" data-photo="' + esc(chat.key) + '" title="Change photo">' + avatarHTML(chat, 'xxl') +
    '<span class="cam">' + ICON.camera + '</span></button>' +
    '<div class="ci-name"><span>' + esc(chat.name) + '</span><button class="icon-btn" data-ci="rename" title="Edit name">' + ICON.edit + '</button></div>' +
    '<div class="ci-sub">' + (chat.isGroup ? 'Group · ' + chat.senders.length + ' participants' : n.toLocaleString() + ' messages') + '<br>' +
    esc(longDate(chat.msgs[0].ts)) + ' – ' + esc(longDate(chat.msgs[n - 1].ts)) + '</div></div>';
  h += '<div class="set-sec">' +
    row('media', 'media', 'Media, links and docs', (chat.visual.length + chat.docs.length + chat.links.length).toLocaleString()) +
    row('starred', 'starBorder', 'Starred messages', starSet(chat).size ? String(starSet(chat).size) : 'None') +
    row('insights', 'chart', 'Chat insights', 'Who talks most, busiest days, top emoji') +
    row('theme', 'wallpaper', 'Chat theme', settings.chatThemes[chat.key] ? 'This chat has its own theme' : 'Using the default theme') + '</div>';
  if (chat.isGroup) {
    h += '<div class="set-sec"><h4>' + chat.senders.length + ' participants</h4>';
    for (const s of chat.senders) {
      h += '<div class="opt wide plain">' + senderAvatar(chat, s, 'md') + '<span class="lbl"><b>' + esc(s === chat.me ? 'You' : s) + '</b><small>' +
        (chat.counts.get(s) || 0).toLocaleString() + ' messages</small></span></div>';
    }
    h += '</div>';
  }
  if (chat.parts.length > 1) {
    h += '<div class="set-sec"><h4>Merged from ' + chat.parts.length + ' exports</h4>' +
      chat.parts.map(p => '<p>' + esc(p.rec.fileName) + ' · ' + p.msgs.length.toLocaleString() + ' messages</p>').join('') +
      '<button class="soft-btn" data-ci="split">Show them as separate chats</button></div>';
  }
  h += '<div class="set-sec">' +
    (custom.photo ? '<button class="opt wide" data-ci="nophoto"><span class="lead">' + ICON.person + '</span><span class="lbl"><b>Remove photo</b></span></button>' : '') +
    (custom.name ? '<button class="opt wide" data-ci="noname"><span class="lead">' + ICON.refresh + '</span><span class="lbl"><b>Reset name</b><small>Back to “' + esc(chat.baseName) + '”</small></span></button>' : '') +
    '<button class="opt wide danger" data-ci="delete"><span class="lead">' + ICON.trash + '</span><span class="lbl"><b>Delete chat</b></span></button></div>';
  $('#contact-body').innerHTML = h;
}

function setContact(key, patch) {
  const next = Object.assign({}, settings.contacts[key], patch);
  for (const k of Object.keys(next)) if (next[k] == null || next[k] === '') delete next[k];
  if (Object.keys(next).length) settings.contacts[key] = next; else delete settings.contacts[key];
  saveSettings();
  applyIdentities();
  if (view.chat) updateHeader();
  refreshAvatars();
  refreshChat();
  renderInfo();
  if (!dom.settings.hidden) renderSettings();
}

function renameChat(chat) {
  const box = showModal('<h3>Edit name</h3><p>Shown instead of the name from the export. Only in this viewer.</p>' +
    '<input class="field" id="rename-input" type="text" maxlength="60" autocomplete="off">' +
    '<div class="foot"><button class="ghost-btn" data-x>Cancel</button><button class="ok-btn" data-ok>Save</button></div>');
  const input = $('#rename-input', box);
  input.value = chat.name;
  input.focus(); input.select();
  const save = () => { const v = input.value.trim(); closeModal(); if (v && v !== chat.name) setContact(chat.key, { name: v }); };
  $('[data-x]', box).addEventListener('click', closeModal);
  $('[data-ok]', box).addEventListener('click', save);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}

// Contact photos are cropped to a square and scaled down before they are stored.
function shrinkImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.min(size, side);
      canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not read image'))), 'image/jpeg', 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}
async function savePhoto(key, file) {
  try {
    await Store.putFile(photoName(key), await shrinkImage(file, 512));
    setContact(key, { photo: Date.now() });
  } catch (e) { toast("Couldn't use that picture"); }
}

function infoClick(t) {
  const chat = view.chat;
  const hit = t.closest('[data-ci]');
  if (!hit || !chat) return;
  const what = hit.dataset.ci;
  if (what === 'media') openGallery('chat', 'media');
  else if (what === 'starred') openStarred(chat);
  else if (what === 'insights') openInsights(chat);
  else if (what === 'theme') { drawer.themeScope = 'chat'; openSettings('theme'); }
  else if (what === 'rename') renameChat(chat);
  else if (what === 'noname') setContact(chat.key, { name: null });
  else if (what === 'nophoto') Store.delFile(photoName(chat.key)).catch(() => {}).then(() => setContact(chat.key, { photo: null }));
  else if (what === 'split') {
    settings.separate.push(...chat.parts.slice(1).map(p => p.rec.id));
    saveSettings();
    rebuildChats();
    renderList();
    toast('Shown as separate chats again');
  } else if (what === 'delete') {
    confirmBox('Delete this chat?', '“' + chat.name + '” will be removed from this viewer. Your exported file is not touched.', 'Delete chat', () => removeChat(chat));
  }
}

// ---------------------------------------------------------------- screen lock
function lockScreen() {
  return new Promise(resolve => {
    const screen = $('#lock-screen'), input = $('#lock-input'), note = $('#lock-error');
    screen.hidden = false;
    input.value = '';
    input.focus();
    $('#lock-form').onsubmit = async e => {
      e.preventDefault();
      note.textContent = '';
      if (await Store.unlock(input.value)) {
        input.value = '';
        screen.hidden = true;
        resolve();
      } else {
        note.textContent = 'That password is not right.';
        input.select();
      }
    };
  });
}
function lockSettingsHTML() {
  const how = Store.mode === 'server'
    ? 'The viewer asks for a password, and its server will not hand out your chats until it is entered.'
    : 'The viewer asks for a password before showing your chats in this browser. It hides them; it does not encrypt them.';
  let h = '<div class="set-sec"><h3>' + ICON.lock + 'Privacy</h3>';
  if (!Store.canLock) return h + '<p>Screen lock needs the viewer’s server, or a page opened over https or localhost.</p></div>';
  if (Store.locked) {
    h += '<p>Screen lock is on. ' + how + '</p>' +
      '<button class="opt" data-lock="now"><span class="lbl"><b>Lock now</b></span></button>' +
      '<button class="opt" data-lock="set"><span class="lbl"><b>Change password</b></span></button>' +
      '<button class="opt" data-lock="off"><span class="lbl"><b>Turn off screen lock</b></span></button>';
  } else {
    h += '<button class="opt" data-lock="set"><span class="lbl"><b>Screen lock</b><small>' + how + '</small></span><span class="chev">' + ICON.right + '</span></button>';
  }
  return h + '</div>';
}
function askNewPassword() {
  const box = showModal('<h3>' + (Store.locked ? 'Change password' : 'Set a password') + '</h3><p>You will need it every time the viewer is opened. There is no way to recover it, so pick one you will remember.</p>' +
    '<input class="field" id="pw1" type="password" placeholder="Password" autocomplete="new-password">' +
    '<input class="field" id="pw2" type="password" placeholder="Repeat password" autocomplete="new-password">' +
    '<p class="err" id="pw-err"></p>' +
    '<div class="foot"><button class="ghost-btn" data-x>Cancel</button><button class="ok-btn" data-ok>Save</button></div>');
  const a = $('#pw1', box), b = $('#pw2', box), err = $('#pw-err', box);
  a.focus();
  const save = async () => {
    if (a.value.length < 4) { err.textContent = 'Use at least 4 characters.'; return; }
    if (a.value !== b.value) { err.textContent = 'The two passwords do not match.'; return; }
    try {
      await Store.setLock(a.value);
      closeModal();
      toast('Screen lock is on');
      renderSettings();
    } catch (e) { err.textContent = "Couldn't save the password."; }
  };
  $('[data-x]', box).addEventListener('click', closeModal);
  $('[data-ok]', box).addEventListener('click', save);
  b.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}

// Clicks inside the settings drawer that belong to this file. Returns true when handled.
function extrasSettingsClick(t) {
  let hit;
  if ((hit = t.closest('[data-photo]'))) {
    photoTarget = hit.dataset.photo;
    $('#avatar-input').click();
  } else if ((hit = t.closest('[data-lock]'))) {
    const what = hit.dataset.lock;
    if (what === 'set') askNewPassword();
    else if (what === 'now') Store.logout().then(() => location.reload());
    else confirmBox('Turn off screen lock?', 'The viewer will open without asking for a password.', 'Turn off', () => {
      Store.removeLock().then(() => { toast('Screen lock is off'); renderSettings(); }).catch(() => toast("Couldn't turn it off"));
    });
  } else if ((hit = t.closest('.unstar'))) {
    const it = starredItems[+hit.closest('[data-star]').dataset.star];
    if (it) { setStar(it.chat, it.m, false); saveSettings(); rerenderRow(it.chat, it.m.i); renderStarred(); renderInfo(); }
  } else if ((hit = t.closest('[data-star]'))) {
    const it = starredItems[+hit.dataset.star];
    if (it) { if (window.innerWidth <= 760) closeSettings(true); goToMessage(it.chat, it.m.i); }
  } else return false;
  return true;
}

// ---------------------------------------------------------------- search across all chats
const gs = { from: '', after: '', before: '', media: false, links: false, docs: false, hits: [], shown: 0, q: '' };
const gsFilterCount = () => [gs.from, gs.after, gs.before, gs.media, gs.links, gs.docs].filter(Boolean).length;
function globalSearchActive() {
  return state.tab === 'chats' && (state.query.trim().length >= 2 || gsFilterCount() > 0);
}

function chatRowHTML(chat, whenText, previewInner, extraClass) {
  return '<button class="chat-item ' + (extraClass || '') + '">' + avatarHTML(chat, 'lg') +
    '<span class="body"><span class="top"><span class="name">' + esc(chat.name) + '</span><span class="when">' + esc(whenText) + '</span></span>' +
    '<span class="bottom"><span class="preview">' + previewInner + '</span></span></span></button>';
}

function renderGlobalSearch() {
  const q = lc(state.query.trim());
  const useQ = q.length >= 2;
  gs.q = useQ ? q : '';
  dom.list.textContent = '';
  dom.list.scrollTop = 0;

  if (useQ) {
    const chats = state.chats.filter(c => lc(c.name).includes(q)).sort((a, b) => lastTs(b) - lastTs(a));
    if (chats.length) {
      dom.list.appendChild(el('div', 'list-head', 'Chats'));
      for (const chat of chats) {
        const last = chat.msgs[chat.msgs.length - 1];
        const holder = el('div', '', chatRowHTML(chat, listWhen(last, chat), previewHTML(chat, last), chat === view.chat ? 'on' : ''));
        holder.firstChild.addEventListener('click', () => openChat(chat));
        dom.list.appendChild(holder.firstChild);
      }
    }
  }

  const after = gs.after ? new Date(gs.after + 'T00:00:00').getTime() : -Infinity;
  const before = gs.before ? new Date(gs.before + 'T23:59:59').getTime() : Infinity;
  const kinds = gs.media || gs.links || gs.docs;
  const hits = [];
  for (const chat of state.chats) {
    for (const m of chat.msgs) {
      if (m.type === 'system' || m.ts < after || m.ts > before) continue;
      if (gs.from === '@me' ? m.sender !== chat.me : gs.from && lc(m.sender) !== lc(gs.from)) continue;
      if (kinds) {
        const visual = m.type === 'image' || m.type === 'video' || m.type === 'gif' || m.type === 'audio';
        if (!((gs.media && visual) || (gs.links && chat.linkMap.has(m.i)) || (gs.docs && m.type === 'document'))) continue;
      }
      let at = -1;
      if (useQ) {
        if (!m.text) continue;
        if (m.lc === undefined) m.lc = m.text.toLowerCase();
        at = m.lc.indexOf(q);
        if (at < 0) continue;
      }
      hits.push({ chat, m, at });
    }
  }
  hits.sort((a, b) => b.m.ts - a.m.ts);
  gs.hits = hits; gs.shown = 0;
  dom.list.appendChild(el('div', 'list-head', 'Messages <small>' + hits.length.toLocaleString() + '</small>'));
  if (!hits.length) { dom.list.appendChild(el('div', 'list-empty', 'No messages match.')); return; }
  moreGlobalSearch();
}

function moreGlobalSearch() {
  const end = Math.min(gs.hits.length, gs.shown + 60);
  const frag = document.createDocumentFragment();
  for (let k = gs.shown; k < end; k++) {
    const { chat, m, at } = gs.hits[k];
    const out = !!chat.me && m.sender === chat.me;
    let inner;
    if (at >= 0) {
      const from = Math.max(0, at - 24), len = gs.q.length;
      inner = '<span class="t">' + (out ? 'You: ' : chat.isGroup ? esc(m.sender.split(' ')[0]) + ': ' : '') + (from ? '…' : '') + esc(m.text.slice(from, at)) +
        '<b>' + esc(m.text.slice(at, at + len)) + '</b>' + esc(m.text.slice(at + len, at + len + 90)) + '</span>';
    } else inner = previewHTML(chat, m);
    const holder = el('div', '', chatRowHTML(chat, numericDate(m.ts, chat), inner, 'hit'));
    holder.firstChild.dataset.hit = k;
    frag.appendChild(holder.firstChild);
  }
  gs.shown = end;
  dom.list.appendChild(frag);
}

function renderFilterPop() {
  const pop = $('#filter-pop');
  const names = new Map();
  for (const chat of state.chats) for (const s of chat.senders) if (s !== chat.me) names.set(lc(s), s);
  const check = (key, label) => '<label class="chk"><input type="checkbox" data-f="' + key + '"' + (gs[key] ? ' checked' : '') + '><span>' + label + '</span></label>';
  pop.innerHTML = '<div class="fp-row"><label>From</label><select data-f="from"><option value="">Anyone</option><option value="@me"' + (gs.from === '@me' ? ' selected' : '') + '>You</option>' +
    [...names.values()].sort().map(n => '<option' + (lc(gs.from) === lc(n) ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></div>' +
    '<div class="fp-row"><label>Between</label><input type="date" data-f="after" value="' + esc(gs.after) + '"><input type="date" data-f="before" value="' + esc(gs.before) + '"></div>' +
    '<div class="fp-row"><label>Has</label><span class="chks">' + check('media', 'Media') + check('links', 'Links') + check('docs', 'Docs') + '</span></div>' +
    '<div class="fp-foot"><span>Searches every chat</span><button class="soft-btn" data-f-clear>Clear</button></div>';
}
function syncFilterBadge() {
  const n = gsFilterCount();
  $('#filter-btn').classList.toggle('on', n > 0);
  $('#filter-btn').dataset.n = n || '';
}

// ---------------------------------------------------------------- wiring
function bindExtras() {
  dom.msgs.addEventListener('click', e => {
    const btn = e.target.closest('.msg-menu');
    if (!btn) return;
    e.stopPropagation();
    messageMenu(btn, +btn.closest('.row').dataset.i);
  });
  dom.msgs.addEventListener('contextmenu', e => {
    const row = e.target.closest('.row');
    if (!row || e.target.closest('a')) return;
    e.preventDefault();
    messageMenu(row.querySelector('.bubble'), +row.dataset.i);
  });

  $('#avatar-input').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file && photoTarget) savePhoto(photoTarget, file);
  });
  $('#contact-close').addEventListener('click', closePanels);
  $('#contact-body').addEventListener('click', e => {
    const edit = e.target.closest('[data-photo]');
    if (edit) { photoTarget = edit.dataset.photo; $('#avatar-input').click(); return; }
    infoClick(e.target);
  });

  // Search across chats
  dom.list.addEventListener('scroll', () => {
    if (globalSearchActive() && gs.shown < gs.hits.length && dom.list.scrollHeight - dom.list.scrollTop - dom.list.clientHeight < 600) moreGlobalSearch();
  }, { passive: true });
  dom.list.addEventListener('click', e => {
    const row = e.target.closest('[data-hit]');
    const hit = row && gs.hits[+row.dataset.hit];
    if (hit) goToMessage(hit.chat, hit.m.i);
  });
  const pop = $('#filter-pop');
  $('#filter-btn').addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    if (!pop.hidden) renderFilterPop();
  });
  pop.addEventListener('change', e => {
    const key = e.target.dataset.f;
    if (!key) return;
    gs[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    syncFilterBadge();
    renderList();
  });
  pop.addEventListener('click', e => {
    e.stopPropagation();
    if (!e.target.closest('[data-f-clear]')) return;
    Object.assign(gs, { from: '', after: '', before: '', media: false, links: false, docs: false });
    syncFilterBadge();
    renderFilterPop();
    renderList();
  });
  document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; });

  bindInsights();
}
