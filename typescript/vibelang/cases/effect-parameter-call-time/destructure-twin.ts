import { Effect } from "effect"
let calls = 0
const init = () => ++calls
function f({ p = init() } = {}) { return Effect.gen(function* () { p += 10; return p }) }
export const make = () => f()
export const count = () => calls
