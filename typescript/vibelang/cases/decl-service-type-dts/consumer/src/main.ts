// TypeScript code that imports services of any shape through their declarations.
import { Effect, Layer } from "effect"
import { greet, Prefix, Search, SearchLive, Version } from "../../out/main.js"

const program = Effect.gen(function* () {
  const search = yield* Search
  const hit = yield* search.find("q")
  const prefix: string = yield* Prefix
  const version: number = yield* Version
  return `${prefix}${hit} v${version}`
})

const layers = Layer.mergeAll(SearchLive, Layer.succeed(Prefix, "> "))
export const direct: Effect.Effect<string, never, never> = Effect.provide(program, layers)
export const viaVibe: Effect.Effect<string, never, never> = Effect.provide(greet("v"), layers)
