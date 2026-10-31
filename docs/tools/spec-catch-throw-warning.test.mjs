import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect } from "effect"
import { chapter, read } from "./spec-witness.mjs"

// Decided detail 239 (loop round 1, ASTRA-9): an explicit throw that can complete a
// plain catch handler is the lint warning EK0511, published wherever its sibling EK0508 is.
test("every owner of the plain-handler throw warning states EK0511", () => {
  const running = chapter("002-running")
  assert.match(running, /\| `x catch \(e\) => \{ throw e \}` \| plain function \| a defect, with lint warning `EK0511`;/)
  assert.match(running, /explicit `throw` that can complete it gets a VIP-38 lint warning \(`EK0511`\), with the quick fix `catch effect \(e\) => \{ … \}`/)
  assert.match(running, /A `throw` caught inside the handler, or written in a nested function, does not warn\./)
  assert.match(running, /\| an explicit `throw` that can complete a plain handler, not one caught inside it or in a nested function: the result dies \| `EK0511` \(lint warning\) \|/)
  assert.match(chapter("007-tooling"), /\| An explicit `throw` can complete a plain `catch` handler \(\[VIP-5\]\(\.\.\/vips\/0005-try-runs-effects\.md#decision\)\) \| `EK0511` \|/)
  const appendix = chapter("900-appendices")
  assert.match(appendix, /\| `EK0511` \| lint warning: an explicit `throw` that can complete a plain `catch` handler/)
  assert.ok(appendix.indexOf("| `EK0511` |") > appendix.indexOf("| `EK0509` |"), "Appendix B keeps code order")
  assert.match(read("docs/design/vips/0005-try-runs-effects.md"), /an explicit `throw` in a plain handler warns \(decided detail 239\)\.\*\* .*`EK0511`/)
})

// The warning's reason, on pinned Effect: Effect.catch(x, e => Effect.succeed(h(e))) dies
// with what h throws, while an effect handler's throw is a typed failure.
test("a plain handler's throw dies and an effect handler's throw fails", () => {
  class Wrapped extends Error {}
  const failing = Effect.fail("missing")
  const plain = Effect.runSyncExit(Effect.catch(failing, (e) => Effect.sync(() => { throw new Wrapped(e) })))
  const typed = Effect.runSyncExit(Effect.catch(failing, (e) => Effect.fail(new Wrapped(e))))
  assert.deepEqual(plain.cause.reasons.map((r) => [r._tag, (r.defect ?? r.error) instanceof Wrapped]), [["Die", true]])
  assert.deepEqual(typed.cause.reasons.map((r) => [r._tag, (r.defect ?? r.error) instanceof Wrapped]), [["Fail", true]])
  const caught = Effect.runSyncExit(Effect.catch(failing, (e) => Effect.sync(() => { try { throw e } catch { return "guest" } })))
  assert.equal(caught._tag, "Success")
  const nested = Effect.runSyncExit(Effect.catch(failing, (e) => Effect.sync(() => () => { throw e })))
  assert.equal(nested._tag, "Success")
})
