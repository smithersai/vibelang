import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"
import * as Jj from "../lib/jj.mjs"
import { must } from "../lib/util.mjs"
const steps = await import(process.env.MIGRATE_BASELINE_STEPS
  ? pathToFileURL(process.env.MIGRATE_BASELINE_STEPS) : new URL("../lib/steps.mjs", import.meta.url))
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-toolchain-collection-regression.json", import.meta.url)))
const put = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)) }
const failure = /toolchain baseline regression/

async function fixture(root, { testsFail = true, compilerFail = false } = {}) {
  const target = join(root, "target"), toolchain = join(root, "toolchain"), run = join(root, "run")
  put(join(target, "package.json"), { name: "foldkit-collection-corpus", type: "module", dependencies: { effect: "4.0.6" } })
  put(join(target, ".gitignore"), "node_modules/\ndist/\n")
  put(join(target, "tsconfig.json"), { compilerOptions: { types: [] }, include: ["src/**/*"] })
  put(join(target, "src/main." + (compilerFail ? "vibe" : "ts")), "export const value = 1\n")
  put(join(target, "vitest.mjs"), [
    'import { existsSync, readFileSync, writeFileSync } from "node:fs"',
    'const moved = JSON.parse(readFileSync("package.json")).dependencies.effect !== "4.0.6"',
    'const failed = (moved && ' + testsFail + ') || existsSync("setup-marker")',
    'const files = ' + JSON.stringify(corpus.files),
    'const report = { testResults: files.map(file => ({ name: process.cwd() + "/" + file, status: failed ? "failed" : "passed", assertionResults: [] })) }',
    'writeFileSync(process.argv.find(arg => arg.startsWith("--outputFile.json=")).split("=").slice(1).join("="), JSON.stringify(report))',
    'process.exit(failed ? 2 : 0)'
  ].join("\n"))
  put(join(toolchain, "toolchain.json"), { version: "0.0.11", effect: "4.1.0", compiler: "native/vibelang", packages: {} })
  for (const [file, name, broken] of [[join(target, "node_modules/.bin/vibelang"), "previous", false],
    [join(toolchain, "native/vibelang"), "candidate", compilerFail]]) {
    put(file, '#!/bin/sh\nif [ "$1" = --version ]; then echo ' + name + '; exit 0; fi\n' +
      (broken ? 'echo "src/main.vibe(1,1): error EK4402: HTMLElement is platform code"; exit 2\n' : "exit 0\n"))
    chmodSync(file, 0o755)
  }
  symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
  const base = await Jj.commit(target, "unchanged original sources and tests")
  return { target, toolchain, run, base, packages: ["."], test: "node vitest.mjs", install: "true", wire: false }
}

