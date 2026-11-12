#!/usr/bin/env node
/* Tiny server for the WhatsApp chat viewer. No dependencies.
   Serves the app and keeps imported chats, settings and the custom background in DATA_DIR,
   so they persist across browsers and restarts (mount DATA_DIR as a volume in Docker). */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const dns = require('dns').promises;
const Zip = require('./js/zip.js');

const PORT = Number(process.env.PORT) || 5178;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const CHATS = path.join(DATA, 'chats');
const FILES = path.join(DATA, 'files');
const PREVIEWS = path.join(DATA, 'previews');
const LOCK_FILE = path.join(DATA, 'lock.json');

// Only these are ever served as static files; nothing else in the folder is reachable.
const STATIC_DIRS = ['css', 'js', 'assets'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
// Content types a slice of a chat zip may be served as (never anything scriptable).
const SLICE_TYPE = /^(image\/(jpeg|png|gif|webp|heic|bmp)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf|text\/plain|text\/vcard|application\/octet-stream)$/;
const ID = /^[a-z0-9-]{1,80}$/;

const send = (res, status, body, headers) => {
  res.writeHead(status, Object.assign({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers));
  res.end(body);
};
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });

function receive(req, file) {
  return new Promise((resolve, reject) => {
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.part';
    const out = fs.createWriteStream(tmp);
    const fail = err => { out.destroy(); fs.rm(tmp, { force: true }, () => reject(err)); };
    req.on('error', fail);
    req.on('aborted', () => fail(new Error('Upload aborted')));
    out.on('error', fail);
    out.on('finish', () => fs.rename(tmp, file, err => (err ? fail(err) : resolve())));
    req.pipe(out);
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Serve bytes [base, base + length) of a file as if they were a file of their own, honouring Range.
function serveBytes(req, res, file, base, length, type, cache) {
  let start = 0, end = length - 1, status = 200;
  const headers = {
    'Content-Type': type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cache || 'no-store',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
    else { start = Math.max(0, length - Number(range[2])); }
    if (start > end || start >= length) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + length });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + length;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || length === 0) return res.end();
  const stream = fs.createReadStream(file, { start: base + start, end: base + end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

async function listChats() {
  const out = [];
  for (const name of await fsp.readdir(CHATS)) {
    if (!name.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(CHATS, name), 'utf8'));
      const st = await fsp.stat(path.join(CHATS, meta.id + '.bin'));
      out.push({ id: meta.id, fileName: meta.fileName, addedAt: meta.addedAt, size: st.size });
    } catch (e) { /* half-written or orphaned entry: ignore */ }
  }
  return out.sort((a, b) => a.addedAt - b.addedAt);
}

const recovering = new Map();
function recoverIndex(id, bin) {
  const cache = path.join(CHATS, id + '.index.json');
  if (recovering.has(id)) return recovering.get(id);
  const job = (async () => {
    const st = await fsp.stat(bin);
    try {
      const c = JSON.parse(await fsp.readFile(cache, 'utf8'));
      if (c.size === st.size && c.mtime === st.mtimeMs) return c.entries;
    } catch (e) { /* not cached yet */ }
    const fh = await fsp.open(bin, 'r');
    try {
      const source = {
        size: st.size,
        read: async (a, b) => {
          const buf = Buffer.alloc(b - a);
          const { bytesRead } = await fh.read(buf, 0, b - a, a);
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead);
        },
      };
      const zip = await Zip.open(source);
      const entries = zip.recovered || [];
      await fsp.writeFile(cache, JSON.stringify({ size: st.size, mtime: st.mtimeMs, entries }));
      return entries;
    } finally { await fh.close(); }
  })().finally(() => recovering.delete(id));
  recovering.set(id, job);
  return job;
}

// ---------------------------------------------------------------- screen lock
// When a password is set, every API call except health and unlock needs a session cookie.
let lock = null;
const sessions = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scrypt = (password, salt) => new Promise((res, rej) =>
  crypto.scrypt(String(password), Buffer.from(salt, 'hex'), 32, (err, key) => (err ? rej(err) : res(key.toString('hex')))));
const sessionOf = req => { const m = /(?:^|;\s*)wa_session=([a-f0-9]{48})/.exec(req.headers.cookie || ''); return m ? m[1] : null; };
const authed = req => !lock || sessions.has(sessionOf(req));
function startSession(res) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.add(token);
  res.setHeader('Set-Cookie', 'wa_session=' + token + '; HttpOnly; SameSite=Strict; Path=/');
}
async function jsonBody(req) {
  try { return JSON.parse((await readBody(req, 1 << 16)).toString('utf8') || '{}') || {}; } catch (e) { return {}; }
}

