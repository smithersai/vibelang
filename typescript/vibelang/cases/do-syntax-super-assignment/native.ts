const events: string[] = []
class Base {
  own = 0
  set value(n: number) { events.push("set:" + n); this.own = n }
}
class Child extends Base {
  probe(): unknown[] {
    super.value = (() => { events.push("rhs"); return 7 })()
    super[(() => { events.push("key"); return "value" as const })()] = (() => { events.push("rhs2"); return 8 })()
    const alternate = { set value(n: number) { events.push("alternate-base:" + n) } }
    super.value = (() => { events.push("change-base"); Object.setPrototypeOf(Child.prototype, alternate); return 9 })()
    return [this.own, events]
  }
}
export function probe(): unknown[] { return new Child().probe() }
