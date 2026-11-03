import { Effect, Exit } from "effect"
import { api, specifier, reset, counts } from "./foreign.js"
export function main(): Effect.Effect<readonly unknown[],unknown> { return Effect.gen(function* () {
  reset()
  const tagged = Effect.tryPromise(() => api.tag`value${3}`)
  const imported = Effect.tryPromise(() => import("./payload.js"))
  const coercion = Effect.tryPromise({ try: () => import(specifier as any), catch: (e) => e })
  const before = counts()
  const tagValue = yield* tagged
  const module = yield* imported
  const bad = yield* Effect.exit(coercion)
  return [before, counts(),tagValue,module.value,Exit.isFailure(bad) && bad.cause.reasons[0]?._tag === "Fail" && bad.cause.reasons[0].error === "coercion"]
}) }
