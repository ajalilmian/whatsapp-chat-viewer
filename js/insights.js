'use strict';
/* Chat insights (numbers and charts) and Memories (on this day, random memory).
   Uses the helpers defined in app.js. */

// ---------------------------------------------------------------- memories
let randomMemory = null;

// Messages sent on this calendar day in earlier years, grouped by chat and year.
function onThisDay(spread) {
  const now = new Date(), year = now.getFullYear();
  const wanted = new Set();
  for (let d = -spread; d <= spread; d++) {
    const x = new Date(year, now.getMonth(), now.getDate() + d);
    wanted.add((x.getMonth() + 1) * 100 + x.getDate());
  }
  const rows = [];
  for (const chat of state.chats) {
    let cur = null;
    for (const m of chat.msgs) {
      if (m.type === 'system') continue;
      const y = Math.floor(m.day / 10000);
      if (y >= year || !wanted.has(m.day % 10000)) continue;
      if (!cur || cur.day !== m.day) { cur = { chat, day: m.day, year: y, first: m.i, ts: m.ts, count: 0, photos: 0, sample: '' }; rows.push(cur); }
      cur.count++;
      if (m.type === 'image' || m.type === 'video') cur.photos++;
      if (!cur.sample && m.type === 'text' && m.text.length > 3) cur.sample = m.text;
    }
  }
  return rows.sort((a, b) => b.ts - a.ts);
}

function pickRandomMemory() {
  const total = state.chats.reduce((n, c) => n + c.msgs.length, 0);
  if (!total) return null;
  let pick = Math.floor(Math.random() * total), chat = null;
  for (const c of state.chats) { if (pick < c.msgs.length) { chat = c; break; } pick -= c.msgs.length; }
  let first = pick;
  while (first > 0 && chat.msgs[first - 1].day === chat.msgs[pick].day) first--;
  const row = { chat, day: chat.msgs[pick].day, first, ts: chat.msgs[first].ts, count: 0, photos: 0, sample: '' };
  for (let i = first; i < chat.msgs.length && chat.msgs[i].day === row.day; i++) {
    const m = chat.msgs[i];
    if (m.type === 'system') continue;
    row.count++;
    if (m.type === 'image' || m.type === 'video') row.photos++;
    if (!row.sample && m.type === 'text' && m.text.length > 3) row.sample = m.text;
  }
  return row;
}

function memoryRow(row, label) {
  const bits = [row.count + (row.count === 1 ? ' message' : ' messages')];
  if (row.photos) bits.push(row.photos + (row.photos === 1 ? ' photo' : ' photos'));
  const b = el('button', 'chat-item tall',
    avatarHTML(row.chat, 'lg') + '<span class="body"><span class="top"><span class="name">' + esc(row.chat.name) + '</span><span class="when">' + esc(label) + '</span></span>' +
    '<span class="bottom"><span class="preview"><span class="t">' + esc(longDate(row.ts)) + ' · ' + bits.join(' · ') + '</span></span></span>' +
    (row.sample ? '<span class="bottom"><span class="preview quote"><span class="t">“' + esc(row.sample.replace(/\s+/g, ' ').slice(0, 90)) + '”</span></span></span>' : '') + '</span>');
  b.addEventListener('click', () => goToMessage(row.chat, row.first));
  return b;
}

function renderMemories() {
  const q = lc(state.query.trim());
  const keep = r => !q || lc(r.chat.name).includes(q);
  const now = new Date(), year = now.getFullYear();
  dom.list.textContent = '';
  if (!state.chats.length) {
    dom.list.appendChild(el('div', 'list-empty', 'No chats yet.<br>Memories from your imported chats will show up here.'));
    return;
  }
  const ago = y => (year - y === 1 ? '1 year ago' : (year - y) + ' years ago');

  dom.list.appendChild(el('div', 'list-head', 'On this day <small>' + now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) + '</small>'));
  const today = onThisDay(0).filter(keep);
  if (today.length) today.forEach(r => dom.list.appendChild(memoryRow(r, ago(r.year))));
  else dom.list.appendChild(el('div', 'list-note', 'Nothing was said on this date in earlier years.'));

  const todayKey = (now.getMonth() + 1) * 100 + now.getDate();
  const near = onThisDay(3).filter(r => keep(r) && r.day % 10000 !== todayKey);
  if (near.length) {
    dom.list.appendChild(el('div', 'list-head', 'Around this time'));
    near.slice(0, 30).forEach(r => dom.list.appendChild(memoryRow(r, ago(r.year))));
  }

  dom.list.appendChild(el('div', 'list-head', 'Random memory'));
  if (randomMemory && state.chats.includes(randomMemory.chat)) dom.list.appendChild(memoryRow(randomMemory, String(Math.floor(randomMemory.day / 10000))));
  const again = el('button', 'soft-btn list-btn', ICON.shuffle + (randomMemory ? 'Show me another' : 'Surprise me'));
  again.addEventListener('click', () => {
    randomMemory = pickRandomMemory();
    renderMemories();
    if (randomMemory && window.innerWidth > 760) goToMessage(randomMemory.chat, randomMemory.first);
  });
  dom.list.appendChild(again);
}

