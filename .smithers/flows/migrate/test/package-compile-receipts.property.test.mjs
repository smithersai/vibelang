import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { makeConfig, paths, setup, compile } from "../lib/steps.mjs"
import { check } from "../lib/diagnostics.mjs"
import { assertBaselineSafe } from "../lib/baseline.mjs"
import * as Receipt from "../lib/baseline.mjs"
import { packRepository } from "../lib/pack-policy.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const native = fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/package-compile-receipts.json", import.meta.url), "utf8"))

test("real setup and batch checks keep colliding package names independent", { timeout: 120000 }, async () => {
  assert.ok(existsSync(native), "Build the native compiler before running the package receipt integration test")
  const root = mkdtempSync(join(tmpdir(), "package-compile-receipts-"))
  const target = join(root, "repo"), run = join(root, "run"), p = paths(run)
  const put = (name, value) => {
    const path = join(target, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value))
  }
  try {
    put("package.json", { private: true, type: "module", workspaces: corpus.packages })
    put(".gitignore", "node_modules/\n")
    for (const [index, dir] of corpus.packages.entries()) {
      put(dir + "/package.json", { name: "receipt-package-" + index, version: "1.0.0", private: true, type: "module" })
      put(dir + "/tsconfig.json", { compilerOptions: { strict: true, types: [], target: "ES2022", module: "ESNext", rootDir: "src" }, include: ["src"] })
      put(dir + "/src/main.ts", corpus.sources[index])
    }
    mkdirSync(join(target, "node_modules"), { recursive: true })
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    mkdirSync(join(target, corpus.packages[0], "node_modules/.bin"), { recursive: true })
    symlinkSync(native, join(target, corpus.packages[0], "node_modules/.bin/vibelang"))
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    const revision = await Jj.commit(target, "original package sources")
    const config = makeConfig({ target, packages: corpus.packages, test: "true", vibelangVersion: "0.0.13", wire: false })
    writeJson(p.config, config)
    writeJson(p.upgrade, { jj: { initialized: true, commit: revision, baseCommit: revision }, effect: { to: "4.1.1" }, changed: [], tests: {} })
    writeJson(join(p.baseline, "upgraded-tests.json"), { code: 0, tests: {} })
    const checks = {}
    for (const dir of corpus.packages) checks[dir] = { compiler: "original", ...await check({
      compiler: native, tsconfig: "tsconfig.json", cwd: join(target, dir), root: target,
      log: join(run, "original-" + Object.keys(checks).length + ".log"),
    }) }
    assert.deepEqual(Object.values(checks).map(result => result.code), [0, 2], JSON.stringify(checks))
    writeJson(join(p.baseline, "upstream-checks.json"), checks)
    writeJson(join(p.baseline, "upgraded-checks.json"), checks)
    writeJson(join(p.baseline, "upstream-packs.json"), await packRepository(config, join(run, "packs")))
    await setup({ run })
    const admission = assertBaselineSafe(p)
    assert.deepEqual(admission.compile.filter(row => row.stage === "setup").map(row => [row.package, row.exit.after]),
      [[corpus.packages[0], 0], [corpus.packages[1], 2]])
    // The batch reader must select the same package's baseline too.
    writeJson(p.plan, { batches: [{ files: [corpus.packages[0] + "/src/main.ts"] }] })
    const result = await compile({ run, batch: "01" })
    assert.deepEqual(result.newErrors, [], JSON.stringify(result))
    put(corpus.packages[0] + "/src/main.ts", 'export const value: number = "new error"\n')
    const failed = await compile({ run, batch: "01" })
    assert.ok(failed.newErrors.some(error => error.file.startsWith(corpus.packages[0] + "/")), JSON.stringify(failed))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const diagnostic = dir => ({ category: "error", code: "TS2322", file: dir + "/src/main.ts",
  line: 1, column: 1, message: "existing type error", notes: [] })
function receipts(action) {
  const root = mkdtempSync(join(tmpdir(), "package-receipt-"))
  const p = { baseline: join(root, "baseline"), upgrade: join(root, "upgrade.json"), setup: join(root, "setup.json") }
  try { return action(p) } finally { rmSync(root, { recursive: true, force: true }) }
}
const originals = (p, packages, codes) => {
  const checks = Object.fromEntries(packages.map((dir, index) => [dir,
    { compiler: "original", code: codes[index], diagnostics: codes[index] ? [diagnostic(dir)] : [] }]))
  writeJson(join(p.baseline, "upstream-checks.json"), checks)
  return checks
}

test("legacy receipt collisions are unverified and name every possible owner", () => {
  for (const packages of [corpus.packages, ...corpus.neighbours.filter(pair => slug(pair[0]) === slug(pair[1]))]) receipts(p => {
    originals(p, packages, [0, 0])
    writeJson(join(p.baseline, "compile-" + slug(packages[0]) + ".json"), [])
    writeJson(join(p.baseline, "compile-" + slug(packages[0]) + ".exit.json"), { code: 0 })
    writeJson(join(p.baseline, "admission.json"), { state: "accepted" })
    assert.throws(() => assertBaselineSafe(p), /toolchain baseline regression/)
    const result = JSON.parse(readFileSync(join(p.baseline, "admission.json"), "utf8"))
    assert.equal(result.compile.length, 2)
    for (const row of result.compile) {
      assert.equal(row.state, "unverified")
      assert.match(row.reason, /legacy.*aliases/)
      assert.deepEqual(row.packages, packages)
    }
    assert.equal(assertBaselineSafe(p, { includeSetup: false }).state, "accepted")
  })
})

test("unambiguous legacy receipts stay readable; modern partial receipts never fall back", () => receipts(p => {
  originals(p, ["packages/core"], [0])
  writeJson(join(p.baseline, "compile-packages__core.json"), [])
  writeJson(join(p.baseline, "compile-packages__core.exit.json"), { code: 0 })
  assert.equal(assertBaselineSafe(p).state, "accepted")
  Receipt.recordSetupCompile(p, "packages/core", { code: 0, diagnostics: [] })
  rmSync(join(p.baseline, Receipt.setupCompileKey("packages/core") + ".exit.json"))
  assert.throws(() => assertBaselineSafe(p), /toolchain baseline regression/)
  const row = JSON.parse(readFileSync(join(p.baseline, "admission.json"), "utf8")).compile[0]
  assert.equal(row.state, "unverified")
  assert.match(row.receipt, /^compile-v2\//)
  assert.match(row.reason, /exit.*missing or invalid/)
  Receipt.recordSetupCompile(p, "packages/core", { code: 0, diagnostics: [] })
  rmSync(join(p.baseline, Receipt.setupCompileKey("packages/core") + ".json"))
  assert.throws(() => assertBaselineSafe(p), /toolchain baseline regression/)
  assert.match(JSON.parse(readFileSync(join(p.baseline, "admission.json"), "utf8")).compile[0].reason, /diagnostics.*missing/)
}))

test("modern package receipts take precedence over ambiguous legacy evidence", () => receipts(p => {
  originals(p, corpus.packages, [0, 0])
  writeJson(join(p.baseline, "compile-packages__core.json"), [diagnostic(corpus.packages[1])])
  writeJson(join(p.baseline, "compile-packages__core.exit.json"), { code: 2 })
  for (const dir of corpus.packages) Receipt.recordSetupCompile(p, dir, { code: 0, diagnostics: [] })
  assert.equal(assertBaselineSafe(p).state, "accepted")
}))

test("property: package receipt paths preserve punctuation, nesting, root and Unicode identities", () => {
  const segment = fc.array(fc.constantFrom("a", "b", "_", "%", ".", " ", "δ"), { minLength: 1, maxLength: 8 })
    .map(parts => parts.join("")).filter(value => value !== "." && value !== "..")
  const directory = fc.oneof(fc.constantFrom(".", "root"), fc.array(segment, { minLength: 1, maxLength: 3 }).map(parts => parts.join("/")))
  fc.assert(fc.property(fc.uniqueArray(directory, { minLength: 2, maxLength: 8 }), packages => receipts(p => {
    const checks = originals(p, packages, packages.map((_, i) => i % 2 ? 2 : 0))
    for (const dir of packages) Receipt.recordSetupCompile(p, dir, checks[dir])
    assert.equal(new Set(packages.map(Receipt.setupCompileKey)).size, packages.length)
    const result = assertBaselineSafe(p)
    assert.deepEqual(result.compile.map(row => [row.package, row.exit.after]), packages.map(dir => [dir, checks[dir].code]))
    for (const dir of packages) assert.deepEqual(Receipt.readSetupCompile(p, dir, packages).diagnostics, checks[dir].diagnostics)
    // A new error in any one package remains a regression independent of its neighbours.
    const dir = packages[0]
    Receipt.recordSetupCompile(p, dir, { code: 2, diagnostics: [diagnostic(dir)] })
    assert.throws(() => assertBaselineSafe(p), /toolchain baseline regression/)
  })), { seed: 371900, numRuns: 180, examples: [corpus.packages, ...corpus.neighbours].map(pair => [pair]) })
})

test("valid long Unicode package segments keep bounded receipt filenames", () => receipts(p => {
  const packages = ["δ".repeat(90), "δ".repeat(89) + "a"]
  const checks = originals(p, packages, [0, 2])
  for (const dir of packages) {
    const key = Receipt.setupCompileKey(dir)
    assert.ok(Buffer.byteLength(key.split("/").at(-1) + ".exit.json") <= 255)
    Receipt.recordSetupCompile(p, dir, checks[dir])
  }
  assert.notEqual(Receipt.setupCompileKey(packages[0]), Receipt.setupCompileKey(packages[1]))
  assert.equal(assertBaselineSafe(p).state, "accepted")
}))
