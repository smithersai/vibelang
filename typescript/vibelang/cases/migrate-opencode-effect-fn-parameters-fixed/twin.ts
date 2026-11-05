import { Effect, Schema } from "effect"
export const Path = Schema.String.pipe(Schema.brand("Path"))
export type Path = typeof Path.Type
// Effect functions bind parameters when called, outside the cold body.
export const canonical = (input: Path) => Effect.gen(function* () {
  return yield* Effect.withSpan(Effect.gen(function* () { return input }), "canonical")
})
export const legacy = Effect.fnUntraced(function* (input: Path) {
  return yield* Effect.withSpan(Effect.gen(function* () { return input }), "canonical")
})
// Alias spelling does not change either direction of the public contract.
const acceptsLegacy: typeof canonical = legacy
const acceptsCanonical: typeof legacy = canonical
