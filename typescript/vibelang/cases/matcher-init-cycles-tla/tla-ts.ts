import "vibelang-runtime"
import { log } from "./log.ts"
log("tla start")
await Promise.resolve()
log("tla resumed")
export const ready = await Promise.resolve("ready").then((value) => value)
log("tla " + ready)
class Three { static [Symbol.customMatcher](value: unknown) { return value === 3 } }
export const isThree = (value: unknown) => Three[Symbol.customMatcher](value)
