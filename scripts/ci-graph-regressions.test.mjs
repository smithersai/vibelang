import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8")
const root = read("PACKAGE.ts")
const packages = read("packages/PACKAGE.ts")

test("overlapping case runs use isolation and graph commands use prepared installs", () => {
  assert.doesNotMatch(root, /harness\.mjs\s+--verbose/)
  assert.doesNotMatch(packages, /(?:shell:|&&)\s*"[^"\n]*\bbun install\b/)
  assert.match(root, /"kernel-laws": check\([\s\S]*?"cd experiments && bun test --timeout 30000"/)
})

test("cross-package quoted rules and durable schema fixtures use workspace file inputs", () => {
  assert.doesNotMatch(packages, /S\.glob\("\/\/(?:docs\/|typescript\/vibelang\/cases\/schema-durable-serialization)/)
  assert.match(packages, /workspaceFiles\("docs\/design\/src\/\*\.md"\)/)
  assert.match(packages, /workspaceFiles\("typescript\/vibelang\/cases\/schema-durable-serialization\/\*\*\/\*"\)/)
  assert.match(packages, /files\.includes\("typescript-shim\/test\/twin\.test\.mjs"\) \? workspaceFiles\("typescript\/vibelang\/cases\/\*\*\/\*"\)/)
  assert.match(root, /S\.file\("\/\/\.smithers\/evals\/spec-rule-judge\/cases\.json"\)/)
})

test("the generator contract selector names the live test in its package", () => {
  const command = root.match(/"go-generator-return-contracts": goVibelang\(\s*"[^"]*",\s*`([^`]+)`/)[1]
  assert.match(command, /-run '\^TestEffectFnBareReturnContractsQuoted\$' \.\/internal\/vibelangfuzz\/$/)
})
