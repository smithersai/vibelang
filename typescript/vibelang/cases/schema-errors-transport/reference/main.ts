import { Cause, Data, Effect, Exit, Schema } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
class Wire extends Schema.TaggedError<Wire>()("Wire", { value: Schema.BigIntFromString }) {}
class Native extends Schema.TaggedError<Native>()("Native", { value: Schema.BigInt }) {}
class Plain extends Data.TaggedError("Plain")<{ readonly value: bigint }> {}
export function main() {
  return Effect.gen(function* () {
    const encoded = yield* Schema.encodeEffect(Wire)(new Wire({ value: 12n }))
    const decoded = yield* Schema.decodeUnknownEffect(Wire)({ _tag: "Wire", value: "15" })
    const json = yield* Effect.try(() => JSON.stringify(encoded))
    const native = yield* Schema.encodeEffect(Native)(new Native({ value: 12n }))
    const unsupported = yield* Effect.exit(Effect.try(() => JSON.stringify(native)))
    return [encoded.value, typeof encoded.value, decoded.value.toString(), json.includes('"value":"12"'), Exit.isFailure(unsupported), Schema.isSchema(Plain)]
  })
}
