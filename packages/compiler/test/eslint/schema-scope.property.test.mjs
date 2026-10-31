import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import vibelang, { parseForESLint } from "../../eslint.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const require = createRequire(import.meta.url)
const { Linter } = require("eslint")
const tseslint = require("typescript-eslint")
const fc = require("fast-check")
const quote =
  "In a schema type, an identifier or qualified name is looked up as a value and must satisfy Effect's `Schema.Top`; a type of the same name is not expanded."
const counterpartQuote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."
const filePath = fileURLToPath(new URL("./fixtures/foldkit-codec-reference.vibe", import.meta.url))
const regressions = new URL("./property-regressions/", import.meta.url)
const propertyName = "SchemaCodecValueReferences"
const forms = [
  "bare",
  "optional",
  "array",
  "nested",
  "record",
  "alias",
  "qualified",
  "schema-alias",
  "tuple",
]

function diagnostics(code, parser = vibelang, filename = filePath) {
  return new Linter({ configType: "flat", cwd: "/" }).verify(
    code,
    [
      {
        files: ["**/*.vibe", "**/*.ts"],
        languageOptions: { parser, sourceType: "module" },
        plugins: { "@typescript-eslint": tseslint.plugin },
        rules: { "@typescript-eslint/no-unused-vars": "error" },
      },
    ],
    { filename },
  )
}
function sourceOf(input) {
  if (input.fixture) {
    assert.equal(input.fixture, "foldkit-codec-reference.vibe")
    return {
      binding: "Names",
      code: readFileSync(new URL("./fixtures/" + input.fixture, import.meta.url), "utf8"),
    }
  }
  const n = input.name
  const head = "const " + n + " = Schema.String; "
  switch (input.form) {
    case "bare":
      return { binding: n, code: head + "export schema Locale { name: " + n + " }" }
    case "optional":
      return { binding: n, code: head + "export schema Locale { name?: " + n + " }" }
    case "array":
      return { binding: n, code: head + "export schema Locale { names: " + n + "[] }" }
    case "nested":
      return { binding: n, code: head + "export schema Locale { nested: { name: " + n + " } }" }
    case "record":
      return {
        binding: n,
        code: head + "export schema Locale { names: Record<string, " + n + "> }",
      }
    case "alias":
      return {
        binding: n + "Alias",
        code:
          head + "const " + n + "Alias = " + n + "; export schema Locale { name: " + n + "Alias }",
      }
    case "qualified":
      return {
        binding: n,
        code:
          "const " +
          n +
          " = { Name: Schema.String }; export schema Locale { name: " +
          n +
          ".Name }",
      }
    case "schema-alias":
      return { binding: n, code: head + "export schema Locale = " + n }
    case "tuple":
      return {
        binding: n,
        code:
          "const " +
          n +
          " = Schema.Tuple([Schema.String, Schema.String]); export schema Locale { names: " +
          n +
          " }",
      }
    case "primitive": {
      const field = [
        "name: string",
        "name?: string",
        "names: string[]",
        "nested: { name: string }",
        "names: Record<string, string>",
      ][input.variant % 5]
      return { binding: null, code: "export schema " + n + " { " + field + " }" }
    }
    default:
      throw new Error("unknown schema scope form: " + input.form)
  }
}
function roles(scopeManager, binding) {
  const variables = scopeManager.scopes
    .flatMap((scope) => scope.variables)
    .filter((v) => v.name === binding)
  assert.ok(variables.length, "scope manager lost " + binding)
  return variables
    .flatMap((v) =>
      v.references.map((r) => ({
        read: r.isRead(),
        value: r.isValueReference,
        type: r.isTypeReference,
        range: r.identifier.range,
      })),
    )
    .sort((a, b) => a.range[0] - b.range[0])
}
class MissingCodecValueRead extends Error {}
function checkValueUse(input) {
  const { code, binding } = sourceOf(input)
  const messages = diagnostics(code)
  assert.ok(
    messages.every((message) => !message.fatal),
    "parser failed on a valid scope witness",
  )
  const unused = messages.filter(
    (message) => message.ruleId === "@typescript-eslint/no-unused-vars",
  )
  assert.ok(
    messages.every((message) => message.ruleId === "@typescript-eslint/no-unused-vars"),
    "unrelated ESLint diagnostic",
  )
  if (binding === null) {
    assert.deepEqual(unused, [])
    return
  }
  const { scopeManager } = parseForESLint(code, { filePath })
  const references = roles(scopeManager, binding)
  const valueRead = references.some((reference) => reference.read && reference.value)
  if (!valueRead) {
    // Only this precise scope defect is pending. Parser failures, lost bindings
    // and unrelated diagnostics still fail outside the knownFailure replay.
    assert.ok(
      unused.every((message) => message.message.includes(binding)),
      "unrelated unused binding",
    )
    throw new MissingCodecValueRead(
      JSON.stringify({ form: input.form, binding, references, unused }, null, 2),
    )
  }
  assert.deepEqual(unused, [])
}
test("foldkit-12: codec value reads and ordinary schema controls preserve native scope roles", async () => {
  assert.ok(
    readFileSync(SpecPath("006-data.md"), "utf8").includes(quote),
    "update the codec-value oracle",
  )
  const records = readdirSync(regressions)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(new URL(name, regressions), "utf8")))
    .filter((record) => record.property === propertyName)
  const pending = new Set(
    records.filter((record) => record.knownFailure).map((record) => record.input.form),
  )
  const available = ["primitive", ...forms.filter((form) => !pending.has(form))]
  let unexpectedKnownFailure
  await checkProperty(fc, {
    name: propertyName,
    rule: "Chapter 6: schema codec references consume Schema values.",
    command: "node --test packages/compiler/test/eslint/schema-scope.property.test.mjs",
    arbitrary: fc.record({
      form: fc.constantFrom(...available),
      name: fc.integer({ min: 0, max: 999 }).map((id) => "Codec" + id),
      variant: fc.integer({ min: 0, max: 4 }),
    }),
    numRuns: 160,
    regressions,
    check(input) {
      try {
        checkValueUse(input)
      } catch (error) {
        if (!(error instanceof MissingCodecValueRead)) unexpectedKnownFailure = error
        throw error
      }
    },
    artifacts: (input) => ({ "main.vibe": sourceOf(input).code + "\n" }),
  })
  // The shared replay marks known failures by input. Do not let it swallow a
  // different failure such as a parser crash in one of those exact fixtures.
  assert.ifError(unexpectedKnownFailure)
})
test("ordinary TypeScript scope roles and type-only unused values match typescript-eslint", () => {
  assert.ok(
    readFileSync(SpecPath("000-intro.md"), "utf8").includes(counterpartQuote),
    "update the ordinary TypeScript oracle",
  )
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 2 }), (id, form) => {
      const name = "Model" + id
      const code = [
        "interface " + name + " { value: string }; export type Alias = " + name + ";",
        "const " + name + " = Schema.String; export type Alias = typeof " + name + ";",
        "type " + name + " = { value: string }; export interface Alias { value: " + name + " };",
      ][form]
      const stock = tseslint.parser.parseForESLint(code, {
        sourceType: "module",
        filePath: filePath + ".ts",
        range: true,
        loc: true,
      })
      const vibe = parseForESLint(code, { filePath })
      assert.deepEqual(roles(vibe.scopeManager, name), roles(stock.scopeManager, name))
      const count = (messages) =>
        messages.filter((message) => message.ruleId === "@typescript-eslint/no-unused-vars").length
      assert.equal(
        count(diagnostics(code)),
        count(diagnostics(code, tseslint.parser, filePath + ".ts")),
      )
    }),
    { seed: 120613, numRuns: 120 },
  )
})
