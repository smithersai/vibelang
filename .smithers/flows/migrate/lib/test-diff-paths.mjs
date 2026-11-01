// Detail 272, fourth addendum. Interpret paths against pinned inventories;
// never evaluate target code or inspect the host filesystem.
import { posix } from "node:path"
const literal = (ts, n) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
const unwrap = (ts, n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAwaitExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n))) n = n.expression
  return n
}
const meta = (ts, n, name) => ts.isPropertyAccessExpression(n) && n.name.text === name &&
  ts.isMetaProperty(n.expression) && n.expression.keywordToken === ts.SyntaxKind.ImportKeyword && n.expression.name.text === "meta"
const failure = () => { throw new Error("path is not statically resolvable") }
function pathMethod(ts, n, bindings) {
  if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "path" || bindings.has(n.expression.text)) && bindings.role(n.expression.text, "path"))
    return ["join", "resolve"].includes(n.name.text) ? n.name.text : null
  if (ts.isIdentifier(n)) for (const name of ["join", "resolve"])
    if (bindings.role(n.text, "path:" + name) && (bindings.has(n.text) || ["join", "resolve"].includes(n.text))) return name
  return null
}
const urlCall = (ts, n, bindings) => ts.isNewExpression(n) && ts.isIdentifier(n.expression) &&
  n.expression.text === "URL" && bindings.role("URL", "URL")
