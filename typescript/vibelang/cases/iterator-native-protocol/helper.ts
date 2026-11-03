import { Effect } from "effect"
export const events: string[] = []
/** @vibelang trusted */
export function values(name: string, entries: any[]): Iterable<any> {
  return {
    *[Symbol.iterator]() {
      events.push(name + ":open")
      try {
        for (const entry of entries) { events.push(name + ":next"); yield entry }
        events.push(name + ":done")
      } finally { events.push(name + ":close") }
    }
  }
}
/** @vibelang trusted */
export function reference(): string[][] {
  const results: string[][] = []
  const failed = Effect.fail("boom")
  const run = (body: () => Generator<Effect.Effect<any, any, never>, any, any>) => Effect.runSync(Effect.catch(Effect.gen(body), () => Effect.sync(() => { events.push("caught") })))
  events.length = 0
  run(function* () {
    const { items: [[n = yield* failed]] } = { items: values("outer", [values("inner", [undefined])]) }
    events.push("unreachable:" + n)
  })
  results.push(events.splice(0))
  let loopTarget = [0]
  run(function* () { for (loopTarget[yield* failed] of values("loop-target", [1])) events.push("unreachable") })
  results.push(events.splice(0))
  let target = [0]
  run(function* () { [target[yield* failed]] = values("target", [1]); events.push("unreachable") })
  results.push(events.splice(0))
  let restTarget: number[][] = []
  run(function* () { [...restTarget[yield* failed]] = values("rest", [1, 2]); events.push("unreachable") })
  results.push(events.splice(0))
  const [, n = 7, ...rest] = values("elision", [1, undefined, 3, 4])
  events.push(String(n) + ":" + rest.join(","))
  results.push(events.splice(0))
  return results
}
