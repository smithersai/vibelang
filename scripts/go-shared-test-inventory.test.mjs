import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")

// Native command tests and VibeLang-owned files in shared upstream packages. Whole-package
// targets already cover parser/format tests; project and tsoptions use a
// bounded -run selector so optional upstream fixtures are not prerequisites.
function ownedTests() {
  const tests = []
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir + "/", root), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== "testdata" && !entry.name.startsWith("vibelang")) walk(dir + "/" + entry.name)
      const owned = dir.startsWith("typescript/tsc/cmd/tsc")
        ? /_test\.go$/.test(entry.name)
        : /^vibelang.*_test\.go$/.test(entry.name)
      if (entry.isFile() && owned) {
        const file = dir + "/" + entry.name
        for (const match of read(file).matchAll(/^func ((?:Test|Fuzz)\w+)\(/gm)) {
          tests.push({ file, pkg: "./" + dir.replace("typescript/tsc/", ""), name: match[1] })
        }
      }
    }
  }
  walk("typescript/tsc/internal")
  walk("typescript/tsc/cmd/tsc")
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

function duplicateTargetNames(entries) {
  const names = new Set(), duplicates = new Set()
  for (const { target } of entries) {
    if (names.has(target)) duplicates.add(target)
    names.add(target)
  }
  return [...duplicates].sort()
}

test("shared Go validation declares each target name once", () => {
  assert.deepEqual(duplicateTargetNames(selected), [],
    "duplicate object keys hide one declaration while the source inventory sees both")
})

test("target uniqueness rejects duplicate keys even with different packages and selectors", () => {
  for (let index = 0; index < 64; index++) {
    const name = "go-owned-" + index
    const first = '"' + name + '": goTest("unit", "./internal/one", "internal/one", "^TestOwned$")'
    const second = '"' + name + '": goTest("fuzz", "./internal/two", "internal/two", "^FuzzOwned$")'
    assert.deepEqual(duplicateTargetNames(selections(first + "\n" + second)), [name])
    const distinct = second.replace('"' + name + '"', '"' + name + '-neighbour"')
    assert.deepEqual(duplicateTargetNames(selections(first + "\n" + distinct)), [])
  }
})

test("generated equivalent target appends expose duplicates without matching comments", () => {
  for (let index = 0; index < 128; index++) {
    const name = "go-directive-" + index
    const first = '"'+name+'": goTest("directive recognition", "./internal/ast", "internal/ast", "^(Test|Fuzz)HasVibeLangDirective$")'
    const second = " ".repeat(index % 5) + '"'+name+'": goTest("source directive", "./internal/ast", "internal/ast", "^(TestHasVibeLangDirective|FuzzHasVibeLangDirective)$")'
    const newline = index % 2 ? "\r\n" : "\n"
    assert.deepEqual(duplicateTargetNames(selections(first + newline + second)), [name])
    assert.deepEqual(duplicateTargetNames(selections(first + newline + "// " + second)), [])
    assert.deepEqual(duplicateTargetNames(selections(first + newline + second.replace('"'+name+'"', '"'+name+'-other"'))), [])
  }
})

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

test("directive selection includes unit and fuzz witnesses without prefix matches", () => {
  const pkg = "./internal/ast"
  const target = selected.filter(selection => covers(selection.pattern, pkg))
  assert.equal(target.length, 1, "retain one directive target after declaration cleanup")
  for (const name of ["TestHasVibeLangDirective", "FuzzHasVibeLangDirective"]) {
    assert.equal(target.some(selection => selects(selection, { pkg, name })), true, name)
    for (let index = 0; index < 32; index++) {
      for (const neighbour of [name + "Extra" + index, "Prefix" + index + name]) {
        assert.equal(target.some(selection => selects(selection, { pkg, name: neighbour })), false, neighbour)
      }
    }
  }
})