// ---------------------------------------------------------------- link previews
// Fetches a linked page's title, description and picture. Only public http(s) addresses are
// contacted, so the endpoint cannot be used to reach machines on the local network.
function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  if (l.startsWith('::ffff:')) return isPrivateIP(l.slice(7));
  return l === '::' || l === '::1' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
}
async function safeFetch(link, accept, hops) {
  const u = new URL(link);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Unsupported link');
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIP(a.address))) throw new Error('Address not allowed');
  const r = await fetch(u, {
    redirect: 'manual', signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkPreview/1.0)', Accept: accept, 'Accept-Language': 'en' },
  });
  const next = r.headers.get('location');
  if (r.status >= 300 && r.status < 400 && next && (hops || 0) < 4) {
    try { await r.body.cancel(); } catch (e) { /* ignore */ }
    return safeFetch(new URL(next, u).href, accept, (hops || 0) + 1);
  }
  return r;
}
async function readLimited(r, max) {
  const reader = r.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    size += value.length;
  }
  try { await reader.cancel(); } catch (e) { /* ignore */ }
  return Buffer.concat(chunks).subarray(0, max);
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = t => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENT[e.toLowerCase()] || m;
  const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  try { return String.fromCodePoint(code); } catch (err) { return m; }
});
const clean = (t, max) => decodeEntities(String(t || '')).replace(/\s+/g, ' ').trim().slice(0, max);
const previewKey = link => crypto.createHash('sha1').update(link).digest('hex');
const previewMisses = new Map();

