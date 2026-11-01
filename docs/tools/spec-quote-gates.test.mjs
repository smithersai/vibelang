import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import ts from "typescript"

const require = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

function gateNames(source) {
  const ast = ts.createSourceFile("PACKAGE.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names = []
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "specTests") {
      assert.ok(ts.isArrayLiteralExpression(node.initializer), "specTests must remain an explicit gate list")
      for (const item of node.initializer.elements) {
        assert.ok(ts.isStringLiteralLike(item), "a quote gate must be an explicit test name")
        names.push(item.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(names.length, "PACKAGE.ts must declare specTests")
  return new Set(names)
}

function missingGates(go, config) {
  const gates = gateNames(config)
  return [...go.matchAll(/^func (Test\w+Quoted)\(/gm)].map(m => m[1]).filter(name => !gates.has(name))
}

test("every static-rule quote test participates in the pre-merge spec gate", () => {
  const config = readFileSync(new URL("../../PACKAGE.ts", import.meta.url), "utf8")
  const directory = new URL("../../typescript/tsc/internal/vibelangfuzz/", import.meta.url)
  const missing = []
  for (const name of readdirSync(directory).filter(name => name.endsWith("_test.go"))) {
    for (const test of missingGates(readFileSync(new URL(name, directory), "utf8"), config)) {
      missing.push(name + ":" + test)
    }
  }
  assert.deepEqual(missing, [], "a spec edit must run every static-rule quote check before merge")
})

test("the gate inventory ignores decoys and formatting across generated test-name sets", () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.stringMatching(/^[A-Z][a-z]{1,8}$/), { minLength: 1, maxLength: 10 }),
    fc.nat(),
    fc.boolean(),
    (parts, offset, multiline) => {
      const names = parts.map(part => "Test" + part + "Quoted")
      const absent = names.filter((_, i) => (i + offset) % 3 === 0)
      const listed = names.filter(name => !absent.includes(name))
      // Keep one unrelated gate so a fully omitted generated set is a valid
      // inventory. Decoys include every absent name, outside the real list.
      const separator = multiline ? ",\n/* gate */ " : ", "
      const config = "const decoys = " + JSON.stringify(absent) + ";\n" +
        "const specTests = [" + [...listed, "TestUnrelated"].map(JSON.stringify).join(separator) + "];\n"
      const go = names.map(name => "func " + name + "(t *testing.T) {}").join("\n")
      assert.deepEqual(missingGates(go, config), absent)
    }
  ), { seed: 440044, numRuns: 500 })
})
