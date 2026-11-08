import { Effect, Layer } from "effect"
const single = () => Effect.provide(Effect.succeed(1), { layer: Layer.empty }.layer)
const nested = () => Effect.provide(Effect.succeed(2), { box: { layer: Layer.empty } }.box.layer)
const ordered = Effect.gen(function* () {
  let order = 0
  return yield* Effect.provide(Effect.sync(() => order), [
    { get layer() { order = order * 10 + 1; return Layer.empty } }.layer,
    { get layer() { order = order * 10 + 2; return Layer.empty } }.layer,
    { get layer() { order = order * 10 + 3; return Layer.empty } }.layer,
  ])
})
export const main = Effect.gen(function* () { return [yield* single(), yield* nested(), yield* ordered] })
