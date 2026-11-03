import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { specTestSelection } from "../../scripts/spec-test-selection.mjs"

const require = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

const fuzzPackage = "typescript/tsc/internal/vibelangfuzz"

function missingGates(go, config) {
  const { pattern, packages } = specTestSelection(config)
  return [...go.matchAll(/^func (Test\w+Quoted)\(/gm)].map(m => m[1])
    .filter(name => !packages.includes(fuzzPackage) || !pattern.test(name))
}

// The property fixtures exercise the same -run argument and package scope as
// the real target, including the explicit-list form used before name discovery.
function configFor(names, wildcard = "", packages = "./internal/vibelangfuzz/", separator = ", ") {
  return "const specTests = [" + names.map(JSON.stringify).join(separator) + "];\n" +
    '"spec-tests": S.Shell.Test({ shell: ' +
    "`go test -run '^(" + wildcard + '${[...specTests].join("|")}' +
    ")$' " + packages + '`, data: [] })'
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
        configFor([...listed, "TestUnrelated"], "", "./internal/vibelangfuzz/", separator)
      const go = names.map(name => "func " + name + "(t *testing.T) {}").join("\n")
      assert.deepEqual(missingGates(go, config), absent)
    }
  ), { seed: 440044, numRuns: 500 })
})

test("name discovery admits new quote tests and rejects selector or package regressions", () => {
  const go = "func TestNewRuleQuoted(t *testing.T) {}"
  assert.deepEqual(missingGates(go, configFor(["TestUnrelated"], "Test[A-Za-z0-9_]*Quoted|")), [])
  assert.deepEqual(missingGates(go, configFor(["TestUnrelated"])), ["TestNewRuleQuoted"])
  assert.deepEqual(missingGates(go, configFor(["TestUnrelated"], "Test[A-Za-z0-9_]*Quoted|", "./internal/checker/")), ["TestNewRuleQuoted"])
  assert.deepEqual(missingGates(go, configFor(["TestNewRuleQuoted"])), [])
})

test("fast-check: quote discovery follows the executable selector and package scope", () => {
  fc.assert(fc.property(
    fc.stringMatching(/^[A-Z][a-z]{1,12}$/),
    fc.boolean(), fc.boolean(), fc.boolean(),
    (part, wildcard, listed, inScope) => {
      const name = "Test" + part + "Quoted"
      const config = configFor(listed ? [name] : ["TestUnrelated"],
        wildcard ? "Test[A-Za-z0-9_]*Quoted|" : "",
        inScope ? "./internal/vibelangfuzz/" : "./internal/checker/")
      const go = "func " + name + "(t *testing.T) {}"
      assert.deepEqual(missingGates(go, config), inScope && (wildcard || listed) ? [] : [name])
    }
  ), { seed: 440045, numRuns: 500 })
})
