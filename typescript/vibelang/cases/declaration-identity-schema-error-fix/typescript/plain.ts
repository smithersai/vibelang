import { customMatcher as $vibeMatcher } from "vibelang-runtime"
import * as Schema from "effect/Schema"

export class Alone extends Schema.TaggedError<Alone>()("Alone", {
  message: Schema.String,
}) {
  static [$vibeMatcher](subject: unknown, hint?: { readonly matchType: "boolean" | "extractor" }): boolean | readonly [unknown] {
    const tagged = subject !== null && (typeof subject === "object" || typeof subject === "function") && "_tag" in subject && subject._tag === "Alone"
    return tagged ? hint?.matchType === "extractor" ? [subject] : true : false
  }
}
