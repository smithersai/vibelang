import { Schema } from "effect"
const Optional = Schema.optionalKey(Schema.Number)
export const events: string[] = []
const fields = { get value(): typeof Optional { events.push("field"); return Optional } }
const Direct = Schema.Struct({ value: fields.value })
const Nested = Schema.Struct({ child: Schema.Struct({ value: Optional }) })
class Outer extends Schema.TaggedError<Outer>()("Outer", { child: Schema.Struct({ value: Optional }) }) {
  get label(): string { return "kept" }
}
export const reference = {
  Direct, Nested, Outer,
  Named: Schema.Struct({ value: Optional }),
}
