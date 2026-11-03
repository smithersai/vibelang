import { Effect } from "effect"
export const sample = () => Effect.gen(function* () {
  const obj = { run: () => Effect.succeed(3) }
  const a = (yield* obj.run()) + 4
  const b = (yield* obj.run()) + 5
  const c = (yield* obj.run()) + 6
  const d = 2 * (yield* obj.run())
  return [a, b, c, d]
})
