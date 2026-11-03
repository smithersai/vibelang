import { Effect } from "effect"
export function sample() {
  return Effect.gen(function* () {
    let calls = 0
    let thenCalls = 0
    const promised: any = Promise.resolve(7)
    const lazy: any = { then(resolve: any) { thenCalls++; resolve(9) } }
    const obj = { value: 3 }
    const nested: any = Effect.succeed(5)
    const a = yield* Effect.catch(Effect.fail(0), function () { calls++; return Effect.succeed(promised) })
    const b = yield* Effect.catch(Effect.fail(0), function named() { calls++; return Effect.succeed(lazy) })
    const c = yield* Effect.catch(Effect.fail(0), (function () { calls++; return Effect.succeed(obj) }))
    const d = yield* Effect.catch(Effect.fail(0), function () { calls++; return Effect.succeed(nested) })
    const e = yield* Effect.catch(Effect.succeed(8), function () { calls++; return Effect.succeed(99) })
    return [a === promised, b === lazy, c === obj, d === nested, e, calls, thenCalls]
  })
}
