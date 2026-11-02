export function probe(): unknown[] {
  const events: string[] = []
  class Base { get value(): number { events.push("wrong-get"); return 7 }; method(n: number): number { events.push("wrong-call"); return n } }
  class Child extends Base {
    blocked: number
    constructor() {
      let blocked = 0
      try {
        // @ts-ignore Native JavaScript validates the uninitialized receiver before the key.
        const value = super[(() => { events.push("wrong-key"); return "value" as const })()]
        events.push("wrong-after")
      } catch (error) { blocked += error instanceof ReferenceError ? 1 : 0 }
      try {
        // @ts-ignore Native JavaScript must fail before either do operand.
        super[(() => { events.push("wrong-call-key"); return "method" as const })()]((() => { events.push("wrong-argument"); return 1 })())
      } catch (error) { blocked += error instanceof ReferenceError ? 1 : 0 }
      super()
      this.blocked = blocked
    }
  }
  return [new Child().blocked === 2, events]
}
