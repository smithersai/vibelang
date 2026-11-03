import { Effect } from "effect"
export function main(): Effect.Effect<readonly unknown[]> { return Effect.gen(function* () {
  const events: string[] = []
  function mark(name: string, n: number) { events.push(name); return n }
  function head(n: number) { events.push("head" + n); return Effect.sync(() => { events.push("run" + n); return n }) }
  function args(a: number,b: number,c: number) { return [a,b,c] }
  const sum = mark("left",1) + (yield* head(2)) * mark("right",3)
  const values = args(mark("arg-left",1), yield* head(6), mark("arg-right",7))
  const selected = true ? yield* head(4) : yield* head(5)
  const member = yield* ({ program: Effect.succeed(8) }).program
  return [sum,values,selected,member,events]
}) }
