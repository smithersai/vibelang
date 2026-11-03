import { Effect } from "effect"
let calls = 0
const init = () => ++calls
const f = (p = init()) => Effect.gen(function* () { p += 10; return p })
export const make = () => f()
export const count = () => calls
