import { Effect, Schema } from "effect"
export const Named = Schema.Tuple([Schema.String, Schema.Number])
export type Named = typeof Named.Type
export const Optional = Schema.Tuple([Schema.String, Schema.optional(Schema.Number)])
export type Optional = typeof Optional.Type
export const NamedOptional = Schema.Tuple([Schema.String, Schema.optional(Schema.Number)])
export type NamedOptional = typeof NamedOptional.Type
export const Mutable = Schema.mutable(Schema.Tuple([Schema.String, Schema.optional(Schema.Number)]))
export type Mutable = typeof Mutable.Type
export function main() {
  return Effect.gen(function* () {
    const named = yield* Schema.decodeUnknownEffect(Named)(["a", 1])
    const optional = yield* Schema.decodeUnknownEffect(Optional)(["b"])
    const present = yield* Schema.decodeUnknownEffect(NamedOptional)(["c", 2])
    const missing = yield* Schema.decodeUnknownEffect(NamedOptional)(["d"])
    const mutable = yield* Schema.decodeUnknownEffect(Mutable)(["e"])
    mutable[0] = "changed"
    mutable[1] = 3
    return [named, optional, present, missing, Schema.is(NamedOptional)(["e"]), Schema.is(NamedOptional)(["e", undefined]), mutable]
  })
}
