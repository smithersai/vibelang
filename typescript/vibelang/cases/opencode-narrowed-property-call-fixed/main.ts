// expect-result: {"ternary":[4,0],"nested":[4,6,0],"both":[true,false],"block":[4,0],"early":[4,0]}
// main.ts stays TypeScript: it calls lib.
import { Effect } from "effect"
import { block, both, early, nested, ternary } from "./lib.vibe"

export function main() {
  return Effect.gen(function* () {
    return {
      ternary: [yield* ternary({ p: 2 }), yield* ternary({})],
      nested: [yield* nested({ p: 2 }, 0), yield* nested({}, 3), yield* nested({}, 0)],
      both: [yield* both({ p: 2 }), yield* both({})],
      block: [yield* block({ p: 2 }), yield* block({})],
      early: [yield* early({ p: 2 }), yield* early({})],
    }
  })
}
