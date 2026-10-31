import assert from "node:assert/strict"
import { test } from "node:test"
import { Deferred, Effect, Exit, Fiber, Stream } from "effect"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("for try gives plain forks to the current consuming fiber, with no per-item owner", () => {
  const section = chapter("002-running").split("## `for try`")[1]?.split("## Producers")[0] ?? ""
  assert.match(section, /current consuming fiber/)
  assert.match(section, /outlive.*item.*loop/)
  assert.match(section, /not implicitly joined/)
})

test("public VIP and producer guide keep native consuming-fiber ownership", () => {
  for (const path of ["docs/design/vips/0020-for-try.md", "docs/user/src/vibelang-features/112-producers.md"])
    assert.match(read(path), /current consuming fiber/, path)
})

test("the runtime's gated child survives its item and successful loop completion", () => {
  const result = run(block(chapter("008-runtime"), "Stream consuming-fiber witness"))
  assert.equal(result.status, 0, result.stderr + result.stdout)
})

test("a nested consuming fiber owns its child even while the outer fiber continues", async () => {
  const trace = []
  const result = await Effect.runPromiseExit(Effect.gen(function* () {
    const started = yield* Deferred.make()
    const afterLoop = yield* Deferred.make()
    const endOwner = yield* Deferred.make()
    const children = []
    const owner = yield* Effect.forkChild(Effect.gen(function* () {
      yield* Stream.runForEachWhile(Stream.make(1), () => Effect.gen(function* () {
        children.push(yield* Effect.forkChild(Effect.ensuring(
          Effect.gen(function* () { yield* Deferred.succeed(started, undefined); yield* Effect.never }),
          Effect.sync(() => { trace.push("child-final") })
        )))
        yield* Deferred.await(started)
        return true
      }))
      trace.push("loop")
      yield* Deferred.succeed(afterLoop, undefined)
      yield* Deferred.await(endOwner)
    }))
    yield* Deferred.await(afterLoop)
    assert.deepEqual(trace, ["loop"], "item and loop completion must leave the child alive")
    yield* Deferred.succeed(endOwner, undefined)
    yield* Fiber.join(owner)
    const childExit = yield* Fiber.await(children[0])
    assert.ok(Exit.isFailure(childExit))
    assert.equal(childExit.cause.reasons[0]._tag, "Interrupt")
    trace.push("outer-continues")
  }))
  assert.ok(Exit.isSuccess(result))
  assert.deepEqual(trace, ["loop", "child-final", "outer-continues"])
})
