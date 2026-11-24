import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

// A lead that ends with a colon introduces the block right after it: a code
// block, a list or a table. A paragraph between them reads as the thing the
// colon announces.
function strandedLeads(text) {
  const lines = text.split("\n")
  const stranded = []
  let fenced = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("```")) { fenced = !fenced; continue }
    if (fenced || !lines[i].trim().endsWith(":")) continue
    let j = i + 1
    while (j < lines.length && lines[j].trim() === "") j++
    if (j < lines.length && !/^(```|\s*[-*|]|\s*\d+\.|    )/.test(lines[j])) stranded.push(`${i + 1}: ${lines[j].slice(0, 60)}`)
  }
  return stranded
}

test("a colon lead in chapters 000, 001, 003 and 900 is followed by what it introduces", () => {
  for (const name of ["000-intro", "001-functions", "003-failures", "900-appendices"]) {
    assert.deepEqual(strandedLeads(chapter(name)), [], name)
  }
})

// VIP-1/VIP-4 define the callable; a historical bullet order and compiler-gap
// comment are not part of that contract.
test("the current effectful-function example retains its executable counterpart", () => {
  const text = chapter("001-functions")
  const example = block(text, "effect function pick", "vibe es")
  assert.match(example, /effect function pick\(x: string\): string!!;/)
  assert.match(example, /effect function pick\(x: number\): number!!;/)
  const result = run(block(text, "// Overload-position counterpart"))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), '["ok",7]')
})
