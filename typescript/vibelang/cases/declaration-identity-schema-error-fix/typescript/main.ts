import { customMatcher as $vibeMatcher } from "vibelang-runtime"
import * as Schema from "effect/Schema"

export class Plain extends Schema.TaggedError<Plain>()("Plain", {
  message: Schema.String,
}) {
  static [$vibeMatcher](subject: unknown, hint?: { readonly matchType: "boolean" | "extractor" }): boolean | readonly [unknown] {
    const tagged = subject !== null && (typeof subject === "object" || typeof subject === "function") && "_tag" in subject && subject._tag === "Plain"
    return tagged ? hint?.matchType === "extractor" ? [subject] : true : false
  }
}

export class Failed extends Schema.TaggedError<Failed>()("Failed", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  static [$vibeMatcher](subject: unknown, hint?: { readonly matchType: "boolean" | "extractor" }): boolean | readonly [unknown] {
    const tagged = subject !== null && (typeof subject === "object" || typeof subject === "function") && "_tag" in subject && subject._tag === "Failed"
    return tagged ? hint?.matchType === "extractor" ? [subject] : true : false
  }

  override get message(): string {
    return `failed: ${this.reason}`
  }
}
