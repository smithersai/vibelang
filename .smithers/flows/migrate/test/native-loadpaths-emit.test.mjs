import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { emitMigratedJs } from "../lib/steps.mjs"
import { wireEsbuildBuilds } from "../lib/esbuild-builds.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const ts = require("typescript")
const compiler = process.env.VIBELANG_BINARY
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const packages = [{ dir: ".", tsconfig: "tsconfig.json", sources: ["src", "db"] }]
const run = (root, file) => spawnSync(process.execPath, [file], { cwd: root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } })
function fixture(t, name) {
  const root = mkdtempSync(join(tmpdir(), "migrate-loadpath-emit-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const files = JSON.parse(readFileSync(new URL("./corpus/" + name + ".json", import.meta.url)))
  for (const [file, text] of Object.entries(files)) if (!file.startsWith(".vibelang/")) put(root, file, text)
  put(root, "tsconfig.json", JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    noEmit: true, rewriteRelativeImportExtensions: true, allowArbitraryExtensions: true, skipLibCheck: true, types: []
  }, include: ["src/**/*.ts", "src/**/*.vibe", "db/**/*.ts", "db/**/*.vibe"], exclude: ["**/*.test.*"] }))
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
  for (const [name, source] of [
    ["typescript", dirname(require.resolve("typescript/package.json"))],
    ["esbuild", dirname(require.resolve("esbuild/package.json"))],
    ["effect", dirname(require.resolve("effect/package.json"))],
    ["vibelang", join(repo, "packages/compiler")],
    ["vibelang-runtime", join(repo, "packages/runtime")],
    ["vibelang-unplugin", join(repo, "packages/unplugin")]
  ]) symlinkSync(source, join(root, "node_modules", name))
  symlinkSync(compiler, join(root, "node_modules/.bin/vibelang"))
  return { root, files }
}
for (const [name, runner] of [
  ["smithers-plain-node-migration", "ops/entry.test.ts"],
  ["smithers-test-local-esbuild", "src/tab.test.mjs"]
]) test(name + ": the real emit step prepares a private package with no exports", { skip: !compiler && "set VIBELANG_BINARY" }, async t => {
  const { root, files } = fixture(t, name)
  const failed = run(root, runner)
  assert.notEqual(failed.status, 0)
  const config = { target: root, toolchain: { kind: "installed" }, packages }
  for (let pass = 0; pass < 2; pass++) {
    const receipts = await emitMigratedJs(config, root, join(root, ".logs"))
    const receipt = receipts.find(item => !item.restored)
    assert.ok(receipt?.files > 0, JSON.stringify(receipts))
    assert.equal(receipt.code, 0, JSON.stringify(receipt))
    assert.ok(!receipts.some(item => item.warnings?.length), JSON.stringify(receipts))
    const result = run(root, runner)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(root, runner), "utf8"), files[runner])
  }
})

test("ordinary esbuild script gets the real native plugin and bundles the converted module", { skip: !compiler && "set VIBELANG_BINARY" }, async t => {
  const { root } = fixture(t, "smithers-test-local-esbuild")
  const script = 'import { build } from "esbuild"\nconst result = await build({ entryPoints: ["src/browser.ts"], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent" })\nconst module = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"))\nif (module.answer !== 42) throw new Error("wrong result")\n'
  put(root, "scripts/build.mjs", script)
  assert.notEqual(run(root, "scripts/build.mjs").status, 0)
  const result = wireEsbuildBuilds({ root, packages, ts, specsFor: () => ({ vibelang: "0.0.11", "vibelang-unplugin": "0.0.11" }) })
  assert.ok(result.wired.includes("scripts/build.mjs"))
  const built = run(root, "scripts/build.mjs")
  assert.equal(built.status, 0, built.stderr)
})

test("a plain TypeScript consumer reads source reexports with relocated sidecars", { skip: !compiler && "set VIBELANG_BINARY" }, async t => {
  const { root } = fixture(t, "smithers-test-local-esbuild")
  const json = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  json.exports = { ".": "./src/browser.ts" }
  put(root, "package.json", JSON.stringify(json))
  const config = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"))
  config.vibe = { sidecarDir: ".vibe/declarations" }
  put(root, "tsconfig.json", JSON.stringify(config))
  const consumer = join(root, "consumer")
  put(root, "consumer/package.json", '{"type":"module"}')
  put(root, "consumer/index.ts", 'import * as Api from "smithers-test-esbuild"\nexport const value: number = Api.answer\n')
  mkdirSync(join(consumer, "node_modules"), { recursive: true })
  symlinkSync(root, join(consumer, "node_modules/smithers-test-esbuild"))
  const diagnostics = () => ts.getPreEmitDiagnostics(ts.createProgram([join(consumer, "index.ts")], {
    noEmit: true, allowImportingTsExtensions: true, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022,
    strict: true, types: [], skipLibCheck: true
  }))
  assert.ok(diagnostics().length > 0, "the unadapted source export cannot reach its hidden sidecar")
  await emitMigratedJs({ target: root, toolchain: { kind: "installed" }, packages }, root, join(root, ".logs"))
  assert.deepEqual(diagnostics().map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
})
