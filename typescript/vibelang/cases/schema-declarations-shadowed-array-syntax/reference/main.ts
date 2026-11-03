import { Effect, Schema } from "effect"
type Array<T> = { unrelated: T }
const Values = Schema.Struct({ mutable: Schema.mutable(Schema.Array(Schema.Number)), fixed: Schema.Array(Schema.Number) })
export function main() { return Effect.sync(() => Schema.decodeUnknownSync(Values)({ mutable: [1], fixed: [2] })) }