// ---------------------------------------------------------------- insights: numbers
const STOP = new Set(('that this with have from your what will they were been just about would there their which when then them also into some than ' +
  'could should like dont cant didnt youre thats well yeah okay been more much very really know think going want need good time back still even only here ' +
  'does doing done make made come came take took said says tell told sure thing things because where while after before over again').split(' '));

function spanText(ms) {
  const min = ms / 60000;
  if (min < 1) return 'under a minute';
  if (min < 60) return Math.round(min) + ' min';
  if (min < 1440) return (min / 60).toFixed(1).replace('.0', '') + ' hr';
  return Math.round(min / 1440) + ' days';
}
function callSeconds(detail) {
  let s = 0;
  for (const m of String(detail || '').matchAll(/(\d+)\s*(hr|hour|h|min|m|sec|s)\b/gi)) {
    const u = m[2].toLowerCase()[0];
    s += +m[1] * (u === 'h' ? 3600 : u === 'm' ? 60 : 1);
  }
  return s;
}
const dayToTs = day => new Date(Math.floor(day / 10000), Math.floor(day / 100) % 100 - 1, day % 100).getTime();

function computeInsights(chats) {
  const people = new Map();
  const person = (chat, sender) => {
    const name = chat.me && sender === chat.me ? 'You' : sender;
    let p = people.get(name);
    if (!p) { p = { name, msgs: 0, words: 0, media: 0, starts: 0, replies: [] }; people.set(name, p); }
    return p;
  };
  const out = {
    total: 0, first: Infinity, last: -Infinity, byMonth: new Map(), byHour: new Array(24).fill(0), byDow: new Array(7).fill(0),
    byDay: new Map(), dayChat: new Map(), emoji: new Map(), words: new Map(),
    kinds: { Photos: 0, Videos: 0, 'Voice messages': 0, Documents: 0, Links: 0, 'Stickers and GIFs': 0 },
    calls: { count: 0, missed: 0, seconds: 0 },
  };
  const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu;
  for (const chat of chats) {
    let prev = null;
    for (const m of chat.msgs) {
      if (m.type === 'system') continue;
      out.total++;
      if (m.ts < out.first) out.first = m.ts;
      if (m.ts > out.last) out.last = m.ts;
      const d = new Date(m.ts);
      out.byHour[d.getHours()]++;
      out.byDow[d.getDay()]++;
      const mk = d.getFullYear() * 12 + d.getMonth();
      out.byMonth.set(mk, (out.byMonth.get(mk) || 0) + 1);
      const dayCount = (out.byDay.get(m.day) || 0) + 1;
      out.byDay.set(m.day, dayCount);
      if (!out.dayChat.has(m.day)) out.dayChat.set(m.day, { chat, i: m.i });

      const p = person(chat, m.sender);
      p.msgs++;
      if (!prev || m.ts - prev.ts > 6 * 3600000) p.starts++;
      else if (prev.sender !== m.sender) p.replies.push(m.ts - prev.ts);
      prev = m;

      if (m.type === 'image') { out.kinds.Photos++; p.media++; }
      else if (m.type === 'video') { out.kinds.Videos++; p.media++; }
      else if (m.type === 'audio') { out.kinds['Voice messages']++; p.media++; }
      else if (m.type === 'document') { out.kinds.Documents++; p.media++; }
      else if (m.type === 'sticker' || m.type === 'gif') { out.kinds['Stickers and GIFs']++; p.media++; }
      else if (m.type === 'call') { out.calls.count++; if (m.missed) out.calls.missed++; out.calls.seconds += callSeconds(m.detail); }
      if (chat.linkMap.has(m.i)) out.kinds.Links++;

      if (m.text && (m.type === 'text' || m.file)) {
        const plain = m.text.replace(new RegExp(URL_RE.source, 'gi'), ' ');
        const tokens = plain.toLowerCase().match(/[\p{L}][\p{L}']*/gu) || [];
        p.words += tokens.length;
        for (const w of tokens) if (w.length >= 4 && !STOP.has(w)) out.words.set(w, (out.words.get(w) || 0) + 1);
        for (const e of plain.match(EMOJI) || []) out.emoji.set(e, (out.emoji.get(e) || 0) + 1);
      }
    }
  }
  // Longest run of consecutive days, and the busiest day.
  const days = [...out.byDay.keys()].sort((a, b) => a - b);
  let run = 0, best = 0, bestEnd = 0, prevTs = 0, busiest = 0;
  for (const day of days) {
    const ts = dayToTs(day);
    run = prevTs && Math.round((ts - prevTs) / DAY) === 1 ? run + 1 : 1;
    if (run > best) { best = run; bestEnd = ts; }
    prevTs = ts;
    if (!busiest || out.byDay.get(day) > out.byDay.get(busiest)) busiest = day;
  }
  out.activeDays = days.length;
  out.spanDays = out.total ? Math.round((dayStart(out.last) - dayStart(out.first)) / DAY) + 1 : 0;
  out.streak = best; out.streakEnd = bestEnd; out.busiest = busiest;
  out.people = [...people.values()].sort((a, b) => b.msgs - a.msgs);
  for (const p of out.people) {
    p.replies.sort((a, b) => a - b);
    p.reply = p.replies.length ? p.replies[Math.floor(p.replies.length / 2)] : null;
  }
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  out.topEmoji = top(out.emoji, 10);
  out.topWords = top(out.words, 12);
  return out;
}

// ---------------------------------------------------------------- insights: drawing
const ins = { scope: null, data: null, year: 0 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function niceMax(v) {
  if (v <= 4) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 3, 4, 5, 6, 8, 10]) if (k * pow >= v) return k * pow;
  return 10 * pow;
}
const compact = n => (n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n));

