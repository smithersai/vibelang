import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"
import { specTestSelection as specTests } from "./spec-test-selection.mjs"

// //:spec-tests runs the Go tests that quote the specification (fuzz coverage RULES #9), so a spec commit that
// rewords a quoted rule fails its own gate instead of main after the merge. A quote test joins by its name: every
// Test...Quoted in the target's packages runs. Other tests join through the lists in PACKAGE.ts.
const root = new URL("../", import.meta.url)
const read = path => readFileSync(new URL(path, root), "utf8")


function goTests(packages) {
  const names = new Set()
  for (const dir of packages)
    for (const file of readdirSync(new URL(dir, root)).filter(f => f.endsWith("_test.go")))
      for (const m of read(`${dir}/${file}`).matchAll(/^func (Test\w*)\(t \*testing\.T\)/gm)) names.add(m[1])
  return names
}

test("every quote test in the target's packages runs in //:spec-tests", () => {
  const { pattern, packages } = specTests(read("PACKAGE.ts"))
  assert.ok(packages.length >= 3, packages.join(" "))
  const quoted = [...goTests(packages)].filter(name => name.endsWith("Quoted"))
  assert.ok(quoted.length >= 50, `found ${quoted.length} quote tests`)
  assert.deepEqual(quoted.filter(name => !pattern.test(name)), [])
})

test("a quote test needs no list entry: the pattern selects it by name", () => {
  const { pattern } = specTests(read("PACKAGE.ts"))
  assert.ok(pattern.test("TestSomeChapterRuleQuoted"))
  assert.ok(!pattern.test("TestSomeChapterRule"))
  assert.ok(!pattern.test("TestQuotedRulesAreLong"))
})

// go test -run with a name that matches no test passes, so a misspelled or renamed list entry would run nothing.
test("every listed name is a test in the target's packages", () => {
  const { listed, packages } = specTests(read("PACKAGE.ts"))
  const names = goTests(packages)
  assert.deepEqual(listed.filter(name => !names.has(name)), [])
})

// Merge-queue rejections on PACKAGE.ts came from lanes appending quote tests next to each other in this list (34 of
// the last 400 rejections). The pattern already runs every quote test, so a listed one only invites that conflict.
test("no list names a quote test: the pattern runs it", () => {
  const { listed } = specTests(read("PACKAGE.ts"))
  assert.deepEqual(listed.filter(name => name.endsWith("Quoted")), [])
})
