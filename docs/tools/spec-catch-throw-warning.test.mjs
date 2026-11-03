import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect } from "effect"
import { chapter, read } from "./spec-witness.mjs"

// Decided detail 239 made an explicit throw in a plain catch handler the lint warning EK0511. Will's
// 2026-10-31 ruling ("today's EK0511 warning becomes this error") replaces it with EK0401 in every owner.
test("every owner of the plain-handler throw rule states EK0401, not the EK0511 warning", () => {
  const running = chapter("002-running")
  assert.match(running, /\| `x catch \(e\) => \{ throw e \}` \| plain function \| a compile error, `EK0401`; write `x catch effect \(e\) => \{ throw e \}` \|/)
  assert.match(running, /A `throw` in a plain handler is `EK0401`, with the quick fix `catch effect \(e\) => \{ … \}`, which makes the throw a typed failure\./)
  assert.doesNotMatch(running, /A `throw` caught inside the handler, or written in a nested function, does not warn\./)
  assert.doesNotMatch(chapter("007-tooling"), /^\| `EK0511` \|/m)
  const appendix = chapter("900-appendices")
  assert.doesNotMatch(appendix, /^\| `EK0511` \|/m)
  assert.match(appendix, /The old `EK0511` is retired too: VIP-4 makes a `throw` in a plain `catch` handler the error `EK0401`\./)
  assert.match(read("docs/design/vips/0005-try-runs-effects.md"), /The old lint warning `EK0511` retires\./)
})

// The reason for the fixes, on pinned Effect: Effect.catch(x, e => Effect.succeed(h(e))) dies with what h
// throws, while an effect handler's throw is a typed failure and Effect.die keeps the defect.
test("a plain handler's throw dies, an effect handler's throw fails and die keeps the defect", () => {
  class Wrapped extends Error {}
  const failing = Effect.fail("missing")
  const plain = Effect.runSyncExit(Effect.catch(failing, (e) => Effect.sync(() => { throw new Wrapped(e) })))
  const typed = Effect.runSyncExit(Effect.catch(failing, (e) => Effect.fail(new Wrapped(e))))
  const died = Effect.runSyncExit(Effect.catch(failing, (e) => Effect.die(new Wrapped(e))))
  assert.deepEqual(plain.cause.reasons.map((r) => [r._tag, (r.defect ?? r.error) instanceof Wrapped]), [["Die", true]])
  assert.deepEqual(typed.cause.reasons.map((r) => [r._tag, (r.defect ?? r.error) instanceof Wrapped]), [["Fail", true]])
  assert.deepEqual(died.cause.reasons.map((r) => [r._tag, (r.defect ?? r.error) instanceof Wrapped]), [["Die", true]])
})
