import {Effect,Fiber} from "effect"
import {h} from "./jsx.js"
declare global { namespace JSX { type Element = Effect.Effect<number> } }
let runs = 0
function A() { return Effect.gen(function*(){ runs++; return 3 }) }
export function main(): Effect.Effect<Array<number>> {
 return Effect.gen(function*() {
 const fiber = yield* Effect.forkChild(<A/>)
 const joined = yield* Fiber.join(fiber)
 const direct = yield* <A/>
 return [joined,direct,runs]
 })
}
