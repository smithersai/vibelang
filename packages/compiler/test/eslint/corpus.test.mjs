// Every .vibe file in this repository that is meant to compile parses into a
// tree with the properties tree.mjs states, and the rules lint it without a
// crash or a message about code the parser wrote: each excluded rule below
// once reported a synthesized form.
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { Linter } from "eslint"
import { visitorKeys as typescriptKeys } from "@typescript-eslint/visitor-keys"
import { parseForESLint } from "../../eslint.mjs"
import { config } from "./config.mjs"
import { relativeToRepo, repositoryFiles, expectedParseError, matchesParseError, matchesLintParseError } from "./helpers.mjs"
import { allVisitorKeys, problems, reportsSynthesizedLabel } from "./tree.mjs"


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
  assert.deepEqual(failures, [])
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
    for (const message of messages) {
      if (message.ruleId === "no-unused-labels" && !reportsSynthesizedLabel(message, linter.getSourceCode())) continue
      if (matchesLintParseError(expected, message)) continue
      if (message.fatal || synthesizedFormRules.has(message.ruleId) || /'\$\w+'/.test(message.message)) {
        failures.push(`${relativeToRepo(file)}:${message.line}:${message.column} ${message.ruleId}: ${message.message}`)
      }
    }
  }
  assert.deepEqual(failures, [])
})
