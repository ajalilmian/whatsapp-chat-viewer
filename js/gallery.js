'use strict';
/* Media, docs and links: a dialog covering every chat, and a side panel for the open chat.
   Uses the helpers defined in app.js. */

const gal = {
  scope: 'chat', tab: 'media', sentBy: 'all', sort: 'newest', show: 'all', q: '', finding: false,
  select: false, picked: new Set(), items: [], shown: 0, lastKey: null, cur: null,
};
let galIO = null;
const galHost = () => (gal.scope === 'all' ? dom.mediaModal : dom.infoPanel);
const TAB_WORD = { media: 'Media', docs: 'Docs', links: 'Links' };
const itemKey = it => it.chat.sig + ':' + it.m.i;
const whoOf = it => (it.chat.me && it.m.sender === it.chat.me ? 'You' : it.m.sender);

function sentWhen(m, chat) {
  const diff = Math.round((dayStart(Date.now()) - dayStart(m.ts)) / DAY);
  return (diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : numericDate(m.ts, chat)) + ' at ' + m.time;
}

function resetGallery(scope, tab) {
  Object.assign(gal, { scope, sentBy: 'all', sort: 'newest', show: 'all', q: '', finding: false, select: false });
  gal.picked.clear();
  if (tab) gal.tab = tab;
}
function openGallery(scope, tab, opts) {
  if (scope === 'chat' && !view.chat) scope = 'all';
  resetGallery(scope, tab);
  if (opts && opts.starred) gal.show = 'starred';
  if (scope === 'all') dom.mediaModal.hidden = false;
  else showPanel('#info-panel');
  renderGallery();
}
function closeGallery(host) {
  if (host === dom.mediaModal) {
    dom.mediaModal.hidden = true;
    if (!dom.infoPanel.hidden && view.chat) { resetGallery('chat'); renderGallery(); }
  } else {
    dom.infoPanel.hidden = true;
    syncPanels();
  }
}

function galleryItems() {
  const chats = gal.scope === 'chat' ? [view.chat] : state.chats;
  const q = lc(gal.q.trim());
  const items = [];
  for (const chat of chats) {
    const idx = gal.tab === 'media' ? chat.visual : gal.tab === 'docs' ? chat.docs : chat.links;
    for (const i of idx) {
      const m = chat.msgs[i];
      const out = !!chat.me && m.sender === chat.me;
      if (gal.sentBy === 'you' && !out) continue;
      if (gal.sentBy === 'others' && out) continue;
      if (gal.show === 'starred' && !isStarred(chat, m)) continue;
      if (q) {
        const hay = lc([m.text, m.title, m.file && displayName(m.file), m.sender, chat.name].filter(Boolean).join(' '));
        if (!hay.includes(q)) continue;
      }
      items.push({ chat, m, size: gal.tab === 'links' ? 0 : fileSize(chat, m.file) });
    }
  }
  if (gal.sort === 'oldest') items.sort((a, b) => a.m.ts - b.m.ts);
  else if (gal.sort === 'largest' && gal.tab !== 'links') items.sort((a, b) => b.size - a.size);
  else items.sort((a, b) => b.m.ts - a.m.ts);
  return items;
}

function renderGallery() {
  const host = galHost(), body = $('.g-body', host);
  host.classList.toggle('selecting', gal.select);
  host.querySelectorAll('.g-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === gal.tab));
  $('.g-select', host).classList.toggle('on', gal.select);
  $('.g-search', host).hidden = !gal.finding;
  if (gal.scope === 'all') {
    $('.media-title .name', host).textContent = 'Media';
    $('.media-title .sub', host).textContent = TAB_WORD[gal.tab] + ' from all chats' + (gal.show === 'starred' ? ' · starred' : '');
  }
  const head = $('.g-thead', host);
  head.hidden = gal.tab === 'media';
  head.innerHTML = gal.tab === 'docs' ? '<span>Doc</span><span>Caption</span><span>Sent by</span>' : '<span>Link</span><span>Message</span><span>Sent by</span>';

  gal.items = galleryItems();
  gal.shown = 0; gal.lastKey = null; gal.cur = null;
  if (galIO) galIO.disconnect();
  galIO = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { galIO.unobserve(e.target); loadGalleryNode(e.target); }
  }, { root: body, rootMargin: '600px 0px' });
  body.textContent = '';
  body.scrollTop = 0;
  updateGalleryBar();
  if (!gal.items.length) {
    const word = { media: 'media', docs: 'documents', links: 'links' }[gal.tab];
    const narrowed = gal.sentBy !== 'all' || gal.show !== 'all' || gal.q.trim();
    body.appendChild(el('div', 'g-empty', '<div class="t">No ' + word + '</div><div class="s">' +
      (narrowed ? 'Nothing matches this filter.' : gal.scope === 'chat' ? TAB_WORD[gal.tab] + ' shared in this chat will appear here.' : TAB_WORD[gal.tab] + ' from your imported chats will appear here.') + '</div>' +
      (gal.scope === 'chat' ? '<button data-all>' + ICON.media + 'View ' + lc(TAB_WORD[gal.tab]) + ' from all chats</button>' : '')));
    return;
  }
  moreGallery();
  while (gal.shown < gal.items.length && body.scrollHeight <= body.clientHeight + 300) moreGallery();
}

