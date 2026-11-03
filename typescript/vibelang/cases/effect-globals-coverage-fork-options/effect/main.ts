import { Effect, Fiber } from "effect"
export function main() {
 return Effect.gen(function*() {
  const n=4
  const a=yield* Effect.forkChild(Effect.succeed(n),{startImmediately:true})
  const b=yield* Effect.forkChild(Effect.succeed(n+1),{uninterruptible:"inherit"})
  return [yield* Fiber.join(a),yield* Fiber.join(b)]
 })
}
