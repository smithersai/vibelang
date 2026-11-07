// expect-result: {"before":[0,0],"first":{"values":[1,2],"constructed":3,"runs":0},"second":{"values":[1,2],"constructed":6,"runs":0},"after":[6,0]}
// rule-evidence: docs/design/src/007-tooling.md#fix-ownership-and-preservation
import { Effect } from "effect"
import { constructed, make, runs } from "./lib.js"

export function main() {
  const program = make()
  return Effect.gen(function* () {
    const before = [constructed, runs]
    const first = yield* program
    const second = yield* program
    return { before, first, second, after: [constructed, runs] }
  })
}
