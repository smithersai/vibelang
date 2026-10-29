// Executable Effect 4.1.0 oracle for the VibeLang forms in main.vibe.
// Each source is rebuilt for every observation, including every retry.
import { Cause, Effect, Exit, Queue, Stream } from "effect"

const E = { _tag: "E" }, E2 = { _tag: "E2" }
type Program = Effect.Effect<unknown, unknown>
const fail = () => Effect.fail(E)
const cleanup = () => Effect.die("D")
const mixed = () => Effect.ensuring(fail(), cleanup())
const resource = () => Effect.scoped(Effect.gen(function*() {
  yield* Effect.acquireRelease(Effect.succeed(1), cleanup)
  return yield* fail()
}))
const disposable = () => ({ [Symbol.dispose]() { throw new Error("D") } })
const callable = () => Object.assign(() => {}, disposable())
const asyncCallable = () => Object.assign(() => {}, {
  async [Symbol.asyncDispose]() { throw new Error("D") }
})
const disposed = (make = disposable) => Effect.scoped(Effect.gen(function*() {
  yield* Effect.acquireRelease(Effect.sync(make), r => Effect.sync(() => r[Symbol.dispose]()))
  return yield* fail()
}))
const holder = () => Effect.scoped(Effect.gen(function*() {
  yield* Effect.acquireRelease(Effect.sync(() => ({ value: disposable() })),
    r => Effect.sync(() => r.value[Symbol.dispose]()))
  return yield* fail()
}))
const asyncDisposed = () => Effect.scoped(Effect.gen(function*() {
  yield* Effect.acquireRelease(Effect.sync(asyncCallable), r => Effect.promise(() => r[Symbol.asyncDispose]()))
  return yield* fail()
}))
const later = () => Effect.andThen(Effect.sleep(5), fail())
const interrupted = () => Effect.ensuring(Effect.never, cleanup())
// A producer is Stream.callback with one element of buffer (VIP-21). The
// consumer's failure interrupts the producer's own fiber, so the cleanup's
// defect reaches no one and the loop fails with E alone.
const producer = () => Stream.runForEach(Stream.callback<number>((queue) =>
  Effect.ensuring(Effect.andThen(Queue.offer(queue, 1), Queue.offer(queue, 2)), cleanup()).pipe(Effect.andThen(Queue.end(queue))),
  { bufferSize: 1, strategy: "suspend" }), fail)

export const sources: Record<string, () => Program> = {
  r0_fail: fail,
  r1_finallyDies: mixed,
  r1_finallyExitDies: () => Effect.onExit(fail(), cleanup),
  r1_finallyThrows: () => Effect.onExit(fail(), () => Effect.fail(E2)),
  r1_dieThenFinallyThrows: () => Effect.onExit(cleanup(), () => Effect.fail(E2)),
  r2_usingReleaseDies: resource,
  r2_usingDisposeThrows: () => disposed(),
  r3_producerCleanupDies: producer,
  r3_producerIteratorCloseThrows: producer,
  r4_awaitAll: () => Effect.all([later(), interrupted()], { concurrency: "unbounded" }),
  r4_forConcurrent: () => Effect.forEach([0, 1], i => i === 0 ? later() : interrupted(), { concurrency: "unbounded", discard: true }),
  r5_awaitRace: () => Effect.raceFirst(fail(), cleanup()),
  r5_awaitAny: () => Effect.raceAll([fail(), cleanup()]),
  r6_interruptThenFinallyThrows: () => Effect.onExit(Effect.interrupt, fail),
  // Abandonment combines the clause failure with cleanup like Effect's finalizer.
  r8_abandonMixed: mixed,
  r8_allSettled: () => Effect.all([mixed()], { concurrency: "unbounded", mode: "result" }),
  r2_forUsingHead: () => disposed(),
  r2_forUsingOf: () => Effect.forEach([1], () => disposed(), { discard: true }),
  r2_callableDispose: () => disposed(callable),
  r2_callableAsyncDispose: asyncDisposed,
  r2_holder: holder,
  r9_handBuiltMixed: () => Effect.failCause(Cause.combine(Cause.fail(E), Cause.die("D"))),
}

function name(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null && "_tag" in value) {
    return value._tag === "M" && "of" in value ? "M:" + value.of : String(value._tag)
  }
  if (value instanceof Error) return value.message
  return String(value)
}
function show(result: Exit.Exit<unknown, unknown>) {
  return Exit.isSuccess(result) ? "ok(" + name(result.value) + ")"
    : result.cause.reasons.map(r => r._tag === "Fail" ? "Fail(" + name(r.error) + ")"
      : r._tag === "Die" ? "Die(" + name(r.defect) + ")" : "Interrupt").join("+")
}
export function referenceRows() {
  return Effect.gen(function*() {
    const rows: Record<string, Record<string, string>> = {}
    for (const [key, source] of Object.entries(sources)) {
      const raw = yield* Effect.exit(source())
      const caught = yield* Effect.exit(Effect.catch(source(), e => Effect.succeed("catch ran: " + name(e))))
      const matched = yield* Effect.exit(Effect.catch(source(), e => Effect.succeed("matched " + name(e))))
      const fallback = yield* Effect.exit(Effect.orElseSucceed(source(), () => "fallback"))
      let attempts = 0
      const retried = yield* Effect.exit(Effect.retry(Effect.suspend(() => { attempts++; return source() }), { times: 2 }))
      const mapped = yield* Effect.exit(Effect.mapError(source(), e => ({ _tag: "M", of: name(e) })))
      const defect = yield* Effect.exit(Effect.catchDefect(source(), d => Effect.succeed("defect " + name(d))))
      rows[key] = { exit: show(raw), catch: show(caught), catchMatch: show(matched), catchValue: show(fallback),
        retry: show(retried) + " x" + attempts, mapError: show(mapped), catchDefect: show(defect) }
    }
    return rows
  })
}
