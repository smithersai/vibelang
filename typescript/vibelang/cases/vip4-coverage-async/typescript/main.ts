import { Effect, Exit, Fiber, Deferred } from "effect"
async function rejects() { throw "async" }
const arrow = async () => { throw "arrow" }
class Worker { async method() { throw "method" } }
async function nested() { return Promise.resolve(7) }
async function observeFiber(f: Fiber.Fiber<number>) { return await f }
async function observeDeferred(d: Deferred.Deferred<number>) { return await d }
async function joinFiber(f: Fiber.Fiber<number>) { return await Effect.runPromise(Fiber.join(f)) }
async function waitDeferred(d: Deferred.Deferred<number>) { return await Effect.runPromise(Deferred.await(d)) }
export function main(): Effect.Effect<readonly unknown[],unknown> { return Effect.gen(function* () {
  const a = yield* Effect.exit(Effect.tryPromise({ try: rejects, catch: (e) => e }))
  const b = yield* Effect.exit(Effect.tryPromise({ try: arrow, catch: (e) => e }))
  const c = yield* Effect.exit(Effect.tryPromise({ try: () => new Worker().method(), catch: (e) => e }))
  const value = yield* Effect.tryPromise(nested)
  const fiber = yield* Effect.forkChild(Effect.succeed(8))
  const deferred = yield* Deferred.make<number>()
  yield* Deferred.succeed(deferred, 9)
  const fiberData = yield* Effect.tryPromise(() => observeFiber(fiber))
  const deferredData = yield* Effect.tryPromise(() => observeDeferred(deferred))
  const joined = yield* Effect.tryPromise(() => joinFiber(fiber))
  const waited = yield* Effect.tryPromise(() => waitDeferred(deferred))
  const failure = (x: Exit.Exit<unknown,unknown>) => Exit.isFailure(x) && x.cause.reasons[0]?._tag === "Fail" ? x.cause.reasons[0].error : null
  return [failure(a),failure(b),failure(c),value,fiberData === fiber,deferredData === deferred,joined,waited]
}) }
