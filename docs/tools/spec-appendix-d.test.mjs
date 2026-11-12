import assert from "node:assert/strict"
import test from "node:test"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { chapter, read, repo } from "./spec-witness.mjs"

// Appendix D's flipping procedure must match what check-snippets compares: it
// takes a block's expected codes only from an `// expect-error:` header, so a
// stale marker proves a promised code only once the header lists it.
const appendixD = () => chapter("900-appendices").split("## Appendix D.")[1].split("\n## ")[0]

test("check-snippets reads expected codes only from expect-error and expect-warning headers", () => {
  const checker = read("docs/tools/check-snippets.ts")
  const reads = checker.split("\n").filter(line => /^\s*expected:/.test(line))
  assert.equal(reads.length, 1)
  assert.match(reads[0], /header\.matchAll\(\/\\\/\\\/ expect-\(\?:error\|warning\):/)
  assert.doesNotMatch(reads[0], /source/)
})

test("Appendix D lists the promised codes in that header before a marker is deleted", () => {
  const steps = appendixD()
  assert.doesNotMatch(steps, /the compiler now accepts it/)
  assert.match(steps, /reads expected codes only from that header, not from trailing comments/)
  assert.match(steps, /Write every code the block's comments promise in an `\/\/ expect-error:` header/)
  assert.match(steps, /Delete the block's `\/\/ compiler-gap: pending VIP-N` line only if it still passes/)
})

test("the Appendix D witness is a 001 rule the block states in a trailing comment", () => {
  const functions = chapter("001-functions")
  assert.match(functions, /effect function n\(\): number \{ return 1 \} +\/\/ EK0106/)
  assert.match(appendixD(), /`effect function n\(\): number \{ return 1 \}   \/\/ EK0106` reports stale/)
})

// The gate's snippet step checks the specification, so a compiler-gap marker
// whose block now compiles fails the gate instead of going stale unnoticed.
test("the //:snippets gate target checks the specification's examples", () => {
  const target = read("PACKAGE.ts").split("\n  snippets: check(")[1].split("\n  ),")[0]
  assert.match(target, /bun docs\/tools\/check-snippets\.ts && bun docs\/tools\/check-snippets\.ts --root docs\/design\/src/)
  assert.match(appendixD(), /The snippet step of the merge queue's gate runs the command above on every change, so a stale marker fails the gate/)
})

// Known limitations lists the VIPs whose specification examples still carry a
// compiler-gap marker, so the page changes whenever a marker is added or removed.
test("known limitations names exactly the VIPs of the remaining compiler-gap markers", () => {
  const chapters = readdirSync(join(repo, "docs/design/src")).filter(name => name.endsWith(".md")).map(name => name.slice(0, -3))
  const marked = new Set(chapters.flatMap(name => [...chapter(name).matchAll(/^\s*\/\/ compiler-gap: pending ([^\n]+)$/gm)]
    .flatMap(m => m[1].match(/VIP-\d+/g) ?? [])))
  const page = read("docs/user/src/setup/known-limitations.md").split("## Specification examples the compiler does not pass yet")[1]
  assert.ok(page, "known-limitations.md lists the specification's compiler gaps")
  const listed = new Set([...page.split("\n## ")[0].matchAll(/^- (VIP-\d+):/gm)].map(m => m[1]))
  assert.deepEqual([...listed].sort(), [...marked].sort())
})
