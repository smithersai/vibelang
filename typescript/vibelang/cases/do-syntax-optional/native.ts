export function probe(): unknown[] {
  const events: string[] = []
  const missing = null as { value?: number, f: (n: number) => number } | null
  const present = { value: 4, f(n: number): number { events.push("call"); return this.value + n } }
  const a = missing?.[(() => { events.push("wrong-key"); return "value" as const })()]
  const b = missing?.f((() => { events.push("wrong-argument"); return 1 })())
  const c = present?.f((() => { events.push("argument"); return 3 })())
  const d = delete missing?.[(() => { events.push("wrong-delete"); return "value" as const })()]
  const absent = null as ((n: number) => number) | null
  const e = absent?.((() => { events.push("wrong-optional-call"); return 1 })())
  const f = present.f?.((() => { events.push("optional-argument"); return 4 })())
  const g = present?.[(() => { events.push("live-key"); return "f" as const })()]((() => { events.push("live-argument"); return 5 })())
  return [a === undefined, b === undefined, c, d, e === undefined, f, g, events]
}
