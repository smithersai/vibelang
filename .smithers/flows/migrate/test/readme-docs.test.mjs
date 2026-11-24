// Issue #511: the README showed stray `#` paragraphs and counted four eval
// scores where eval.ts defines five.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
const evalSource = readFileSync(new URL("../eval.ts", import.meta.url), "utf8")

/** Lines outside fenced code that start with `#` and no space: not a heading, shown as a stray `#`. */
export function strayHashes(markdown) {
  let fenced = false
  return markdown.split("\n").flatMap((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return [] }
    return !fenced && /^#[^# ]/.test(line) ? [`${i + 1}: ${line.slice(0, 40)}`] : []
  })
}

test("strayHashes skips headings and fenced code", () => {
  assert.deepEqual(strayHashes("# A\n## B\n```sh\n#!/bin/sh\n```\n#C"), ["6: #C"])
})

test("no README line outside a code fence starts with a stray #", () => {
  assert.deepEqual(strayHashes(readme), [])
})

test("the README counts the eval's scores as eval.ts defines them", () => {
  const bound = evalSource.match(/bindings: \[([^\]]*)\]/)
  assert.ok(bound, "eval.ts binds its scorers in one array")
  const count = bound[1].split(",").length
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven"]
  assert.match(readme, new RegExp(`compares ${words[count]} scores with \`baseline.json\``))
})
