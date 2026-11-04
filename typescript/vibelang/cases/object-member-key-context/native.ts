import { Effect } from "effect"
export const events: string[] = []
export function main() {
 return Effect.gen(function* () {
  const object = {
   [yield* Effect.sync(() => { events.push("value1"); return { [Symbol.toPrimitive]() { events.push("coerce1"); return "method" } } as unknown as string })]() { events.push("body"); return 7 },
   [yield* Effect.sync(() => { events.push("value2"); return "program" as const })]() { return Effect.gen(function* () { events.push("cold-body"); return 7 }) }
  }
  return 1
 })
}
