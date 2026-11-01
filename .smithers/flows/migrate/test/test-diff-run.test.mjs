import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { test } from "node:test"
import * as Jj from "../lib/jj.mjs"
import { verifyRepositoryTests } from "../lib/test-diff-run.mjs"
import { paths, record, report, verify } from "../lib/steps.mjs"
import { must, readJson, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const put = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}
async function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), "test-diff-repo-"))
  const target = join(root, "repo"), run = join(root, "run"), p = paths(run)
  try {
    mkdirSync(target)
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    put(target, ".gitignore", "node_modules/\n")
    put(target, "package.json", "{}\n")
    put(target, "src/X.ts", "export const f = () => 1\n")
    put(target, "test/x.test.ts", 'import { f } from "../src/X.ts"\nexpect(f()).toBe(1)\n')
    const base = await Jj.commit(target, "unmodified baseline")
    mkdirSync(join(target, "node_modules"))
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    renameSync(join(target, "src/X.ts"), join(target, "src/X.vibe"))
    put(target, "test/x.test.ts", 'import { f } from "../src/X.vibe"\nexpect(f()).toBe(1)\n')
    const renames = [{ from: "src/X.ts", to: "src/X.vibe" }]
    writeJson(p.config, { target, toolchain: { kind: "registry" }, packages: [], test: { cwd: "." }, bookmark: "vibe" })
    writeJson(p.inventory, { files: [{ path: "src/X.ts", tokens: 7 }] })
    writeJson(p.plan, { batches: [{ files: ["src/X.ts"], reason: "regression" }] })
    writeJson(p.codemod("01"), { renames, fix: { totals: {}, refused: [] } })
    await body({ root, target, run, p, base, renames })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("real jj snapshots report permitted imports and every changed test/fixture", async () => fixture(async ({ root, target, base, renames }) => {
  const result = await verifyRepositoryTests({ ts, target, base, renames, scratch: join(root, "snapshots") })
  assert.equal(result.ok, true)
  assert.deepEqual(result.files.map(f => f.file), ["test/x.test.ts"])
  assert.equal(result.from, base)
  assert.match(result.to, /^[0-9a-f]+$/)
  assert.equal(readJson(join(root, "snapshots/test-diff.json")).ok, true)
  put(target, "fixtures/config.json", '{"include":["src/*.vibe"]}')
  put(target, "test/x.test.ts", 'import { f } from "../src/X.vibe"\nexpect(f()).toBe(2)\n')
  const bad = await verifyRepositoryTests({ ts, target, base, renames, scratch: join(root, "snapshots") })
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.files.map(f => f.file), ["fixtures/config.json", "test/x.test.ts"])
}))
test("record --force cannot commit an edited assertion, and writes its reason", async () => fixture(async ({ target, run, p, base }) => {
  put(target, "test/x.test.ts", 'import { f } from "../src/X.vibe"\nexpect(f()).toBe(2)\n')
  await assert.rejects(record({ run, batch: "01", force: "tests were green" }), /forbidden test\/fixture edits/)
  assert.equal(await Jj.commitId(target, "@-"), base)
  assert.equal(readJson(join(p.batch("01"), "test-diff.json")).ok, false)
  assert.match(readFileSync(join(p.batch("01"), "test-diff.md"), "utf8"), /forbidden/)
}))
test("record rechecks after a formatter edits a previously verified test", async () => fixture(async ({ target, run, p, base }) => {
  writeJson(p.verify("01"), { ok: true })
  put(target, "package.json", '{"scripts":{"format":"prettier --write"}}')
  put(target, "node_modules/.bin/prettier", '#!/bin/sh\nsed -i "s/toBe(1)/toBe(2)/" test/x.test.ts\n')
  await must("chmod +x node_modules/.bin/prettier", { cwd: target })
  await assert.rejects(record({ run, batch: "01" }), /forbidden test\/fixture edits/)
  assert.equal(await Jj.commitId(target, "@-"), base)
}))
test("recorded selector/import proof is included in the PR body artifact", async () => fixture(async ({ run, p }) => {
  const result = await record({ run, batch: "01", force: "no other checks in this fixture" })
  assert.equal(result.testDiff.ok, true)
  assert.equal(result.testDiff.files[0].hunks[0].kind, "specifier")
  const data = await report({ run })
  assert.equal(data.testDiffs.length, 1)
  assert.match(readFileSync(p.prBody, "utf8"), /test\/x.test.ts/)
  assert.match(readFileSync(p.prBody, "utf8"), /specifier/)
}))

