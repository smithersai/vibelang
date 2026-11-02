// A literal Vite build input follows its batch's source rename. Configuration
// stays native TypeScript; no target test, fixture or runner is edited (272).
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { packageDirOf } from "./codemod.mjs"
import { applyEdits } from "./imports.mjs"
import { testPath } from "./test-files.mjs"

const configFile = /(?:^|\/)vite\.config\.[cm]?[jt]s$/
const fields = [["build", "lib", "entry"], ["build", "rollupOptions", "input"], ["build", "rolldownOptions", "input"], ["pack", "entry"]]

function entries(text, file, ts, warn) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression
    return node
  }
  const nameOf = node => node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined
  // A conditional spread of disjoint options, such as onSuccess, cannot
  // override entry. Unknown objects or keys still require leaving it alone.
  const mayOverride = (node, name) => {
    node = unwrap(node)
    if (ts.isConditionalExpression(node)) return mayOverride(node.whenTrue, name) || mayOverride(node.whenFalse, name)
    if (node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return false
    if (!ts.isObjectLiteralExpression(node)) return true
    return node.properties.some(prop => ts.isSpreadAssignment(prop) ? mayOverride(prop.expression, name) : nameOf(prop.name) === undefined || nameOf(prop.name) === name)
  }
  // A later spread or computed key can replace a field. Never assume its value.
  const field = (object, name) => {
    object = unwrap(object)
    if (!object || !ts.isObjectLiteralExpression(object)) return object && { unknown: object }
    for (const prop of [...object.properties].reverse()) {
      if (ts.isSpreadAssignment(prop)) {
        if (mayOverride(prop.expression, name)) return { unknown: prop }
        continue
      }
      if (nameOf(prop.name) === undefined) return { unknown: prop }
      if (nameOf(prop.name) === name) return ts.isPropertyAssignment(prop) ? { value: prop.initializer } : { unknown: prop }
    }
  }
  const define = new Set(), namespaces = new Set()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly || !["vite", "vite-plus"].includes(statement.moduleSpecifier.text)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) {
      if (!e.isTypeOnly && (e.propertyName?.text ?? e.name.text) === "defineConfig") define.add(e.name.text)
    }
    else if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
  }
  const isDefine = node => ts.isIdentifier(node) ? define.has(node.text) : ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) && namespaces.has(node.expression.text) && node.name.text === "defineConfig"
  const configs = (node, allowCall = true) => {
    node = unwrap(node)
    if (!node) return []
    if (ts.isObjectLiteralExpression(node)) return [node]
    if (allowCall && ts.isCallExpression(node) && isDefine(node.expression)) return configs(node.arguments[0])
    if (ts.isConditionalExpression(node)) return [...configs(node.whenTrue, allowCall), ...configs(node.whenFalse, allowCall)]
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (!ts.isBlock(node.body)) return configs(node.body, false)
      const out = []
      const visit = child => {
        if (ts.isReturnStatement(child)) out.push(...configs(child.expression, false))
        else if (!ts.isFunctionLike(child)) ts.forEachChild(child, visit)
      }
      ts.forEachChild(node.body, visit)
      return out
    }
    return []
  }
  const out = []
  const literals = node => {
    node = unwrap(node)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node)
    else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(literals)
    else if (ts.isObjectLiteralExpression(node)) node.properties.forEach(prop => ts.isPropertyAssignment(prop) ? literals(prop.initializer) : warn(prop, "computed build input left as written"))
    else warn(node, "computed build input left as written")
  }
  for (const statement of source.statements) {
    let expression = ts.isExportAssignment(statement) && !statement.isExportEquals ? statement.expression : undefined
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const { left, right } = statement.expression
      if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression) &&
        ((left.expression.text === "module" && left.name.text === "exports") || (left.expression.text === "exports" && left.name.text === "default"))) expression = right
    }
    if (!expression) continue
    const objects = configs(expression)
    if (!objects.length) warn(expression, "computed Vite configuration left as written")
    for (const config of objects) {
      const root = field(config, "root")
      const rootValue = root?.value && unwrap(root.value)
      if (root?.unknown || (rootValue && !ts.isStringLiteral(rootValue) && !ts.isNoSubstitutionTemplateLiteral(rootValue))) {
        warn(root.unknown ?? rootValue, "computed Vite root left as written")
        continue
      }
      const base = rootValue?.text ?? "."
      for (const keys of fields) {
        let nodes = [config]
        for (const key of keys) {
          nodes = nodes.flatMap(node => {
            node = unwrap(node)
            const values = ts.isArrayLiteralExpression(node) ? [...node.elements] : [node]
            return values.flatMap(value => {
              const next = field(value, key)
              if (next?.unknown) warn(next.unknown, "computed build configuration left as written")
              return next?.value ? [next.value] : []
            })
          })
        }
        for (const node of nodes) {
          const at = out.length
          literals(node)
          for (let i = at; i < out.length; i++) out[i] = { node: out[i], base }
        }
      }
    }
  }
  return { source, literals: out }
}

