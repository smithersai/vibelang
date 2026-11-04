import { Data } from "effect"
export class Wanted extends Data.TaggedError("Shared")<{}> {}
export class Other extends Data.TaggedError("Shared")<{}> {}
