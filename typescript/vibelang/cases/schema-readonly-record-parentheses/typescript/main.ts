import { Schema } from "effect"
export const Grouped = Schema.Record(Schema.String, Schema.Number)
export type Grouped = typeof Grouped.Type
export const Nested = Schema.Struct({ dict: Schema.Record(Schema.Literals(["a", "b"]), Schema.Number) })
export type Nested = typeof Nested.Type
export const groupedKey = Grouped.key
export const nestedValue = Nested.fields.dict.value
