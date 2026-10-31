import * as Schema from "effect/Schema"

export class Plain extends Schema.TaggedError<Plain>()("Plain", {
  message: Schema.String,
}) {}

export class Failed extends Schema.TaggedError<Failed>()("Failed", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `failed: ${this.reason}`
  }
}
