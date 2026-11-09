import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import ts from "typescript"

const root = fileURLToPath(new URL("../../typescript/vibelang/", import.meta.url))
  function* files(dir = "") {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (["node_modules", "out", ".cache"].includes(entry.name)) continue
      const file = join(dir, entry.name)
      if (entry.isDirectory()) yield* files(file)
      else if (entry.isFile()) yield file
    }
  }

test("case runners and shared helpers do not invoke retired automatic-fix flags", () => {
  const findings = []
  for (const file of files()) {
    if (!file.endsWith(".mjs") || /(?:^|\/)(?:node_modules|out|\.cache)(?:\/|$)/.test(file)) continue
    if (file === "cases/cli-fix-is-unknown-option/run.mjs") continue
    const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true)
    function visit(node) {
      if (ts.isStringLiteral(node) && /^--fix(?:$|[-=])/.test(node.text))
        findings.push(file + ":" + source.getLineAndCharacterOfPosition(node.getStart(source)).line + " " + node.text)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.deepEqual(findings, [])
})

test("case runners import only existing shared-helper exports", () => {
  const findings = []
  const cache = new Map()
  function exportedNames(file) {
    if (cache.has(file)) return cache.get(file)
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
    const names = new Set()
    cache.set(file, names)
    function bindings(name) {
      if (ts.isIdentifier(name)) names.add(name.text)
      else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindings(element.name)
    }
    for (const node of source.statements) {
      if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause))
          for (const element of node.exportClause.elements) names.add(element.name.text)
        else if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const target = resolve(dirname(file), node.moduleSpecifier.text)
          if (!existsSync(target)) return null
          const reexported = exportedNames(target)
          if (!reexported) return null
          for (const name of reexported) names.add(name)
        }
      } else if (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) {
        if (ts.isVariableStatement(node))
          for (const declaration of node.declarationList.declarations) bindings(declaration.name)
        else if (node.name) bindings(node.name)
      }
    }
    return names
  }
  for (const file of files()) {
    if (!file.endsWith(".mjs")) continue
    const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true)
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue
      const bindings = node.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      const target = resolve(root, dirname(file), node.moduleSpecifier.text)
      if (!target.startsWith(resolve(root, "tests") + sep) || !existsSync(target)) continue
      const names = exportedNames(target)
      if (!names) continue
      for (const element of bindings.elements) {
        const name = (element.propertyName ?? element.name).text
        if (!names.has(name)) findings.push(file + ": missing shared-helper export " + name)
      }
    }
  }
  assert.deepEqual(findings, [])
})
