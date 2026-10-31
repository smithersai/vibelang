import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { block, chapter, repo, run, tools } from "./spec-witness.mjs"
const ts = createRequire(join(repo, "experiments/package.json"))("typescript")
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")
const prefix = 'import { Effect } from "effect"\nconst syncOne = (id: string) => Effect.succeed(id)\nconst limit = () => 2\n'

test("the concurrent ownership example passes a thunk to the injected sync", () => {
  const source = block(running(), "function run(ids:", "vibe es")
  assert.doesNotMatch(source, /fork sync\(id\)/)
  assert.equal([...source.matchAll(/fork sync\(\(\) => id\)/g)].length, 2)
  const native = block(running(), "function run(ids:")
  const dir = mkdtempSync(join(tools, ".spec-fork-sync-"))
  try {
    const file = join(dir, "example.mts")
    writeFileSync(file, prefix + native)
    const program = ts.createProgram([file], {
      strict: true, noEmit: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext
    })
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(d => d.code), [], ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: x => x, getCurrentDirectory: () => repo, getNewLine: () => "\n"
    }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the printed fork counterparts complete with Success(undefined)", () => {
  const result = run(prefix + block(running(), "function run(ids:") + `
import assert from "node:assert/strict"
import { Exit } from "effect"
for (const ids of [[], ["a"], ["a", "b"]]) {
  const exit = await Effect.runPromiseExit(run(ids))
  assert.equal(Exit.isSuccess(exit), true)
  if (Exit.isSuccess(exit)) assert.equal(exit.value, undefined)
}
`)
  assert.equal(result.status, 0, result.stderr)
})
