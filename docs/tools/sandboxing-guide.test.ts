import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Cause, Effect } from "effect"
import fc from "fast-check"
import { defaultCompiler, extract, linkModules, runBlock } from "./check-snippets"

test("the sandbox inspection example runs and retains its written error channel", async () => {
  const page = readFileSync(new URL("../user/src/error-management/020-sandboxing.md", import.meta.url), "utf8")
  const blocks = extract(page)
  const inspection = blocks.find(block => block.source.includes("function readWithInspection"))!
  expect(inspection.pending).toBeUndefined()
  expect(inspection.source).toContain("function readWithInspection(): never!InvalidRow")
  const temp = mkdtempSync(join(tmpdir(), "sandboxing-guide-"))
  try {
    linkModules(temp)
    const result = await runBlock(join(temp, "inspection"), blocks, { ...inspection, status: "ok", diagnostics: [] }, defaultCompiler(), 10000)
    expect({ status: result.status, reason: result.reason, execution: result.execution }).toMatchObject({
      status: "ok", execution: { phase: "run", status: "passed", stdout: inspection.output + "\n", exitCode: 0 }
    })
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test("sandbox inspection restores single and mixed failure causes", () => {
  // The guide: "failCause(cause) restores the original failure model, with every expected failure, defect, and interruption in the cause".
  fc.assert(fc.property(fc.array(fc.tuple(fc.boolean(), fc.string()), { minLength: 1, maxLength: 6 }), entries => {
    const causes = entries.map(([defect, value]) => defect ? Cause.die(value) : Cause.fail(value))
    const cause = causes.reduce((left, right) => Cause.combine(left, right))
    const program = Effect.failCause(cause)
    const inspected = Effect.catch(Effect.sandbox(program), held => Effect.gen(function* () {
      yield* Effect.orDie(Effect.try(() => JSON.stringify(held.reasons.map(reason => reason._tag))))
      return yield* Effect.failCause(held)
    }))
    expect(Effect.runSyncExit(inspected)).toEqual(Effect.runSyncExit(program))
  }), { seed: 2058, numRuns: 80 })
})
