export function probe(): unknown[] {
  const events: string[] = []
  class Base {
    constructor(readonly value: number) { events.push("base") }
    method(n: number): number { events.push("method"); return this.value + n }
  }
  class Child extends Base {
    constructor() { super((() => { events.push("argument"); return 4 })()) }
    probe(): unknown[] {
      return [super.method((() => { events.push("method-argument"); return 3 })()), events]
    }
  }
  return new Child().probe()
}
