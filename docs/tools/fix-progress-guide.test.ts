import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { checkFixProgressGuide, fixProgressGuideProblems } from "./fix-progress-guide.mjs"

test("the CLI guide assigns saved progress files to the configured migration runner", () => {
  assert.deepEqual(checkFixProgressGuide(), [])
})

test("bare fix invocations do not promise runner-owned log files", () => {
  for (const text of [
    "Each invocation records its counters in a .progress.jsonl log.",
    "The compiler saves its counters in a .progress.jsonl log.",
    "The migration runner writes .progress.jsonl files."
  ]) assert.equal(fixProgressGuideProblems(text).length, 1)
})

test("runner logging, direct stderr and nonclaims remain distinct", () => {
  for (const text of [
    "The migration runner, when given a log path, records counters in .progress.jsonl files.",
    "The migration flow saves .progress.jsonl files with logging enabled.",
    "The direct CLI writes progress to standard error.",
    "The direct CLI does not write .progress.jsonl files.",
    "Inspect a .progress.jsonl file from an earlier run."
  ]) assert.deepEqual(fixProgressGuideProblems(text), [])
})

test("fenced log examples remain examples rather than promises", () => {
  assert.deepEqual(fixProgressGuideProblems("~~~text\nThe compiler writes .progress.jsonl files.\n~~~\n"), [])
})

test("generated actors, logging conditions and Markdown preserve the artifact boundary", () => {
  fc.assert(fc.property(fc.constantFrom("migration runner", "migration flow", "compiler", "vibelang --fix"),
    fc.constantFrom("records", "saves", "writes"), fc.boolean(), fc.boolean(), (actor, verb, enabled, code) => {
      const clause = "The " + actor + (enabled ? ", when given a log path," : "") + " " + verb + " counters in " +
        (code ? "\x60fix.1.progress.jsonl\x60" : "fix.1.progress.jsonl") + " files."
      const expected = actor.startsWith("migration") && enabled ? 0 : 1
      assert.equal(fixProgressGuideProblems(clause).length, expected)
      assert.deepEqual(fixProgressGuideProblems("~~~text\n" + clause + "\n~~~"), [])
  }), { seed: 2471106, numRuns: 200 })
})
