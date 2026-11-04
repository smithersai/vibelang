// expect-result: {"unbraced":[1,1],"sameLine":[2,2],"otherwise":[3,0],"chained":[4,0,5]}
// main.ts stays TypeScript: it calls lib.
import { Effect } from "effect"
import { chained, otherwise, sameLine, unbraced } from "./lib.vibe"

export function main() {
  return Effect.gen(function* () {
    return {
      unbraced: [yield* unbraced({ description: "a" }), yield* unbraced({})],
      sameLine: [yield* sameLine({ description: "b" }), yield* sameLine({})],
      otherwise: [yield* otherwise({ description: "c" }), yield* otherwise({})],
      chained: [yield* chained({ description: "abcd" }, 0), yield* chained({}, 0), yield* chained({}, 5)],
    }
  })
}
