import { Schema } from "effect"
export const events: string[] = []
const fields = { get value(): typeof Schema.String { events.push("field"); return Schema.String } }
class Outer extends Schema.TaggedError<Outer>()("Outer", { child: Schema.Struct({ value: Schema.String }) }) { get label(): string { return "kept" } }
export const reference = {
 Direct: Schema.Struct({ value: fields.value, count: Schema.Number }),
 Nested: Schema.Struct({ child: Schema.Struct({ value: Schema.Number }) }),
 Outer,
 Named: Schema.Struct({ value: Schema.Boolean }),
 Mixed: Schema.Struct({ value: Schema.String }),
}
