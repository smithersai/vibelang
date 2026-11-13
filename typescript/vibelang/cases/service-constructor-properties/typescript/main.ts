import { Context, Effect, Layer } from "effect"
type RecordShape = { readonly constructor: string }
class RecordKey extends Context.Service<RecordKey, RecordShape>()("constructor-properties/RecordKey") {}
type FactoryShape = { constructor: () => number }
class FactoryKey extends Context.Service<FactoryKey, FactoryShape>()("constructor-properties/FactoryKey") {}
type OptionalShape = { "constructor"?: string }
class OptionalKey extends Context.Service<OptionalKey, OptionalShape>()("constructor-properties/OptionalKey") {}
type MethodShape = { constructor?(): number }
class MethodKey extends Context.Service<MethodKey, MethodShape>()("constructor-properties/MethodKey") {}
const methods: MethodShape = { constructor: () => 9 }
const record: RecordShape = { constructor: "record" }
const factory: FactoryShape = { constructor: () => 7 }
const optional: OptionalShape = { constructor: undefined }
export function main() {
  return Effect.gen(function* () {
    return yield* Effect.provide(Effect.gen(function* () {
      return [(yield* RecordKey).constructor, (yield* FactoryKey).constructor(), (yield* OptionalKey).constructor === undefined, (yield* MethodKey).constructor?.()]
    }), [Layer.succeed(RecordKey, record), Layer.succeed(FactoryKey, factory), Layer.succeed(OptionalKey, optional), Layer.succeed(MethodKey, methods)])
  })
}
