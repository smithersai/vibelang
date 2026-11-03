import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { Linter } from "eslint"
import vibelang, { parseESTree } from "../../eslint.mjs"

const filename = new URL("./fixtures/forms.vibe", import.meta.url).pathname
const lint = (code) => new Linter({ configType: "flat", cwd: "/" }).verify(code, [{
  files: ["**/*.vibe"], languageOptions: { parser: vibelang },
  rules: { "no-unexpected-multiline": "error" }
}], { filename })

function recoveryNames(value, found = []) {
  if (!value || typeof value !== "object") return found
  if (value.type === "Identifier" && value.name === "$patternError" && value.synthesized === true) found.push(value.range)
  for (const [key, child] of Object.entries(value)) {
    if (key === "tokens" || key === "comments") continue
    if (Array.isArray(child)) child.forEach((item) => recoveryNames(item, found))
    else if (child && typeof child === "object") recoveryNames(child, found)
  }
  return found
}

test("the clean forms fixture has no recovered invalid match arms", () => {
  const code = readFileSync(filename, "utf8")
  assert.deepEqual(recoveryNames(parseESTree(code, filename)), [])
  assert.deepEqual(lint(code), [])
})

test("terminated final arms keep clean layouts and genuine source call warnings", () => {
  // Spec 004, Match expressions: "A newline alone is not a separator."
  fc.assert(fc.property(
    fc.constantFrom("\n", "\r\n"),
    fc.constantFrom(" ", "  ", "\t"),
    fc.constantFrom("", " /* final arm */", " // final arm"),
    fc.integer({ min: -100, max: 100 }),
    fc.boolean(),
    (newline, indent, comment, number, writtenCall) => {
      const value = String(number)
      const code = "export function choose(input) {" + newline + indent + "return match (input) {" + newline +
        indent + "when 0: read();" + newline + indent + "default: " + value + ";" + comment + newline + indent + "}" + newline + "}" + (writtenCall ? newline + "read" + newline + "(1)" : "")
      assert.deepEqual(recoveryNames(parseESTree(code, filename)), [], code)
      const messages = lint(code)
      assert.equal(messages.length, writtenCall ? 1 : 0, JSON.stringify(messages) + "\n" + code)
      for (const message of messages) {
        assert.equal(message.ruleId, "no-unexpected-multiline")
        assert.equal(message.fatal, undefined)
        assert.equal(code.split(/\r?\n/u)[message.line - 1][message.column - 1], "(")
      }
    }
  ), { seed: 174, numRuns: 160 })
})

test("removing the final fixture separator restores the exact recovery witness", () => {
  const code = readFileSync(filename, "utf8")
  const broken = code.replace("default: throw e;", "default: throw e")
  assert.notEqual(broken, code)
  assert.equal(recoveryNames(parseESTree(broken, filename)).length, 1)
})
