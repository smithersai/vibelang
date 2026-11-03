import { Effect, Exit, Layer } from "effect"
type Payload = { readonly n: number }
function observed(events: unknown[]) {
 return Layer.effectDiscard(Effect.acquireRelease(Effect.void, (_resource, ex) => Effect.sync(() => {
   events.push(Exit.isSuccess(ex) ? ex.value : "failure")
 })))
}
function normal(events: unknown[]) {
 return Effect.gen(function* () {
   yield* Effect.provide(Effect.gen(function* () { 7 }), observed(events))
   return 7
 })
}
function returned(events: unknown[], value: Payload) {
 return Effect.gen(function* () {
   return yield* Effect.provide(Effect.gen(function* () {
     return yield* Effect.uninterruptibleMask(() => Effect.gen(function* () { return value }))
   }), observed(events))
 })
}
function bare(events: unknown[]) { return Effect.provide(Effect.gen(function* () { return }), observed(events)) }
function jumped(events: unknown[]) {
 return Effect.gen(function* () {
   let count = 0
   outer: for (let n = 0; n < 3; n++) {
     let jump = ""
     yield* Effect.provide(Effect.gen(function* () {
       if (n === 0) { jump = "continue"; return }
       if (n === 2) { jump = "break"; return }
       count += n
     }), observed(events))
     if (jump === "continue") continue outer
     if (jump === "break") break outer
   }
   return count
 })
}
function completions() {
 return Effect.gen(function* () {
   yield* Effect.uninterruptibleMask(() => Effect.void)
   const empty = 5
   yield* Effect.uninterruptibleMask(() => Effect.void)
   const explicit = undefined
   yield* Effect.interruptible(Effect.void)
   const value = 7
   yield* Effect.uninterruptibleMask(restore => restore(Effect.void))
   const restored = 9
   yield* Effect.provide(Effect.void, Layer.empty)
   const labeled = 11
   return [empty, explicit === undefined, value, restored, labeled]
 })
}
class Base {
 n = 13
 value() { return Effect.provide(Effect.succeed(this.n), Layer.empty) }
}
class Child extends Base {
 value() { return Effect.uninterruptibleMask(() => super.value()) }
}
export function main(): Effect.Effect<unknown> {
 return Effect.gen(function* () {
 const events: unknown[] = []
 const payload = { n: 17 }
 const result = yield* normal(events)
 const same = (yield* returned(events, payload)) === payload
 const nothing = (yield* bare(events)) === undefined
 const count = yield* jumped(events)
 return [result, same, nothing, count, events, yield* completions(), yield* new Child().value()]
 })
}