// Change only the suffix in the original literal, retaining its quotes/escapes.
function literalEdit(node, source, to) {
  const raw = node.getText(source)
  const extension = /\.(?:ts|vibe)(["'`])$/.exec(raw)
  if (!extension) return null
  return { start: node.getStart(source), end: node.end, text: raw.slice(0, extension.index) + to.slice(to.lastIndexOf(".")) + extension[1] }
}

/** Rewrite literal build inputs in native Vite configs; record reversible edits and unsupported expressions. */
export function rewriteBuildEntrypoints(root, files, renames, ts, { read = (file) => readFileSync(join(root, file), "utf8"), write = (file, text) => writeFileSync(join(root, file), text) } = {}) {
  const moved = new Map(renames.map(rename => [posix.normalize(rename.from), rename]))
  const edits = [], warnings = new Set()
  for (const file of files.filter(file => configFile.test(file) && !testPath.test(file))) {
    const directory = packageDirOf(root, file)
    // A config in a different directory can be loaded with an arbitrary CLI root.
    if (posix.dirname(file) !== directory) {
      warnings.add(`${file}:1: configuration outside its package root left as written`)
      continue
    }
    const text = read(file)
    const warn = (node, message) => warnings.add(`${file}:${ts.getLineAndCharacterOfPosition(node.getSourceFile(), node.getStart()).line + 1}: ${message}`)
    const { source, literals } = entries(text, file, ts, warn)
    const changes = []
    for (const { node, base } of literals) {
      if (posix.isAbsolute(node.text) || posix.isAbsolute(base)) continue
      const renamed = moved.get(posix.normalize(posix.join(directory, base, node.text)))
      if (!renamed || !node.text.endsWith(".ts")) continue
      const to = node.text.slice(0, -3) + ".vibe"
      const edit = literalEdit(node, source, to)
      if (!edit) { warn(node, "escaped build input suffix left as written"); continue }
      changes.push(edit)
      edits.push({ file, source: renamed.from, from: node.text, to })
    }
    if (changes.length) write(file, applyEdits(text, changes))
  }
  return { edits, warnings: [...warnings] }
}

/** Undo recorded entries for one reverted module, preserving every other config byte. */
export function restoreBuildEntrypoints(root, recorded, restored, ts) {
  const edits = []
  const relevant = recorded.filter(edit => edit.source === restored)
  for (const file of new Set(relevant.map(edit => edit.file))) {
    if (!existsSync(join(root, file))) continue
    const text = readFileSync(join(root, file), "utf8")
    const { source, literals } = entries(text, file, ts, () => {})
    const remaining = relevant.filter(edit => edit.file === file)
    const changes = []
    for (const { node, base } of literals) {
      const target = posix.normalize(posix.join(packageDirOf(root, file), base, node.text))
      const index = remaining.findIndex(edit => edit.to === node.text && target === edit.source.replace(/\.ts$/, ".vibe"))
      if (index < 0) continue
      const original = remaining.splice(index, 1)[0]
      const edit = literalEdit(node, source, original.from)
      if (!edit) continue
      changes.push(edit)
      edits.push({ file, from: original.to, to: original.from })
    }
    if (changes.length) writeFileSync(join(root, file), applyEdits(text, changes))
  }
  return edits
}
