import { Effect } from "effect"
let calls = 0
const init = () => ++calls
const f = function named(p = init()) { return Effect.gen(function* () { p += 10; return p }) }
export const make = () => f()
export const count = () => calls
