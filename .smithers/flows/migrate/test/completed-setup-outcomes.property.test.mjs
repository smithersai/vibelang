import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { assertBaselineSafe } from "../lib/baseline.mjs"
import { slug, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/completed-setup-outcomes.json", import.meta.url), "utf8"))
test("completed setup outcome oracle quotes the migration contract", () => {
  assert.ok(readFileSync(new URL("../../../../docs/user/src/setup/migrating-retired-forms.md", import.meta.url), "utf8").includes(corpus.quote))
})
function check({ completed = true, diagnostics = false, exit = false, includeSetup = true,
  beforeCode = 0, afterCode = 0, packageDir = ".", added = false, legacy = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "completed-setup-outcomes-"))
  try {
    const p = { baseline: join(root, "baseline"), setup: join(root, "setup.json"), upgrade: join(root, "upgrade.json") }
    mkdirSync(p.baseline)
    const before = { compiler: "original", code: beforeCode, diagnostics: [] }
    writeJson(join(p.baseline, "upstream-checks.json"), { [packageDir]: before })
    writeJson(join(p.baseline, "upgraded-checks.json"), { [packageDir]: before })
    if (completed) writeJson(p.setup, legacy ? {} : { compile: { [packageDir]: { errors: 0, warnings: 0 } } })
    if (diagnostics) writeJson(join(p.baseline, "compile-" + slug(packageDir) + ".json"),
      added ? [{ category: "error", code: "TS2322", file: packageDir + "/src/main.ts", line: 1, column: 1, message: "new type error", notes: [] }] : [])
    if (exit) writeJson(join(p.baseline, "compile-" + slug(packageDir) + ".exit.json"), { code: afterCode })
    writeJson(join(p.baseline, "admission.json"), { state: "accepted", compile: [] })
    const rejected = includeSetup && ((completed && !diagnostics) ||
      (diagnostics && (!exit || added || (beforeCode === 0 && afterCode !== 0))))
    if (rejected) assert.throws(() => assertBaselineSafe(p, { includeSetup }), /toolchain baseline regression/)
    else assert.equal(assertBaselineSafe(p, { includeSetup }).state, "accepted")
    const result = JSON.parse(readFileSync(join(p.baseline, "admission.json"), "utf8"))
    assert.equal(result.state, rejected ? "rejected" : "accepted")
    if (includeSetup && completed && !diagnostics) {
      const row = result.compile.find(row => row.stage === "setup")
      assert.equal(row.state, "unverified")
      assert.equal(row.package, packageDir)
      assert.equal(row.receipt, "setup.json")
      assert.match(row.reason, /completed setup.*compiler/)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("a completed setup cannot lose both compiler receipts", () => check())
test("completed and collecting setup states retain independent receipt requirements", () => {
  for (const variant of corpus.variants) for (const completed of [true, false]) for (const includeSetup of [true, false]) {
    check({ ...variant, completed, includeSetup })
  }
})
test("property: completed setup retains compiler evidence across receipt loss and legacy metadata", () => {
  fc.assert(fc.property(fc.record({
    completed: fc.boolean(), receipts: fc.boolean(), includeSetup: fc.boolean(),
    beforeCode: fc.constantFrom(0, 1, 2), afterCode: fc.constantFrom(0, 1, 2),
    packageDir: fc.constantFrom(".", "packages/core", "space δ"), added: fc.boolean(), legacy: fc.boolean(),
  }), ({ receipts, ...input }) => check({ ...input, diagnostics: receipts, exit: receipts })), { seed: 372900, numRuns: 220 })
})
