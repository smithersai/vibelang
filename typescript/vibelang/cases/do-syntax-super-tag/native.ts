export function probe(): unknown[] {
  const events: string[] = []
  class Base {
    value = 4
    tag(_strings: TemplateStringsArray, n: number): number { events.push("tag"); return this.value + n }
  }
  class Child extends Base {
    probe(): unknown[] {
      return [super[(() => { events.push("key"); return "tag" as const })()]`v:${(() => { events.push("substitution"); return 3 })()}`, events]
    }
  }
  return new Child().probe()
}
