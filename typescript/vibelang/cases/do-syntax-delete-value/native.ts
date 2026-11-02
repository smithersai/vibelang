// @ts-nocheck
// TypeScript restricts delete to property references. With checking disabled,
// JavaScript still permits deleting a value; lifting must not create a name.
export function probe(): unknown[] {
  const events: string[] = []
  const box = { value: 7 }
  const direct = delete ((() => { events.push("direct"); return box })())
  const chosen = delete (true ? (() => { events.push("chosen"); return box })() : box)
  const logical = delete (false || (() => { events.push("logical"); return box })())
  return [direct, chosen, logical, box.value, events]
}
