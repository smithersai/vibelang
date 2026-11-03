// Chapter 2: explicit Effect TypeScript counterpart.
import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () {
 const events: string[] = []
 const scope = yield* Scope.make()
 function scopeValue() { events.push("scope"); return scope }
 function operand() { events.push("operand"); return Effect.succeed(10) }
 const savedScope = scopeValue()
 const fiber = yield* Effect.forkIn(operand(), savedScope)
 const value = yield* Fiber.join(fiber)
 yield* Scope.close(scope, Exit.void)
 function limit() { events.push("limit"); return 1 }
 function items() { events.push("items"); return [1] }
 const savedLimit = limit()
 yield* Effect.forEach(items(), item => Effect.sync(() => { events.push("item") }), {concurrency: savedLimit, discard: true})
 return { events, value }
}) }
