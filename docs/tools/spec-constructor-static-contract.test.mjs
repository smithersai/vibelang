import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { block, chapter, repo, run, tools } from "./spec-witness.mjs"
const ts = createRequire(join(repo, "experiments/package.json"))("typescript")
const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")

test("generated constructor never contracts retain implicit payload-access failures", () => {
  const text = failures()
  assert.doesNotMatch(text, /constructors do not throw for well-typed input/)
  assert.match(text, /intrinsic static contract/)
  assert.ok(text.includes("getters, `Proxy` traps and target property operations"))
  assert.match(text, /native order and value/)
  assert.match(text, /defects in effect code, even when the payload is well-typed/)
})

test("the exact typed getter witness dies before either constructor produces its result", () => {
  const source = block(failures(), "function copyPayload(")
  const dir = mkdtempSync(join(tools, ".spec-constructor-contract-"))
  try {
    const file = join(dir, "example.mts")
    writeFileSync(file, source)
    const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext })
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(d => d.code), [], ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: x => x, getCurrentDirectory: () => repo, getNewLine: () => "\n"
    }))
  } finally { rmSync(dir, { recursive: true, force: true }) }
  const result = run(source + `
import assert from "node:assert/strict"
import { Exit } from "effect"
for (const kind of ["error", "data"] as const) {
  const exit = Effect.runSyncExit(copyPayload(kind))
  assert.equal(Exit.isFailure(exit), true)
  if (Exit.isFailure(exit)) assert.ok(exit.cause.reasons.some(reason => reason._tag === "Die" && reason.defect === "payload"))
}
`)
  assert.equal(result.status, 0, result.stderr)
})
