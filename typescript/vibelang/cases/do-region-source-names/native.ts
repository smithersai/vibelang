import * as Effect from "effect/Effect"
function arrow() { return Effect.uninterruptibleMask(() => Effect.succeed(() => 1)) }
function fn() { return Effect.interruptible(Effect.succeed(function () { return 1 })) }
function klass() { return Effect.uninterruptibleMask(() => Effect.interruptible(Effect.succeed(class { static observed = this.name }))) }
function namedFn() { return Effect.uninterruptibleMask(() => Effect.succeed(function written() { return 1 })) }
function namedClass() { return Effect.interruptible(Effect.succeed(class Written { static observed = this.name })) }
function sourceBinding() { const bound = () => 1; return Effect.uninterruptibleMask(() => Effect.succeed(bound)) }
export function main() {
  return Effect.gen(function* () {
    const a = yield* arrow()
    const f = yield* fn()
    const C = yield* klass()
    const n = yield* namedFn()
    const N = yield* namedClass()
    const b = yield* sourceBinding()
    return [a.name, f.name, [C.name, C.observed], n.name, [N.name, N.observed], b.name]
  })
}
