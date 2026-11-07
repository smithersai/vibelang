import { Effect } from "effect"
import { predicate, extractor, Box, BoundBox, Constructor, constructed, events, optionalPredicate } from "./matchers.js"
export function narrow(value: unknown) {
  return predicate(value, { matchType: "boolean" }) ? value + 1 : 0
}
export function main() {
  return Effect.sync(() => {
    const predicates = [
      predicate(7, { matchType: "boolean" }), predicate(-1, { matchType: "boolean" }),
      predicate(7, { matchType: "boolean" }),
      holder.predicate(1, { matchType: "boolean" }), holder["predicate"](7, { matchType: "boolean" }),
      !!predicate(7, { matchType: "boolean" }), optionalPredicate(7, { matchType: "boolean" })
    ]
    const first = extractor(7, { matchType: "extractor" })
    const second = extractor(-1, { matchType: "extractor" })
    const third = holder.extractor(7, { matchType: "extractor" })
    const fourth = holder["extractor"](7, { matchType: "extractor" })
    const extracted = [first === false ? 0 : first[0], second === false ? 0 : second[0], third === false ? 0 : third[0], fourth === false ? 0 : fourth[0]]
    const constructors = [
      new Box() instanceof BoundBox, {} instanceof BoundBox,
      constructed instanceof Constructor, {} instanceof Constructor,
      new Box() instanceof BoundBox
    ]
    return { predicates, extracted, constructors, events }
  })
}
const holder = { limit: 2, predicate, extractor }