function pathExpression(ts, node, bindings) {
  let n = node
  while (ts.isParenthesizedExpression(n.parent)) n = n.parent
  const p = n.parent
  return (ts.isCallExpression(p) && pathMethod(ts, p.expression, bindings) ||
    urlCall(ts, p, bindings)) && p.arguments?.includes(n) ? p : node
}
export function pathCandidate(ts, n) {
  return literal(ts, n) && /\.(?:tsx?|vibe|vibex)$/.test(n.text) && !n.text.startsWith("!") && !/[*?{}]/.test(n.text) && !/^\.(?:tsx?|vibe|vibex)$/.test(n.text)
}
function safeJoin(base, part) {
  // posix.normalize clamps absolute '..' at '/', which would hide an escape
  // from our abstract repository root. Reject that escape before normalizing.
  if (base.startsWith("/")) {
    let depth = base.split("/").filter(Boolean).length
    for (const piece of part.split("/")) {
      if (piece === "..") { if (--depth < 0) return failure() }
      else if (piece && piece !== ".") depth++
    }
  }
  return posix.join(base, part)
}
function resolveStatic(ts, n, bindings, file, seen = new Set()) {
  n = unwrap(ts, n)
  if (!n) return failure()
  if (literal(ts, n)) return n.text
  if (ts.isIdentifier(n)) {
    if (n.text === "__dirname" && bindings.role(n.text, "dirname")) return "/" + posix.dirname(file)
    const value = bindings.get(n.text)
    if (!value || seen.has(n.text)) return failure()
    return resolveStatic(ts, value, bindings, file, new Set([...seen, n.text]))
  }
  if (meta(ts, n, "dirname")) return "/" + posix.dirname(file)
  if (meta(ts, n, "url")) return "/" + file
  if (ts.isCallExpression(n) && pathMethod(ts, n.expression, bindings)) {
    if (!n.arguments.length) return failure()
    const parts = n.arguments.map(arg => resolveStatic(ts, arg, bindings, file, seen))
    // A bare relative base is repo-rooted; __dirname/import.meta.dirname and
    // derived constants carry an absolute abstract root, never a host path.
    let value = ""
    for (const part of parts) {
      if (pathMethod(ts, n.expression, bindings) === "resolve" && part.startsWith("/")) value = part
      else value = safeJoin(value || ".", part)
    }
    return value
  }
  if (urlCall(ts, n, bindings) && n.arguments?.length === 2 && meta(ts, n.arguments[1], "url")) {
    const part = resolveStatic(ts, n.arguments[0], bindings, file, seen)
    if (part.includes(":") || part.includes("?") || part.includes("#")) return failure()
    return part.startsWith("/") ? part : safeJoin("/" + posix.dirname(file), part)
  }
  return failure()
}
function pathsFor(ts, node, bindings, file, tree, seen = new Set()) {
  node = unwrap(ts, node)
  if (ts.isIdentifier(node) && bindings.get(node.text) && !seen.has(node.text))
    return pathsFor(ts, bindings.get(node.text), bindings, file, tree, new Set([...seen, node.text]))
  const expression = pathExpression(ts, node, bindings)
  const value = resolveStatic(ts, expression, bindings, file)
  if (value.includes("\\") || value.includes(":") || /[?#\x00]/.test(value)) return failure()
  const paths = expression === node && literal(ts, node) && !value.startsWith("/") ?
    [posix.join(posix.dirname(file), value), value] : [value.replace(/^\//, "")]
  return [...new Set(paths.map(p => posix.normalize(p)))].filter(p =>
    p !== ".." && !p.startsWith("../") && Object.hasOwn(tree, p))
}
function readArgument(ts, n) {
  if (!ts.isCallExpression(n)) return null
  const e = n.expression
  if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) {
    const name = ts.isIdentifier(e) ? e.text : e.name.text
    if (/^readFile/.test(name)) return n.arguments[0]
    if (name === "text" && ts.isPropertyAccessExpression(e) && ts.isCallExpression(e.expression)) {
      const file = e.expression
      if (ts.isPropertyAccessExpression(file.expression) && file.expression.name.text === "file" &&
        ts.isIdentifier(file.expression.expression) && file.expression.expression.text === "Bun") return file.arguments[0]
    }
  }
  return null
}
const contains = (ts, n, pred) => {
  if (!n) return false
  if (pred(n)) return true
  let found = false
  ts.forEachChild(n, c => { if (contains(ts, c, pred)) found = true })
  return found
}
function assertedText(ts, source, bindings, file, tree, target, pathNode) {
  const reads = new Set(), aliases = new Set(), textNames = new Set()
  // Imported reader aliases are still reads.
  const readerAliases = new Set()
  const scanAliases = n => {
    if (ts.isImportDeclaration(n) && literal(ts, n.moduleSpecifier) &&
      ["fs", "node:fs", "fs/promises", "node:fs/promises"].includes(n.moduleSpecifier.text)) {
      const named = n.importClause?.namedBindings
      if (named && ts.isNamedImports(named)) for (const s of named.elements)
        if ((s.propertyName ?? s.name).text.startsWith("readFile")) readerAliases.add(s.name.text)
    }
    ts.forEachChild(n, scanAliases)
  }
  scanAliases(source)
  const tainted = n => contains(ts, n, c => reads.has(c) || ts.isIdentifier(c) && textNames.has(c.text))
  const pathTainted = n => contains(ts, n, c => c === pathNode || ts.isIdentifier(c) && aliases.has(c.text))
  const names = (n, set) => {
    if (ts.isIdentifier(n)) { const size = set.size; set.add(n.text); return size !== set.size }
    let changed = false
    ts.forEachChild(n, c => { if (names(c, set)) changed = true })
    return changed
  }
  const scan = n => {
    const arg = readArgument(ts, n) ?? (ts.isCallExpression(n) && ts.isIdentifier(n.expression) &&
      readerAliases.has(n.expression.text) ? n.arguments[0] : null)
    if (arg) {
      if (pathTainted(arg)) reads.add(n)
      try { if (pathsFor(ts, arg, bindings, file, tree).includes(target)) reads.add(n) }
      catch {
        // A reader with the edited literal inside an unresolvable expression
        // cannot prove this file's contents remain an independent oracle.
        if (contains(ts, arg, c => c === pathNode)) reads.add(n)
      }
    }
    ts.forEachChild(n, scan)
  }
  scan(source)
  let changed = true
  while (changed) {
    changed = false
    const visit = n => {
      const variable = ts.isVariableDeclaration(n) && n.initializer
      const assign = ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
      if (variable || assign) {
        const value = variable ? n.initializer : n.right, name = variable ? n.name : n.left
        if (tainted(value) && names(name, textNames)) changed = true
        if (pathTainted(value) && names(name, aliases)) changed = true
      }
      ts.forEachChild(n, visit)
    }
    visit(source)
    const count = reads.size
    scan(source)
    if (reads.size !== count) changed = true
  }
  let rejected = false
  const visit = n => {
    if (ts.isCallExpression(n)) {
      // Assertion chains include expect(...), assert.*, Chai and snapshots.
      const callee = n.expression.getText(source)
      const assertion = /(?:^|\.)(?:expect|assert|equal|deepEqual|strictEqual|ok|should)$/.test(callee) ||
        /^(?:expect|assert|should)(?:\.|\()/.test(callee)
      if (assertion && (tainted(n) || pathTainted(n))) rejected = true
      // Unknown consumers of source text may assert inside a helper; refuse
      // rather than claim an interprocedural proof we did not perform.
      if (!reads.has(n) && n.arguments.some(tainted)) rejected = true
      if (tainted(n.expression) && n.arguments.some(arg => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) rejected = true
      if (reads.has(n) && n.arguments.some(arg => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) rejected = true
    }
    if (ts.isReturnStatement(n) && n.expression && tainted(n.expression)) rejected = true
    ts.forEachChild(n, visit)
  }
  visit(source)
  return rejected
}
export function provePathRename({ ts, file, old, next, a, b, before, after, renames }) {
  if (!/\.tsx?$/.test(old.text) || next.text !== old.text.replace(/\.tsx?$/, ext => ext === ".tsx" ? ".vibex" : ".vibe"))
    throw new Error("path edit is not a same-path source-extension rename")
  // An unproven module-loader role must not fall back to the generic path rule.
  let parent = old.parent
  while (ts.isParenthesizedExpression(parent)) parent = parent.parent
  if (ts.isCallExpression(parent) && /^(?:require|vi\.mock|jest\.mock)$/.test(parent.expression.getText()))
    throw new Error("module loader is shadowed or unproven")
  const from = pathsFor(ts, old, a.bindings, file, before), to = pathsFor(ts, next, b.bindings, file, after)
  if (from.length !== 1 || to.length !== 1) throw new Error("path does not resolve uniquely to a migrated file")
  const rename = renames.find(r => r.from === from[0] && r.to === to[0])
  if (!rename) throw new Error("path does not resolve to the rename map's migrated file")
  if (assertedText(ts, a.source, a.bindings, file, before, rename.from, old) ||
    assertedText(ts, b.source, b.bindings, file, after, rename.to, next))
    throw new Error("keep `.ts`, send to migfix: source text or the edited path reaches an assertion")
  return rename
}
