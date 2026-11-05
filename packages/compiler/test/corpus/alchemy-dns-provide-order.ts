import { Effect, Layer } from "effect"
export const trace: string[] = []
const makeLayer = () => {
  trace.push("layer:construct")
  return Layer.empty
}
export const provided = Effect.fn(function* (value: number) {
  return yield* Effect.provide(Effect.gen(function* () {
    trace.push("program:run")
    return value
  }), makeLayer())
})
