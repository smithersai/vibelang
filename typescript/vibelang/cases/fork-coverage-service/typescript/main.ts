import { Effect, Context } from "effect"
function join(n: number) { return n + 2 }
export function main(): Effect.Effect<number> {
 return Effect.gen(function* () {
  const Item = Context.Reference<{ n: number }>("Item", { defaultValue: () => ({ n: join(3) }) })
  return (yield* Item).n
 })
}
