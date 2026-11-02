export class Trace {
  events: string[] = []
  state = 1
  ev(s: string): void { this.events.push(s) }
}
export type Ctor = new (n: number) => { value: number }
export function constructors(t: Trace, bad = false): { readonly C: Ctor } {
  return {
    get C(): Ctor {
      t.ev("get:" + t.state)
      if (bad) throw new Error("getter")
      const saved = t.state
      return class {
        value: number
        constructor(n: number) { t.ev("new:" + saved); this.value = saved + n }
      }
    }
  }
}
export function key(t: Trace): "C" {
  return { [Symbol.toPrimitive](hint: string) { t.ev("key:" + hint); return "C" } } as unknown as "C"
}
export function replacement(t: Trace): { C: Ctor; B: Ctor } {
  return {
    C: class { value: number; constructor(n: number) { t.ev("A"); this.value = n } },
    B: class { value: number; constructor(n: number) { t.ev("B"); this.value = n + 10 } }
  }
}
