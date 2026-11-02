export function probe(): unknown[] {
  const events: string[] = []
  let tag = (strings: TemplateStringsArray, n: number): string => { events.push("tag"); return strings[0] + n }
  const out = tag`value:${(() => { events.push("substitution"); tag = (): string => "wrong"; return 7 })()}`
  return [out, events]
}
