// Minimal zip reader standing in for System.IO.Compression.ZipFile (browsers have deflate via DecompressionStream, but no zip directory reader).
// Supports stored and deflate entries; no zip64, no encryption (neither is used by .phxm / .rhm).
export class ZipArchive {
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.entries = new Map();   // name -> { method, csize, offset }
    let eocd = -1;
    for (let i = this.bytes.length - 22; i >= Math.max(0, this.bytes.length - 22 - 65535); i--) {
      if (this.view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file');
    const count = this.view.getUint16(eocd + 10, true);
    let p = this.view.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (this.view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip directory');
      const method = this.view.getUint16(p + 10, true), csize = this.view.getUint32(p + 20, true);
      const n = this.view.getUint16(p + 28, true), m = this.view.getUint16(p + 30, true), k = this.view.getUint16(p + 32, true);
      const offset = this.view.getUint32(p + 42, true);
      const name = dec.decode(this.bytes.subarray(p + 46, p + 46 + n));
      if (!name.endsWith('/')) this.entries.set(name, { method, csize, offset });
      p += 46 + n + m + k;
    }
  }
  getEntry(name) { return this.entries.get(name) ?? null; }   // ZipArchive.GetEntry
  async read(name) {                                          // entry.Open() + CopyTo
    const e = this.entries.get(name);
    if (!e) throw new Error(`ZipArchiveEntry ${name} is missing!`);
    const o = e.offset;
    if (this.view.getUint32(o, true) !== 0x04034b50) throw new Error('Corrupt zip entry');
    const start = o + 30 + this.view.getUint16(o + 26, true) + this.view.getUint16(o + 28, true);
    const data = this.bytes.subarray(start, start + e.csize);
    if (e.method === 0) return data.slice();
    if (e.method !== 8) throw new Error(`Unsupported zip compression method ${e.method}`);
    const out = new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
    return new Uint8Array(await out.arrayBuffer());
  }
}
