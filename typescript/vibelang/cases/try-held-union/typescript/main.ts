import { Effect } from "effect"
import { left, right, legacy, reference, exitValue, configValue } from "./factory.js"
import type { RequiredOperand, LeftRequirement, RightRequirement } from "./factory.js"
export function required(p: RequiredOperand) {
  return Effect.gen(function* () { return yield* p })
}
export function main() {
  return Effect.gen(function* () { return [yield* reference(left), yield* reference(right), yield* reference(legacy), yield* exitValue, yield* configValue] })
}
