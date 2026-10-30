import { Schema } from "effect"
export const events: string[] = []
class Outer extends Schema.TaggedError<Outer>()("Outer", { child: Schema.Struct({ value: Schema.Number }) }) { get label(): string { return "kept" } }
export const reference = {
 Direct: Schema.Struct({ value: Schema.Number, maybe: Schema.optional(Schema.Number) }),
 Nested: Schema.Struct({ child: Schema.Struct({ value: Schema.Number }) }),
 Outer,
 Named: Schema.Struct({ value: Schema.Boolean }),
}
