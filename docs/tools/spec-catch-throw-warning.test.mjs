import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect } from "effect"
import { chapter, read } from "./spec-witness.mjs"

// Decided detail 239 made an explicit throw in a plain catch handler the lint warning EK0511. Will's
// 2026-10-31 ruling ("today's EK0511 warning becomes this error") replaces it with EK0401 in every owner.
test("every owner of the plain-handler throw rule states EK0401, not the EK0511 warning", () => {
  const running = chapter("002-running")
  assert.match(running, /\| `x catch \(e\) => \{ throw e \}` \| plain function \| error `EK0401`/)
  assert.match(running, /A plain handler is plain code, so a `throw` in it is `EK0401` \(VIP-5, amended 2026-10-31; this replaces the retired `EK0511` warning\)/)
  assert.doesNotMatch(running, /A `throw` caught inside the handler, or written in a nested function, does not warn\./)
  assert.match(chapter("007-tooling"), /The retired `EK0511` warning for a `throw` in a plain handler is now this error\./)
  const appendix = chapter("900-appendices")
  assert.match(appendix, /\| `EK0511` \| lint warning: an explicit `throw` that can complete a plain `catch` handler/)
  assert.match(read("docs/design/vips/0005-try-runs-effects.md"), /`EK0511` is retired/)
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
