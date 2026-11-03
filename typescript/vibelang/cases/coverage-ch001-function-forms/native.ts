import { Effect } from "effect"
import anonymousDefault from "./native-default.js"
export function pick(x: string): Effect.Effect<string>;
export function pick(x: number): Effect.Effect<number>;
export function pick(x: string | number) { return Effect.gen(function* () { return x }) }
export class Choices {
  pick(x: string): Effect.Effect<string>;
  pick(x: number): Effect.Effect<number>;
  pick(x: string | number) { return Effect.gen(function* () { return x }) }
  static identity<T>(x: T) { return Effect.gen(function* () { return x }) }
  #identity<T>(x: T) { return Effect.gen(function* () { return x }) }
  privateValue() { return Effect.gen({ self: this }, function* () { return yield* this.#identity(9) }) }
}
export interface Ordinary { effect(): number }
export const ordinary: Ordinary = { effect() { return 4 } }
export const expression = function (n: number) { return Effect.gen(function* () { return n + 1 }) }
export const blockArrow = (n: number) => Effect.gen(function* () { return n + 2 })
export const bareArrow: (n: number) => Effect.Effect<number> = n => Effect.gen(function* () { return n + 3 })
export const expressionArrow = (n: number) => Effect.gen(function* () { return n + 4 })
let defaults = 0
let bodies = 0
export function cold(n = ++defaults) { return Effect.gen(function* () { bodies++; return n }) }
const decorations: string[] = []
function mark<This, Args extends unknown[], R>(
  value: (this: This, ...args: Args) => R,
  _context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => R>
) { decorations.push("mark"); return value }
export class Decorated {
  @mark
  static value() { return Effect.gen(function* () { return 5 }) }
}
export function main() { return Effect.gen(function* () {
  const program = cold(7)
  const afterCall = [defaults, bodies]
  const first = yield* program
  const second = yield* program
  const choices = new Choices()
  return {
    overloads: [yield* pick("ok"), yield* choices.pick(7)],
    forms: [yield* expression(1), yield* blockArrow(1), yield* bareArrow(1), yield* expressionArrow(1), yield* anonymousDefault(1)],
    methods: [ordinary.effect(), yield* Choices.identity(8), yield* choices.privateValue(), yield* Decorated.value()],
    cold: [afterCall, first, second, defaults, bodies],
    decorations
  }
}) }
