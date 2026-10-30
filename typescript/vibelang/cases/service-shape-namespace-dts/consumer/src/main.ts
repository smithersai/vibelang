import type { Context } from "effect"
import { Recursive, recursive, Left, Right, left, right, Defaults, Group, type Recursive_shape } from "../../out/main.js"
const occupied: Recursive_shape = "occupied"
const r: Recursive.Shape = recursive.next()
const l: Left.Shape = left.next().next()
const rr: Right.Shape = right.next().next()
const defaults: Defaults.Shape = { value: 10 }
const nested: Group.Nested.Shape = { value: 11 }
const extracted: Context.Service.Shape<typeof Recursive> = r
const generic: string = recursive.identity("generic")
function readonlyCheck(value: Recursive.Shape) {
  // @ts-expect-error Readonly members remain readonly in declarations.
  value.value = 0
}
export const result = [extracted.value, l.value, rr.value, defaults.value, nested.value, occupied, generic]
