// expect-result: {"read":"x","again":"xx","count":2,"run":1}
import { Effect } from "effect"
import { again, count, read, run } from "./lib.js"

export function main() {
  return Effect.gen(function* () {
    return { read: yield* read({ value: "x" }), again: yield* again({ value: "x" }), count: yield* count({ n: 1 }), run: run() }
  })
}
