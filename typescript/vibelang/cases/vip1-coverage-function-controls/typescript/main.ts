import { Effect } from "effect"
function f() { return 7 }
const typed: Function = f
const erased: any = f
export function main(): Effect.Effect<readonly [boolean, boolean, number, number]> {
  return Effect.succeed([typed instanceof Function, Function.prototype === Function["prototype"], erased.constructor === Function ? 7 : 0, f()] as const)
}
