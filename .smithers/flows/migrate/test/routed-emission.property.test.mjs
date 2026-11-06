import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { emitMigratedJs } from "../lib/steps.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? join(repo, "packages/compiler/native/vibelang")
const require = createRequire(join(repo, "packages/runtime/package.json"))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-routed-emission.json", import.meta.url), "utf8"))

async function probe(value, routed = true, importer = corpus.importer) {
  const root = mkdtempSync(join(tmpdir(), "routed-emission-"))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  try {
    put("package.json", JSON.stringify({ name: "routed-emission", type: "module", exports: { ".": "./src/entry.ts" } }))
    put("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "preserve", moduleResolution: "bundler", strict: true, skipLibCheck: true, allowArbitraryExtensions: true, noEmit: true, types: [] }, include: ["src"], vibe: { sidecarDir: ".vibe/declarations" } }))
    put("src/leaf.vibe", "export const value = " + value + "\n")
    put("src/entry.ts", routed ? importer : "export const answer = " + value + "\n")
    for (const [name, target] of Object.entries({ vibelang: join(repo, "packages/compiler"), typescript: dirname(require.resolve("typescript/package.json")), effect: join(repo, "packages/runtime/node_modules/effect"), "vibelang-runtime": join(repo, "packages/runtime") })) {
      mkdirSync(join(root, "node_modules"), { recursive: true })
      symlinkSync(target, join(root, "node_modules", name), "dir")
    }
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
    symlinkSync(compiler, join(root, "node_modules/.bin/vibelang"))
    const config = { target: root, packages: [{ dir: ".", tsconfig: "tsconfig.json", sources: ["src"] }], toolchain: { kind: "installed" } }
    const result = await emitMigratedJs(config, root, join(root, "logs"))
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    const target = typeof manifest.exports["."] === "string" ? manifest.exports["."] : manifest.exports["."].default
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", 'import {answer} from ' + JSON.stringify(new URL(target, "file://" + root + "/").href) + '; console.log(answer)'], { cwd: root, encoding: "utf8", timeout: 30000 })
    assert.equal(run.status, 0, run.stdout + run.stderr)
    assert.equal(run.stdout.trim(), String(value))
    const emitted = result.filter(row => !row.restored)
    assert.ok(emitted.every(row => row.code === 0), JSON.stringify(result))
    assert.equal(emitted[0].emissionPass ?? 1, routed ? 2 : 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("one emission routes native imports before qualifying the emitted runtime", { timeout: 120000 }, async () => {
  assert.ok(existsSync(compiler), "native compiler required")
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.rule))
  for (const importer of corpus.forms) await probe(7, true, importer)
})
test("an importer without a native source dependency still emits once", { timeout: 120000 }, async () => {
  await probe(11, false)
})
test("property: fresh routed output loads for every generated constant", { timeout: 180000 }, async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: -1000, max: 1000 }), fc.constantFrom(...corpus.forms), (value, importer) => probe(value, true, importer)), { numRuns: 12, seed: 119024 })
})
