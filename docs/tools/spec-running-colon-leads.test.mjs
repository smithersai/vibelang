import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"

// A prose paragraph ending in a colon introduces the block right after it: a list, a table or a code block.
function strandedLeads(text) {
  const lines = text.split("\n")
  const stranded = []
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith("```")) { fence = !fence; continue }
    if (fence || !line.trim().endsWith(":") || /^\s*([-|#]|\d+\.)/.test(line)) continue
    let j = i + 1
    while (j < lines.length && !lines[j].trim()) j++
    if (!/^(```|- |\| |\d+\. |<a )/.test(lines[j] ?? "")) stranded.push(`${i + 1}: ${line.slice(0, 60)}`)
  }
  return stranded
}

for (const name of ["002-running", "003-failures"]) {
  test(`every colon lead in ${name} is followed by the block it introduces`, () => {
    assert.deepEqual(strandedLeads(chapter(name)), [])
  })
}
