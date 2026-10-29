// Run directly with Node as well as the Bun suite's Node subprocess consumers.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire, registerHooks } from "node:module"
import { $bind, $catch, $program, $region, $using, Effect, Exit } from "vibelang-runtime"
import { Locks } from "vibelang-runtime/experimental"
import { ExperimentalNodeLocks } from "vibelang-runtime/experimental/platform-node"

test("Node floor supplies the loader and synchronous ESM package ABI", () => {
  assert.equal(typeof import.meta.main, "boolean")
  assert.equal(typeof registerHooks, "function")
  assert.equal(typeof process.getBuiltinModule, "function")
  const required = createRequire(import.meta.url)("vibelang-runtime")
  assert.equal(required.Effect, Effect)
  assert.equal(required.$bind, $bind)
})

test("Node executes lazy runtime programs, typed recovery and scoped disposal", async () => {
  let calls = 0
  const program = $program(() => Effect.sync(() => ++calls))
  assert.equal(calls, 0)
  assert.equal(await Effect.runPromise(program), 1)
  assert.equal(await Effect.runPromise(program), 2)
  assert.equal(await Effect.runPromise($catch(Effect.fail("expected"), e => Effect.succeed(e))), "expected")
  const events = []
  await Effect.runPromise($region(scope => Effect.gen(function* () {
    yield* $using(scope, Effect.succeed({ [Symbol.dispose]() { events.push("disposed") } }))
    events.push("body")
  })))
  assert.deepEqual(events, ["body", "disposed"])
})

test("Web Locks is opt-in and fails clearly on hosts without navigator.locks", async () => {
  if (globalThis.navigator?.locks !== undefined) return
  const exit = await Effect.runPromiseExit(Effect.provide(Effect.service(Locks.Locks), ExperimentalNodeLocks.layer))
  assert.ok(Exit.isFailure(exit))
  assert.match(String(exit), /The Locks layer needs navigator.locks/)
})
