import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { analyze, collect, report, start } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const label = "//:example"
const at = "2020-01-01T00:00:00.000Z"
const render = `const texts = await Bun.stdin.json(); process.stdout.write(JSON.stringify(texts.map(text => Bun.markdown.html(text))))`

function checkRendered(run, names) {
  const result = report(run)
  assert.deepEqual(result.tests, names, "saved failure names retain their original text")
  assert.deepEqual(result.intermittent, names)
  assert.deepEqual(JSON.parse(readFileSync(join(run, "report.json"), "utf8")), result)
  const text = readFileSync(join(run, "report.md"), "utf8")
  const sections = [
    text.split("## Flaky tests\n")[1].split("## Intermittent tests\n")[0],
    text.split("## Intermittent tests\n")[1].split("## Slower targets\n")[0]
  ]
  const child = spawnSync("bun", ["-e", render], { input: JSON.stringify(sections), encoding: "utf8", timeout: 10000 })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr)
  const escaped = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }
  const expected = names.map(name => name.replace(/[&<>"]/g, char => escaped[char])
    .replace(/\r\n|[\r\n\u2028\u2029]/g, "<br>"))
  for (const html of JSON.parse(child.stdout)) {
    const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? ""
    const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    const cells = rows.map(row => [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(cell => cell[1]))
    assert.deepEqual(cells.map(row => row[1]), expected, "both rendered tables display literal names")
    assert.ok(cells.every(row => row[2] === "2"), "rendering retains each failure count")
  }
}

function checkNames(names) {
  const run = mkdtempSync(join(tmpdir(), "ci-health-markdown-"))
  try {
    writeFileSync(join(run, "options.json"), "{}")
    writeFileSync(join(run, "analyze.json"), JSON.stringify({
      runs: 4,
      flaky: [{ label, keys: 1, failures: 2, passes: 2, last: at, causes: { assertion: 2 },
        tests: names.map(name => ({ name, failures: 2, last: at })) }],
      intermittent: names.map(name => ({ label, name, failures: 2, returns: 1, last: at })),
      slow: [], regressed: []
    }))
    checkRendered(run, names)
  } finally {
    rmSync(run, { recursive: true, force: true })
  }
}

test("health-report names render Markdown formatting and links literally", () => {
  checkNames(["__proto__", "**bold** *emphasis* ~~deleted~~", "`code` [link](https://example.invalid) ![image](image.png)"])
})

test("health-report names render HTML, entities, pipes and backslashes literally beside real line breaks", () => {
  checkNames(["<br> <span>text</span> &lt; &#124; &copy;", "before \\| after \\* tail\\", "first\n<br>\r\nsecond\r& third\u2028fourth\u2029fifth"])
})

test("generated punctuation and newline neighbours keep literal names in both rendered tables", () => {
  const punctuation = Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33))
    .filter(char => !/[A-Za-z0-9]/.test(char))
  const token = fc.constantFrom(...punctuation, "__proto__", "**bold**", "~~gone~~", "`code`",
    "[text](url)", "![alt](image)", "<br>", "&amp;", "&#124;", "\\|", "\n", "\r", "\r\n", "\u2028", "\u2029", "☃", "🧪", " ")
  const name = fc.array(token, { minLength: 1, maxLength: 20 }).map(parts => "name " + parts.join("") + " end")
  fc.assert(fc.property(fc.uniqueArray(name, { minLength: 1, maxLength: 6 }), checkNames),
    { seed: 329, numRuns: 100 })
})

for (const kind of ["node", "migrate"]) {
  test("actual " + kind + " reporter names display literally in both rendered health-report tables", () => {
    const run = mkdtempSync(join(tmpdir(), "ci-health-actual-markdown-"))
    try {
      start(run, { results: new URL("../fixture-" + kind + "-reporter/", import.meta.url).pathname, since: "" })
      collect(run)
      const analysis = analyze(run)
      const names = analysis.flaky[0].tests.map(item => item.name)
      assert.ok(names.includes("__proto__"), "the actual reporter supplies the Markdown witness")
      assert.ok(names.some(name => name.includes("\n")), "the real multiline witness remains covered")
      checkRendered(run, names)
    } finally {
      rmSync(run, { recursive: true, force: true })
    }
  })
}

