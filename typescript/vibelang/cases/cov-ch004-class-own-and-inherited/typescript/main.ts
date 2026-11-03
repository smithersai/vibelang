import { Effect } from "effect"
function probe(): unknown {
class A {}
class B extends A {}
const subject: unknown = 7
const forged = Object.create(B.prototype)
const genuine = new B()
Object.setPrototypeOf(genuine, null)
return [typeof subject === "number", subject instanceof B, forged instanceof B, genuine instanceof B]
}
export function main(): Effect.Effect<unknown> { return Effect.sync(probe) }