test("verify fails a batch even when all target tests and compiler checks pass", async () => fixture(async ({ target, run, p }) => {
  const config = readJson(p.config)
  config.packages = [{ dir: ".", sources: ["src"], tsconfig: "tsconfig.json" }]
  config.test.command = "true"
  writeJson(p.config, config)
  put(target, "package.json", '{"private":true}')
  put(target, "tsconfig.json", '{"include":["src/**/*"]}')
  put(target, "node_modules/.bin/vibelang", "#!/bin/sh\nexit 0\n")
  await must("chmod +x node_modules/.bin/vibelang", { cwd: target })
  writeJson(join(p.baseline, "compile-root.json"), [])
  writeJson(join(p.baseline, "tests.json"), { code: 0, tests: null })
  const good = await verify({ run, batch: "01" })
  assert.equal(good.ok, true)
  put(target, "test/x.test.ts", 'import { f } from "../src/X.vibe"\nexpect(f()).toBe(2)\n')
  const bad = await verify({ run, batch: "01" })
  assert.equal(bad.checks.tests, true)
  assert.equal(bad.ok, false)
  assert.equal(bad.checks.testEdits, false)
}))
test("specifier proof reads declarationImportStyle from the importer's inherited config", async () => fixture(async ({ root, target, base, renames }) => {
  put(target, "tsconfig.base.json", '{"compilerOptions":{"declarationImportStyle":"js"}}')
  put(target, "tsconfig.json", '{"extends":"./tsconfig.base.json"}')
  put(target, "test/x.test.ts", 'import { f } from "../src/X.js"\nexpect(f()).toBe(1)\n')
  const result = await verifyRepositoryTests({ ts, target, base, renames, scratch: join(root, "style-proof") })
  assert.equal(result.ok, true, JSON.stringify(result))
  put(target, "test/x.test.ts", 'import { f } from "../src/X.vibe"\nexpect(f()).toBe(1)\n')
  const wrong = await verifyRepositoryTests({ ts, target, base, renames, scratch: join(root, "style-proof") })
  assert.equal(wrong.ok, false)
}))
test("changed binary fixtures cannot compare equal through UTF-8 replacement characters", async () => fixture(async ({ root, target, renames }) => {
  put(target, "fixtures/data.bin", Buffer.from([255]))
  const base = await Jj.commit(target, "binary baseline")
  put(target, "fixtures/data.bin", Buffer.from([254]))
  const result = await verifyRepositoryTests({ ts, target, base, renames, scratch: join(root, "binary-proof") })
  assert.equal(result.ok, false)
  assert.equal(result.files[0].file, "fixtures/data.bin")
}))
test("removing a test's UTF-8 BOM is an edit outside permitted literals", async () => fixture(async ({ root, target, renames }) => {
  put(target, "test/x.test.ts", '\ufeffimport { f } from "../src/X.vibe"\nexpect(f()).toBe(1)\n')
  const base = await Jj.commit(target, "BOM baseline")
  put(target, "test/x.test.ts", 'import { f } from "../src/X.vibe"\nexpect(f()).toBe(1)\n')
  const result = await verifyRepositoryTests({ ts, target, base, renames, scratch: join(root, "bom-proof") })
  assert.equal(result.ok, false)
}))

test("pinned trees prove a filesystem path and refuse asserted source text", async () => fixture(async ({ root, target, renames }) => {
  put(target, "test/x.test.ts", 'const file = "../src/X.ts"; load(file)')
  renameSync(join(target, "src/X.vibe"), join(target, "src/X.ts"))
  const base = await Jj.commit(target, "path baseline")
  renameSync(join(target, "src/X.ts"), join(target, "src/X.vibe"))
  put(target, "test/x.test.ts", 'const file = "../src/X.vibe"; load(file)')
  const result = await verifyRepositoryTests({ ts, target, base, renames, scratch: join(root, "paths") })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(result.files[0].hunks[0].resolved, renames[0])
  put(target, "test/x.test.ts", 'const file = "../src/X.ts"; expect(readFileSync(file, "utf8")).toBe("text")')
  renameSync(join(target, "src/X.vibe"), join(target, "src/X.ts"))
  const textBase = await Jj.commit(target, "text baseline")
  renameSync(join(target, "src/X.ts"), join(target, "src/X.vibe"))
  put(target, "test/x.test.ts", 'const file = "../src/X.vibe"; expect(readFileSync(file, "utf8")).toBe("text")')
  const bad = await verifyRepositoryTests({ ts, target, base: textBase, renames, scratch: join(root, "paths") })
  assert.equal(bad.ok, false)
  assert.match(readFileSync(join(root, "paths/test-diff.md"), "utf8"), /send to migfix/)
}))

