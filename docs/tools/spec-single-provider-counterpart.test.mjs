import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { block, chapter, repo, run, tools } from "./spec-witness.mjs"
const ts = createRequire(join(repo, "experiments/package.json"))("typescript")
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")
const fixtures = `
import { Context, Effect, Layer } from "effect"
class Users extends Context.Service<Users, { has: (id: string) => Effect.Effect<boolean> }>()("spec/Users") {}
const testUsers = { has: (id: string) => Effect.succeed(id === "yes") }
`

test("one binding provider follows the existing direct-provider counterpart", () => {
  const native = block(running(), "function find(ids:")
  assert.ok(native.includes("}), Layer.succeed(Users, testUsers))"))
  assert.ok(!native.includes("[Layer.succeed(Users, testUsers)]"))
  const dir = mkdtempSync(join(tools, ".spec-single-provider-"))
  try {
    const file = join(dir, "example.mts")
    writeFileSync(file, fixtures + native + `
const tuple: [Layer.Layer<never>] = [Layer.empty]
Effect.provide(Effect.succeed(1), Layer.empty)
Effect.provide(Effect.succeed(1), Context.empty())
Effect.provide(Effect.succeed(1), tuple)
Effect.provide(Effect.succeed(1), [Layer.empty, Layer.empty])
`)
    const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext })
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(d => d.code), [], ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: x => x, getCurrentDirectory: () => repo, getNewLine: () => "\n"
    }))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("the printed binding-provider reference preserves all loop completion paths", () => {
  const result = run(fixtures + block(running(), "function find(ids:") + `
import assert from "node:assert/strict"
for (const [ids, expected] of [
  [[], "none"], [["skip", "yes"], "yes"], [["stop", "yes"], "none"],
  [["no", "yes"], "yes"], [["no"], "none"]
] as const) {
  assert.equal(await Effect.runPromise(find([...ids])), expected)
}
`)
  assert.equal(result.status, 0, result.stderr)
})
