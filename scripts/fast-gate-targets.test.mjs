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
