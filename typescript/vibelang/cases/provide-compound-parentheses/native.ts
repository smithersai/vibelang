import { Context, Effect, Layer } from "effect"
class Value extends Context.Service<Value, { n: number }>()("provider-compound/native") {}
export function nativeMain() {
  return Effect.gen(function* () {
    const values: number[] = []
    const first = Layer.succeed(Value, { n: 1 })
    const next = Layer.succeed(Value, { n: 2 })
    const read = Effect.gen(function* () { return (yield* Value).n })
    let layer = first
    values.push(yield* Effect.provide(read, layer ||= next))
    values.push(yield* Effect.provide(read, layer &&= next))
    let optional: Layer.Layer<Value> | undefined
    values.push(yield* Effect.provide(read, optional ??= first))
    const flag = true
    values.push(yield* Effect.provide(read, flag ? layer = first : next))
    let value = 0
    values.push(yield* Effect.provide(read, Layer.succeed(Value, { n: value ||= 3 })))
    return values
  })
}
