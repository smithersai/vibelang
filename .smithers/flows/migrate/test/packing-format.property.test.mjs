import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { emitMigratedJs } from "../lib/steps.mjs"
import { routeBundledImports } from "../lib/bundled-imports.mjs"
import { loaderRecord } from "../../../../packages/compiler/cache.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/compiler/package.json"))
const runtimeRequire = createRequire(join(repo, "packages/runtime/package.json"))
const prettier = require("prettier"), fc = require("fast-check")
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-pack-policy-format.json", import.meta.url)))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }

function fixture({ base = "plain", files = true, useTabs = false, tabWidth = 2, fail = false, formatter = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "packing-format-"))
  const dir = "packages/" + base, pkg = join(root, dir)
  const options = { useTabs, tabWidth, printWidth: 100 }
  put(root, "package.json", JSON.stringify({ private: true, ...(formatter ? { scripts: { "format:check": "prettier --check ." } } : {}) }))
  put(root, ".prettierrc.json", JSON.stringify(options))
  put(root, "untouched.json", '{"keep" : [ 1,2 ]}\n')
  put(root, dir + "/package.json", JSON.stringify({ name: "packing-format-fixture", private: true, type: "module", exports: { ".": "./src/index.ts" }, ...(files ? { files: ["dist"] } : {}) }))
  put(root, dir + "/tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, skipLibCheck: true, types: [] }, include: ["src/**/*"] }))
  put(root, dir + "/src/index.ts", 'export { value } from "./user.vibe"\n')
  put(root, dir + "/src/user.vibe", "export const value: number = 42\n")
  put(root, dir + "/.gitignore", "private.txt\n.vibelang/\n")
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
  for (const [name, path] of [
    ["typescript", dirname(runtimeRequire.resolve("typescript/package.json"))],
    ["effect", dirname(runtimeRequire.resolve("effect/package.json"))],
    ["vibelang", join(repo, "packages/compiler")],
    ["vibelang-runtime", join(repo, "packages/runtime")]
  ]) symlinkSync(path, join(root, "node_modules", name))
  mkdirSync(join(pkg, "node_modules/.bin"), { recursive: true })
  symlinkSync(compiler, join(pkg, "node_modules/.bin/vibelang"))
  if (fail) put(root, "node_modules/.bin/prettier", "#!/bin/sh\necho packing-formatter-rejected >&2\nexit 17\n")
  else symlinkSync(require.resolve("prettier/bin/prettier.cjs"), join(root, "node_modules/.bin/prettier"))
  if (fail) {
    const { chmodSync } = runtimeRequire("node:fs")
    chmodSync(join(root, "node_modules/.bin/prettier"), 0o755)
  }
  const config = { target: root, toolchain: { kind: "installed" }, packages: [{ dir, tsconfig: "tsconfig.json" }] }
  return { root, dir, pkg, options, config, logs: join(root, ".logs"), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

async function check(input) {
  const f = fixture(input)
  try {
    const receipt = await emitMigratedJs(f.config, f.root, f.logs)
    for (const row of receipt.filter(row => !row.restored)) assert.equal(row.code, 0, JSON.stringify(row))
    const policy = join(f.pkg, ".vibelang/pack-policy.json")
    const written = readFileSync(policy, "utf8")
    if (input.files !== false) assert.deepEqual(JSON.parse(written), corpus)
    assert.equal(await prettier.check(written, { ...f.options, filepath: policy }), true, "packing receipt must satisfy the unchanged target formatter")
    assert.equal(await prettier.check(readFileSync(join(f.pkg, "package.json"), "utf8"), { ...f.options, filepath: join(f.pkg, "package.json") }), true)
    assert.equal(readFileSync(join(f.root, "untouched.json"), "utf8"), '{"keep" : [ 1,2 ]}\n')
    for (const row of receipt.filter(row => !row.restored)) {
      assert.equal(row.code, 0, JSON.stringify(row.diagnostics))
      assert.equal(row.packingFormatted.code, 0)
      assert.ok(row.packingFormatted.files.includes(f.dir + "/.vibelang/pack-policy.json"))
      assert.ok(row.loaderRecords.length)
      for (const record of row.loaderRecords) assert.equal(record.miss, undefined, JSON.stringify(record))
    }
    const project = join(f.pkg, "tsconfig.json")
    assert.equal(loaderRecord({ project, root: f.pkg, compiler }).lookup().miss, undefined, "formatting must precede the loader fingerprint")
    await emitMigratedJs(f.config, f.root, f.logs)
    assert.equal(readFileSync(policy, "utf8"), written, "re-emission is a formatting fixed point")
    routeBundledImports({ root: f.root, packages: f.config.packages, ts: runtimeRequire("typescript"), restore: true, native: true })
    renameSync(join(f.pkg, "src/user.vibe"), join(f.pkg, "src/user.ts"))
    put(f.pkg, "src/index.ts", 'export { value } from "./user.ts"\n')
    await emitMigratedJs(f.config, f.root, f.logs)
    assert.equal(existsSync(policy), false)
    const restored = readFileSync(join(f.pkg, "package.json"), "utf8")
    assert.equal(await prettier.check(restored, { ...f.options, filepath: join(f.pkg, "package.json") }), true, "restored manifests satisfy the same formatter")
    assert.deepEqual(JSON.parse(restored).files, input.files === false ? undefined : ["dist"])
  } finally { f.cleanup() }
}

test("opencode packing receipt uses the repository formatter before loader records", () => check({}))
test("packing formatting preserves policy values, restoration and loader validity across target styles", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    base: fc.constantFrom("plain", "with space", "with'apostrophe", "dollar$sign"),
    files: fc.boolean(), useTabs: fc.boolean(), tabWidth: fc.constantFrom(2, 4)
  }), check), { seed: 2026110742, numRuns: 12 })
})
test("packing formatter failure includes exit status and durable log", async () => {
  const f = fixture({ fail: true })
  try {
    await assert.rejects(emitMigratedJs(f.config, f.root, f.logs), error => {
      assert.match(error.message, /packing.*format.*17/i)
      assert.match(error.message, /packing-format\.log/)
      return true
    })
    assert.match(readFileSync(join(f.logs, "packing-format.log"), "utf8"), /packing-formatter-rejected/)
  } finally { f.cleanup() }
})
test("without a target formatter the packing JSON retains its original serialization", async () => {
  const f = fixture({ formatter: false })
  try {
    await emitMigratedJs(f.config, f.root, f.logs)
    assert.equal(readFileSync(join(f.pkg, ".vibelang/pack-policy.json"), "utf8"), JSON.stringify(corpus, null, 2) + "\n")
  } finally { f.cleanup() }
})