function moreGallery() {
  const body = $('.g-body', galHost());
  const end = Math.min(gal.items.length, gal.shown + (gal.tab === 'media' ? 72 : 50));
  const grouped = !(gal.sort === 'largest' && gal.tab !== 'links');
  const boxClass = gal.tab === 'media' ? 'g-grid' : 'g-list';
  for (let k = gal.shown; k < end; k++) {
    const it = gal.items[k];
    if (grouped) {
      const b = bucketOf(it.m.ts);
      if (b.key !== gal.lastKey) {
        gal.lastKey = b.key;
        body.appendChild(el('div', 'g-sec', '<div class="t">' + esc(b.title) + '</div><div class="s">' + esc(b.sub) + '</div>'));
        gal.cur = body.appendChild(el('div', boxClass));
      }
    } else if (!gal.cur) {
      gal.cur = body.appendChild(el('div', boxClass + ' flat'));
    }
    gal.cur.appendChild(galleryNode(it, k));
  }
  gal.shown = end;
}

const DOC_KIND = { pdf: 'pdf', doc: 'word', docx: 'word', rtf: 'word', xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ppt: 'slides', pptx: 'slides', zip: 'zip', txt: 'text' };

function galleryNode(it, k) {
  const { chat, m } = it;
  const all = gal.scope === 'all';
  const who = whoOf(it);
  const picked = gal.picked.has(itemKey(it));
  const starred = isStarred(chat, m);
  const cb = '<span class="cb">' + ICON.boxOn + ICON.boxOff + '</span>';
  let node;
  if (gal.tab === 'media') {
    node = el('button', 'g-tile',
      (m.type === 'image' ? '<img alt="" draggable="false">' : '<video muted playsinline preload="metadata"></video><span class="vid">' + ICON.videoFill + '<span></span></span>') +
      (all ? '<span class="who">' + esc(chat.name) + '</span>' : '') + cb + '<span class="stb">' + ICON.star + '</span>');
    node.title = who + ' · ' + sentWhen(m, chat);
    galIO.observe(node);
  } else {
    const sent = '<div class="c3">' + senderAvatar(chat, m.sender, 'sm') + '<div class="tx"><div class="n">' + esc(who + (all && (chat.isGroup || who === 'You') ? ' • ' + chat.name : '')) + '</div>' +
      '<div class="m">' + esc(sentWhen(m, chat)) + '</div></div></div>';
    const tools = '<div class="c4"><span class="stb">' + ICON.star + '</span><button class="icon-btn open" title="' + (gal.tab === 'docs' ? 'Open' : 'Open link in a new tab') + '">' + ICON.openNew + '</button>' +
      '<button class="icon-btn more" title="More">' + ICON.down + '</button></div>';
    const narrow = '<span class="nar"> · ' + esc(who) + ' · ' + esc(numericDate(m.ts, chat)) + '</span>';
    if (gal.tab === 'docs') {
      const name = m.title || displayName(m.file), ext = extOf(m.file);
      node = el('div', 'g-row', cb + '<div class="c1"><span class="ficon k-' + (DOC_KIND[ext] || 'file') + '">' + ICON.doc + '</span><div class="tx"><div class="n">' + esc(name) + '</div>' +
        '<div class="m">' + esc(fmtSize(it.size) + ' • ' + ext.toUpperCase()) + narrow + '</div></div></div>' +
        '<div class="c2">' + (m.text ? '“' + esc(m.text.slice(0, 160)) + '”' : '<i>No caption</i>') + '</div>' + sent + tools);
    } else {
      const urls = chat.linkMap.get(m.i) || [];
      let host = urls[0] || '';
      try { host = new URL(hrefOf(urls[0])).hostname.replace(/^www\./, ''); } catch (e) { /* keep raw */ }
      const rest = m.text.replace(new RegExp(URL_RE.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
      const known = linkPreviewNow(urls[0]);
      node = el('div', 'g-row', cb + '<div class="c1"><span class="ficon k-link">' + (known && known.image ? '<img src="' + esc(known.image) + '" alt="">' : ICON.link) + '</span>' +
        '<div class="tx"><div class="n">' + esc(known ? known.title : host) + '</div><div class="m">' + esc(host) + narrow + '</div></div></div>' +
        '<div class="c2">' + (rest ? '“' + esc(rest.slice(0, 160)) + '”' : '<i>No caption</i>') + '</div>' + sent + tools);
      node.dataset.url = urls[0] || '';
      if (!known && linkPreviewsOn()) galIO.observe(node);
    }
  }
  node.dataset.k = k;
  node.classList.toggle('picked', picked);
  node.classList.toggle('starred', starred);
  return node;
}

function loadGalleryNode(node) {
  const it = gal.items[+node.dataset.k];
  if (!it) return;
  if (gal.tab === 'links') {
    getLinkPreview(node.dataset.url).then(info => {
      if (!info || !node.isConnected) return;
      $('.c1 .n', node).textContent = info.title;
      if (info.image) $('.ficon', node).innerHTML = '<img src="' + esc(info.image) + '" alt="">';
    });
    return;
  }
  mediaURL(it.chat, it.m.file).then(url => {
    const media = node.firstElementChild;
    if (it.m.type === 'image') {
      media.onload = () => node.classList.add('loaded');
      media.src = url;
    } else {
      media.onloadedmetadata = () => { $('.vid span', node).textContent = fmtDur(media.duration); };
      media.onloadeddata = () => node.classList.add('loaded');
      media.src = url + '#t=0.1';
    }
  }).catch(() => node.classList.add('loaded'));
}

// ---- selection
function pickedItems() { return gal.items.filter(it => gal.picked.has(itemKey(it))); }
function updateGalleryBar() {
  const host = galHost(), bar = $('.g-bar', host);
  bar.hidden = !gal.select;
  if (!gal.select) return;
  const items = pickedItems();
  const bytes = items.reduce((n, it) => n + it.size, 0);
  $('.g-size', bar).textContent = bytes ? fmtSize(bytes) : '';
  $('.g-count', bar).textContent = items.length + ' selected';
  const allStarred = items.length > 0 && items.every(it => isStarred(it.chat, it.m));
  $('.g-star', bar).innerHTML = ICON[allStarred ? 'star' : 'starBorder'];
  $('.g-star', bar).title = allStarred ? 'Unstar' : 'Star';
  $('.g-dl', bar).title = gal.tab === 'links' ? 'Copy links' : 'Download';
  $('.g-dl', bar).innerHTML = ICON[gal.tab === 'links' ? 'copy' : 'download'];
  bar.querySelectorAll('button').forEach(b => { b.disabled = !items.length; });
}
function setSelecting(on) {
  gal.select = on;
  if (!on) gal.picked.clear();
  const host = galHost();
  host.classList.toggle('selecting', on);
  $('.g-select', host).classList.toggle('on', on);
  host.querySelectorAll('.picked').forEach(n => n.classList.remove('picked'));
  updateGalleryBar();
}
function togglePick(node, it) {
  const key = itemKey(it);
  if (gal.picked.has(key)) gal.picked.delete(key); else gal.picked.add(key);
  node.classList.toggle('picked', gal.picked.has(key));
  updateGalleryBar();
}

function starItems(items, on) {
  for (const it of items) {
    setStar(it.chat, it.m, on);
    rerenderRow(it.chat, it.m.i);
  }
  saveSettings();
  $('.g-body', galHost()).querySelectorAll('[data-k]').forEach(n => {
    const it = gal.items[+n.dataset.k];
    if (it) n.classList.toggle('starred', isStarred(it.chat, it.m));
  });
  updateGalleryBar();
}
async function downloadItems(items) {
  for (const it of items) {
    try {
      const a = document.createElement('a');
      a.href = await mediaURL(it.chat, it.m.file);
      a.download = it.m.title || displayName(it.m.file);
      document.body.appendChild(a); a.click(); a.remove();
      await new Promise(r => setTimeout(r, 350));
    } catch (e) { toast("Couldn't download " + displayName(it.m.file)); }
  }
}
function copyText(text, done) {
  const ok = () => toast(done);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, () => toast("Couldn't copy"));
  else {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); ok(); } catch (e) { toast("Couldn't copy"); }
    t.remove();
  }
}
const linksOf = it => (it.chat.linkMap.get(it.m.i) || []).map(hrefOf);

