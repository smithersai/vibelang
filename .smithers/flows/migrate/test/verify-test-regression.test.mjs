import "./helpers/jj-config.mjs"
// verify must refuse a batch whose candidate regresses the target's own tests,
// read through a real runner's per-test report, not a hand-built map.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { packRepository } from "../lib/pack-policy.mjs"
import { makeConfig, paths, verify } from "../lib/steps.mjs"
import { runTests } from "../lib/tests.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))

// The runner is Node's own, with the spec reporter's top-level lines read as
// the per-test report. node_modules is ignored, so changing the mode file is
// not a foreign edit: only the test verdict can refuse the batch.
const command = "if [ \"$(cat node_modules/.mode)\" = crash ]; then exit 3; fi; node --test --test-reporter=spec t.test.mjs"
const report = "^(?<status>✔|✖|﹣) (?<name>.+?) \\(\\d[\\d.]*m?s\\)"
const suite = `import { test } from "node:test"
import { readFileSync } from "node:fs"
const mode = readFileSync("node_modules/.mode", "utf8").trim()
test("alpha", () => {})
test("beta", { skip: mode === "skip" }, () => { if (mode === "fail") throw new Error("beta regressed") })
`

async function fixture(mode, action) {
  const root = mkdtempSync(join(tmpdir(), "migrate-verify-tests-"))
  const target = join(root, "repo"), run = join(root, "run")
  try {
    mkdirSync(join(target, "src"), { recursive: true })
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(target, "node_modules/typescript"))
    writeJson(join(target, "package.json"), { private: true, type: "module" })
    writeJson(join(target, "tsconfig.json"), { include: ["src/**/*.ts", "src/**/*.vibe"] })
    writeFileSync(join(target, ".gitignore"), "node_modules/\n")
    writeFileSync(join(target, "src/main.ts"), "export const value = 1\n")
    writeFileSync(join(target, "t.test.mjs"), suite)
    writeFileSync(join(target, "node_modules/.mode"), "pass\n")
    writeFileSync(join(target, "node_modules/.bin/vibelang"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await must("jj commit -m fixture", { cwd: target })
    const p = paths(run)
    // The baseline is what the same runner reports before any file moves.
    const baseline = await runTests({ command, report, cwd: target, root: target, jsonFile: join(run, "baseline.json") })
    assert.deepEqual(baseline.tests, { alpha: "passed", beta: "passed" })
    writeJson(join(p.baseline, "tests.json"), baseline)
    writeJson(join(p.baseline, "upstream-packs.json"), await packRepository({ target }, join(run, "upstream-packs")))
    renameSync(join(target, "src/main.ts"), join(target, "src/main.vibe"))
    writeJson(p.config, makeConfig({ target, test: command, testReport: report, vibelangVersion: "0.0.11" }))
    writeJson(p.plan, { batches: [{ files: ["src/main.ts"] }] })
    writeJson(p.inventory, { files: [{ path: "src/main.ts", tokens: 1 }] })
    writeJson(join(p.baseline, "compile-" + slug(".") + ".json"), [])
    writeFileSync(join(target, "node_modules/.mode"), mode + "\n")
    const result = await verify({ run, batch: "01" })
    assert.equal(result.checks.foreignFiles, true, "the mode file is not a foreign edit")
    return action(result)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("verify accepts a candidate whose real test report matches the baseline", async () => {
  await fixture("pass", result => {
    assert.equal(result.checks.tests, true)
    assert.equal(result.ok, true)
  })
})

test("verify refuses a candidate in which one test now fails", async () => {
  await fixture("fail", result => {
    assert.equal(result.checks.tests, false)
    assert.equal(result.ok, false)
    assert.deepEqual(result.tests.newFailures, ["beta"])
  })
})

test("verify refuses a candidate in which a passing test is now skipped", async () => {
  await fixture("skip", result => {
    assert.equal(result.checks.tests, false)
    assert.equal(result.ok, false)
    assert.deepEqual(result.tests.skipped, ["beta"])
  })
})

test("verify refuses a candidate whose runner exits nonzero with no report", async () => {
  await fixture("crash", result => {
    assert.equal(result.checks.tests, false)
    assert.equal(result.ok, false)
    assert.deepEqual(result.tests.missing, ["alpha", "beta"])
  })
})
