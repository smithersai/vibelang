// Ordinary TypeScript counterparts of the initialized paths in main.vibe: a
// for(;;) body declares a fresh let cell for each condition evaluation.
const safe = (read: () => unknown) => { try { return read() } catch (e) { return e instanceof ReferenceError ? "tdz" : "other" } }
function feed(values: Array<number>) { let i = 0; return () => values[i++] ?? 99 }
function keep(flag: boolean) { return flag }
function ternary(next: () => number) {
  const reads: Array<() => unknown> = []
  for (;;) { const v = next(); if (!(v < 3)) break; reads.push(() => v) }
  return reads.map(safe)
}
function argument(next: () => number) {
  let count = 0; const reads: Array<() => unknown> = []
  for (;;) { if (!(count < 2)) break; const v = next(); if (!keep(true)) break; count++; reads.push(() => v) }
  return reads.map(safe)
}
function labeled(next: () => number) {
  let turns = 0; const reads: Array<() => unknown> = []
  outer: for (;;) {
    if (!(turns++ < 3)) break
    const v = next()
    reads.push(() => v)
    if (turns === 2) continue outer
    reads.push(() => v + 10)
  }
  return reads.map(safe)
}
function shadow() {
  const x = 99; let n = 0; const readers: Array<() => unknown> = []
  for (;;) { if (!(n < 2)) break; let x = ++n; readers.push(() => x); x += 10 }
  return [x, readers.map(safe)]
}
export const result = { ternary: ternary(feed([1, 2, 3])), argument: argument(feed([1, 2, 3])), labeled: labeled(feed([1, 2, 3])), shadow: shadow() }
console.log(JSON.stringify(result))
