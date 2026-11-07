import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { analyze, collect, report, start } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const tick = String.fromCharCode(96)
const label = "//:example"
const prefix = "| " + tick + label + tick + " | "
const at = "2020-01-01T00:00:00.000Z"

function checkCells(pairs) {
  const dir = mkdtempSync(join(tmpdir(), "ci-health-report-cells-"))
  try {
    const names = pairs.map(pair => pair[0])
    const analysis = {
      runs: 4,
      flaky: [{ label, keys: 1, failures: 2, passes: 2, last: at, causes: { assertion: 2 },
        tests: names.map(name => ({ name, failures: 2, last: at })) }],
      intermittent: names.map(name => ({ label, name, failures: 2, returns: 1, last: at })),
      slow: [], regressed: []
    }
    writeFileSync(join(dir, "options.json"), "{}")
    writeFileSync(join(dir, "analyze.json"), JSON.stringify(analysis))
    const result = report(dir)
    assert.deepEqual(result.tests, names, "raw failure names remain in the saved result")
    assert.deepEqual(result.intermittent, names)
    const saved = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"))
    assert.deepEqual(saved, result)
    const text = readFileSync(join(dir, "report.md"), "utf8")
    const flaky = text.split("## Flaky tests\n")[1].split("## Intermittent tests\n")[0]
    const intermittent = text.split("## Intermittent tests\n")[1].split("## Slower targets\n")[0]
    for (const section of [flaky, intermittent]) {
      const rows = section.split(/\r\n|\r|\n|\u2028|\u2029/).filter(line => line.startsWith(prefix))
      assert.equal(rows.length, pairs.length, "every test occupies one complete row")
      for (const [, display] of pairs) {
        assert.ok(rows.some(row => row.startsWith(prefix + "<pre>" + display + "</pre> | 2 | ")),
          "the complete displayed name and count must share a row: " + JSON.stringify(display))
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("all newline forms keep failure counts inside both health-report tables", () => {
  checkCells([
    ["first\nsecond\r\nthird\rfourth\u2028fifth\u2029sixth | tail",
      "first<br>second<br>third<br>fourth<br>fifth<br>sixth \\| tail"],
    ["ordinary name", "ordinary name"]
  ])
})

test("generated multiline names retain row boundaries, pipes and unmodified saved names", () => {
  const text = fc.array(fc.constantFrom(..."abc XYZ012"), { minLength: 1, maxLength: 8 })
    .map(chars => { const value = chars.join(""); return [value, value] })
  const separator = fc.constantFrom(
    ["\n", "<br>"], ["\r", "<br>"], ["\r\n", "<br>"],
    ["\u2028", "<br>"], ["\u2029", "<br>"], ["|", "\\|"], ["\r\r\n", "<br><br>"]
  )
  const part = fc.tuple(text, separator).map(([a, b]) => [a[0] + b[0], a[1] + b[1]])
  const name = fc.array(part, { minLength: 1, maxLength: 12 })
    .map(parts => [parts.map(part => part[0]).join(""), parts.map(part => part[1]).join("")])
    .filter(pair => pair[0].trim().length > 0)
  fc.assert(fc.property(fc.uniqueArray(name, {
    minLength: 1, maxLength: 6, selector: pair => pair[0]
  }), checkCells), { seed: 328, numRuns: 100 })
})

for (const [kind, target] of [["node", "//packages:compiler-test-2"], ["migrate", "//packages:migrate-test"]]) {
  test("actual " + kind + " reporter multiline names stay in one rendered table row", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-health-actual-report-cells-"))
    try {
      const fixture = new URL("../fixture-" + kind + "-reporter/", import.meta.url)
      start(dir, { results: fixture.pathname, since: "" })
      collect(dir)
      const analysis = analyze(dir)
      const name = "multiline\nname\r\nwith\rcontrols | tail"
      assert.ok(analysis.flaky[0].tests.some(item => item.name === name))
      assert.ok(report(dir).tests.includes(name), "persisted names retain every original character")
      const text = readFileSync(join(dir, "report.md"), "utf8")
      const expected = "| " + tick + target + tick + " | <pre>multiline<br>name<br>with<br>controls \\| tail</pre> | 2 | "
      assert.equal(text.split("\n").filter(line => line.startsWith(expected)).length, 2,
        "both flaky and returning tables retain the complete name and count")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
