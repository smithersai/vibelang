import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// Appendix D's flipping procedure must match what check-snippets compares: it
// takes a block's expected codes only from an `// expect-error:` header, so a
// stale marker proves a promised code only once the header lists it.
const appendixD = () => chapter("900-appendices").split("## Appendix D.")[1].split("\n## ")[0]

test("check-snippets reads expected codes only from an expect-error header", () => {
  const checker = read("docs/tools/check-snippets.ts")
  const reads = [...checker.matchAll(/expected: \[\.\.\.\(header\.match\(\/\\\/\\\/ ([a-z-]+):/g)].map(m => m[1])
  assert.deepEqual(reads, ["expect-error"])
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
