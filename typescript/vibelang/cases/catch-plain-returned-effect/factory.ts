import { Effect } from "effect"

/** @throws {never} */
export function factory(events = ["unused"]) {
  events.push("factory")
  return Effect.sync(() => { events.push("function"); return 2 })
}