async function buildPreview(link) {
  const key = previewKey(link);
  const file = path.join(PREVIEWS, key + '.json');
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch (e) { /* not cached yet */ }
  if (previewMisses.has(key)) return {};
  try {
    const r = await safeFetch(link, 'text/html,application/xhtml+xml');
    if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) throw new Error('Not a web page');
    const html = (await readLimited(r, 400000)).toString('utf8');
    const meta = {};
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
      const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag);
      const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
      if (name && content && !(name[1].toLowerCase() in meta)) meta[name[1].toLowerCase()] = content[1] != null ? content[1] : content[2];
    }
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const info = {
      title: clean(meta['og:title'] || meta['twitter:title'] || (title && title[1]), 200),
      description: clean(meta['og:description'] || meta['twitter:description'] || meta.description, 300),
      site: clean(meta['og:site_name'], 80) || new URL(link).hostname.replace(/^www\./, ''),
      image: false,
    };
    if (!info.title) throw new Error('No title');
    const picture = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'];
    if (picture) {
      try {
        const ir = await safeFetch(new URL(decodeEntities(picture), link).href, 'image/*');
        const type = (ir.headers.get('content-type') || '').split(';')[0].trim();
        if (ir.ok && /^image\/(jpeg|png|gif|webp|avif)$/.test(type)) {
          await fsp.writeFile(path.join(PREVIEWS, key + '.img'), await readLimited(ir, 3 << 20));
          info.image = true;
          info.imageType = type;
        }
      } catch (e) { /* preview without a picture */ }
    }
    await fsp.writeFile(file, JSON.stringify(info));
    return info;
  } catch (e) {
    previewMisses.set(key, true);
    return {};
  }
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const method = req.method;

  if (parts[0] === 'health') return json(res, 200, { ok: true, app: 'wa-chat-viewer', locked: !!lock, authed: authed(req) });

  if (parts[0] === 'unlock' && method === 'POST') {
    const { password } = await jsonBody(req);
    if (!lock) return json(res, 200, { ok: true });
    const given = Buffer.from(await scrypt(password || '', lock.salt), 'hex');
    if (crypto.timingSafeEqual(given, Buffer.from(lock.hash, 'hex'))) { startSession(res); return json(res, 200, { ok: true }); }
    await sleep(700); // slows down guessing
    return json(res, 401, { error: 'Wrong password' });
  }
  if (!authed(req)) return json(res, 401, { error: 'Locked' });

  if (parts[0] === 'lock' && parts.length === 1) {
    if (method === 'POST') {
      const { password } = await jsonBody(req);
      if (!password || String(password).length > 200) return json(res, 400, { error: 'Bad password' });
      const salt = crypto.randomBytes(16).toString('hex');
      lock = { salt, hash: await scrypt(password, salt) };
      await fsp.writeFile(LOCK_FILE, JSON.stringify(lock));
      sessions.clear();
      startSession(res);
      return json(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      lock = null;
      sessions.clear();
      await fsp.rm(LOCK_FILE, { force: true });
      return json(res, 200, { ok: true });
    }
  }
  if (parts[0] === 'logout' && method === 'POST') {
    sessions.delete(sessionOf(req));
    res.setHeader('Set-Cookie', 'wa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }

  if (parts[0] === 'files' && parts.length === 2) {
    const name = parts[1];
    if (!ID.test(name)) return json(res, 400, { error: 'Bad file name' });
    const file = path.join(FILES, name + '.bin'), typeFile = path.join(FILES, name + '.type');
    if (method === 'GET' || method === 'HEAD') {
      let st, type = '';
      try { st = await fsp.stat(file); } catch (e) { return json(res, 404, { error: 'Not found' }); }
      try { type = (await fsp.readFile(typeFile, 'utf8')).trim(); } catch (e) { /* default */ }
      return serveBytes(req, res, file, 0, st.size, /^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(type) ? type : 'application/octet-stream', 'private, max-age=31536000');
    }
    if (method === 'PUT') {
      await receive(req, file);
      await fsp.writeFile(typeFile, String(req.headers['content-type'] || '').split(';')[0].trim());
      return json(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      await fsp.rm(file, { force: true });
      await fsp.rm(typeFile, { force: true });
      return json(res, 200, { ok: true });
    }
  }

  if (parts[0] === 'preview' && method === 'GET') {
    const link = url.searchParams.get('url') || '';
    if (!/^https?:\/\//i.test(link) || link.length > 2000) return json(res, 400, { error: 'Bad link' });
    const info = await buildPreview(link);
    if (parts[1] === 'image') {
      const file = path.join(PREVIEWS, previewKey(link) + '.img');
      let st;
      try { st = await fsp.stat(file); } catch (e) { return json(res, 404, { error: 'No picture' }); }
      return serveBytes(req, res, file, 0, st.size, info.imageType || 'application/octet-stream', 'private, max-age=604800');
    }
    return json(res, 200, { title: info.title || '', description: info.description || '', site: info.site || '', image: !!info.image });
  }

  if (parts[0] === 'chats' && parts.length === 1 && method === 'GET') return json(res, 200, await listChats());

  if (parts[0] === 'chats' && parts[1]) {
    const id = parts[1];
    if (!ID.test(id)) return json(res, 400, { error: 'Bad chat id' });
    const bin = path.join(CHATS, id + '.bin');
    const metaFile = path.join(CHATS, id + '.json');

    if (parts.length === 2 && method === 'PUT') {
      let fileName = 'chat.zip';
      try { fileName = decodeURIComponent(String(req.headers['x-file-name'] || fileName)).slice(0, 255); } catch (e) { /* keep default */ }
      await receive(req, bin);
      const st = await fsp.stat(bin);
      const meta = { id, fileName, addedAt: Date.now(), size: st.size };
      await fsp.writeFile(metaFile, JSON.stringify(meta));
      return json(res, 200, meta);
    }
    if (parts.length === 2 && method === 'DELETE') {
      await fsp.rm(bin, { force: true });
      await fsp.rm(metaFile, { force: true });
      await fsp.rm(path.join(CHATS, id + '.index.json'), { force: true });
      return json(res, 200, { ok: true });
    }
    // Files a broken zip index left out (see js/zip.js). Found here, next to the file,
    // instead of making the browser download gigabytes to look for them.
    if (parts.length === 3 && parts[2] === 'index' && method === 'GET') {
      try { await fsp.stat(bin); } catch (e) { return json(res, 404, { error: 'No such chat' }); }
      return json(res, 200, await recoverIndex(id, bin));
    }
    if (parts.length === 3 && parts[2] === 'file' && (method === 'GET' || method === 'HEAD')) {
      let st;
      try { st = await fsp.stat(bin); } catch (e) { return json(res, 404, { error: 'No such chat' }); }
      if (url.searchParams.has('start')) {
        const start = Number(url.searchParams.get('start')), end = Number(url.searchParams.get('end'));
        const type = url.searchParams.get('type') || 'application/octet-stream';
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > st.size) return json(res, 400, { error: 'Bad range' });
        return serveBytes(req, res, bin, start, end - start, SLICE_TYPE.test(type) ? type : 'application/octet-stream', 'private, max-age=86400');
      }
      return serveBytes(req, res, bin, 0, st.size, 'application/octet-stream');
    }
  }

  if (parts[0] === 'settings' && parts.length === 1) {
    const file = path.join(DATA, 'settings.json');
    if (method === 'GET') {
      let text = '{}';
      try { text = await fsp.readFile(file, 'utf8'); JSON.parse(text); } catch (e) { text = '{}'; }
      return send(res, 200, text, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    if (method === 'PUT') {
      const body = (await readBody(req, 1 << 20)).toString('utf8');
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json(res, 400, { error: 'Bad settings' });
      await fsp.writeFile(file + '.part', JSON.stringify(parsed));
      await fsp.rename(file + '.part', file);
      return json(res, 200, { ok: true });
    }
  }

  if (parts[0] === 'wallpaper' && parts.length === 1) {
    const file = path.join(DATA, 'wallpaper.bin'), typeFile = path.join(DATA, 'wallpaper.type');
    if (method === 'GET' || method === 'HEAD') {
      let st, type = 'application/octet-stream';
      try { st = await fsp.stat(file); } catch (e) { return send(res, method === 'HEAD' ? 204 : 404, ''); }
      try { type = (await fsp.readFile(typeFile, 'utf8')).trim(); } catch (e) { /* default */ }
      return serveBytes(req, res, file, 0, st.size, /^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(type) ? type : 'application/octet-stream');
    }
    if (method === 'PUT') {
      await receive(req, file);
      await fsp.writeFile(typeFile, String(req.headers['content-type'] || '').split(';')[0].trim());
      return json(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      await fsp.rm(file, { force: true });
      await fsp.rm(typeFile, { force: true });
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { error: 'Not found' });
}

async function staticFile(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, 'Bad request'); }
  if (rel === '/' || rel === '/index.html') rel = '/index.html';
  else if (!STATIC_DIRS.includes(rel.split('/')[1])) return send(res, 404, 'Not found');
  // A private wallpaper tile, kept out of version control, replaces the bundled one when present.
  if (rel === '/assets/chat-bg.svg' && fs.existsSync(path.join(ROOT, 'assets', 'chat-bg.local.svg'))) rel = '/assets/chat-bg.local.svg';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, 'Not found');
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (e) {
    send(res, 404, 'Not found');
  }
}

for (const dir of [CHATS, FILES, PREVIEWS]) fs.mkdirSync(dir, { recursive: true });
try { lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); } catch (e) { lock = null; }

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const run = url.pathname.startsWith('/api/') ? api(req, res, url) : staticFile(req, res, url);
  Promise.resolve(run).catch(err => {
    console.error(req.method, req.url, err.message);
    if (!res.headersSent) json(res, 500, { error: 'Server error' }); else res.destroy();
  });
}).listen(PORT, HOST, () => {
  console.log('WhatsApp chat viewer on http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + '  (data: ' + DATA + ')');
});
