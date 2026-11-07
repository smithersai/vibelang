import "vibelang-runtime"
import { log } from "./log.ts"
log("after")
class Four { static [Symbol.customMatcher](value: unknown) { return value === 4 } }
export const isFour = (value: unknown) => Four[Symbol.customMatcher](value)
