/* Minimal ZIP reader: stored + deflate entries, zip64 aware.
   Reads lazily through a "source" (a local File, or a file on the viewer's server read with
   HTTP range requests), so media is only fetched when it is shown. */
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

    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const at = Number(dv.getBigUint64(loc + 8, true));
        const z = new DataView(await source.read(at, at + 56));
        if (z.getUint32(0, true) === 0x06064b50) {
          cdSize = Number(z.getBigUint64(40, true));
          cdOffset = Number(z.getBigUint64(48, true));
        }
      }
    }

    const cd = new Uint8Array(await source.read(cdOffset, cdOffset + cdSize));
    const cv = new DataView(cd.buffer);
    const entries = new Map();
    let p = 0;
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

      if (!name.endsWith('/')) {
        entries.set(name, { name, method, compSize, size: fullSize, headerOffset, dataStart: -1 });
      }
      p += 46 + nameLen + extraLen + commentLen;
    }

    return new Zip(source, entries);
  }

  global.Zip = { open, fromBlob, fromURL };
})(window);
