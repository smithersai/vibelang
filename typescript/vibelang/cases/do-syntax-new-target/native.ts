export function probe(): unknown[] {
  const events: string[] = []
  class Probe {
    result: unknown[]
    constructor() {
      const values = [new.target, (() => { events.push("after"); return 3 })()]
      const name = new.target[(() => { events.push("key"); return "name" as const })()]
      this.result = [values[0] === Probe, name, events]
    }
  }
  return new Probe().result
}
