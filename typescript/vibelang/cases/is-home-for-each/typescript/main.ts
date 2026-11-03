export function probe(a: unknown): unknown[] {
  const out: unknown[] = []
  { const head = a; for (const item of [head]) { let cell = head; out.push([item, cell]) } }
  return out
}
export function copies(): number[] {
  const read: (() => number)[] = []
  { const head = 7; for (const item of [1, 2, 3]) { let cell = head; read.push(() => cell); cell += item } }
  return read.map((get) => get())
}
export function defaults(): number[] {
  const read: (() => number)[] = []
  for (const entry of [{}, {}, {}] as {value?: number}[]) {
    let cell!: number
    const {value = (cell = 7)} = entry
    read.push(() => { cell++; return cell })
    void value
  }
  return read.map((get) => get())
}
export function labels(): number[] {
  const out: number[] = []
  { const head = 7; outer: inner: for (const item of [1, 2, 3]) {
    const cell = head
    if (item === 2) continue outer
    out.push(cell + item)
    if (item === 3) break inner
  } }
  return out
}
function sequence(set: (n: number) => void): Iterable<number> {
  return { [Symbol.iterator]() {
    let i = 0
    return { next(): IteratorResult<number> {
      set(++i)
      return i <= 2 ? {done: false, value: i} : {done: true, value: undefined}
    } }
  } }
}
export function headWrites(): number[] {
  const read: (() => number)[] = []
  { let head = 0; for (const item of sequence((n) => { head = n })) {
    let cell = head
    cell += 10
    read.push(() => cell)
    void item
  } }
  return read.map((get) => get())
}
