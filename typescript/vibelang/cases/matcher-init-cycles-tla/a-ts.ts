import "vibelang-runtime"
import { log } from "./log.ts"
import { fromB } from "./b-ts.ts"
log("a body, b says " + fromB())
export function fromA() { return "a" }
class One { static [Symbol.customMatcher](value: unknown) { return value === 1 } }
export const isOne = (value: unknown) => One[Symbol.customMatcher](value)
