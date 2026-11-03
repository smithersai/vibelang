import { Effect } from "effect"
import { Audit } from "./main.js"

export const bareCatch = () => Effect.gen(function* () {
  const audit = yield* Audit
  return yield* Effect.catch(audit.record("catch"), () => Effect.succeed(-1))
})
export const tried = () => Effect.gen(function* () {
  const audit = yield* Audit
  return yield* audit.record("try")
})
export const piped = () => Effect.gen(function* () {
  const audit = yield* Audit
  return yield* Effect.map(audit.record("pipe"), (n) => n + 1)
})
export const pipeCatch = () => Effect.gen(function* () {
  const audit = yield* Audit
  return yield* Effect.catch(Effect.map(audit.record("pipe-catch"), (n) => n + 1), () => Effect.succeed(-1))
})
export const nestedCatch = () => Effect.gen(function* () {
  const audit = yield* Audit
  return yield* Effect.catch(Effect.catch(audit.record("inner"), () => Effect.succeed(-1)), () => Effect.succeed(-2))
})
export const instance = () => Effect.gen(function* () {
  const audit = yield* Audit
  return yield* Effect.catch(audit.record("instance"), () => Effect.succeed(-1))
})
