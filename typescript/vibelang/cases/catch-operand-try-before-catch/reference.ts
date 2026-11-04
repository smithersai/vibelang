// Effect TypeScript counterpart: the left side's yield* runs before Effect.catch.
import { Effect } from "effect"
const g = (n: number) => n > 0 ? Effect.fail("g" + n) : Effect.succeed(n)
function argument(a: Effect.Effect<number, string>) {
  return Effect.gen(function* () { return yield* Effect.catch(g(yield* a), (e) => Effect.succeed("caught " + e)) })
}
function grouped(nested: Effect.Effect<Effect.Effect<number, string>, string>) {
  return Effect.gen(function* () { return yield* Effect.catch(yield* nested, () => Effect.succeed(7)) })
}
function asserted(nested: Effect.Effect<Effect.Effect<number, string>, string>) {
  return Effect.gen(function* () { return yield* Effect.catch((yield* nested) as Effect.Effect<number, string>, () => Effect.succeed(7)) })
}
function order(events: string[], a: Effect.Effect<number, string>) {
  return Effect.gen(function* () {
    const o = { m(x: number, y: number) { events.push("m"); return y > 0 ? Effect.fail("m") : Effect.succeed(x + y) } }
    const f = () => { events.push("f"); return 1 }
    const r = yield* Effect.catch(o.m(f(), yield* Effect.tap(a, () => Effect.sync(() => { events.push("a") }))), (e) => Effect.succeed((() => { events.push("h:" + e); return -1 })()))
    return [r, events.join(",")]
  })
}
export function main() {
  return Effect.gen(function* () {
    const results: unknown[] = []
    results.push(yield* Effect.exit(argument(Effect.fail("a"))))
    results.push(yield* argument(Effect.succeed(1)))
    results.push(yield* argument(Effect.succeed(0)))
    results.push(yield* Effect.exit(grouped(Effect.fail("out"))))
    results.push(yield* grouped(Effect.succeed(Effect.fail("in"))))
    results.push(yield* grouped(Effect.succeed(Effect.succeed(3))))
    results.push(yield* Effect.exit(asserted(Effect.fail("out"))))
    results.push(yield* asserted(Effect.succeed(Effect.fail("in"))))
    results.push(yield* order([], Effect.succeed(0)))
    results.push(yield* order([], Effect.succeed(2)))
    results.push(yield* Effect.exit(order([], Effect.fail("a"))))
    return results
  })
}
