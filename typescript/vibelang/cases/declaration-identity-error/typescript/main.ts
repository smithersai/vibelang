import { Data } from "effect"

// foldkit: managedResource.
/** A managed resource was read while it was not acquired. */
export class ResourceNotAvailable extends Data.TaggedError("ResourceNotAvailable")<{
  readonly resource: string
}> {}

export class Timeout extends Data.TaggedError("Timeout") {}

export class Gone extends Data.TaggedError("Gone") {
  get message(): string {
    return "gone"
  }
}

export class MissingBuildId extends Data.TaggedError("MissingBuildId")<{}> {}

export class TimeoutWithBraces extends Data.TaggedError("TimeoutWithBraces") {}
