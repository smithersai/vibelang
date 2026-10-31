import * as Schema from "effect/Schema"

export class Alone extends Schema.TaggedError<Alone>()("Alone", {
  message: Schema.String,
}) {}
