import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const require = createRequire(join(root, "packages/runtime/package.json"))
const Effect = require("effect/Effect")
const ts = require("typescript")
const fc = createRequire(new URL("../package.json", import.meta.url))("fast-check")
const binary = process.env.VIBELANG_BINARY ?? join(root, "packages/compiler/native/vibelang")
const source = readFileSync(new URL("./corpus/opencode-plain-effect-fn.ts", import.meta.url), "utf8")
const options = { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], declaration: true, outDir: "out" }

function run(cwd, ...args) {
  const result = spawnSync(binary, args, { cwd, encoding: "utf8", timeout: 90000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout + result.stderr
}

test("plain Effect.fn refusal preserves API, construction and repeated execution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "plain-effect-fn-"))
  try {
    mkdirSync(join(directory, "node_modules"))
    symlinkSync(join(root, "packages/runtime/node_modules/effect"), join(directory, "node_modules/effect"))
    symlinkSync(join(root, "packages/runtime"), join(directory, "node_modules/vibelang-runtime"))
    writeFileSync(join(directory, "package.json"), '{"type":"module"}')
    writeFileSync(join(directory, "oracle.ts"), source)
    const program = ts.createProgram([join(directory, "oracle.ts")], {
      ...options, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, outDir: join(directory, "oracle"),
    })
    assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
    assert.equal(program.emit().emitSkipped, false)
    writeFileSync(join(directory, "main.vibe"), source)
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: options, files: ["main.vibe"] }))
    const output = run(directory, "-p", ".", "--fix", "--pretty", "false")
    assert.equal(output.split("\n").filter(line => line.includes("refused site:") && line.includes("not an inline generator")).length, 1, output)
    const fixed = readFileSync(join(directory, "main.vibe"), "utf8")
    assert.ok(fixed.includes(source.slice(source.indexOf("export const work"))))
    assert.equal(readFileSync(join(directory, "out/main.d.ts"), "utf8"), readFileSync(join(directory, "oracle/oracle.d.ts"), "utf8"))
    const oracle = await import(pathToFileURL(join(directory, "oracle/oracle.js")))
    const actual = await import(pathToFileURL(join(directory, "out/main.js")))
    const observed = (module, value) => {
      module.trace.length = 0
      const operation = module.work(value)
      const constructed = [...module.trace]
      const first = Effect.runSyncExit(operation)
      const second = Effect.runSyncExit(operation)
      return { constructed, first, second, trace: [...module.trace], length: module.work.length }
    }
    fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), value => {
      assert.deepEqual(observed(actual, value), observed(oracle, value))
    }), { seed: 330334, numRuns: 80 })
    const second = run(directory, "-p", ".", "--fix", "--pretty", "false")
    assert.match(second, /refused site:.*not an inline generator/)
    assert.equal(readFileSync(join(directory, "main.vibe"), "utf8"), fixed)
    for (const scope of ["--fix-migration-only", "--fix-vip-only"]) {
      const report = run(directory, "-p", ".", "--fix", scope, "--pretty", "false")
      assert.doesNotMatch(report, /not an inline generator/)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
