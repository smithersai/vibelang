import "vibelang-runtime"
import { log } from "./log.ts"
import { fromA } from "./a-ts.ts"
log("b body, a hoists " + typeof fromA)
export function fromB() { return "b:" + fromA() }
class Two { static [Symbol.customMatcher](value: unknown) { return value === 2 } }
export const isTwo = (value: unknown) => Two[Symbol.customMatcher](value)
