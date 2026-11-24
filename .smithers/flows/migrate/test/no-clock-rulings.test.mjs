// Issue #640: a test justified by "the 18:45Z ruling" names no date, document or
// decision, so a contributor cannot find the rule when the test fails. A rule a
// test enforces lives in rules.md, the README or the specification, and the test
// asserts the quote is still there.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const dir = fileURLToPath(new URL(".", import.meta.url))

/** Lines that cite a ruling by a clock time with no date before it. */
export function clockRulings(source) {
  const undated = /(?<![\dT]|\d{4}-\d{2}-\d{2} )\b\d{1,2}:\d{2}(?::\d{2})?Z\b/
  return source.split("\n").flatMap((line, i) =>
    /\bruling\b/i.test(line) && undated.test(line) ? [i + 1 + ": " + line.trim()] : [])
}

test("clockRulings finds undated clock-time rulings and accepts dated ones", () => {
  assert.equal(clockRulings('// foldkit agent\'s accepted 18:45Z ruling: "x"').length, 1)
  assert.equal(clockRulings('"source": "selector; accepted 04:40Z ruling requires names"').length, 1)
  assert.deepEqual(clockRulings("// spec ruling 2026-11-01T09:50Z\n// decide-live 2026-11-01 04:09Z ruling"), [])
  assert.deepEqual(clockRulings("// drive-t3code 17:46Z: a counterexample\n// The rule: rules.md"), [])
})

test("no migrate test or corpus file cites a ruling by clock time alone", () => {
  const found = []
  for (const sub of ["", "corpus"]) {
    for (const name of readdirSync(join(dir, sub)).filter(n => /\.(mjs|json)$/.test(n)).sort()) {
      if (name === "no-clock-rulings.test.mjs") continue
      for (const line of clockRulings(readFileSync(join(dir, sub, name), "utf8"))) found.push(join(sub, name) + ":" + line)
    }
  }
  assert.deepEqual(found, [])
})
