import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { makeConfig, paths, setup, verify } from "../lib/steps.mjs"
import * as Baseline from "../lib/baseline.mjs"
import { compareDeclarations } from "../lib/declarations.mjs"
import { packRepository } from "../lib/pack-policy.mjs"
import * as Jj from "../lib/jj.mjs"
import * as Util from "../lib/util.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const native = fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/package-declaration-baselines.json", import.meta.url), "utf8"))

test("real setup and verification preserve each colliding package's original API", { timeout: 120000 }, async () => {
  assert.ok(existsSync(native), "Build the native compiler before running the declaration baseline integration test")
  const root = mkdtempSync(join(tmpdir(), "package-declaration-baselines-"))
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
      put(dir + "/package.json", { name: "declaration-package-" + index, version: "1.0.0",
        type: "module", types: "./main.d.ts", files: ["main.ts"] })
      put(dir + "/tsconfig.json", { compilerOptions: { strict: true, types: [], target: "ES2022", module: "ESNext", rootDir: "." }, include: ["main.ts"] })
      put(dir + "/main.ts", corpus.sources[index])
    }
    mkdirSync(join(target, "node_modules"), { recursive: true })
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    mkdirSync(join(target, corpus.packages[0], "node_modules/.bin"), { recursive: true })
    symlinkSync(native, join(target, corpus.packages[0], "node_modules/.bin/vibelang"))
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    const revision = await Jj.commit(target, "original package APIs")
    const config = makeConfig({ target, packages: corpus.packages, test: "true", vibelangVersion: "0.0.13",
      stockCompiler: require.resolve("typescript/bin/tsc"), wire: false })
    writeJson(p.config, config)
    writeJson(p.upgrade, { jj: { initialized: true, commit: revision, baseCommit: revision }, effect: { to: "4.1.1" }, changed: [], tests: {} })
    writeJson(join(p.baseline, "upgraded-tests.json"), { code: 0, tests: {} })
    writeJson(join(p.baseline, "upstream-packs.json"), await packRepository(config, join(run, "packs")))
    const original = await setup({ run })
    for (const dir of corpus.packages) assert.deepEqual(original.declarationOracle[dir],
      { compiler: "tsc", unproven: 0 }, JSON.stringify(original.declarationOracle))
    writeJson(p.plan, { batches: [{ files: [corpus.packages[0] + "/main.ts"] }] })
    const unchanged = await verify({ run, batch: "01" })
    // An API change that makes the first package equal its neighbour is still a change.
    put(corpus.packages[0] + "/main.ts", corpus.sources[1])
    const changed = await verify({ run, batch: "01" })
    assert.deepEqual({ unchanged: unchanged.checks.declarations, changed: changed.checks.declarations },
      { unchanged: true, changed: false }, "package declaration gates for unchanged and changed APIs")
    assert.equal(changed.declarations[corpus.packages[0]].identical, false)
    assert.equal(changed.declarations[corpus.packages[1]].identical, true)
    // Existing ambiguous runs cannot certify declarations that another package overwrote.
    const first = Baseline.declarationBaselineDir(p, corpus.packages[0], corpus.packages)
    mkdirSync(join(p.baseline, "dts"), { recursive: true })
    renameSync(first, join(p.baseline, "dts", slug(corpus.packages[0])))
    rmSync(join(p.baseline, "dts-v2"), { recursive: true, force: true })
    const oldSetup = JSON.parse(readFileSync(p.setup, "utf8"))
    delete oldSetup.declarationBaselineVersion
    writeJson(p.setup, oldSetup)
    await assert.rejects(verify({ run, batch: "01" }), /legacy declaration directory aliases packages/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

function baselineFixture(action) {
  const root = mkdtempSync(join(tmpdir(), "declaration-identity-"))
  const p = { baseline: join(root, "baseline"), setup: join(root, "setup.json") }
  try { return action(p) } finally { rmSync(root, { recursive: true, force: true }) }
}

test("legacy declaration collisions name every package and require fresh setup", () => {
  for (const packages of [corpus.packages, ...corpus.neighbours].filter(pair => slug(pair[0]) === slug(pair[1]))) {
    baselineFixture(p => {
      mkdirSync(join(p.baseline, "dts", slug(packages[0])), { recursive: true })
      for (const dir of packages) assert.throws(() => Baseline.declarationBaselineDir(p, dir, packages), error =>
        /unverified declaration baseline.*legacy declaration directory aliases packages/.test(error.message) &&
        packages.every(pkg => error.message.includes(pkg)))
    })
  }
})

test("unambiguous legacy declarations remain readable and current snapshots take precedence", () => baselineFixture(p => {
  const dir = "packages/core", packages = [dir], legacy = join(p.baseline, "dts", slug(dir))
  mkdirSync(legacy, { recursive: true })
  assert.equal(Baseline.declarationBaselineDir(p, dir, packages), legacy)
  const modern = join(p.baseline, Baseline.declarationKey(dir))
  mkdirSync(modern, { recursive: true })
  assert.equal(Baseline.declarationBaselineDir(p, dir, packages), modern)
  assert.equal(Baseline.declarationBaselineDir(p, dir, corpus.packages), modern)
  rmSync(modern, { recursive: true })
  // Another current package is enough to identify the run's snapshot layout.
  assert.equal(Baseline.declarationBaselineDir(p, dir, packages), modern)
  rmSync(join(p.baseline, "dts-v2"), { recursive: true })
  writeJson(p.setup, { declarationBaselineVersion: 2 })
  assert.equal(Baseline.declarationBaselineDir(p, dir, packages), modern)
}))

test("property: declaration snapshots retain distinct APIs across package path neighbours", () => {
  const segment = fc.array(fc.constantFrom("a", "b", "_", "%", " ", "δ"), { minLength: 1, maxLength: 7 }).map(chars => chars.join(""))
  const directory = fc.oneof(fc.constantFrom(".", "root"), fc.array(segment, { minLength: 1, maxLength: 3 }).map(parts => parts.join("/")))
  fc.assert(fc.property(fc.uniqueArray(directory, { minLength: 2, maxLength: 6 }), packages => baselineFixture(p => {
    const keys = packages.map(Baseline.declarationKey)
    assert.equal(new Set(keys).size, packages.length)
    for (const [index, dir] of packages.entries()) {
      const snapshot = join(p.baseline, Baseline.declarationKey(dir))
      mkdirSync(snapshot, { recursive: true })
      writeFileSync(join(snapshot, "main.d.ts"), "export declare const value: " + JSON.stringify("package-" + index) + ";")
    }
    for (const [index, dir] of packages.entries()) {
      const snapshot = Baseline.declarationBaselineDir(p, dir, packages)
      assert.match(readFileSync(join(snapshot, "main.d.ts"), "utf8"), new RegExp('"package-' + index + '"'))
      assert.equal(Baseline.setupCompileKey(dir), "compile-v2/" + Util.packageKey(dir))
      assert.ok(Buffer.byteLength(keys[index].split("/").at(-1) + ".log") <= 255)
    }
  })), { seed: 373900, numRuns: 150, examples: [corpus.packages, ...corpus.neighbours,
    ["δ".repeat(90), "δ".repeat(89) + "a"]].map(packages => [packages]) })
})

test("an incomplete current declaration snapshot cannot borrow a complete legacy API", () => baselineFixture(p => {
  const dir = "packages/core", packages = [dir]
  const legacy = join(p.baseline, "dts", slug(dir)), current = join(p.baseline, Baseline.declarationKey(dir))
  const candidate = join(p.baseline, "candidate")
  for (const out of [legacy, candidate]) {
    mkdirSync(out, { recursive: true })
    writeJson(join(out, "package.json"), { types: "./main.d.ts", exports: { ".": "./main.d.ts" } })
    writeFileSync(join(out, "main.d.ts"), "export declare const value: number;")
  }
  mkdirSync(current, { recursive: true })
  const result = compareDeclarations(ts, Baseline.declarationBaselineDir(p, dir, packages), candidate)
  assert.equal(result.identical, false, JSON.stringify(result))
}))
