// Little-endian byte writer for the TSVL format. Explicit DataView calls, never host endianness.

export class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  private n = 0;

  private ensure(extra: number): void {
    if (this.n + extra <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.n + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): void { this.ensure(1); this.view.setUint8(this.n, v); this.n += 1; }
  u16(v: number): void { this.ensure(2); this.view.setUint16(this.n, v, true); this.n += 2; }
  u32(v: number): void { this.ensure(4); this.view.setUint32(this.n, v, true); this.n += 4; }
  i32(v: number): void { this.ensure(4); this.view.setInt32(this.n, v, true); this.n += 4; }
  f32(v: number): void { this.ensure(4); this.view.setFloat32(this.n, v, true); this.n += 4; }
  f64(v: number): void { this.ensure(8); this.view.setFloat64(this.n, v, true); this.n += 8; }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 0x7f);
  }

  /** UTF-8 string with a u32 length prefix. */
  str(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.u32(bytes.length);
    this.ensure(bytes.length);
    this.buf.set(bytes, this.n);
    this.n += bytes.length;
  }

  u8array(a: Uint8Array): void {
    this.u32(a.length);
    this.ensure(a.length);
    this.buf.set(a, this.n);
    this.n += a.length;
  }

  u16array(a: Uint16Array): void { this.u32(a.length); for (let i = 0; i < a.length; i++) this.u16(a[i]); }
  i32array(a: Int32Array): void { this.u32(a.length); for (let i = 0; i < a.length; i++) this.i32(a[i]); }
  f32array(a: Float32Array): void { this.u32(a.length); for (let i = 0; i < a.length; i++) this.f32(a[i]); }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}