function galleryMenu(anchor, node, it) {
  const starred = isStarred(it.chat, it.m);
  const items = [{ label: 'Select', run: () => { if (!gal.select) setSelecting(true); togglePick(node, it); } }, '-'];
  if (gal.tab === 'links') items.push({ label: 'Open link in a new tab', run: () => window.open(linksOf(it)[0], '_blank', 'noopener') });
  else if (gal.tab === 'docs') items.push({ label: 'Open', run: () => openDoc(it.chat, it.m.file) });
  items.push({ label: 'Go to message', run: () => goToMessage(it.chat, it.m.i) });
  if (gal.tab === 'links') items.push({ label: 'Copy link', run: () => copyText(linksOf(it)[0], 'Link copied') });
  else items.push({ label: 'Download', run: () => downloadItems([it]) });
  items.push({ label: starred ? 'Unstar' : 'Star', run: () => starItems([it], !starred) });
  openMenu(anchor, items);
}

function bindGallery(host) {
  const body = $('.g-body', host);
  $('.g-tabs', host).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) { gal.tab = b.dataset.tab; gal.picked.clear(); renderGallery(); }
  });
  $('.g-close', host).addEventListener('click', () => closeGallery(host));
  $('.g-select', host).addEventListener('click', () => setSelecting(!gal.select));
  $('.g-find', host).addEventListener('click', () => {
    gal.finding = !gal.finding;
    if (!gal.finding) gal.q = '';
    $('.g-search input', host).value = gal.q;
    renderGallery();
    if (gal.finding) $('.g-search input', host).focus();
  });
  let timer = 0;
  $('.g-search input', host).addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { gal.q = e.target.value; renderGallery(); }, 160);
  });
  $('.g-sort', host).addEventListener('click', e => {
    e.stopPropagation();
    const pick = (key, val) => () => { gal[key] = val; renderGallery(); };
    const radio = (label, key, val) => ({ label, radio: true, on: gal[key] === val, run: pick(key, val) });
    openMenu(e.currentTarget, [
      { heading: 'Show' }, radio('Everything', 'show', 'all'), radio('Starred', 'show', 'starred'), '-',
      { heading: 'Sent by' }, radio('All', 'sentBy', 'all'), radio('You', 'sentBy', 'you'), radio('Others', 'sentBy', 'others'), '-',
      { heading: 'Sort by' }, radio('Newest', 'sort', 'newest'), radio('Oldest', 'sort', 'oldest'), radio('Largest', 'sort', 'largest'),
    ]);
  });
  $('.g-star', host).addEventListener('click', () => {
    const items = pickedItems();
    starItems(items, !items.every(it => isStarred(it.chat, it.m)));
  });
  $('.g-dl', host).addEventListener('click', () => {
    const items = pickedItems();
    if (gal.tab === 'links') copyText(items.map(it => linksOf(it)[0]).join('\n'), items.length + (items.length === 1 ? ' link copied' : ' links copied'));
    else downloadItems(items);
  });
  body.addEventListener('scroll', () => {
    if (host === galHost() && gal.shown < gal.items.length && body.scrollHeight - body.scrollTop - body.clientHeight < 900) moreGallery();
  }, { passive: true });
  body.addEventListener('click', e => {
    if (e.target.closest('[data-all]')) { openGallery('all', gal.tab); return; }
    const node = e.target.closest('[data-k]');
    if (!node) return;
    const it = gal.items[+node.dataset.k];
    if (!it) return;
    const more = e.target.closest('.more');
    if (more) { e.stopPropagation(); galleryMenu(more, node, it); return; }
    if (gal.select) { togglePick(node, it); return; }
    if (e.target.closest('.open')) {
      if (gal.tab === 'docs') openDoc(it.chat, it.m.file); else window.open(linksOf(it)[0], '_blank', 'noopener');
    } else if (gal.tab === 'media') showLightbox(gal.items, +node.dataset.k, gal.scope === 'all');
    else if (gal.tab === 'docs') openDoc(it.chat, it.m.file);
    else goToMessage(it.chat, it.m.i);
  });
  body.addEventListener('contextmenu', e => {
    const node = e.target.closest('[data-k]');
    const it = node && gal.items[+node.dataset.k];
    if (!it) return;
    e.preventDefault();
    galleryMenu(node, node, it);
  });
}
