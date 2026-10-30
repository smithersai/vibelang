import { Schema } from "effect"
export const events: string[] = []
const fields = { get value(): typeof Schema.String { events.push("field"); return Schema.String } }
class Problem extends Schema.TaggedError<Problem>()("Problem", { value: Schema.String }) { get label(): string { return this.value } }
export const reference = {
  Problem,
  Direct: Schema.Struct({ value: fields.value, count: Schema.Number }),
  Nested: Schema.Struct({ child: Schema.Struct({ value: Schema.Number }) }),
  Named: Schema.Struct({ value: Schema.Boolean }),
}
