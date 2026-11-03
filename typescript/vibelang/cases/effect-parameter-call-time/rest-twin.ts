import { Effect } from "effect"
let calls = 0
const init = () => ++calls
function f(...p: number[]) { return Effect.gen(function* () { p[0] = (p[0] ?? 1) + 10; return p[0] }) }
export const make = () => f()
export const count = () => calls
