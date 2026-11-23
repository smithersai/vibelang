// Every .vibe file in this repository that is meant to compile parses into a
// tree with the properties tree.mjs states, and the rules lint it without a
// crash or a message about code the parser wrote: each excluded rule below
// once reported a synthesized form. The open defects are listed, not skipped.
import { strict as assert } from "node:assert"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { test } from "node:test"
import { Linter } from "eslint"
import { visitorKeys as typescriptKeys } from "@typescript-eslint/visitor-keys"
import { parseForESLint } from "../../eslint.mjs"
import { config } from "./config.mjs"
import { relativeToRepo, repositoryFiles, expectedParseError, matchesParseError, matchesLintParseError } from "./helpers.mjs"
import { allVisitorKeys, problems, reportsSynthesizedLabel, reportsSynthesizedConstant } from "./tree.mjs"
import { reportsSynthesizedName } from "./lint-oracle.mjs"


const keys = allVisitorKeys(typescriptKeys)
// The JSDoc convention is Smithers'; the corpus does not follow it.
const corpusConfig = config.map((entry) =>
  entry.rules ? { ...entry, rules: Object.fromEntries(Object.entries(entry.rules).filter(([rule]) => !rule.startsWith("jsdoc/"))) } : entry
)
const synthesizedFormRules = new Set([
  "no-unexpected-multiline", // a synthesized call before a line break: error Timeout
  "no-constant-condition", // a handle chain's if (true)
  "no-dupe-else-if", // a handle chain's repeated $performed test
  "no-unused-labels" // a match statement's or a select's label
])

// corpus-known-failures.json holds each open defect of the tree, with the
// exact failures it causes in this corpus. The failures found must equal the
// ledger's: a new one fails, and so does a listed one that no longer occurs,
// so a fix removes its lines here. VIBELANG_ESLINT_CORPUS_FOUND names a file
// to write the failures found to, for reading a large difference.
// The corpus-* guards run this file over a corpus of their own, which has none.
const ledgerFile = new URL("./corpus-known-failures.json", import.meta.url)
const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : {}
const known = (kind) => Object.values(ledger).flatMap((defect) => defect[kind] ?? [])

function assertKnown(kind, failures) {
  const found = process.env.VIBELANG_ESLINT_CORPUS_FOUND
  if (found) writeFileSync(`${found}.${kind}.json`, JSON.stringify(failures, null, 2) + "\n")
  const count = (list) => list.reduce((counts, item) => counts.set(item, (counts.get(item) ?? 0) + 1), new Map())
  const [actual, expected] = [count(failures), count(known(kind))]
  const beyond = (a, b) => [...a].flatMap(([item, times]) => Array(Math.max(0, times - (b.get(item) ?? 0))).fill(item)).sort()
  assert.deepEqual({ unexpected: beyond(actual, expected), noLongerFailing: beyond(expected, actual) }, { unexpected: [], noLongerFailing: [] },
    "fix an unexpected failure; delete a line that no longer fails from corpus-known-failures.json")
}

test("each known defect says what is wrong and how to see it", () => {
  for (const [name, defect] of Object.entries(ledger)) {
    assert.ok(defect.defect?.length > 40 && defect.reproduction?.length > 10, name)
    assert.ok((defect.parse?.length ?? 0) + (defect.lint?.length ?? 0) > 0, `${name} lists no failure: delete it`)
  }
})

// Cases ending in .fail are compiler tests of invalid programs.
const files = repositoryFiles(".vibe").filter((file) => !/\.fail\//.test(file) && !file.includes("/test/eslint/fixtures/"))

test("the corpus is large", () => {
  assert.ok(files.length > 250, `found ${files.length} .vibe files`)
})

test("every .vibe file parses into a tree of its own tokens and names", () => {
  const failures = []
  for (const file of files) {
    const code = readFileSync(file, "utf8")
    const expected = expectedParseError(file)
    try {
      const { ast } = parseForESLint(code, { filePath: file })
      if (expected) failures.push(`${relativeToRepo(file)}: expected syntax error was not reported: ${expected.message}`)
      for (const problem of problems(code, ast, keys)) failures.push(`${relativeToRepo(file)}: ${problem}`)
    } catch (error) {
      if (!matchesParseError(expected, error)) failures.push(`${relativeToRepo(file)}: ${error.message}`)
    }
  }
  assertKnown("parse", failures)
})

test("every .vibe file lints without a crash or a report about code the parser wrote", () => {
  const failures = []
  for (const file of files) {
    const code = readFileSync(file, "utf8")
    const expected = expectedParseError(file)
    let messages
    const linter = new Linter({ configType: "flat", cwd: "/" })
    try {
      messages = linter.verify(code, corpusConfig, { filename: file })
    } catch (error) {
      failures.push(`${relativeToRepo(file)}: ${error.message.split("\n")[0]}`)
      continue
    }
    if (expected && !messages.some((message) => matchesLintParseError(expected, message))) {
      failures.push(`${relativeToRepo(file)}: expected lint parsing error was not reported: ${expected.message}`)
    }
    const sourceCode = linter.getSourceCode()
    for (const message of messages) {
      if (message.ruleId === "no-constant-condition" && !reportsSynthesizedConstant(message, sourceCode)) continue
      if (message.ruleId === "no-unused-labels" && !reportsSynthesizedLabel(message, linter.getSourceCode())) continue
      if (matchesLintParseError(expected, message)) continue
      if (message.fatal || synthesizedFormRules.has(message.ruleId) || reportsSynthesizedName(message, sourceCode)) {
        failures.push(`${relativeToRepo(file)}:${message.line}:${message.column} ${message.ruleId}: ${message.message}`)
      }
    }
  }
  assertKnown("lint", failures)
})
