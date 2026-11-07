// The same class with no suspension: the evaluation order to match.
export function plain(): string[] {
  const log: string[] = []
  const v = <T>(tag: string, x: T): T => { log.push(tag); return x }
  const dec = (tag: string) => <V>(value: V, _context: unknown): V => { log.push("apply " + tag); return value }
  class B { constructor() { log.push("B") } }
  @(v("cd", dec("cd")))
  class C extends (v("ext", B)) {
    @(v("d1", dec("d1"))) [v("k1", "a")]() { return 1 }
    [v("k2", "b")]() { return 2 }
    @(v("d3", dec("d3"))) static [v("k3", "c")]() { return 3 }
    @(v("d4", dec("d4"))) last() { return 4 }
    tail() { return 5 }
  }
  log.push("defined")
  new C()
  return log
}
