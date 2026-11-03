import { Effect } from "effect"
import { reject, throws, summary } from "./foreign.js"
export const main = () => Effect.gen(function* () {
 const fail = yield* Effect.exit(Effect.tryPromise(reject))
 const thrown = yield* Effect.exit(Effect.tryPromise(throws))
 const die = yield* Effect.exit(Effect.promise(reject))
 const ok = yield* Effect.promise(() => Promise.resolve(7))
 return [summary(fail),summary(thrown),summary(die),ok]
})
