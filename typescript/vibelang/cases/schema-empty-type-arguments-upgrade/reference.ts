import { Schema } from "effect"

const Base = Schema.String
class Malformed extends Schema.TaggedError<Malformed>()("Malformed", { value: Base }) {}
export const reference = {
  Alias: Base,
  Lists: Schema.mutable(Schema.Array(Base)),
  Shape: Schema.Struct({
    item: Base,
    list: Schema.mutable(Schema.Array(Schema.Tuple([Base]))),
    record: Schema.Record(Schema.Literal("x"), Base),
    literal: Schema.Literal("Base<>"),
    ["Base<>"]: Schema.String,
  }),
  Malformed,
}
