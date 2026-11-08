import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { compareApiIdentity } from "../lib/api-identity.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
import { markPlainFunctions } from "../lib/plain.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const runtime = join(repo, "packages/runtime")
const ts = loadTypeScript([runtime])
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const skip = !existsSync(native) && "build the compiler before the native generator declaration check"

test("t3code Effect.fn generator: migration retains the TypeScript declaration", { skip }, () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-explicit-effects-generator-return-pin.json", import.meta.url), "utf8"))
  // The inline witness isolates the rewrite; the planner regression includes
  // an overloaded builder that exercises its generator annotation branch.
  const source = corpus.rewriteWitness
  const root = mkdtempSync(join(tmpdir(), "generator-native-"))
  try {
    symlinkSync(join(runtime, "node_modules"), join(root, "node_modules"))
    const config = JSON.stringify({ compilerOptions: {
      target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true,
      exactOptionalPropertyTypes: true, types: [], skipLibCheck: true,
      declaration: true, emitDeclarationOnly: true, outDir: "out"
    }, include: ["input.ts", "input.vibe"] })
    for (const name of ["before", "after"]) {
      const dir = join(root, name); mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), '{"type":"module"}')
      writeFileSync(join(dir, "tsconfig.json"), config)
      writeFileSync(join(dir, "input.ts"), source)
    }
    const before = join(root, "before"), after = join(root, "after")
    const options = ts.getParsedCommandLineOfConfigFile(join(before, "tsconfig.json"), {}, ts.sys)
    const program = ts.createProgram(options.fileNames, options.options)
    assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error), [], "the stock TypeScript control must compile")
    assert.equal(program.emit().emitSkipped, false)
    assert.deepEqual(markPlainFunctions(ts, after, ["input.ts"], ["tsconfig.json"], { flipped: true }), {})
    assert.equal(readFileSync(join(after, "input.ts"), "utf8"), source)
    renameSync(join(after, "input.ts"), join(after, "input.vibe"))
    const compiled = spawnSync(native, ["-p", "tsconfig.json", "--singleThreaded", "--pretty", "false"], { cwd: after, encoding: "utf8", timeout: 120000 })
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
    const api = compareApiIdentity(ts, before, after, {
      beforeEntrypoints: { ".": "out/input.d.ts" }, afterEntrypoints: { ".": "out/input.d.ts" }
    })
    assert.equal(api.comparisonComplete, true, JSON.stringify(api))
    assert.equal(api.identical, true, JSON.stringify(api))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
