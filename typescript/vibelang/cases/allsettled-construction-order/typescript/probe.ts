import { Effect } from "effect"

/** @throws {never} */
export function createProbe() {
  const events: string[] = []
  /** @throws {never} */
  function factory(name: string): Effect.Effect<string> {
    events.push("make:" + name)
    return Effect.sync(() => {
      events.push("run:" + name)
      return name
    })
  }
  /** @throws {never} */
  function spread(name: string, present: boolean): Iterable<Effect.Effect<string>> {
    return {
      *[Symbol.iterator]() {
        events.push("spread:" + name)
        if (present) yield factory(name)
      }
    }
  }
  /** @throws {never} */
  function take(): string[] {
    return events.splice(0)
  }
  return { events, factory, spread, take }
}
