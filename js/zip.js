/* Minimal ZIP reader: stored + deflate entries, zip64 aware.
   Reads lazily through a "source" (a local File, or a file on the viewer's server read with
   HTTP range requests), so media is only fetched when it is shown.
   Some very large WhatsApp exports (over 4 GB) leave every file past the 4 GB mark out of the
   zip's index, including _chat.txt. Those files are found again by walking the local headers
   (see recover); the source can cache the result so this only happens once per file. */
(function (global) {
  'use strict';

  const utf8 = new TextDecoder('utf-8');

  // source = { size, read(start, end) -> ArrayBuffer, blob(start, end, type) -> Blob, url?(start, end, type) -> string }
  function fromBlob(file) {
    return {
      size: file.size,
      read: (a, b) => file.slice(a, b).arrayBuffer(),
      blob: (a, b, type) => Promise.resolve(file.slice(a, b, type || '')),
    };
  }

  function fromURL(url, size) {
    const range = (a, b) => fetch(url, { headers: { Range: 'bytes=' + a + '-' + (b - 1) } }).then(r => {
      if (!r.ok) throw new Error('Could not read the chat file from the server (' + r.status + ')');
      return r;
    });
    return {
      size,
      read: (a, b) => (b <= a ? Promise.resolve(new ArrayBuffer(0)) : range(a, b).then(r => r.arrayBuffer())),
      blob: (a, b, type) => (b <= a ? Promise.resolve(new Blob([], { type: type || '' }))
        : range(a, b).then(r => r.blob()).then(x => x.slice(0, x.size, type || ''))),
      url: (a, b, type) => url + '?start=' + a + '&end=' + b + '&type=' + encodeURIComponent(type || 'application/octet-stream'),
    };
  }

  class Zip {
    constructor(source, entries) {
      this.source = source;
      this.entries = entries; // Map<name, entry>
    }

    async _dataStart(entry) {
      if (entry.dataStart < 0) {
        const dv = new DataView(await this.source.read(entry.headerOffset, entry.headerOffset + 30));
        if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('Corrupt zip entry: ' + entry.name);
        entry.dataStart = entry.headerOffset + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
      }
      return entry.dataStart;
    }

    async blob(name, type) {
      const entry = this.entries.get(name);
      if (!entry) throw new Error('Not in zip: ' + name);
      const start = await this._dataStart(entry);
      const raw = await this.source.blob(start, start + entry.compSize, type);
      if (entry.method === 0) return raw;
      if (entry.method === 8) {
        if (typeof DecompressionStream === 'undefined') {
          throw new Error('This browser cannot read compressed zip entries');
        }
        const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const out = await new Response(stream).blob();
        return type ? out.slice(0, out.size, type) : out;
      }
      throw new Error('Unsupported zip compression method ' + entry.method);
    }

    // A URL the page can use directly. Uncompressed entries on the server are streamed
    // straight from the zip, so large videos never have to be held in memory.
    async url(name, type) {
      const entry = this.entries.get(name);
      if (!entry) throw new Error('Not in zip: ' + name);
      if (entry.method === 0 && this.source.url) {
        const start = await this._dataStart(entry);
        return this.source.url(start, start + entry.compSize, type);
      }
      return URL.createObjectURL(await this.blob(name, type));
    }

    async text(name) {
      return (await this.blob(name)).text();
    }

    async arrayBuffer(name) {
      return (await this.blob(name)).arrayBuffer();
    }
  }

  async function open(source) {
    const size = source.size;
    if (size < 22) throw new Error('Not a zip file');
    const tailLen = Math.min(size, 65557 + 20);
    const tail = new Uint8Array(await source.read(size - tailLen, size));
    const dv = new DataView(tail.buffer);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file');

    let cdSize = dv.getUint32(eocd + 12, true);
    let cdOffset = dv.getUint32(eocd + 16, true);
    const count = dv.getUint16(eocd + 10, true);
    let expected = count;

    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const at = Number(dv.getBigUint64(loc + 8, true));
        const z = new DataView(await source.read(at, at + 56));
        if (z.getUint32(0, true) === 0x06064b50) {
          expected = Number(z.getBigUint64(32, true));
          cdSize = Number(z.getBigUint64(40, true));
          cdOffset = Number(z.getBigUint64(48, true));
        }
      }
    }

    const cd = new Uint8Array(await source.read(cdOffset, cdOffset + cdSize));
    const cv = new DataView(cd.buffer);
    const entries = new Map();
    let p = 0, records = 0, last = null;
    while (p + 46 <= cd.length && cv.getUint32(p, true) === 0x02014b50) {
      const method = cv.getUint16(p + 10, true);
      let compSize = cv.getUint32(p + 20, true);
      let fullSize = cv.getUint32(p + 24, true);
      const nameLen = cv.getUint16(p + 28, true);
      const extraLen = cv.getUint16(p + 30, true);
      const commentLen = cv.getUint16(p + 32, true);
      let headerOffset = cv.getUint32(p + 42, true);
      const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));

      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = cv.getUint16(x, true);
        const len = cv.getUint16(x + 2, true);
        if (id === 0x0001) {
          let q = x + 4;
          if (fullSize === 0xffffffff) { fullSize = Number(cv.getBigUint64(q, true)); q += 8; }
          if (compSize === 0xffffffff) { compSize = Number(cv.getBigUint64(q, true)); q += 8; }
          if (headerOffset === 0xffffffff) { headerOffset = Number(cv.getBigUint64(q, true)); }
        }
        x += 4 + len;
      }

      const entry = { name, method, compSize, size: fullSize, headerOffset, dataStart: -1 };
      if (!name.endsWith('/')) entries.set(name, entry);
      if (!last || headerOffset > last.headerOffset) last = entry;
      records++;
      p += 46 + nameLen + extraLen + commentLen;
    }

    const zip = new Zip(source, entries);
    if (records < expected) {
      // The index is missing entries: look for them after the last indexed file.
      let from = 0;
      if (last) from = (await zip._dataStart(last)) + last.compSize;
      const scan = () => recover(source.read, from, cdOffset);
      const found = source.recover ? await source.recover(scan) : await scan();
      for (const [name, method, compSize, size, headerOffset, dataStart] of found) {
        if (!entries.has(name)) entries.set(name, { name, method, compSize, size, headerOffset, dataStart });
      }
      zip.recovered = found;
    }
    return zip;
  }

  // Walks local file headers in [from, to) and returns
  // [name, method, compSize, size, headerOffset, dataStart] for each file found. Sizes that
  // were left out of the header (flag bit 3) are taken from the data descriptor after the data.
  async function recover(read, from, to) {
    const CHUNK = 8 << 20;
    let buf = new Uint8Array(0), bufStart = from;
    const have = (pos, n) => pos >= bufStart && pos + n <= bufStart + buf.length;
    async function ensure(pos, n) {
      if (have(pos, n)) return true;
      const end = Math.min(to, pos + Math.max(n, CHUNK));
      if (end - pos < n) return false;
      buf = new Uint8Array(await read(pos, end));
      bufStart = pos;
      return buf.length >= n;
    }
    const u16 = pos => buf[pos - bufStart] | (buf[pos - bufStart + 1] << 8);
    const u32 = pos => (u16(pos) | (u16(pos + 2) << 16)) >>> 0;
    // Next "PK" b2 b3 signature at or after pos, or -1.
    async function find(b2, b3, pos) {
      while (pos + 4 <= to) {
        if (!(await ensure(pos, 4))) return -1;
        const n = buf.length - 3;
        let i = pos - bufStart;
        while ((i = buf.indexOf(0x50, i)) >= 0 && i < n) {
          if (buf[i + 1] === 0x4b && buf[i + 2] === b2 && buf[i + 3] === b3) return bufStart + i;
          i++;
        }
        pos = bufStart + n;
      }
      return -1;
    }

    const out = [];
    let pos = from;
    for (;;) {
      const h = await find(3, 4, pos);
      if (h < 0 || !(await ensure(h, 30))) break;
      const flags = u16(h + 6), method = u16(h + 8), nameLen = u16(h + 26), extraLen = u16(h + 28);
      let compSize = u32(h + 18), size = u32(h + 22);
      if ((method !== 0 && method !== 8) || nameLen === 0 || nameLen > 1024) { pos = h + 1; continue; }
      if (!(await ensure(h, 30 + nameLen + extraLen))) break;
      const name = utf8.decode(buf.subarray(h - bufStart + 30, h - bufStart + 30 + nameLen));
      const dataStart = h + 30 + nameLen + extraLen;
      // zip64 sizes in the local header's extra field
      for (let x = h + 30 + nameLen; x + 4 <= dataStart;) {
        const id = u16(x), len = u16(x + 2);
        if (id === 0x0001 && len >= 16 && size === 0xffffffff) {
          size = u32(x + 4) + u32(x + 8) * 4294967296;
          compSize = u32(x + 12) + u32(x + 16) * 4294967296;
        }
        x += 4 + len;
      }
      let next;
      if ((flags & 8) && (compSize === 0 || compSize === 0xffffffff)) {
        // Size is only in the data descriptor: find the one whose size matches its position.
        let d = await find(7, 8, dataStart), ok = false;
        while (d >= 0 && (await ensure(d, 16))) {
          const len = d - dataStart, big = len >= 4294967296;
          if (u32(d + 8) === len % 4294967296 && (!big || ((await ensure(d, 24)) && u32(d + 12) === Math.floor(len / 4294967296)))) {
            compSize = len;
            const is64 = big;
            size = is64 ? u32(d + 16) + u32(d + 20) * 4294967296 : u32(d + 12);
            next = d + (is64 ? 24 : 16);
            ok = true;
            break;
          }
          d = await find(7, 8, d + 1);
        }
        if (!ok) break;
      } else {
        next = dataStart + compSize + ((flags & 8) ? 16 : 0);
      }
      if (!name.endsWith('/')) out.push([name, method, compSize, size, h, dataStart]);
      pos = next;
    }
    return out;
  }

  const api = { open, fromBlob, fromURL, recover };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // used by server.js
  else global.Zip = api;
})(typeof window !== 'undefined' ? window : globalThis);