test("dependency assertion proof reads both pinned manifests and reaches the PR body", async () => fixture(async ({ root, target, run, p }) => {
  const old = 'expect(Object.keys(pkg.dependencies)).toEqual(["effect"])'
  const next = 'expect(Object.keys(pkg.dependencies)).toEqual(["effect", "vibelang-runtime"])'
  put(target, "package.json", '{"dependencies":{"effect":"4.1.0"}}')
  put(target, "test/x.test.ts", old)
  const base = await Jj.commit(target, "dependency assertion baseline")
  put(target, "package.json", '{"dependencies":{"effect":"4.1.0","vibelang-runtime":"0.0.12"}}')
  put(target, "test/x.test.ts", next)
  const result = await verifyRepositoryTests({ ts, target, base, renames: [], scratch: join(root, "dependency-proof") })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.files[0].hunks[0].kind, "assertion")
  const recorded = await record({ run, batch: "01", force: "no other checks in this fixture" })
  assert.equal(recorded.testDiff.ok, true)
  await report({ run })
  const body = readFileSync(p.prBody, "utf8")
  assert.match(body, /#### assertion edits/)
  assert.match(body, /vibelang-runtime/)
  assert.match(body, /package.json/)
  // Both pinned manifests have the dependency now: this is no longer a gain.
  const unchanged = await Jj.commitId(target, "@-")
  put(target, "test/x.test.ts", old)
  const noGain = await verifyRepositoryTests({ ts, target, base: unchanged, renames: [], scratch: join(root, "dependency-proof") })
  assert.equal(noGain.ok, false)
  assert.match(JSON.stringify(noGain), /did not gain/)
}))

test("baseline VibeLang formatting survives pinned trees, record and the PR body; token changes do not", async () => fixture(async ({ target, run, p }) => {
  const old = "effect function check(){return try load()}\n// keep this comment\nexpect(1).toBe(1);\n"
  const next = "effect function check() {\n  return try load()\n}\n  // keep   this comment\nexpect(1).toBe(1)\n"
  put(target, "test/existing.test.vibe", old)
  const base = await Jj.commit(target, "baseline already contains VibeLang test")
  writeJson(p.setup, { jj: { upgradeCommit: base } })
  const config = readJson(p.config)
  config.packages = [{dir: "."}]
  writeJson(p.config, config)
  mkdirSync(join(target, "node_modules/.bin"), {recursive: true})
  symlinkSync(fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url)), join(target, "node_modules/.bin/vibelang"))
  put(target, "test/existing.test.vibe", next)
  const recorded = await record({run, batch: "01", force: "no other checks in this fixture"})
  assert.equal(recorded.testDiff.ok, true, JSON.stringify(recorded.testDiff))
  assert.equal(recorded.testDiff.from, base)
  assert.equal(recorded.testDiff.files[0].hunks[0].kind, "formatter-only")
  await report({run})
  assert.match(readFileSync(p.prBody, "utf8"), /#### formatter-only/)
  assert.match(readFileSync(p.prBody, "utf8"), /existing\.test\.vibe/)
  assert.match(readFileSync(p.prBody, "utf8"), /AST: PASS; tokens: PASS/)
  rmSync(p.record("01"))
  put(target, "test/existing.test.vibe", next.replace("try load()", "(try load())"))
  const parent = await Jj.commitId(target, "@-")
  await assert.rejects(record({run, batch:"01", force:"green tests cannot waive tokens"}), /forbidden test\/fixture edits/)
  assert.equal(await Jj.commitId(target, "@-"), parent)
  assert.match(readFileSync(join(p.batch("01"), "test-diff.md"), "utf8"), /token stream differs/)
}))
