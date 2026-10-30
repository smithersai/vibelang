import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read, block, run } from "./spec-witness.mjs"

test("malformed parameter blocks get the handler diagnostic before the head diagnostic", () => {
  const running = chapter("002-running")
  const syntax = running.split("## `catch`")[1].split("### Static rules")[0]
  const row = syntax.split("\n").find(line => line.startsWith("| `try x catch (e) {"));
  assert.ok(row, "the migration typo needs its own repair row")
  assert.ok(row.includes("EK0509"), "the row must identify the malformed handler")
  assert.ok(row.includes("x catch effect (e) =>"), "the repair must remove try and supply a function literal")
  assert.match(running, /parameter list followed directly by a block/)
  assert.match(running, /does not additionally report `EK0505`/)
  assert.match(running, /well-formed `try x catch \(e\) =>/)
  assert.match(running, /independent.*diagnostics/)
})

test("Appendix A, Appendix B and the public VIP agree on the narrow recovery priority", () => {
  const appendix = chapter("900-appendices")
  const handler = appendix.split("#### CatchHandler")[1].split("#### EffectBlock")[0]
  for (const text of [handler, read("docs/design/vips/0005-try-runs-effects.md")]) {
    assert.ok(text.includes("EK0509"), "handler recovery needs its existing code")
    assert.ok(text.includes("EK0505"), "the same-expression dominance must be explicit")
    assert.ok(text.includes("(e) {"), "the recovery witness must stay visible")
  }
  const row = appendix.split("\n").find(line => line.startsWith("| `EK0509` |"))
  assert.ok(row.includes("try x catch (e) {"), "Appendix B must identify the recovery case")
  assert.ok(row.includes("EK0505"), "Appendix B must preserve the same-expression priority")
})

test("the two explicit repaired handlers both have the checked Success counterpart", () => {
  const witness = block(chapter("002-running"), "function repairedCatchHandler()")
  const result = run(witness + "\nfor (const p of [repairedCatchHandler(), repairedPlainCatchHandler()]) { const ex = Effect.runSyncExit(p); if (ex._tag !== 'Success' || ex.value !== 0) throw ex }\n")
  assert.equal(result.status, 0, result.stderr)
})
