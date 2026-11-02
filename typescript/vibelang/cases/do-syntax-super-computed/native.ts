const events: string[] = []
class Base {
  get value(): number { events.push("get"); return 7 }
}
class Child extends Base {
  probe(): unknown[] {
    const value = super[(() => { events.push("key"); return "value" as const })()]
    return [value, events]
  }
}
export function probe(): unknown[] { return new Child().probe() }
