import { Schema } from "effect"

export const Nested = Schema.Struct({
  maps: Schema.Array(Schema.ReadonlyMap(Schema.String, Schema.Number)),
  sets: Schema.ReadonlySet(Schema.Record(Schema.String, Schema.mutableKey(Schema.Number))),
  both: Schema.ReadonlySet(Schema.ReadonlyMap(Schema.String, Schema.Date)),
  writable: Schema.mutableKey(Schema.mutable(Schema.Array(Schema.ReadonlyMap(Schema.String, Schema.Boolean)))),
})
export type Nested = typeof Nested.Type
