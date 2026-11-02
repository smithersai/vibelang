// Operands for main.vibe: each records a trace and can throw, as JavaScript does.
export class Trace {
  events: string[] = []
  state = 1
  seen: unknown[] = []
  ev(s: string): void { this.events.push(s) }
  fail(s: string): never { throw new Error(s) }
}
export const sym = Symbol("key")
export function iter(t: Trace, n: number, bad: number): Iterable<number> {
  return {
    [Symbol.iterator](): Iterator<number> {
      t.ev("open:" + t.state)
      let i = 0
      return {
        next(): IteratorResult<number> {
          t.ev("next:" + i + ":" + t.state)
          if (i === bad) { throw new Error("next") }
          if (i < n) { i++; return { value: i * 10 + t.state, done: false } }
          return { value: undefined, done: true }
        }
      }
    }
  }
}
export function src(t: Trace, bad: boolean): { readonly x: number, y: number } {
  return { get x(): number { t.ev("get:x:" + t.state); if (bad) { throw new Error("get") } return t.state }, y: 5 }
}
export function key(t: Trace, mode: string): string {
  const k = {
    [Symbol.toPrimitive](hint: string): string | symbol {
      t.ev("key:" + hint + ":" + t.state)
      if (mode === "throw") { throw new Error("key") }
      if (mode === "symbol") { return sym }
      return "k" + t.state
    }
  }
  return k as unknown as string
}
export function str(t: Trace, bad: boolean): string {
  const s = { toString(): string { t.ev("str:" + t.state); if (bad) { throw new Error("str") } return "s" + t.state } }
  return s as unknown as string
}
export type Tag = (this: { name: string }, s: TemplateStringsArray, ...v: unknown[]) => string
export function tags(t: Trace): { name: string, readonly tag: Tag, readonly [k: string]: unknown } {
  return {
    name: "box",
    get tag(): Tag {
      t.ev("get:tag:" + t.state)
      const saved = t.state
      return function (this: { name: string }, s: TemplateStringsArray, ...v: unknown[]): string {
        t.ev("tag:" + saved + ":" + this.name)
        t.seen.push(s)
        return s.join("|") + v.join(",") + saved
      }
    }
  }
}
export function sum(t: Trace, ...xs: number[]): number { t.ev("call"); return xs.reduce((a: number, b: number): number => a + b, 0) }
export class Box { xs: number[]; constructor(t: Trace, ...xs: number[]) { t.ev("new"); this.xs = xs } }
export function shape(value: unknown): unknown {
  if (value instanceof Box) { return { box: value.xs } }
  if (Array.isArray(value)) { return { length: value.length, holes: value.map((_: unknown, i: number): number => i).length !== Object.keys(value).length, items: value.map(shape) } }
  if (typeof value === "object" && value !== null) {
    const out: unknown[] = []
    for (const k of Reflect.ownKeys(value)) { out.push([typeof k === "symbol" ? "symbol:" + String(k.description) : k, shape((value as Record<PropertyKey, unknown>)[k])]) }
    return out
  }
  return value
}
// withArrayIterator runs run with Array.prototype[Symbol.iterator] logging each call.
export function withArrayIterator(t: Trace, run: () => unknown): unknown {
  const original = Array.prototype[Symbol.iterator]
  const logged = function (this: unknown[]): ArrayIterator<unknown> { t.ev("array-iterator"); return original.call(this) }
  Object.defineProperty(Array.prototype, Symbol.iterator, { configurable: true, writable: true, value: logged })
  try { return run() } finally { Object.defineProperty(Array.prototype, Symbol.iterator, { configurable: true, writable: true, value: original }) }
}
