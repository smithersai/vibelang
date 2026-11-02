import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"

// //:spec-tests runs the Go tests that quote the specification (fuzz coverage RULES #9), so a spec commit that
// rewords a quoted rule fails its own gate instead of main after the merge. A quote test joins by its name: every
// Test...Quoted in the target's packages runs. Other tests join through the lists in PACKAGE.ts.
const root = new URL("../", import.meta.url)
const read = path => readFileSync(new URL(path, root), "utf8")

function specTests(source) {
  const target = source.slice(source.indexOf('"spec-tests": S.Shell.Test({'))
  const shell = target.slice(0, target.indexOf("data:"))
  const run = shell.match(/-run '([^']*)'/)[1]
  const lists = Object.fromEntries([...source.matchAll(/^const (\w+Tests) = \[([^\]]*)\]/gm)]
    .map(([, name, body]) => [name, [...body.matchAll(/"(Test\w+)"/g)].map(m => m[1])]))
  const pattern = run.replace(/\$\{\[([^\]]*)\]\.join\("\|"\)\}/, (_, spread) =>
    spread.split(",").map(s => s.trim().replace(/^\.\.\./, "")).flatMap(name => {
      assert.ok(lists[name], `${name} is not a list of test names in PACKAGE.ts`)
      return lists[name]
    }).join("|"))
  const packages = [...shell.matchAll(/ \.\/(internal\/[\w/]+)\//g)].map(m => "typescript/tsc/" + m[1])
  return { pattern: new RegExp(pattern), listed: Object.values(lists).flat(), packages }
}

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
