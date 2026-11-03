import { Effect } from "effect"
import "./native-consumer.js"
export function program() { return Effect.gen(function* () {
 class Base { ping() { return 7 } }
 class Derived extends Base {
  go() { const ping=()=>super.ping(); return Effect.gen(function* () { yield* Effect.yieldNow; return ping() }) }
 }
 return yield* new Derived().go()
}) }
export function main() { return Effect.gen(function* () { return yield* program() }) }
