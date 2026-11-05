import { Schema } from "effect"
export const Value = Schema.Struct({ value: Schema.optional(Schema.String) })
export type Value = typeof Value.Type
export const field: Schema.optional<Schema.String> = Value.fields.value
export const Grouped = Schema.Struct({ value: Schema.optional(Schema.Literals(["a", "b"])) })
export type Grouped = typeof Grouped.Type
export const groupedField: Schema.optional<Schema.Literals<readonly ["a", "b"]>> = Grouped.fields.value
