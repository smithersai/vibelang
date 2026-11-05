// A computed filename cannot follow one source rename until its possible
// inputs have a proven rewrite. Refuse before the write-ahead journal mutates.
import { readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { packageDirOf } from "./codemod.mjs"
import { testPath } from "./test-files.mjs"

const configFile = /(?:^|\/)vite(?:\.[\w-]+)?\.config(?:\.[\w-]+)?\.[cm]?[jt]s$/
const fields = [["build", "lib", "entry"], ["build", "rollupOptions", "input"], ["build", "rolldownOptions", "input"], ["pack", "entry"]]
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function inputs(ts, source, file) {
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression
    return node
  }
  const name = node => node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined
  const field = (node, key) => {
    node = unwrap(node)
    return node && ts.isObjectLiteralExpression(node) ? node.properties.filter(p =>
      ts.isPropertyAssignment(p) && name(p.name) === key).map(p => p.initializer) : []
  }
  const build = new Set(), namespaces = new Set()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly ||
      !["vite", "vite-plus"].includes(statement.moduleSpecifier.text)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) {
      if (!e.isTypeOnly && (e.propertyName?.text ?? e.name.text) === "build") build.add(e.name.text)
    }
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
  }
  const roots = []
  const visit = node => {
    if (configFile.test(file) && ts.isExportAssignment(node) && !node.isExportEquals) roots.push(node.expression)
    if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && build.has(node.expression.text) ||
      ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
      namespaces.has(node.expression.expression.text) && node.expression.name.text === "build")) roots.push(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(source)
  const out = []
  const inspect = node => {
    if (!node) return
    for (const keys of fields) {
      let values = [node]
      for (const key of keys) values = values.flatMap(value => {
        value = unwrap(value)
        return (value && ts.isArrayLiteralExpression(value) ? [...value.elements] : [value]).flatMap(v => field(v, key))
      })
      out.push(...values)
    }
    ts.forEachChild(node, inspect)
  }
  for (const root of roots) inspect(root)
  return [...new Set(out)]
}

function computedPatterns(ts, node) {
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression
    return node
  }
  const parts = node => {
    node = unwrap(node)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
    if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.flatMap(s => [null, s.literal.text])]
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return [...parts(node.left), ...parts(node.right)]
    return [null]
  }
  node = unwrap(node)
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(n => computedPatterns(ts, n))
  if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap(p => ts.isPropertyAssignment(p) ? computedPatterns(ts, p.initializer) : [])
  if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse].flatMap(n => computedPatterns(ts, n))
  // The terminal filename operand has the same suffix with any directory
  // arguments. Do not execute a build helper or evaluate its substitutions.
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
    ["join", "resolve"].includes(node.expression.name.text) && node.arguments.length) return computedPatterns(ts, node.arguments.at(-1))
  const pieces = parts(node)
  if ((!pieces.includes(null) && pieces.length === 1) || !/\.[cm]?tsx?$/.test(pieces.at(-1) ?? "")) return []
  return [{node, pattern:new RegExp("^" + pieces.map(p => p === null ? ".*" : escape(p)).join("") + "$")}]
}

/** Located safe refusal for template/concatenated Vite inputs that may select a renamed source. */
export function assertComputedBuildEntrypoints(root, files, renames, ts) {
  if (!ts || !renames.length) return
  const packages = new Map()
  for (const rename of renames) {
    const base = packageDirOf(root, rename.from)
    if (!packages.has(base)) packages.set(base, [])
    packages.get(base).push(rename.from)
  }
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || /\.d\.[cm]?ts$/.test(file) || testPath.test(file)) continue
    const base = packageDirOf(root, file), candidates = packages.get(base)
    if (!candidates) continue
    const text = readFileSync(join(root, file), "utf8")
    if (!/\.[cm]?tsx?/.test(text)) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    for (const input of inputs(ts, source, file)) for (const {node, pattern} of computedPatterns(ts, input)) {
      const selected = candidates.filter(from => [
        posix.basename(from), from, posix.relative(base, from), posix.relative(posix.dirname(file), from)
      ].some(value => pattern.test(value) || pattern.test("./" + value)))
      if (!selected.length) continue
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      throw new Error(file + ":" + line + ": computed build entry may select " + selected.join(", ") +
        "; keep the source as TypeScript until its entry has a proven rewrite")
    }
  }
}
