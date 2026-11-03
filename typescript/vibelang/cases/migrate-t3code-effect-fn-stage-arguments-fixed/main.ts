// expect-result: {"inspect":"/db:3","mtime":-1,"snapshot":"HTTP://H#5","verify":"p","turn":"ab=3","lookup":0}
import { Effect, Option } from "effect"
import { inspect, lookup, newestFileMtime, snapshot, startTurn, verify } from "./lib.js"

export function main() {
  return Effect.gen(function* () {
    return {
      inspect: yield* inspect("/db"),
      mtime: Option.getOrElse(yield* newestFileMtime(""), () => -1),
      snapshot: yield* snapshot("http://h", "token"),
      verify: yield* verify("p", "h"),
      turn: yield* startTurn("ab", 1),
      lookup: yield* lookup(""),
    }
  })
}
