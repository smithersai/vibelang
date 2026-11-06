import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")

// Only VibeLang-owned test files in shared upstream packages. Whole-package
// targets already cover parser/format tests; project and tsoptions use a
// bounded -run selector so optional upstream fixtures are not prerequisites.
function ownedTests() {
  const tests = []
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir + "/", root), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== "testdata" && !entry.name.startsWith("vibelang")) walk(dir + "/" + entry.name)
      if (entry.isFile() && /^vibelang.*_test\.go$/.test(entry.name)) {
        const file = dir + "/" + entry.name
        for (const match of read(file).matchAll(/^func ((?:Test|Fuzz)\w+)\(/gm)) {
          tests.push({ file, pkg: "./" + dir.replace("typescript/tsc/", ""), name: match[1] })
        }
      }
    }
  }
  walk("typescript/tsc/internal")
  return tests
}

function selections(source) {
  return [...source.matchAll(/^\s*"([^"]+)": goTest\("[^"]*", "([^"]+)", "([^"]+)"(?:, "([^"]+)")?\)/gm)]
    .map(([, target, pattern, inputs, run]) => ({ target, pattern, inputs, run }))
}
const covers = (pattern, pkg) => pattern === pkg ||
  pattern.endsWith("/...") && (pkg === pattern.slice(0, -4) || pkg.startsWith(pattern.slice(0, -3)))
const selects = (selection, test) => covers(selection.pattern, test.pkg) &&
  (!selection.run || new RegExp(selection.run).test(test.name))

const inputsCover = (selection, test) => covers(selection.pattern, test.pkg) &&
  selection.inputs === selection.pattern.replace(/\/\.\.\.$/, "").replace(/^\.\//, "")

const tests = ownedTests()
const selected = selections(read("typescript/tsc/PACKAGE.ts"))

test("every VibeLang test in a shared Go package runs in full validation", () => {
  assert.ok(tests.length >= 6, "only " + tests.length + " tests discovered")
  assert.deepEqual(tests.filter((test) => !selected.some((selection) => selects(selection, test))), [],
    "Go dependencies do not run their tests: select every VibeLang-owned regression")
})

test("shared-package selections include the test files in their cache inputs", () => {
  assert.match(read("typescript/tsc/PACKAGE.ts"), /data:\s*\[srcs, files\(dir\)\]/)
  for (const test of tests) {
    for (const selection of selected.filter((selection) => selects(selection, test))) {
      assert.ok(inputsCover(selection, test), test.file + ": " + selection.target)
    }
  }
})

test("recursive target inputs cover child tests without accepting sibling or mismatched roots", () => {
  for (let index = 0; index < 128; index++) {
    const dir = "internal/cacheRoot" + index
    const source = '"child": goTest("coverage", "./' + dir + '/...", "' + dir + '")'
    const [selection] = selections(source)
    const child = { pkg: "./" + dir + "/nested", name: "TestVibeLangChild" }
    assert.ok(inputsCover(selection, child), "recursive inputs include " + child.pkg)
    assert.equal(inputsCover(selection, { ...child, pkg: "./" + dir + "-sibling" }), false)
    assert.equal(inputsCover({ ...selection, inputs: dir + "/nested" }, child), false, "key the declared root")
    assert.equal(inputsCover({ ...selection, inputs: "internal" }, child), false, "avoid unrelated test inputs")
    assert.equal(inputsCover({ ...selection, pattern: "./" + dir }, child), false, "exact packages exclude children")
  }
})

test("filtered shared targets run all owned tests without selecting upstream fixtures", () => {
  for (const pkg of ["./internal/ast", "./internal/project", "./internal/tsoptions", "./internal/tspath"]) {
    const targets = selected.filter((selection) => covers(selection.pattern, pkg))
    assert.ok(targets.length > 0, pkg + " has no validation target")
    for (const selection of targets) {
      assert.ok(selection.run?.startsWith("^"), selection.target + ": anchor the owned selector")
      for (const name of ["TestParseConfig", "TestReloadProjects", "TestManifestChangeRebuildsTheProgramOther", "TestNotVibeLang"]) {
        assert.equal(selects(selection, { pkg, name }), false, selection.target + " selects unrelated " + name)
      }
    }
  }
})

test("inventory detects a dropped or narrowed target and respects package boundaries", () => {
  const witnesses = tests.filter(({ pkg }) => /\/(?:ast|project|tsoptions|tspath)$/.test(pkg))
  assert.ok(witnesses.length >= 6)
  for (const witness of witnesses) {
    assert.equal(selected.filter((selection) => selects(selection, witness)).length, 1, witness.name)
    const narrowed = selected.map((selection) => ({ ...selection, run: "^TestNoOwnedWitness$" }))
    assert.equal(narrowed.some((selection) => selects(selection, witness)), false)
  }
  assert.equal(covers("./internal/project/...", "./internal/projecttest"), false)
  assert.equal(covers("./internal/tsoptions", "./internal/tsoptions/sub"), false)
  assert.deepEqual(selections('// "fake": goTest("comment", "./internal/project", "internal/project")'), [])
})

test("generated package neighbours cannot steal an owned test selection", () => {
  let neighbours = 0
  for (const witness of tests.filter(({ pkg }) => /\/(?:ast|project|tsoptions|tspath)$/.test(pkg))) {
    for (let index = 0; index < 16; index++) {
      const wrong = { ...witness, pkg: witness.pkg + (index % 2 ? "/child" : "-sibling") + index }
      assert.equal(selected.some(selection => selects(selection, wrong)), false)
      assert.equal(selected.filter(selection => selects(selection, witness)).length, 1)
      neighbours++
    }
  }
  assert.ok(neighbours >= 128)
})
