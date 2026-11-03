import { Effect } from "effect"

export const log: Array<string> = []

const listen = (): Effect.Effect<Effect.Effect<void>> =>
  Effect.sync(() => {
    log.push("listen")
    return Effect.sync(() => {
      log.push("unsubscribe")
    })
  })

const nested = (): Effect.Effect<Effect.Effect<number>> =>
  Effect.succeed(
    Effect.sync(() => {
      log.push("inner")
      return 7
    }),
  )

export const finalized = Effect.gen(function* () {
  const unsubscribe = yield* listen()
  log.push("held")
  yield* Effect.addFinalizer(() => unsubscribe)
  log.push("body")
})

export const returned = Effect.gen(function* () {
  return yield* nested()
})

export const ranLater = Effect.gen(function* () {
  const inner = yield* nested()
  log.push("before")
  return yield* inner
})

export const bothLayers = Effect.gen(function* () {
  return yield* yield* nested()
})
