import { customMatcher as $vibeMatcher } from "vibelang-runtime"
import { Data } from "effect"

// foldkit: managedResource.
/** A managed resource was read while it was not acquired. */
export class ResourceNotAvailable extends Data.TaggedError("ResourceNotAvailable")<{
  readonly resource: string
}> {
  static [$vibeMatcher](subject: unknown, hint?: { readonly matchType: "boolean" | "extractor" }): boolean | readonly [unknown] {
    const tagged = subject !== null && (typeof subject === "object" || typeof subject === "function") && "_tag" in subject && subject._tag === "ResourceNotAvailable"
    return tagged ? hint?.matchType === "extractor" ? [subject] : true : false
  }
}

export class Timeout extends Data.TaggedError("Timeout") {
  static [$vibeMatcher](subject: unknown, hint?: { readonly matchType: "boolean" | "extractor" }): boolean | readonly [unknown] {
    const tagged = subject !== null && (typeof subject === "object" || typeof subject === "function") && "_tag" in subject && subject._tag === "Timeout"
    return tagged ? hint?.matchType === "extractor" ? [subject] : true : false
  }
}

export class Gone extends Data.TaggedError("Gone") {
  static [$vibeMatcher](subject: unknown, hint?: { readonly matchType: "boolean" | "extractor" }): boolean | readonly [unknown] {
    const tagged = subject !== null && (typeof subject === "object" || typeof subject === "function") && "_tag" in subject && subject._tag === "Gone"
    return tagged ? hint?.matchType === "extractor" ? [subject] : true : false
  }

  get message(): string {
    return "gone"
  }
}

export class MissingBuildId extends Data.TaggedError("MissingBuildId")<{}> {}

export class TimeoutWithBraces extends Data.TaggedError("TimeoutWithBraces") {
  static [$vibeMatcher](subject: unknown, hint?: { readonly matchType: "boolean" | "extractor" }): boolean | readonly [unknown] {
    const tagged = subject !== null && (typeof subject === "object" || typeof subject === "function") && "_tag" in subject && subject._tag === "TimeoutWithBraces"
    return tagged ? hint?.matchType === "extractor" ? [subject] : true : false
  }
}