// A column chart: one slot per value, a thin bar inside it, three quiet gridlines.
function columns(values, labels, tips, opts) {
  const max = niceMax(Math.max(1, ...values));
  let h = '<div class="vz-cols' + (opts && opts.dense ? ' dense' : '') + '"><div class="vz-grid">';
  for (const f of [1, 0.5, 0]) h += '<span style="bottom:' + f * 100 + '%"><i>' + compact(Math.round(max * f)) + '</i></span>';
  h += '</div><div class="vz-plot">';
  values.forEach((v, k) => {
    h += '<div class="vz-slot" data-tip="' + esc(tips[k]) + '"><b style="height:' + (v ? Math.max(1.5, v / max * 100) : 0) + '%"></b></div>';
  });
  h += '</div><div class="vz-x">' + labels.map(l => '<span>' + esc(l || '') + '</span>').join('') + '</div></div>';
  return h;
}

function heatmapHTML(data, year) {
  const start = new Date(year, 0, 1), end = new Date(year, 11, 31);
  const counts = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    counts.push(data.byDay.get(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) || 0);
  }
  const max = Math.max(1, ...counts);
  let h = '<div class="vz-heat"><div class="vz-months">', cells = '';
  const lead = start.getDay();
  for (let k = 0; k < lead; k++) cells += '<i class="pad"></i>';
  const cur = new Date(start);
  let lastMonth = -1;
  const monthCols = [];
  counts.forEach((n, k) => {
    const day = cur.getFullYear() * 10000 + (cur.getMonth() + 1) * 100 + cur.getDate();
    if (cur.getMonth() !== lastMonth) { lastMonth = cur.getMonth(); monthCols.push([Math.floor((k + lead) / 7), MONTHS[lastMonth]]); }
    const level = n ? Math.min(5, 1 + Math.floor(Math.sqrt(n / max) * 4.999)) : 0;
    cells += '<i class="l' + level + '"' + (n ? ' data-day="' + day + '"' : '') + ' data-tip="' + cur.getDate() + ' ' + MONTHS[cur.getMonth()] + ' ' + year + ' · ' +
      (n ? n.toLocaleString() + (n === 1 ? ' message' : ' messages') : 'no messages') + '"></i>';
    cur.setDate(cur.getDate() + 1);
  });
  h += monthCols.map(([col, name]) => '<span style="grid-column:' + (col + 1) + '">' + name + '</span>').join('');
  h += '</div><div class="vz-cells">' + cells + '</div>' +
    '<div class="vz-scale"><span>Less</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><i class="l5"></i><span>More</span></div></div>';
  return h;
}

