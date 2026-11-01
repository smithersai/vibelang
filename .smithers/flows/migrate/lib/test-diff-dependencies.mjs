// Detail 272, fifth addendum: an actual new runtime dependency is the sole
// permitted expected-dependency assertion addition.
import { posix } from "node:path"
const unwrap = (ts, n) => { while (ts.isParenthesizedExpression(n)) n = n.expression; return n }
const key = (ts, n) => ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : null
function dependencies(ts, n, bindings, seen = new Set()) {
  n = unwrap(ts, n)
  if (ts.isPropertyAccessExpression(n)) {
    if (n.name.text === "dependencies") return true
    // Object.keys(...).sort() retains the dependencies collection.
    return false
  }
  if (ts.isElementAccessExpression(n)) return ts.isStringLiteral(n.argumentExpression) && n.argumentExpression.text === "dependencies"
  if (ts.isIdentifier(n) && bindings.get(n.text) && !seen.has(n.text))
    return dependencies(ts, bindings.get(n.text), bindings, new Set([...seen, n.text]))
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
    const e = n.expression
    if (e.name.text === "sort" && n.arguments.length === 0) return dependencies(ts, e.expression, bindings, seen)
    if (e.name.text === "keys" && ts.isIdentifier(e.expression) && e.expression.text === "Object" &&
      bindings.role("Object", "Object") && n.arguments.length === 1) return dependencies(ts, n.arguments[0], bindings, seen)
  }
  return false
}
function actual(ts, expected, bindings) {
  let n = expected
  while (ts.isParenthesizedExpression(n.parent)) n = n.parent
  const p = n.parent
  if (!ts.isCallExpression(p)) return null
  const e = p.expression
  if (p.arguments[0] === n && p.arguments.length === 1 && ts.isPropertyAccessExpression(e) &&
    ["toEqual", "toStrictEqual", "eql", "equal"].includes(e.name.text)) {
    let receiver = e.expression
    // Chai expect(x).to.deep.equal(expected).
    while (ts.isPropertyAccessExpression(receiver)) {
      if (!["to", "deep"].includes(receiver.name.text)) return null
      receiver = receiver.expression
    }
    if (ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression) &&
      receiver.expression.text === "expect" && bindings.role("expect", "expect") && receiver.arguments.length === 1) return receiver.arguments[0]
  }
  if (p.arguments[1] === n && p.arguments.length >= 2 && ts.isPropertyAccessExpression(e) &&
    ["deepEqual", "deepStrictEqual"].includes(e.name.text)) {
    let receiver = e.expression
    while (ts.isPropertyAccessExpression(receiver)) receiver = receiver.expression
    if (ts.isIdentifier(receiver) && receiver.text === "assert" && bindings.role("assert", "assert")) return p.arguments[0]
  }
  return null
}
export function dependencyCandidate(ts, n, bindings) {
  if (!ts.isArrayLiteralExpression(n) && !ts.isObjectLiteralExpression(n)) return false
  const value = actual(ts, n, bindings)
  if (value && dependencies(ts, value, bindings)) return true
  // A package-object expectation can contain its own dependencies table.
  const p = n.parent
  return ts.isPropertyAssignment(p) && p.initializer === n && key(ts, p.name) === "dependencies" &&
    ts.isObjectLiteralExpression(p.parent) && actual(ts, p.parent, bindings) !== null
}
function owningPackage(file, before, after) {
  let dir = posix.dirname(file)
  while (true) {
    const path = posix.join(dir, "package.json")
    if (Object.hasOwn(before, path) || Object.hasOwn(after, path)) return path
    if (dir === ".") return null
    dir = posix.dirname(dir)
  }
}
function tokens(ts, text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  const out = []
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if ([ts.SyntaxKind.WhitespaceTrivia, ts.SyntaxKind.NewLineTrivia].includes(kind)) continue
    out.push({ kind, text: scanner.getTokenText(), start: scanner.getTokenPos(), end: scanner.getTextPos() })
  }
  return out
}
export function proveDependencyAddition({ ts, file, old, next, before, after }) {
  const path = owningPackage(file, before, after)
  if (!path) throw new Error("test has no owning package manifest")
  let a, b
  try { a = JSON.parse(before[path]); b = JSON.parse(after[path]) }
  catch { throw new Error("cannot read the owning package's pinned manifests") }
  if (Object.hasOwn(a.dependencies ?? {}, "vibelang-runtime") ||
    !Object.hasOwn(b.dependencies ?? {}, "vibelang-runtime") ||
    typeof b.dependencies["vibelang-runtime"] !== "string" || !b.dependencies["vibelang-runtime"])
    throw new Error("test's package did not gain vibelang-runtime in dependencies")
  const list = ts.isArrayLiteralExpression(old)
  if (list !== ts.isArrayLiteralExpression(next)) throw new Error("dependency collection kind changed")
  const members = n => list ? [...n.elements] : [...n.properties]
  const name = n => list ? ts.isStringLiteral(n) ? n.text : null :
    ts.isPropertyAssignment(n) ? key(ts, n.name) : null
  const oldMembers = members(old), nextMembers = members(next)
  if (oldMembers.some(n => name(n) === null) || nextMembers.some(n => name(n) === null) ||
    oldMembers.some(n => name(n) === "vibelang-runtime") || nextMembers.length !== oldMembers.length + 1)
    throw new Error("expected dependencies must gain exactly one vibelang-runtime entry")
  const added = nextMembers.filter(n => name(n) === "vibelang-runtime")
  if (added.length !== 1) throw new Error("expected dependencies must gain exactly one vibelang-runtime entry")
  if (!list && (!ts.isStringLiteral(added[0].initializer) || added[0].initializer.text !== b.dependencies["vibelang-runtime"]))
    throw new Error("expected runtime version does not match the package's new dependency")
  const start = added[0].getStart() - next.getStart(), end = added[0].end - next.getStart()
  const nextTokens = tokens(ts, next.getText())
  const first = nextTokens.findIndex(t => t.start >= start)
  const last = nextTokens.findLastIndex(t => t.end <= end)
  // Delete precisely the added AST member and one adjacent separator. Keeping
  // every other token, including comments, prevents hidden assertion edits.
  const indices = new Set(Array.from({ length: last - first + 1 }, (_, i) => first + i))
  if (nextTokens[first - 1]?.kind === ts.SyntaxKind.CommaToken) indices.add(first - 1)
  else if (nextTokens[last + 1]?.kind === ts.SyntaxKind.CommaToken) indices.add(last + 1)
  const signature = xs => xs.map(t => [t.kind, t.text])
  if (JSON.stringify(signature(tokens(ts, old.getText()))) !==
    JSON.stringify(signature(nextTokens.filter((_, i) => !indices.has(i)))))
    throw new Error("other dependency assertion tokens changed")
  return { package: path, dependency: "vibelang-runtime", version: b.dependencies["vibelang-runtime"] }
}
