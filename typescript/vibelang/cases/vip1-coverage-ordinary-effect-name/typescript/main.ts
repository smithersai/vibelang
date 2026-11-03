import { Effect } from "effect"
interface Ordinary { effect(): number }
type Literal = { effect(): number }
const ordinary: Ordinary = { effect() { return 7 } }
const literal: Literal = ordinary
export function main(): Effect.Effect<number> { return Effect.succeed(literal.effect()) }
