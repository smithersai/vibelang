import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import ts from "typescript"
import fc from "fast-check"

const root = fileURLToPath(new URL("../../", import.meta.url))
function goNames() {
  const dir = join(root, "typescript/tsc/internal")
  return new Set(readdirSync(dir, { recursive: true }).filter(p => p.endsWith("_test.go")).flatMap(p =>
    [...readFileSync(join(dir, p), "utf8").matchAll(/^func ((?:Test|Fuzz)\w+)\(/gm)].map(m => m[1])))
}
function selectorFindings(text, names) {
  const refs = [...new Set(text.match(/\b(?:Test|Fuzz)[A-Z]\w*/g) ?? [])]
  return refs.filter(ref => ![...names].some(name => name.startsWith(ref)))
}
function shellText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(s => "__DYNAMIC__" + s.literal.text).join("")
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return shellText(node.left) + shellText(node.right)
  return "__DYNAMIC__"
}
function emptySelectors(shell, names) {
  const patterns = [...shell.matchAll(/(?:^|\s)-run(?:=|\s+)(["'])(.*?)\1/g)].map(m => m[2].split("/")[0])
  return patterns.filter(pattern => !pattern.includes("__DYNAMIC__") && (!/(?:Test|Fuzz)/.test(pattern) || /\(\||\|\)|\|\|/.test(pattern) || ![...names].some(name => new RegExp(pattern).test(name))))
}

test("Go check selectors name retained tests and each literal selector runs a test", () => {
  const text = readFileSync(join(root, "PACKAGE.ts"), "utf8")
  const source = ts.createSourceFile("PACKAGE.ts", text, ts.ScriptTarget.Latest, true)
  const names = goNames(), findings = []
  function checkShell(shell) {
    if (/\bgo test\b/.test(shell)) findings.push(...selectorFindings(shell, names), ...emptySelectors(shell, names).map(pattern => "empty selector: " + pattern))
    if (/\bnode\s+--test\b/.test(shell))
      for (const match of shell.matchAll(/packages\/compiler\/test\/[A-Za-z0-9_./-]+\.(?:mjs|js)/g))
        if (!existsSync(join(root, match[0]))) findings.push("missing test file: " + match[0])
  }
  function visit(node) {
    if (ts.isStringLiteral(node) && ts.isArrayLiteralExpression(node.parent) && /^(?:Test|Fuzz)[A-Z]\w*$/.test(node.text)) {
      for (const missing of selectorFindings(node.text, names)) findings.push(missing)
    }
    if (ts.isCallExpression(node) && /^(?:check|goVibelang)$/.test(node.expression.getText(source)) && node.arguments[1]) {
      const shell = shellText(node.arguments[1])
      checkShell(shell)
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "shell") {
      const shell = shellText(node.initializer)
      checkShell(shell)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.deepEqual([...new Set(findings)].sort(), [])
})

test("selector mutations keep native prefixes and detect removed fix functions", () => {
  fc.assert(fc.property(fc.stringMatching(/^[A-Z][a-z]{1,15}$/), suffix => {
    const name = "Test" + suffix
    const names = new Set([name + "Native", "FuzzCurrent"])
    assert.deepEqual(selectorFindings(name, names), [])
    assert.deepEqual(emptySelectors("go test -run '^" + name + "'", names), [])
    assert.deepEqual(selectorFindings("TestRemovedRepair", names), ["TestRemovedRepair"])
    assert.deepEqual(emptySelectors("go test -run '^TestRemovedRepair$'", names), ["^TestRemovedRepair$"])
    assert.deepEqual(emptySelectors("go test -run '^'", names), ["^"])
    assert.deepEqual(emptySelectors("go test -run '^(FuzzCurrent||" + name + ")$'", names), ["^(FuzzCurrent||" + name + ")$"])
    assert.deepEqual(emptySelectors("go test -run '^(FuzzCurrent|TestRemovedRepair)$'", names), [])
    assert.deepEqual(emptySelectors("go test -run '^" + name + "$'", names), ["^" + name + "$"])
  }), { seed: 20261109, numRuns: 100 })
})
