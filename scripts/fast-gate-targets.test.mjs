// The queue's build-only gate selects these targets by changed path. A renamed
// test leaves `go test -run` matching nothing and passing, and a moved file
// leaves the target checking nothing, so what each target names must exist.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const read = path => readFileSync(new URL(path, root), "utf8")
const pkg = read("PACKAGE.ts")
const target = name => {
  const start = pkg.indexOf(`"${name}":`)
  assert.notEqual(start, -1, `PACKAGE.ts declares //:${name}`)
  return pkg.slice(start, start + 400)
}

test("the archive target reads only its standalone Go files and corpus", () => {
  const catalog = read("typescript/tsc/PACKAGE.ts")
  assert.equal([...catalog.matchAll(/^[\t ]*"go-plugin-archive":/gm)].length, 1)
  const start = catalog.indexOf('"go-plugin-archive":')
  const end = catalog.indexOf("\n    }),", start)
  assert.ok(end > start, "the archive target has its own definition")
  const block = catalog.slice(start, end)
  assert.match(block, /cd typescript\/tsc\/internal\/vibelangfmt/)
  assert.match(block, /pack\.go pack_test\.go pack_concurrent_test\.go/)
  assert.match(block, /TestWriteArchive\|FuzzWriteArchiveTemporaryOwnership/)
  assert.match(block, /GOWORK=off/)
  assert.doesNotMatch(block, /go\.work|tools\/go\./)
  for (const moduleFile of ["go.mod", "go.sum"]) assert.ok(block.includes('S.file("' + moduleFile + '")'))
  assert.doesNotMatch(block, /\b(?:srcs|tree)\s*(?:,|\])|\bfiles\s*\(/)
  assert.ok(block.includes("internal/vibelangfmt/testdata/fuzz/FuzzWriteArchiveTemporaryOwnership/**"))
  for (const name of ["pack.go", "pack_test.go", "pack_concurrent_test.go"]) {
    assert.ok(block.includes('S.file("internal/vibelangfmt/' + name + '")'), name)
    const source = read("typescript/tsc/internal/vibelangfmt/" + name)
    if (name.endsWith("_test.go")) {
      const functions = [...source.matchAll(/^func ((?:Test|Fuzz)\w+)\(/gm)].map(match => match[1])
      assert.ok(functions.length > 0, name + " has executable tests")
      for (const name of functions) assert.match(name, /^(TestWriteArchive|FuzzWriteArchiveTemporaryOwnership)/)
    }
    const imports = source.match(/^import\s*\(([\s\S]*?)\n\)/m)?.[1] ??
      source.match(/^import\s+("[^"\n]+")/m)?.[1]
    assert.ok(imports, name + " declares its imports")
    const paths = [...imports.matchAll(/^[\t ]*(?:(?:[A-Za-z_]\w*|\.)[\t ]+)?"([^"]+)"/gm)].map(match => match[1])
    assert.ok(paths.length > 0, name)
    for (const path of paths) assert.ok(!path.split("/")[0].includes("."), name + " imports " + path)
  }
})

test("//:flow-layout runs the layout test that exists", () => {
  const [, file] = target("flow-layout").match(/node --test (\S+\.test\.mjs)/)
  assert.ok(existsSync(new URL(file, root)), file)
})

test("//:grammar-inventory tests a package that stays on the standard library", () => {
  const [, dir] = target("grammar-inventory").match(/-trimpath \.\/(internal\/\S+)\//)
  const path = "typescript/tsc/" + dir + "/"
  const files = readdirSync(new URL(path, root)).filter(file => file.endsWith(".go"))
  assert.ok(files.some(file => file.endsWith("_test.go")), "the package has a test")
  // A repository import pulls in the compiler, and the target stops being fast.
  for (const file of files) assert.doesNotMatch(read(path + file), /"github\.com\//, file)
})

test("//:mapper-scripts matches the mapper's runner tests", () => {
  assert.match(target("mapper-scripts"), /scripts\/mapper-\*\.test\.mjs/)
  const found = readdirSync(new URL("scripts/", root)).filter(file => /^mapper-.*\.test\.mjs$/.test(file))
  for (const file of ["mapper-hover.test.mjs", "mapper-rpc.test.mjs"]) assert.ok(found.includes(file), file)
})

// These declarations deliberately use quoted literal names and goTest calls:
// duplicates are otherwise silently overwritten when Bun loads the graph.
const goTargetNames = source => [...source.matchAll(/^[\t ]*"([^"\r\n]+)":\s*goTest\(/gm)].map(match => match[1])
const duplicateGoTargets = source => {
  const seen = new Set(), repeated = new Set()
  for (const name of goTargetNames(source)) {
    if (seen.has(name)) repeated.add(name)
    seen.add(name)
  }
  return [...repeated].sort()
}

test("the Go target catalog declares each literal target once", () => {
  const source = read("typescript/tsc/PACKAGE.ts")
  const names = goTargetNames(source)
  for (const required of ["go-parser", "go-vibelangfmt"]) assert.ok(names.includes(required), required)
  assert.deepEqual(duplicateGoTargets(source), [], "a duplicate object key silently shadows a target")
})

test("the catalog guard catches distant duplicate declarations across generated layouts", () => {
  for (let index = 0; index < 128; index++) {
    const newline = index % 2 ? "\r\n" : "\n"
    const indent = index % 3 ? "    " : "\t"
    const name = "go-package-" + index
    const row = key => indent + '"' + key + '": goTest(' + newline + indent + '"summary", "./internal/pkg", "internal/pkg"),'
    const unique = [row(name), "// unrelated target", row(name + "-other")].join(newline)
    assert.deepEqual(duplicateGoTargets(unique), [])
    assert.deepEqual(duplicateGoTargets(unique + newline + row(name)), [name])
    assert.deepEqual(duplicateGoTargets(unique + newline + row(name + "-other") + newline + row(name)), [name, name + "-other"])
  }
})
