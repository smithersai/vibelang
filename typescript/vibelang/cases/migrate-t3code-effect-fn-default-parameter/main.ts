// expect-result: {"make":"none","labelled":"a","resolve":"local","open":3,"pick":1}
import { Effect } from "effect"
import { make, open, pick, resolve } from "./lib.js"

export function main() {
  return Effect.gen(function* () {
    return {
      make: yield* make(),
      labelled: yield* make({ label: "a" }),
      resolve: yield* resolve(undefined),
      open: yield* open("a"),
      pick: yield* pick(),
    }
  })
}
