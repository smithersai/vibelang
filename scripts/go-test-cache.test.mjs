import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8")

// The build graph caches each Go test target, so Go's own test cache only adds work: before it stores a result,
// `go test` hashes every file the tests opened. The fuzz suite opens about 25 million, which kept
// //:go-vibelangfuzz busy on one core for some 14 minutes after its tests passed.
test("the repository-wide Go test targets bypass Go's test cache", () => {
  const calls = read("PACKAGE.ts").match(/go test [^`"]*/g)
  assert.ok(calls.length >= 5, calls.join("\n"))
  for (const call of calls) assert.match(call, /(^| )-count=1( |$)/, call)
})
