// expect-result: {"count":2,"first":"a","none":"none","record":{"arguments":2},"load":7}
import { Effect } from "effect"
import { argumentCount, asRecord, firstArgument, named } from "./lib.js"

export function main() {
  return Effect.gen(function* () {
    const tool = { arguments: ["a", "b"], load: 7 }
    return {
      count: yield* argumentCount(tool),
      first: yield* firstArgument(tool),
      none: yield* firstArgument(),
      record: yield* asRecord(tool),
      load: yield* named(tool),
    }
  })
}
