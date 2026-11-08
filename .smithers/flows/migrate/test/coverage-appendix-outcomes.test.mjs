import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertBaselineSafe } from "../lib/baseline.mjs"
import { slug } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/setup-compile-outcomes.json", import.meta.url), "utf8"))
const rule = "A missing validation outcome is unverified: a later stage never inherits an earlier stage's exit."

test("setup outcome oracle quotes the published migration contract", () => {
  assert.ok(readFileSync(new URL("../../../../docs/user/src/setup/migrating-retired-forms.md", import.meta.url), "utf8").includes(rule))
})

function check({ outcome, beforeCode = 0, includeSetup = true, packageDir = ".", added = false, stale = false }) {
  const directory = mkdtempSync(join(tmpdir(), "setup-compile-outcome-"))
  try {
    const baseline = join(directory, "baseline")
    mkdirSync(baseline)
    const write = (name, value) => writeFileSync(join(baseline, name), JSON.stringify(value))
    const diagnostic = { category: "error", code: "EK3870", file: "src/main.vibe", line: 1, column: 1, message: "existing Effect diagnostic", notes: [] }
    const original = { compiler: "before", code: beforeCode, diagnostics: [diagnostic] }
    const diagnostics = added ? [diagnostic, { ...diagnostic, code: "TS2322", message: "new type error" }] : [diagnostic]
    write("upstream-checks.json", { [packageDir]: original })
    write("upgraded-checks.json", { [packageDir]: original })
    write("compile-" + slug(packageDir) + ".json", diagnostics)
    const receipt = "compile-" + slug(packageDir) + ".exit.json"
    if (Object.hasOwn(outcome, "receipt")) write(receipt, outcome.receipt)
    if (stale) write("admission.json", { state: "accepted", tests: [], compile: [] })
    const p = { baseline, upgrade: join(directory, "upgrade.json"), setup: join(directory, "setup.json") }
    const verified = Object.hasOwn(outcome, "code")
    const rejected = includeSetup && (!verified || added || (beforeCode === 0 && outcome.code !== 0))
    if (rejected) assert.throws(() => assertBaselineSafe(p, { includeSetup }), /toolchain baseline regression/)
    else assert.equal(assertBaselineSafe(p, { includeSetup }).state, "accepted")
    const admission = JSON.parse(readFileSync(join(baseline, "admission.json"), "utf8"))
    assert.equal(admission.state, rejected ? "rejected" : "accepted", outcome.key)
    const setup = admission.compile.filter(check => check.stage === "setup")
    assert.equal(setup.length, includeSetup ? 1 : 0)
    if (includeSetup && !verified) {
      assert.equal(setup[0].ok, false)
      assert.equal(setup[0].state, "unverified")
      assert.equal(setup[0].package, packageDir)
      assert.equal(setup[0].receipt, receipt)
      assert.match(setup[0].reason, /exit.*missing or invalid/)
    } else if (includeSetup) {
      assert.deepEqual(setup[0].exit, { before: beforeCode, after: outcome.code })
      assert.equal(setup[0].ok, !rejected)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

// docs/design/src/900-appendices.md#ec621828739d88fb — Chapter 900: unknown legacy setup outcome cannot inherit success.
// docs/design/src/900-appendices.md#97fe4d5b170cb165 — Chapter 900: unknown legacy setup outcome cannot inherit success.
// docs/design/src/900-appendices.md#d68e883b221ef8f1 — Chapter 900: unknown legacy setup outcome cannot inherit success.
test("Chapter 900: a missing setup outcome remains unverified", () => {
  check({ outcome: corpus.find(entry => entry.key === "missing") })
})
test("setup receipt neighbours retain real exits and expose unverified outcomes", () => {
  for (const outcome of corpus) for (const beforeCode of [0, 2]) for (const includeSetup of [false, true]) {
    check({ outcome, beforeCode, includeSetup, stale: true })
  }
})
test("property: each setup compile needs its own exit receipt across packages and diagnostics", () => {
  fc.assert(fc.property(fc.record({
    outcome: fc.constantFrom(...corpus),
    beforeCode: fc.constantFrom(0, 1, 2),
    includeSetup: fc.boolean(), packageDir: fc.constantFrom(".", "packages/core", "packages/space δ"),
    added: fc.boolean(), stale: fc.boolean(),
  }), check), { numRuns: 240, seed: 370900 })
})
