// Port of scripts/util/FileParser.cs (little-endian, same bounds behaviour).
export class FileParser {
  constructor(buffer) {
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.length = this.bytes.length;
    this.pointer = 0;
  }
  _check(n) { if (this.pointer + n > this.length) throw new Error(`Attempted to read ${n} bytes beyond stream length of ${this.length}.`); }
  get(len) { this._check(len); this.pointer += len; return this.bytes.slice(this.pointer - len, this.pointer); }
  skip(len) { this.pointer += len; }
  seek(p) { this.pointer = p; }
  getString(len) { this.pointer += len; return new TextDecoder().decode(this.bytes.subarray(this.pointer - len, this.pointer)); }
  getLine() {
    let s = '';
    while (this.pointer < this.length) {
      const c = this.bytes[this.pointer++];
      if (c === 10) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  getBool() { this._check(1); return this.bytes[this.pointer++] !== 0; }
  getFloat() { this._check(4); const v = this.view.getFloat32(this.pointer, true); this.pointer += 4; return v; }
  getDouble() { this._check(8); const v = this.view.getFloat64(this.pointer, true); this.pointer += 8; return v; }
  getUInt8() { this._check(1); return this.bytes[this.pointer++]; }
  getUInt16() { this._check(2); const v = this.view.getUint16(this.pointer, true); this.pointer += 2; return v; }
  getUInt32() { this._check(4); const v = this.view.getUint32(this.pointer, true); this.pointer += 4; return v; }
  getUInt64() { this._check(8); const v = Number(this.view.getBigUint64(this.pointer, true)); this.pointer += 8; return v; }
}