test("foldkit-104: a real toolchain upgrade cannot absorb new collection failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "foldkit-toolchain-baseline-"))
  try {
    const options = await fixture(root), p = steps.paths(options.run)
    await assert.rejects(steps.upgradeEffect(options), failure)
    const before = JSON.parse(readFileSync(join(p.baseline, "upstream-tests.json")))
    const after = JSON.parse(readFileSync(join(p.baseline, "upgraded-tests.json")))
    assert.equal(before.code, corpus.beforeCode); assert.equal(after.code, corpus.afterCode)
    assert.equal(Object.values(before.tests).every(s => s === "passed"), true)
    assert.equal(Object.values(after.tests).every(s => s === "failed"), true)
    assert.equal(JSON.parse(readFileSync(p.upgrade)).regressions.newFailures.length, corpus.files.length)
    for (const action of ["upgradeEffect", "setup", "plan", "codemod", "verify", "record"]) {
      await assert.rejects(steps[action]({ ...options, batch: "01" }), failure, action + " must preserve the rejected verdict")
    }
    assert.equal(JSON.parse(readFileSync(join(p.baseline, "admission.json"))).state, "rejected")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("foldkit-104: compiler errors fail the switch even when every test stays green", async () => {
  const root = mkdtempSync(join(tmpdir(), "foldkit-toolchain-compile-"))
  try {
    const options = await fixture(root, { testsFail: false, compilerFail: true }), p = steps.paths(options.run)
    await assert.rejects(steps.upgradeEffect(options), failure)
    const admission = JSON.parse(readFileSync(join(p.baseline, "admission.json")))
    assert.equal(admission.tests.every(check => check.ok), true)
    assert.equal(admission.compile[0].newErrors[0].code, corpus.diagnostic)
    const before = JSON.parse(readFileSync(join(p.baseline, "upstream-checks.json")))["."]
    const after = JSON.parse(readFileSync(join(p.baseline, "upgraded-checks.json")))["."]
    assert.equal(before.compiler.version, "previous")
    assert.equal(after.compiler.version, "candidate")
    assert.deepEqual([before.code, after.code], [0, 2])
    await assert.rejects(steps.setup(options), failure)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("foldkit-104: a clean actual upgrade still completes", async () => {
  const root = mkdtempSync(join(tmpdir(), "foldkit-toolchain-clean-"))
  try {
    const options = await fixture(root, { testsFail: false })
    const result = await steps.upgradeEffect(options)
    assert.equal(result.tests.code, 0)
    assert.equal(result.tests.failed.length, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("foldkit-104: generated baseline reports retain new failures, missing tests, exit failures and compiler diagnostics", async () => {
  const { assertBaselineSafe } = await import("../lib/baseline.mjs")
  const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  assert.ok(contract.includes("A toolchain switch must not turn new test failures or compiler errors into the next baseline."))
  const root = mkdtempSync(join(tmpdir(), "foldkit-baseline-property-"))
  try {
    const p = steps.paths(root)
    fc.assert(fc.property(fc.record({ oldFailed: fc.boolean(), newFailed: fc.boolean(), missing: fc.boolean(),
      beforeCode: fc.constantFrom(0, 2), afterCode: fc.constantFrom(0, 2),
      oldError: fc.boolean(), newError: fc.boolean() }), input => {
      const status = failed => failed ? "failed" : "passed"
      const before = { code: input.beforeCode, tests: { witness: status(input.oldFailed), steady: "passed" } }
      const after = { code: input.afterCode, tests: { ...(input.missing ? {} : { witness: status(input.newFailed) }), steady: "passed" } }
      put(join(p.baseline, "upstream-tests.json"), before)
      put(join(p.baseline, "upgraded-tests.json"), after)
      const diagnostic = { category: "error", code: "EK4402", file: "src/main.vibe", line: 1, column: 1, message: "platform code", notes: [] }
      put(join(p.baseline, "upstream-checks.json"), { ".": { compiler: "old", code: input.oldError ? 2 : 0, diagnostics: input.oldError ? [diagnostic] : [] } })
      put(join(p.baseline, "upgraded-checks.json"), { ".": { compiler: "new", code: input.newError ? 2 : 0, diagnostics: input.newError ? [diagnostic] : [] } })
      const refused = (!input.missing && input.newFailed && !input.oldFailed) ||
        (input.missing && !input.oldFailed) || (input.beforeCode === 0 && input.afterCode !== 0) || (input.newError && !input.oldError)
      if (refused) assert.throws(() => assertBaselineSafe(p), failure)
      else assert.equal(assertBaselineSafe(p).state, "accepted")
    }), { seed: 1044402, numRuns: 250 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("foldkit-104: setup rejects newly failing tests before any declaration baseline is written", async () => {
  const root = mkdtempSync(join(tmpdir(), "foldkit-setup-baseline-"))
  try {
    const options = await fixture(root, { testsFail: false }), p = steps.paths(options.run)
    await steps.upgradeEffect(options)
    put(join(options.target, "setup-marker"), "simulate loader failure only after setup")
    await assert.rejects(steps.setup(options), failure)
    const admission = JSON.parse(readFileSync(join(p.baseline, "admission.json")))
    assert.equal(admission.state, "rejected")
    assert.ok(admission.tests.some(check => check.stage === "setup" && !check.ok))
    for (const action of ["setup", "plan", "codemod", "verify", "record"]) {
      await assert.rejects(steps[action]({ ...options, batch: "01" }), failure)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("foldkit-104: legacy receipts cannot hide a recorded failed toolchain switch", async () => {
  const root = mkdtempSync(join(tmpdir(), "foldkit-legacy-baseline-"))
  try {
    const p = steps.paths(root)
    put(p.upgrade, { regressions: { newFailures: ["collection"], missing: [], exit: { before: 0, after: 2 } } })
    await assert.rejects(steps.setup({ run: root }), failure)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// smithers: both compiles print EK3870 as an error and exit 0; admission
// compared the real 0 with a code derived from the categories (2).
test("smithers: setup's admission compares the compiles' real exit codes, so Effect diagnostics that exit 0 pass", async () => {
  const { assertBaselineSafe } = await import("../lib/baseline.mjs")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-baseline-effect-error-exit.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "smithers-baseline-exit-"))
  try {
    const p = steps.paths(root)
    const slug = corpus.package.replaceAll("/", "__")
    const checks = (code) => ({ [corpus.package]: { compiler: "vibelang", code, diagnostics: corpus.diagnostics } })
    fc.assert(fc.property(fc.record({ before: fc.constantFrom(0, 2), after: fc.constantFrom(0, 2, null), added: fc.boolean() }), (input) => {
      rmSync(p.baseline, { recursive: true, force: true })
      put(join(p.baseline, "upstream-checks.json"), checks(input.before))
      put(join(p.baseline, "upgraded-checks.json"), checks(input.before))
      const extra = { category: "error", code: "TS2322", file: "src/New.ts", line: 1, column: 1, message: "new", notes: [] }
      put(join(p.baseline, `compile-${slug}.json`), input.added ? [...corpus.diagnostics, extra] : corpus.diagnostics)
      // null: a receipt from before setup recorded its exit code.
      if (input.after !== null) put(join(p.baseline, `compile-${slug}.exit.json`), { code: input.after })
      const refused = input.added || (input.before === 0 && input.after === 2)
      if (refused) assert.throws(() => assertBaselineSafe(p), failure)
      else assert.equal(assertBaselineSafe(p).state, "accepted")
    }), { seed: 3870, numRuns: 60 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