function renderInsights() {
  const chats = ins.scope ? [ins.scope] : state.chats;
  const body = $('#insights-body');
  $('#insights-sub').textContent = ins.scope ? ins.scope.name : 'All chats';
  const sel = $('#insights-scope');
  sel.innerHTML = '<option value="">All chats</option>' + state.chats.map((c, k) => '<option value="' + k + '"' + (c === ins.scope ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
  if (!chats.length || !chats.some(c => c.msgs.length)) {
    body.innerHTML = '<div class="g-empty"><div class="t">Nothing to show yet</div><div class="s">Import a chat to see its insights.</div></div>';
    return;
  }
  const d = ins.data = computeInsights(chats);
  const firstYear = new Date(d.first).getFullYear(), lastYear = new Date(d.last).getFullYear();
  if (!ins.year || ins.year < firstYear || ins.year > lastYear) ins.year = lastYear;
  const date = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const tile = (value, label, note) => '<div class="vz-tile"><div class="v">' + value + '</div><div class="l">' + label + '</div>' + (note ? '<div class="n">' + note + '</div>' : '') + '</div>';

  let h = '<div class="vz-tiles">' +
    tile(d.total.toLocaleString(), 'Messages', date(d.first) + ' – ' + date(d.last)) +
    tile(d.activeDays.toLocaleString(), 'Days with messages', 'out of ' + d.spanDays.toLocaleString() + ' days') +
    tile(Math.round(d.total / Math.max(1, d.activeDays)).toLocaleString(), 'Messages on a typical active day') +
    tile(d.streak.toLocaleString() + (d.streak === 1 ? ' day' : ' days'), 'Longest streak', d.streak > 1 ? 'ending ' + date(d.streakEnd) : '') +
    tile(d.byDay.get(d.busiest).toLocaleString(), 'Messages on the busiest day', date(dayToTs(d.busiest))) +
    (d.calls.count ? tile(d.calls.count.toLocaleString(), 'Calls', (d.calls.seconds ? spanText(d.calls.seconds * 1000) + ' in total' : '') + (d.calls.missed ? (d.calls.seconds ? ' · ' : '') + d.calls.missed + ' missed' : '')) : '') +
    '</div>';

  // People: a share bar with a legend, then the detail table. Colour follows the person.
  const shown = d.people.slice(0, 8), rest = d.people.slice(8);
  const other = rest.reduce((n, p) => n + p.msgs, 0);
  h += '<section class="vz-card"><h3>Who says what</h3><div class="vz-share">' +
    shown.map((p, k) => '<b class="s' + (k + 1) + '" style="flex:' + p.msgs + '" data-tip="' + esc(p.name) + ' · ' + p.msgs.toLocaleString() + ' messages (' + Math.round(p.msgs / d.total * 100) + '%)"></b>').join('') +
    (other ? '<b class="s0" style="flex:' + other + '" data-tip="' + rest.length + ' others · ' + other.toLocaleString() + ' messages"></b>' : '') + '</div>' +
    '<div class="vz-table"><div class="hd"><span></span><span>Messages</span><span>Words per message</span><span>Media sent</span><span>Started the chat</span><span>Typical reply time</span></div>' +
    shown.map((p, k) => '<div><span><i class="sw s' + (k + 1) + '"></i>' + esc(p.name) + '</span><span>' + p.msgs.toLocaleString() + ' <em>' + Math.round(p.msgs / d.total * 100) + '%</em></span><span>' +
      (p.msgs ? (p.words / p.msgs).toFixed(1) : '0') + '</span><span>' + p.media.toLocaleString() + '</span><span>' + p.starts.toLocaleString() + ' times</span><span>' + (p.reply != null ? spanText(p.reply) : '–') + '</span></div>').join('') +
    (other ? '<div><span><i class="sw s0"></i>' + rest.length + ' others</span><span>' + other.toLocaleString() + '</span><span></span><span></span><span></span><span></span></div>' : '') +
    '</div><p class="vz-note">“Started the chat” counts the first message after a quiet gap of six hours or more.</p></section>';

  // Messages over time: by month, or by year when the chat spans too many months to read.
  const keys = [...d.byMonth.keys()].sort((a, b) => a - b);
  const span = keys[keys.length - 1] - keys[0] + 1;
  let vals = [], labels = [], tips = [], unit = 'month';
  if (span > 150) {
    unit = 'year';
    for (let y = firstYear; y <= lastYear; y++) {
      let n = 0;
      for (let mo = 0; mo < 12; mo++) n += d.byMonth.get(y * 12 + mo) || 0;
      vals.push(n); labels.push(String(y)); tips.push(y + ' · ' + n.toLocaleString() + ' messages');
    }
  } else {
    for (let k = keys[0]; k <= keys[keys.length - 1]; k++) {
      const n = d.byMonth.get(k) || 0, y = Math.floor(k / 12), mo = k % 12;
      vals.push(n);
      labels.push(span > 24 ? (mo === 0 ? String(y) : '') : MONTHS[mo] + (mo === 0 || k === keys[0] ? ' ' + String(y).slice(2) : ''));
      tips.push(MONTHS[mo] + ' ' + y + ' · ' + n.toLocaleString() + ' messages');
    }
  }
  h += '<section class="vz-card"><h3>Messages per ' + unit + '</h3>' + columns(vals, labels, tips, { dense: vals.length > 40 }) + '</section>';

  const hourName = hr => ((hr % 12) || 12) + (hr < 12 ? ' am' : ' pm');
  h += '<div class="vz-two"><section class="vz-card"><h3>Time of day</h3>' +
    columns(d.byHour, d.byHour.map((v, k) => (k % 6 === 0 ? hourName(k) : '')), d.byHour.map((v, k) => hourName(k) + ' – ' + hourName((k + 1) % 24) + ' · ' + v.toLocaleString() + ' messages')) + '</section>' +
    '<section class="vz-card"><h3>Day of the week</h3>' +
    columns(d.byDow, DOW, d.byDow.map((v, k) => DOW[k] + ' · ' + v.toLocaleString() + ' messages')) + '</section></div>';

  h += '<section class="vz-card"><div class="vz-head"><h3>Every day of ' + ins.year + '</h3><span class="vz-nav"><button class="icon-btn" data-year="-1" title="Earlier year"' + (ins.year <= firstYear ? ' disabled' : '') + '>' + ICON.left + '</button>' +
    '<button class="icon-btn" data-year="1" title="Later year"' + (ins.year >= lastYear ? ' disabled' : '') + '>' + ICON.right + '</button></span></div>' +
    '<div id="vz-heat-box">' + heatmapHTML(d, ins.year) + '</div><p class="vz-note">Click a day to open it in the chat.</p></section>';

  const rank = (rows, big) => {
    const max = rows.length ? rows[0][1] : 1;
    return '<div class="vz-rank">' + rows.map(([k, n]) => '<div data-tip="' + esc(k) + ' · used ' + n.toLocaleString() + ' times"><span class="k' + (big ? ' big' : '') + '">' + esc(k) + '</span><span class="bar"><b style="width:' + Math.max(2, n / max * 100) + '%"></b></span><span class="c">' + n.toLocaleString() + '</span></div>').join('') + '</div>';
  };
  h += '<div class="vz-two">' +
    (d.topEmoji.length ? '<section class="vz-card"><h3>Most used emoji</h3>' + rank(d.topEmoji, true) + '</section>' : '') +
    (d.topWords.length ? '<section class="vz-card"><h3>Most used words</h3>' + rank(d.topWords) + '<p class="vz-note">Words of four letters or more, leaving out the most common English ones.</p></section>' : '') + '</div>';

  h += '<section class="vz-card"><h3>What was shared</h3><div class="vz-tiles small">' +
    Object.entries(d.kinds).filter(e => e[1]).map(([k, n]) => tile(n.toLocaleString(), k)).join('') + '</div></section>';

  body.innerHTML = h;
  body.scrollTop = 0;
}

function openInsights(chat) {
  ins.scope = chat || view.chat || null;
  ins.year = 0;
  $('#insights-modal').hidden = false;
  renderInsights();
}

function bindInsights() {
  const modal = $('#insights-modal'), body = $('#insights-body'), tip = $('#viz-tip');
  $('#insights-close').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
  $('#insights-scope').addEventListener('change', e => {
    ins.scope = e.target.value === '' ? null : state.chats[+e.target.value];
    ins.year = 0;
    renderInsights();
  });
  body.addEventListener('click', e => {
    const nav = e.target.closest('[data-year]');
    if (nav) {
      ins.year += +nav.dataset.year;
      const st = body.scrollTop;
      renderInsights();
      body.scrollTop = st;
      return;
    }
    const cell = e.target.closest('[data-day]');
    if (cell && ins.data) {
      const day = +cell.dataset.day;
      const target = ins.data.dayChat.get(day);
      if (target) { tip.hidden = true; goToMessage(target.chat, target.i); }
    }
  });
  // One shared tooltip for every mark.
  body.addEventListener('mousemove', e => {
    const mark = e.target.closest('[data-tip]');
    if (!mark) { tip.hidden = true; return; }
    tip.textContent = mark.dataset.tip;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, e.clientX - w / 2)) + 'px';
    tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 14) + 'px';
  });
  body.addEventListener('mouseleave', () => { tip.hidden = true; });
}
