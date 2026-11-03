import { Effect } from "effect"
type D = { readonly _tag: "V0" } | { readonly _tag: "V1"; readonly n: number }
const events: string[] = []
/** @throws {never} */
export function ev(label: string) { events.push(label) }
/** @throws {never} */
export function takeEvents() { return events.splice(0) }
function project(d: D) {
  switch (d._tag) {
    case "V0": return 0
    case "V1": return d.n
  }
}
export function mainTwin() {
  return Effect.gen(function* () {
    L1: {
      ev("e0")
      return 1
    }
    const d2 = ((1 > 0) ? { _tag: "V1", n: 1 } : { _tag: "V0" }) as D
    const v0: number = project((ev("e1"), d2))
    return v0
  })
}
