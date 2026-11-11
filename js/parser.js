/* Parses WhatsApp "Export chat" text files (iOS and Android layouts). */
(function (global) {
  'use strict';

  const SP = '[ \\u202f\\u00a0]';
  const DATE = '(\\d{1,4})([\\/.\\-])(\\d{1,2})\\2(\\d{2,4})';
  const TIME = '(\\d{1,2})[:.](\\d{2})(?:[:.](\\d{2}))?(?:' + SP + '*([AaPp])\\.?' + SP + '?[Mm]\\.?)?';
  // iOS:     [02/03/2015, 9:30:24 PM] Name: text
  const IOS = new RegExp('^[\\u200e\\u200f\\ufeff]*\\[' + DATE + ',?' + SP + '+' + TIME + '\\]' + SP + '?(.*)$', 's');
  // Android: 02/03/2015, 21:30 - Name: text
  const ANDROID = new RegExp('^[\\u200e\\u200f\\ufeff]*' + DATE + ',?' + SP + '+' + TIME + SP + '+-' + SP + '(.*)$', 's');

  const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;
  const MARK = /^[‎‏]/;

  const EXT_KIND = {
    jpg: 'image', jpeg: 'image', png: 'image', heic: 'image', bmp: 'image',
    webp: 'sticker', gif: 'image',
    mp4: 'video', mov: 'video', m4v: 'video', '3gp': 'video', webm: 'video', mkv: 'video', avi: 'video',
    opus: 'audio', ogg: 'audio', m4a: 'audio', mp3: 'audio', aac: 'audio', wav: 'audio', amr: 'audio',
    vcf: 'contact',
  };

  const OMITTED = /^(.*?)\s*<?(image|video|audio|gif|sticker|document|contact card|video note|media) omitted>?$/is;
  const CALL = /^(missed |silenced )?(group )?(voice|video) call(?:[,.]\s*(.*))?$/i;

  function kindOfFile(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    let kind = EXT_KIND[ext] || 'document';
    if (kind === 'video' && /(^|-)GIF-/i.test(name)) kind = 'gif';
    if (kind === 'image' && /(^|-)STICKER-/i.test(name)) kind = 'sticker';
    return kind;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function parse(text) {
    text = text.replace(/\r\n?/g, '\n');
    const lines = text.split('\n');
    const raw = [];
    let cur = null;
    let maxA = 0, maxB = 0, yearFirst = false, twelveHour = false;

    for (let k = 0; k < lines.length; k++) {
      const line = lines[k];
      const m = IOS.exec(line) || ANDROID.exec(line);
      if (m) {
        const a = +m[1], b = +m[3];
        if (m[1].length === 4) yearFirst = true;
        else { if (a > maxA) maxA = a; if (b > maxB) maxB = b; }
        if (m[8]) twelveHour = true;
        cur = { a, b, c: +m[4], cLen: m[4].length, h: +m[5], mi: +m[6], s: m[7] ? +m[7] : 0, ap: m[8], rest: m[9] };
        raw.push(cur);
      } else if (cur) {
        cur.rest += '\n' + line;
      }
    }

    // DD/MM vs MM/DD: whichever side ever exceeds 12 is the day.
    const monthFirst = !yearFirst && maxA <= 12 && maxB > 12;

    const messages = [];
    const counts = new Map();

    for (let k = 0; k < raw.length; k++) {
      const r = raw[k];
      let y, mo, d;
      if (yearFirst) { y = r.a; mo = r.b; d = r.c; }
      else {
        y = r.cLen <= 2 ? 2000 + r.c : r.c;
        if (monthFirst) { mo = r.a; d = r.b; } else { d = r.a; mo = r.b; }
      }
      let h = r.h;
      if (r.ap) {
        const pm = r.ap.toLowerCase() === 'p';
        if (pm && h < 12) h += 12;
        if (!pm && h === 12) h = 0;
      }
      const date = new Date(y, mo - 1, d, h, r.mi, r.s);
      const time = twelveHour
        ? ((h % 12) || 12) + ':' + pad(r.mi) + ' ' + (h < 12 ? 'AM' : 'PM')
        : pad(h) + ':' + pad(r.mi);

      const msg = {
        i: messages.length,
        ts: date.getTime(),
        day: y * 10000 + mo * 100 + d,
        time,
        sender: null,
        type: 'text',
        text: '',
        edited: false,
      };

      let body = r.rest.replace(/\n+$/, '');
      const sm = /^([^:\n]{1,80}?): ?([\s\S]*)$/.exec(body);
      if (sm) {
        msg.sender = sm[1].replace(BIDI, '').trim();
        body = sm[2];
      } else {
        msg.type = 'system';
        msg.text = body.replace(BIDI, '').trim();
        if (msg.text) messages.push(msg);
        continue;
      }

      if (/<This message was edited>\s*$/.test(body.replace(BIDI, ''))) {
        msg.edited = true;
        body = body.replace(/[‎‏\s]*<This message was edited>\s*$/, '');
      }

      const marked = MARK.test(body);
      const clean = body.replace(BIDI, '').trim();
      let m;

      if ((m = /<attached: ([^>\n]+)>/.exec(body))) {
        msg.file = m[1].replace(BIDI, '').trim();
        msg.type = kindOfFile(msg.file);
        const before = body.slice(0, m.index).replace(BIDI, '').trim();
        const after = body.slice(m.index + m[0].length).replace(BIDI, '').trim();
        if (msg.type === 'document' && before.includes('•')) {
          const parts = before.split('•');
          msg.title = parts[0].trim();
          msg.docMeta = parts.slice(1).join('•').trim();
          msg.text = after;
        } else {
          msg.text = [before, after].filter(Boolean).join('\n');
        }
      } else if ((m = /^([^\n]+?\.[A-Za-z0-9]{2,5}) \(file attached\)(?:\n([\s\S]*))?$/.exec(clean))) {
        msg.file = m[1].trim();
        msg.type = kindOfFile(msg.file);
        msg.text = (m[2] || '').trim();
      } else if ((m = OMITTED.exec(clean)) && (marked || /^</.test(clean) || body.includes('‎'))) {
        msg.type = 'omitted';
        msg.omitted = m[2].toLowerCase();
        msg.text = m[1].trim();
      } else if (/^(This message was deleted\.?|You deleted this message\.?)$/i.test(clean)) {
        msg.type = 'deleted';
        msg.text = clean.replace(/\.$/, '');
      } else if ((m = /^(?:live )?location: (https?:\/\/\S+)/i.exec(clean))) {
        msg.type = 'location';
        msg.url = m[1];
        const q = /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(m[1]);
        if (q) { msg.lat = +q[1]; msg.lng = +q[2]; }
        msg.text = '';
      } else if ((marked || /^(missed|silenced) /i.test(clean)) && (m = CALL.exec(clean))) {
        msg.type = 'call';
        msg.missed = !!m[1] || /no answer/i.test(m[4] || '');
        msg.video = m[3].toLowerCase() === 'video';
        msg.group = !!m[2];
        msg.detail = (m[4] || '').trim();
      } else if (/^POLL:\n/.test(clean)) {
        const rows = clean.split('\n').slice(1).map(s => s.trim()).filter(Boolean);
        msg.type = 'poll';
        msg.question = rows[0] || '';
        msg.options = rows.slice(1).map(row => {
          const o = /^OPTION: (.*?)(?: \((\d+) votes?\))?$/.exec(row);
          return o ? { text: o[1], votes: +(o[2] || 0) } : { text: row, votes: 0 };
        });
        msg.text = msg.question;
      } else if (marked && clean.length < 300 && !clean.includes('\n')) {
        msg.type = 'system';
        msg.text = clean;
      } else {
        msg.text = body.replace(/[‎‏﻿]/g, '');
      }

      if (msg.type !== 'system') counts.set(msg.sender, (counts.get(msg.sender) || 0) + 1);
      messages.push(msg);
    }

    // Senders that only ever produced system lines are group titles, not people.
    for (let k = 0; k < messages.length; k++) {
      const m = messages[k];
      if (m.type === 'system' && m.sender && !counts.has(m.sender)) m.sender = null;
      m.i = k;
    }

    const senders = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
    return { messages, senders, twelveHour, monthFirst };
  }

  global.WAParser = { parse, kindOfFile };
})(window);
