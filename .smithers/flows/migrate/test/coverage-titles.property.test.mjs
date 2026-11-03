import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { comparableTests, compareTests } from "../lib/tests.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-mobile-coverage-titles.json", import.meta.url)))
const clean = { ok: true, newFailures: [], missing: [], fixed: [] }
const prefix = "apps/mobile/src/reactCompilerCoverage.test > React Compiler coverage compiles "
const receipt = tests => ({ code: 0, tests })

test("t3code Mobile: compiled coverage case titles keep the selected source identity", () => {
  assert.deepEqual(compareTests(receipt(corpus.baseline), receipt(corpus.current), corpus), clean)
  assert.equal(compareTests(receipt(corpus.baseline), receipt(corpus.current)).ok, false, "unrecorded renames are not excused")
})

// Decision B: "Its selected paths, mapped to base names, must have exactly the same count and names before and after."
// Test titles enumerate those paths too; changes in status, membership and multiplicity still fail.
test("coverage title renames preserve status, membership and multiplicity", () => {
  fc.assert(fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z][a-z-]{0,14}$/), { minLength: 1, maxLength: 12 }),
    fc.constantFrom(["ts", "vibe"], ["tsx", "vibex"]), fc.boolean(), (names, [fromExt, toExt], failed) => {
      const renames = names.map(name => ({ from: `apps/mobile/src/connection/${name}.${fromExt}`, to: `apps/mobile/src/connection/${name}.${toExt}` }))
      const titles = ext => Object.fromEntries(names.map(name => [prefix + `src/connection/${name}.${ext}`, "passed"]))
      const before = receipt(titles(fromExt)), after = receipt(titles(toExt))
      assert.deepEqual(compareTests(before, after, { renames }), clean)
      const normalized = comparableTests(after.tests, { renames })
      after.tests[prefix + `src/connection/${names[0]}.${toExt}`] = "skipped"
      assert.equal(Object.keys(normalized).length, names.length)
      assert.ok(Object.values(comparableTests(after.tests, { renames })).includes("skipped"))
      after.tests = titles(toExt)
      const first = prefix + `src/connection/${names[0]}.${toExt}`
      if (failed) after.tests[first] = "failed"
      else delete after.tests[first]
      const diff = compareTests(before, after, { renames })
      assert.equal(diff.ok, false)
      assert.equal(diff[failed ? "newFailures" : "missing"].length, 1)
      const duplicate = receipt({ ...titles(toExt), [prefix + `src/connection/${names[0]}.${fromExt}`]: "passed" })
      assert.equal(compareTests(duplicate, before, { renames }).ok, false, "normalization cannot erase an enumerated case")
    }), { seed: 1202986, numRuns: 400 })
})

test("only unambiguous recorded source paths change identity", () => {
  const renames = [{ from: "a/src/main.ts", to: "a/src/main.vibe" }, { from: "b/src/main.tsx", to: "b/src/main.vibex" }]
  assert.equal(compareTests(receipt({ "f > src/main.ts": "passed" }), receipt({ "f > src/main.vibe": "passed" }), { renames }).ok, false, "ambiguous package-relative paths cannot map")
  const before = receipt({ "f > src/main.ts": "passed", "f > output.ts": "passed" })
  const after = receipt({ "f > src/main.vibe": "passed", "f > output.vibe": "passed" })
  assert.equal(compareTests(before, after, { renames }).ok, false)
  assert.equal(compareTests(receipt({ "f > a/src/main.ts": "passed" }), receipt({ "f > a/src/main.vibe": "passed" }), { renames }).ok, true)
  assert.equal(compareTests(receipt({ "f > src/main.ts": "passed" }), receipt({ "f > src/main.d.vibe.ts": "passed" }), { renames }).ok, false)
})
