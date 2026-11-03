import { Effect } from "effect"
let calls = 0
const init = () => ++calls
class C { f(p = init()) { return Effect.gen(function* () { p += 10; return p }) } }; const f = new C().f
export const make = () => f()
export const count = () => calls
