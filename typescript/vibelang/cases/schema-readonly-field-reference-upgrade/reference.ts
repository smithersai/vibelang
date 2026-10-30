import { Schema } from "effect"
const Mutable = Schema.mutableKey(Schema.Number)
export const events: string[] = []
const fields = { get value(): typeof Mutable { events.push("field"); return Mutable } }
class Outer extends Schema.TaggedError<Outer>()("Outer", { child: Schema.Struct({ value: Mutable }) }) {
  get label(): string { return "kept" }
}
export const reference = {
 Direct: Schema.Struct({ value: fields.value, maybe: Schema.optional(Mutable) }),
 Nested: Schema.Struct({ child: Schema.Struct({ value: Mutable }) }),
 Outer,
 Named: Schema.Struct({ value: Mutable }),
}
const writable: typeof reference.Direct.Type = { value: 1 }
writable.value = 2 // a referenced mutableKey really exposes a writable decoded key
