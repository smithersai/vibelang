import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { loadTypeScript } from "../../../.smithers/flows/migrate/lib/declarations.mjs"
import { exampleCases, buildPrompt } from "../../../.smithers/flows/convert/build-prompt.mjs"
import { buildContext } from "../../../.smithers/flows/migrate/build-context.mjs"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const ts = loadTypeScript([join(root, "packages/runtime")])
const quote = "Ordinary interface and object-type properties, including optional members and index signatures, keep exactly the source's written"
function manifest(source) {
  const match = source.match(/export interface Manifest \{([\s\S]*?)\n\}/)
  assert.ok(match, "missing minimized Manifest example")
  return match[1]
}
function members(body, objectType) {
  const source = ts.createSourceFile("ordinary.ts",
    objectType ? "export type Manifest = {" + body + "\n}" : "export interface Manifest {" + body + "\n}",
    ts.ScriptTarget.Latest, true)
  assert.equal(source.parseDiagnostics.length, 0, "ordinary properties must use TypeScript syntax")
  const declaration = source.statements[0]
  const properties = objectType ? declaration.type.members : declaration.members
  return properties.map(p => ({
    name: p.name.getText(source),
    readonly: p.modifiers?.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false,
    optional: !!p.questionToken,
    type: p.type.getText(source).replace(/\s+/g, "")
  }))
}

test("migration examples preserve ordinary property mutability in both generated prompts", () => {
  assert.ok(readFileSync(join(root, "docs/design/src/001-functions.md"), "utf8").includes(quote))
  const example = exampleCases().find(c => c.name === "06-shipment-schema")
  const expected = members(manifest(example.input), false)
  for (const [name, text] of [["example", example.expected], ["convert", buildPrompt()], ["migrate", buildContext()]]) {
    assert.deepEqual(members(manifest(text), false), expected, name)
  }
  const rules = readFileSync(join(root, ".smithers/flows/migrate/rules.md"), "utf8")
  assert.ok(rules.includes("a member is writable unless written"))
  assert.ok(!/write.{0,80}mutable.{0,80}(interface|object-type)/i.test(rules))
})

test("migration property spellings survive interface/type-literal and trivia mutations", async () => {
  const example = exampleCases().find(c => c.name === "06-shipment-schema")
  await checkProperty(fc, {
    name: "migration-ordinary-property-mutability",
    rule: quote,
    command: "node --test packages/compiler/test/migration-mutability.property.test.mjs",
    arbitrary: fc.record({
      objectType: fc.boolean(),
      optional: fc.boolean(),
      comment: fc.constantFrom("", "/* kept */ ", "/* café */ "),
      suffix: fc.constantFrom("", "Café", "_2", "Unicode"),
      newline: fc.constantFrom("\n", "\r\n"),
      reverse: fc.boolean()
    }),
    numRuns: 100,
    check(input) {
      const mutate = body => {
        let lines = body.trim().split("\n")
        if (input.reverse) lines.reverse()
        return input.newline + lines.map(line =>
          input.comment + line.replace(/\b(depot|parcels)\b/g, "$1" + input.suffix + (input.optional ? "?" : ""))
        ).join(input.newline)
      }
      assert.deepEqual(members(mutate(manifest(example.expected)), input.objectType),
        members(mutate(manifest(example.input)), input.objectType))
    }
  })
})

function ordinaryMutable(source) {
  // Stock TypeScript abandons the container at an unknown modifier. Mask it
  // without moving source offsets, then inspect the original ordinary body.
  const masked = source.replace(/\bmutable(?=\s+[\p{L}_$])/gu, "       ")
  const file = ts.createSourceFile("snippet.ts", masked, ts.ScriptTarget.Latest, true)
  const problems = []
  function visit(node) {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
      const body = source.slice(node.members.pos, node.members.end)
      if (/(?:^|[;\n\r])\s*mutable\s+[\p{L}_$]/u.test(body)) problems.push(body)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return problems
}

test("all ordinary property examples in migration sources and contexts omit mutable", () => {
  assert.equal(ordinaryMutable("interface I { mutable value: number }").length, 1)
  assert.equal(ordinaryMutable("type I = { mutable value: number }").length, 1)
  assert.deepEqual(ordinaryMutable("interface I { mutable: number; readonly value?: string }"), [])
  for (const text of [buildContext(), buildPrompt(), readFileSync(join(root, ".smithers/flows/migrate/rules.md"), "utf8")]) {
    for (const fence of text.matchAll(/[\x60]{3}(?:ts|typescript|vibe)\s*\n([\s\S]*?)[\x60]{3}/g)) {
      assert.deepEqual(ordinaryMutable(fence[1]), [], "ordinary properties need no mutable marker")
    }
  }
})
