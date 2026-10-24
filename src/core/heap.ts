// Binary min-heap of cell indices keyed by (priority, index): ties always break by index,
// so pop order never depends on insertion order.

export class CellHeap {
  private idx: Int32Array;
  private key: Float64Array;
  private n = 0;

  constructor(capacity: number) {
    this.idx = new Int32Array(capacity);
    this.key = new Float64Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  private less(a: number, b: number): boolean {
    const ka = this.key[a], kb = this.key[b];
    return ka < kb || (ka === kb && this.idx[a] < this.idx[b]);
  }

  private swap(a: number, b: number): void {
    const ti = this.idx[a]; this.idx[a] = this.idx[b]; this.idx[b] = ti;
    const tk = this.key[a]; this.key[a] = this.key[b]; this.key[b] = tk;
  }

  push(cell: number, priority: number): void {
    if (this.n === this.idx.length) this.grow();
    let i = this.n++;
    this.idx[i] = cell;
    this.key[i] = priority;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Returns the cell with the smallest (priority, index). Caller must check size first. */
  pop(): number {
    const top = this.idx[0];
    this.n--;
    if (this.n > 0) {
      this.idx[0] = this.idx[this.n];
      this.key[0] = this.key[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private grow(): void {
    const idx = new Int32Array(this.idx.length * 2);
    idx.set(this.idx);
    const key = new Float64Array(this.key.length * 2);
    key.set(this.key);
    this.idx = idx;
    this.key = key;
  }
}
