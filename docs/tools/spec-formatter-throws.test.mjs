import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { read, repo, run, tools } from "./spec-witness.mjs"
const ts = createRequire(join(repo, "experiments/package.json"))("typescript")

test("the formatter run preserves its output and bridges its inferred thrown contract", () => {
  const page = process.env.SPEC_FORMATTER ? readFileSync(process.env.SPEC_FORMATTER, "utf8") : read("docs/user/src/code-style/067-pattern-matching.md")
  const lines = page.split("\n").filter(line => line.startsWith("// run:") && line.includes("display(3)") && line.includes("display(false)"))
  assert.equal(lines.length, 1)
  const nativeRun = lines[0].slice("// run:".length).replace(/\btry\s+/g, "yield* ")
  const source = `
import assert from "node:assert/strict"
import { Console, Effect, Exit } from "effect"
// The guide's closed number|boolean match has these native branches.
function display(input: number | boolean): string {
  return typeof input === "number" ? input.toFixed(1) : input ? "enabled" : "disabled"
}
const program = Effect.gen(function* () {
  @RUN@
})
assert.equal(Exit.isSuccess(Effect.runSyncExit(program)), true)
const original = Number.prototype.toFixed
const marker = new RangeError("formatter contract witness")
try {
  Number.prototype.toFixed = function () { throw marker }
  const exit = Effect.runSyncExit(program)
  assert.equal(Exit.isFailure(exit), true)
  if (Exit.isFailure(exit)) {
    const reason = exit.cause.reasons[0]
    assert.equal(reason._tag, "Fail")
    const error: unknown = reason._tag === "Fail" ? reason.error : undefined
    assert.ok(typeof error === "object" && error !== null && "cause" in error)
    if (typeof error === "object" && error !== null && "cause" in error) assert.equal(error.cause, marker)
  }
} finally {
  Number.prototype.toFixed = original
}
console.log("formatter output and native failure bridge pass")
`.replace("@RUN@", nativeRun)
  const dir = mkdtempSync(join(tools, ".spec-formatter-throws-"))
  try {
    const file = join(dir, "example.mts")
    writeFileSync(file, source)
    const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ["node"], typeRoots: [join(tools, "node_modules/@types")] })
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(d => d.code), [], ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: x => x, getCurrentDirectory: () => repo, getNewLine: () => "\n"
    }))
  } finally { rmSync(dir, { recursive: true, force: true }) }
  const result = run(source)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /3\.0 enabled disabled/)
})
