// Chapter 2: explicit Effect TypeScript counterpart.
import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () {
 let calls = 0
 function key() { return Effect.gen(function* () { calls++; return "read" }) }
 function base() { return Effect.gen(function* () { calls++; return class Base { value = 7 } }) }
 const parent = yield* base()
 const name = yield* key()
 class C extends parent { [name]() { return this.value } }
 const value = yield* Effect.try(() => (new C() as any).read())
 return { calls, value }
}) }
