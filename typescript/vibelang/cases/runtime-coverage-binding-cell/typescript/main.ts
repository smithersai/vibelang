import { Effect } from "effect"
import { values } from "./helper.js"
export function main(): Effect.Effect<string[]> {
 return Effect.gen(function* () {
  const trace: string[] = []
  const hook = { read: (): number => 0 }
  hook.read = (): number => x
  const [x = (yield* Effect.succeed(7), 7)] = values(hook, trace)
  return [String(x), ...trace]
 })
}
