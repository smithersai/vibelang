/** Closed DATA operations emitted by Go. This is not a source parser, compiler,
 * callback evaluator, or graph builder. Intermediate IEEE numbers retain JS
 * semantics; the existing durable codecs still police every node boundary. */
import {KEYED_VALUE_LIMITS} from "./keyed-value.ts"
import type {JsonPrimitive, JsonValue} from "./value.ts"

const arities = Object.freeze({
  positive:1, negative:1, not:1, "bit-not":1, "is-null":1,
  get:2, add:2, subtract:2, multiply:2, divide:2, remainder:2, power:2,
  "bit-and":2, "bit-or":2, "bit-xor":2, "shift-left":2, "shift-right":2, "shift-unsigned":2,
  equal:2, "not-equal":2, "loose-equal":2, "loose-not-equal":2,
  less:2, "less-equal":2, greater:2, "greater-equal":2, and:2, or:2, nullish:2,
} as const)
export type KeyedOperator = keyof typeof arities
export const keyedOperatorArity = (value: unknown): number =>
  typeof value === "string" && Object.hasOwn(arities,value) ? arities[value as KeyedOperator] : 0

export class KeyedSourceEvaluationError extends TypeError {
  constructor(message:string) {super(message);this.name="KeyedSourceEvaluationError"}
}
function fail(message:string):never {throw new KeyedSourceEvaluationError(message)}
const scalar = (value:JsonValue):JsonPrimitive =>
  value === null || typeof value !== "object" ? value : fail("keyed computation cannot coerce or compare object identities")
const number = (value:JsonValue):number => typeof value === "number" ? value : fail("keyed computation requires numeric operands")
const ordered = (value:JsonValue):number|string =>
  typeof value === "number" || typeof value === "string" ? value : fail("keyed comparison requires number or string operands")

/** One budget per node preparation, shared by all nested operations. Charge
 * produced UTF-16 units before allocating concatenations; a rope/alias cannot
 * allocate exponentially while its eventual tiny boolean result hides it. */
export function createKeyedComputationEvaluator() {
  let produced = 0
  return (operator:KeyedOperator, operand:(index:number)=>JsonValue):JsonValue => {
    const left=operand(0)
    switch(operator) {
      case "not": return !left
      case "is-null": return left === null
      case "positive": return +number(left)
      case "negative": return -number(left)
      case "bit-not": return ~number(left)
      case "and": return left && operand(1)
      case "or": return left || operand(1)
      case "nullish": return left ?? operand(1)
    }
    const right=operand(1)
    switch(operator) {
      // Values were decoded into inert own data. A guarded projection must not
      // inspect an untaken variant while publishing its complete graph.
      case "get": {
        if(left===null || typeof left!=="object" || typeof right!=="string" || !Object.hasOwn(left,right)) {
          return fail("keyed projection requires a present own data field")
        }
        return (left as Record<string,JsonValue>)[right]
      }
      // One exact null is safe even when the other value is a record. Wire
      // values cannot be undefined or host exotica, so loose null equality
      // also reduces to strict equality without coercion or object identity.
      case "equal": return left===null || right===null ? left===right : scalar(left) === scalar(right)
      case "not-equal": return left===null || right===null ? left!==right : scalar(left) !== scalar(right)
      // Otherwise both values must be primitives: conversions cannot invoke code.
      case "loose-equal": return left===null || right===null ? left===right : scalar(left) == scalar(right)
      case "loose-not-equal": return left===null || right===null ? left!==right : scalar(left) != scalar(right)
      case "less": return ordered(left) < ordered(right)
      case "less-equal": return ordered(left) <= ordered(right)
      case "greater": return ordered(left) > ordered(right)
      case "greater-equal": return ordered(left) >= ordered(right)
      case "add": {
        const a=scalar(left),b=scalar(right)
        if(typeof a !== "string" && typeof b !== "string")return number(a)+number(b)
        const x=String(a),y=String(b)
        produced += x.length+y.length
        if(produced > KEYED_VALUE_LIMITS.bytes)fail("keyed computation exceeds its string production budget")
        return x+y
      }
      case "subtract": return number(left)-number(right)
      case "multiply": return number(left)*number(right)
      case "divide": return number(left)/number(right)
      case "remainder": return number(left)%number(right)
      case "power": return number(left)**number(right)
      case "bit-and": return number(left)&number(right)
      case "bit-or": return number(left)|number(right)
      case "bit-xor": return number(left)^number(right)
      case "shift-left": return number(left)<<number(right)
      case "shift-right": return number(left)>>number(right)
      case "shift-unsigned": return number(left)>>>number(right)
      default: return fail("unknown keyed computation operator")
    }
  }
}
