import { Effect, Fiber } from "effect"
export function main(): Effect.Effect<string[]> {
 return Effect.gen(function* () {
  const trace: string[] = []
  function made() { trace.push("operand"); return Effect.succeed(7) }
  const f = yield* Effect.forkChild(made())
  trace.push("caller-after")
  trace.push(String(yield* Fiber.join(f)))
  return trace
 })
}
