export function probe(): unknown[] {
  const events: string[] = []
  const value = import.meta.url[(() => { events.push("key"); return "length" as const })()]
  const before = [import.meta.url, (() => { events.push("after"); return 3 })()]
  return [typeof value === "number", typeof before[0] === "string", events]
}
