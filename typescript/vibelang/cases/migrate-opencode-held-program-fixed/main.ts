// expect-result: {"order":["listen","held","body","unsubscribe"],"program":true,"unran":[],"later":7,"laterOrder":["before","inner"],"both":7,"bothOrder":["inner"]}
import { Effect } from "effect"
import { bothLayers, finalized, log, ranLater, returned } from "./lib.js"

export function main() {
  return Effect.gen(function* () {
    yield* Effect.scoped(finalized)
    const order = log.splice(0)
    const program = yield* returned
    const unran = log.splice(0)
    const later = yield* ranLater
    const laterOrder = log.splice(0)
    const both = yield* bothLayers
    const bothOrder = log.splice(0)
    return { order, program: Effect.isEffect(program), unran, later, laterOrder, both, bothOrder }
  })
}
