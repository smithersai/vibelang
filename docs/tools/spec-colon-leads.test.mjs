import assert from "node:assert/strict"
import test from "node:test"
import { chapter } from "./spec-witness.mjs"

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

test("a colon lead in chapters 000, 001 and 900 is followed by what it introduces", () => {
  for (const name of ["000-intro", "001-functions", "900-appendices"]) {
    assert.deepEqual(strandedLeads(chapter(name)), [], name)
  }
})

test("the effectful-function bullet is followed by its example", () => {
  const text = chapter("001-functions")
  const lead = "- A plain `.vibe` function that returns an Effect, a Stream or a Layer is effectful, so it can't throw ("
  const after = text.slice(text.indexOf(lead)).split("\n\n")[1]
  assert.match(after, /^```vibe es\n\/\/ compiler-gap: pending VIP-4\nexport function bad/)
  const contract = text.indexOf("Ordinary nongenerator `async` callables use the [normalized async contract]")
  assert.ok(contract !== -1 && contract < text.indexOf(lead))
})
