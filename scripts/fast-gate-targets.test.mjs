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
