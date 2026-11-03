import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { rewriteScripts } from "../lib/codemod.mjs"
import { packRepository } from "../lib/pack-policy.mjs"
import { makeConfig, paths, record, verify } from "../lib/steps.mjs"
import { must, quote, slug, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const packCorpus = JSON.parse(readFileSync(new URL("./corpus/t3code-verify-pack-prerequisites.json", import.meta.url), "utf8"))

async function fixture(action, { before = false, during = false, packageScripts = false, packBaseline = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "alchemy-foreign-gate-"))
  const target = join(root, "repo"), run = join(root, "run")
  try {
    mkdirSync(join(target, "src"), { recursive: true })
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(target, "node_modules/typescript"))
    writeJson(join(target, "package.json"), { private: true, ...(packageScripts ? { scripts: { smoke: "node src/main.ts", test: "vitest" } } : {}) })
    writeJson(join(target, "tsconfig.json"), { include: ["src/**/*.ts", "src/**/*.vibe"] })
    writeFileSync(join(target, ".gitignore"), "node_modules/\n")
    writeFileSync(join(target, "src/main.ts"), "export const value = 1\n")
    writeFileSync(join(target, "src/earlier.vibe"), "export const earlier = 1\n")
    writeFileSync(join(target, "src/main.test.ts"), "export {}\n")
    writeFileSync(join(target, "node_modules/.bin/vibelang"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await must("jj commit -m fixture", { cwd: target })
    renameSync(join(target, "src/main.ts"), join(target, "src/main.vibe"))
    const p = paths(run)
    if (packBaseline) writeJson(join(p.baseline, "upstream-packs.json"), await packRepository({ target }, join(run, "upstream-packs")))
    if (packageScripts) {
      const renames = [{ from: "src/main.ts", to: "src/main.vibe" }]
      writeJson(p.codemod("01"), { renames, packageScriptEdits: rewriteScripts(target, renames) })
    }
    const command = during ? "node -e " + quote('require("node:fs").writeFileSync("src/main.test.ts", ' + JSON.stringify("export const changed = 1\n") + ')') : "true"
    writeJson(p.config, makeConfig({ target, test: command, vibelangVersion: "0.0.11" }))
    writeJson(p.plan, { batches: [{ files: ["src/main.ts"] }] })
    writeJson(p.inventory, { files: [{ path: "src/main.ts", tokens: 1 }] })
    writeJson(join(p.baseline, "tests.json"), { code: 0, tests: {}, total: 0, passed: 0, failed: [], skipped: 0 })
    writeJson(join(p.baseline, "compile-" + slug(".") + ".json"), [])
    if (before) writeFileSync(join(target, "src/earlier.vibe"), "export const earlier = 2\n")
    return await action({ run, target, p })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("verify rejects --fix rewriting an earlier migrated module", async () => {
  await fixture(async ({ run }) => {
    const result = await verify({ run, batch: "01" })
    assert.equal(result.ok, false)
    assert.equal(result.checks.foreignFiles, false)
    assert.deepEqual(result.foreign.map(c => c.path), ["src/earlier.vibe"])
  }, { before: true })
})

test("verify catches a foreign edit made by the test command", async () => {
  await fixture(async ({ run }) => {
    const result = await verify({ run, batch: "01" })
    assert.equal(result.ok, false)
    assert.equal(result.checks.foreignFiles, false)
    assert.deepEqual(result.foreign.map(c => c.path), ["src/main.test.ts"])
  }, { during: true })
})

test("verify accepts a clean batch rename", async () => {
  await fixture(async ({ run }) => {
    const result = await verify({ run, batch: "01" })
    assert.equal(result.checks.foreignFiles, true)
    assert.equal(result.ok, true)
    assert.deepEqual(result.foreign, [])
  })
})

test("record rechecks scope after verify, including with --force", async () => {
  for (const force of [undefined, "known test failure"]) await fixture(async ({ run, target }) => {
    const result = await verify({ run, batch: "01" })
    assert.equal(result.ok, true)
    writeFileSync(join(target, "src/earlier.vibe"), "export const earlier = 2\n")
    await assert.rejects(record({ run, batch: "01", force }), /outside.*batch|foreign/i)
    const { stdout } = await must("jj log -r @- --no-graph -T description", { cwd: target })
    assert.equal(stdout.trim(), "fixture")
  })
})

test("t3code package scripts pass verify, but extra manifest edits fail verify and forced record", async () => {
  await fixture(async ({ run, target }) => {
    assert.equal((await verify({ run, batch: "01" })).ok, true)
    writeJson(join(target, "package.json"), { private: true, scripts: { smoke: "node src/main.vibe", test: "true" } })
    const bad = await verify({ run, batch: "01" })
    assert.equal(bad.checks.foreignFiles, false)
    assert.deepEqual(bad.foreign.map(change => change.path), ["package.json"])
    await assert.rejects(record({ run, batch: "01", force: "negative control" }), /outside.*scope/)
  }, { packageScripts: true })
})

test("verify still rejects a fixture with no upstream pack receipt", async () => {
  await fixture(async ({ run }) => {
    const result = await verify({ run, batch: "01" })
    assert.equal(result.checks.foreignFiles, true)
    assert.equal(result.checks.packs, false)
    assert.equal(result.ok, false)
    assert.ok(result.packs.reason.includes(packCorpus.missingBaselineReason))
  }, { packBaseline: false })
})
