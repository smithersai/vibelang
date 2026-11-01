// Publication scripts that map TypeScript source exports to their built paths.
import { readFileSync, writeFileSync } from "node:fs"
import { posix } from "node:path"
import { packageScripts, testOnlyScripts } from "./test-files.mjs"
import { repositoryPackages } from "./wire.mjs"

/**
 * Recognize a publication helper that maps Object.entries(pkg.exports), guards
 * a string export with /\.tsx?$/, and replaces that suffix with .js/.d.ts.
 * Its migrated entries carry vibelang-source or a paired sidecar/default source.
 * Unwrap only those entries, and
 * teach the same suffix operations about .vibe. Existing condition maps stay
 * untouched. A second run is a no-op.
 */
export function rewritePublishingScript(text, ts, fileName = "pack.ts") {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  // A locally rebound/mutated Object has no built-in entries/fromEntries contract.
  let reboundObject = false
  const checkObject = (node) => {
    if (node.name && ts.isIdentifier(node.name) && node.name.text === "Object" &&
        (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) ||
         ts.isClassDeclaration(node) || ts.isImportSpecifier(node) || ts.isImportClause(node) ||
         ts.isNamespaceImport(node) || ts.isBindingElement(node))) reboundObject = true
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      let target = node.left
      while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) target = target.expression
      if (ts.isIdentifier(target) && target.text === "Object") reboundObject = true
    }
    ts.forEachChild(node, checkObject)
  }
  checkObject(source)
  if (reboundObject) return { text, changed: false }
  const edits = []
  const literals = []
  const maps = []
  const suffix = (node) => node?.kind === ts.SyntaxKind.RegularExpressionLiteral && node.text === "/\\.tsx?$/"
  const property = (node, name) => ts.isPropertyAccessExpression(node) && node.name.text === name
  const qualified = (node) => ts.isIdentifier(node) || (ts.isPropertyAccessExpression(node) && qualified(node.expression))
  const visit = (node) => {
    if (ts.isCallExpression(node) && property(node.expression, "replace") && node.arguments.length === 2 &&
        suffix(node.arguments[0]) && ts.isStringLiteral(node.arguments[1]) &&
        [".js", ".d.ts"].includes(node.arguments[1].text)) literals.push(node.arguments[0])
    if (ts.isCallExpression(node) && property(node.expression, "map") && node.arguments.length === 1) {
      const entries = node.expression.expression
      const callback = node.arguments[0]
      if (ts.isCallExpression(entries) && entries.arguments.length === 1 &&
          property(entries.expression, "entries") && ts.isIdentifier(entries.expression.expression) &&
          entries.expression.expression.text === "Object" && property(entries.arguments[0], "exports") && qualified(entries.arguments[0]) &&
          ts.isArrowFunction(callback) && callback.parameters.length === 1) {
        const binding = callback.parameters[0].name
        if (ts.isArrayBindingPattern(binding) && binding.elements.length === 2 && binding.elements[0].name && binding.elements[1].name && ts.isIdentifier(binding.elements[0].name) && ts.isIdentifier(binding.elements[1].name)) {
          const value = binding.elements[1].name.text
          const guards = []
          const scan = (child) => {
            if (ts.isCallExpression(child) && property(child.expression, "test") && suffix(child.expression.expression) &&
                child.arguments.length === 1 && ts.isIdentifier(child.arguments[0]) && child.arguments[0].text === value) guards.push(child.expression.expression)
            ts.forEachChild(child, scan)
          }
          scan(callback.body)
          if (guards.length) maps.push({ argument: entries.arguments[0], guards })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!literals.length || !maps.length) return { text, changed: false }
  const isJS = /\.[cm]?jsx?$/.test(fileName)
  for (const { argument, guards } of maps) {
    const expression = argument.getText(source)
    const parameter = isJS ? "[key, target]" : "[key, target]: [string, unknown]"
    const explicit = 'target !== null && typeof target === "object" && "vibelang-source" in target && typeof target["vibelang-source"] === "string"'
    const paired = 'target !== null && typeof target === "object" && "default" in target && typeof target.default === "string" && target.default.endsWith(".vibe") && "types" in target && target.types === target.default.slice(0, -5) + ".d.vibe.ts"'
    const normalized = `Object.fromEntries(Object.entries(${expression}).map((${parameter}) => [key, ${explicit} ? target["vibelang-source"] : ${paired} ? target.default : target]))`
    edits.push({ start: argument.getStart(source), end: argument.end, text: isJS ? normalized : `(${normalized} as typeof ${expression})` })
    literals.push(...guards)
  }
  for (const literal of new Set(literals)) edits.push({ start: literal.getStart(source), end: literal.end, text: "/\\.(?:tsx?|vibe)$/" })
  edits.sort((a, b) => b.start - a.start)
  for (const edit of edits) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  return { text, changed: true }
}

/** Setup updates publication helpers, leaving tests/fixtures/test-only helpers intact. */
export function wirePublishingScripts({ root, ts }) {
  const changed = []
  const warnings = []
  for (const pkg of repositoryPackages(root)) {
    const scripts = packageScripts(root, pkg.dir)
    const tests = testOnlyScripts(root, pkg.dir, scripts, pkg.manifest)
    for (const file of scripts) {
      const before = readFileSync(posix.join(root, file), "utf8")
      const after = rewritePublishingScript(before, ts, file)
      if (!after.changed) continue
      if (tests.has(file)) {
        warnings.push(`${file}: publication helper handles only TypeScript export paths; setup leaves tests as they are (decided detail 272)`)
        continue
      }
      writeFileSync(posix.join(root, file), after.text)
      changed.push(file)
    }
  }
  return { changed, warnings }
}
