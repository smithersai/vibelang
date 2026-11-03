import { Effect } from "effect"
function mul(effect: number) { return effect * 2 }
function call(effect: (n: number) => number) { return effect(2) }
function caught() { try
  { throw 2 } catch (error) { return error as number }
}
const native = { async effect() { return 3 } }
const bare: (effect: number) => Promise<number> = async effect => effect + 1
const obj = { async() { return Effect.succeed(6) }, get() { return Effect.succeed(2) } }
export function main() { return Effect.gen(function* () {
  return [mul(3), call(n => n + 1), yield* obj.async(), yield* obj.get(), yield* Effect.promise(() => native.effect()), yield* Effect.promise(() => bare(8)), caught()]
}) }
