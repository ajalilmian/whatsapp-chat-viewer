#!/usr/bin/env node
/* Tiny server for the WhatsApp chat viewer. No dependencies.
   Serves the app and keeps imported chats, settings and the custom background in DATA_DIR,
   so they persist across browsers and restarts (mount DATA_DIR as a volume in Docker). */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const PORT = Number(process.env.PORT) || 5178;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const CHATS = path.join(DATA, 'chats');

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

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const method = req.method;

  if (parts[0] === 'health') return json(res, 200, { ok: true, app: 'wa-chat-viewer' });

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
      return json(res, 200, { ok: true });
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

fs.mkdirSync(CHATS, { recursive: true });

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
