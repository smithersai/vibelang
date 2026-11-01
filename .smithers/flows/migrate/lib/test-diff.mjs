// Detail 272: a test remains the migration's oracle. Only AST module-path
// literals and extension selectors with an identical file set may change.
// No target code is executed: the selector interpreter is deliberately finite.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, posix } from "node:path"
import { isTestFile, isFixtureFile } from "./inventory.mjs"
import { pathCandidate, provePathRename } from "./test-diff-paths.mjs"
import { dependencyCandidate, proveDependencyAddition } from "./test-diff-dependencies.mjs"

export const isProtectedFile = path => isTestFile(path) || isFixtureFile(path)

const globCache = new Map()

// Vite transforms have used engine defaults and explicit extglob disabling.
// Read the installed transform, rather than guessing a version
// threshold or proving a different matcher. Never execute target tool code.
function viteGlobOptions(ts, vite) {
  if (!ts) throw new Error("TypeScript parser required for the glob proof")
  const chunks = join(dirname(vite), "dist/node/chunks")
  const matches = []
  for (const file of readdirSync(chunks).filter(f => f.endsWith(".js"))) {
    const text = readFileSync(join(chunks, file), "utf8")
    if (!text.includes("transformGlobImport")) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
    if (source.parseDiagnostics.length) throw new Error("installed Vite glob transform is not parseable")
    const calls = n => {
      if (ts.isCallExpression(n) && n.arguments.length >= 2 && ts.isIdentifier(n.expression) && n.expression.text === "glob" &&
        ts.isIdentifier(n.arguments[0]) && n.arguments[0].text === "globsResolved" &&
        ts.isObjectLiteralExpression(n.arguments[1])) matches.push(n.arguments[1])
      ts.forEachChild(n, calls)
    }
    const functions = n => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "transformGlobImport") calls(n.body)
      else ts.forEachChild(n, functions)
    }
    functions(source)
  }
  if (matches.length !== 1) throw new Error("installed Vite glob transform is unsupported")
  const option = (n, name) => ts.isPropertyAccessExpression(n) &&
    ts.isIdentifier(n.expression) && n.name.text === name
  const doubleNot = (n, name) => ts.isPrefixUnaryExpression(n) &&
    n.operator === ts.SyntaxKind.ExclamationToken && ts.isPrefixUnaryExpression(n.operand) &&
    n.operand.operator === ts.SyntaxKind.ExclamationToken && option(n.operand.operand, name)
  const nodeModules = n => ts.isStringLiteral(n) && n.text === "**/node_modules/**" ||
    ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "join" &&
    n.arguments.length === 2 && ts.isIdentifier(n.arguments[0]) && n.arguments[0].text === "cwd" &&
    ts.isStringLiteral(n.arguments[1]) && n.arguments[1].text === "**/node_modules/**"
  const supportedDynamic = (name, n) => name === "dot" && doubleNot(n, "exhaustive") ||
    name === "caseSensitiveMatch" && ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      option(n.left, "caseSensitive") && n.right.kind === ts.SyntaxKind.TrueKeyword ||
    name === "ignore" && ts.isConditionalExpression(n) && option(n.condition, "exhaustive") &&
      ts.isArrayLiteralExpression(n.whenTrue) && n.whenTrue.elements.length === 0 &&
      ts.isArrayLiteralExpression(n.whenFalse) && n.whenFalse.elements.length === 1 &&
      nodeModules(n.whenFalse.elements[0])
  const options = {}
  for (const p of matches[0].properties) {
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === "cwd") continue
    if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) throw new Error("unsupported Vite glob option")
    const name = p.name.text
    // Absolute paths/cwd change the output representation; the proof mirrors
    // them to repository-relative paths. These dynamic options come from the
    // test's exhaustive/caseSensitive settings, evaluated below.
    if (["absolute", "cwd"].includes(name)) continue
    if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(p.initializer.kind))
      options[name] = p.initializer.kind === ts.SyntaxKind.TrueKeyword
    else if (!supportedDynamic(name, p.initializer))
      throw new Error("unsupported dynamic Vite glob option")
  }
  return options
}

export function loadGlob(directories, ts) {
  for (const dir of directories) {
    const require = createRequire(join(dir, "package.json"))
    let vite
    try { vite = require.resolve("vite/package.json") }
    catch { continue }
    if (globCache.has(vite)) return globCache.get(vite)
    const tool = createRequire(vite)
    const manifest = tool(vite)
    const dependencies = manifest.dependencies ?? {}
    let sync, library
    if (dependencies.tinyglobby) { library = "tinyglobby"; sync = tool("tinyglobby").globSync }
    else if (dependencies["fast-glob"]) { library = "fast-glob"; sync = tool("fast-glob").sync }
    else throw new Error("installed Vite has no supported glob engine")
    let options
    try { options = viteGlobOptions(ts, vite) }
    catch (error) {
      throw new Error(error.code ? "installed Vite glob transform is unreadable" : error.message)
    }
    const result = { library: "vite@" + manifest.version + ":" + library, sync, options }
    globCache.set(vite, result)
    return result
  }
  throw new Error("cannot resolve Vite's glob library from the target; cannot prove selector identity")
}

const string = (ts, n) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
const children = (ts, n) => { const out = []; ts.forEachChild(n, c => { out.push(c) }); return out }
const unwrap = (ts, n) => { while (ts.isParenthesizedExpression(n) || ts.isAwaitExpression(n)) n = n.expression; return n }
const property = (ts, n, name) => ts.isPropertyAccessExpression(n) && n.name.text === name
const regex = text => {
  const end = text.lastIndexOf("/")
  const flags = text.slice(end + 1)
  if (/[gy]/.test(flags)) throw new Error("stateful selector regex is unsupported")
  return new RegExp(text.slice(1, end), flags)
}
const strip = p => p.replace(/\.(?:ts|tsx|vibe|vibex)$/, "")
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sorted = xs => [...xs].sort()
const moduleLiteral = (ts, node, bindings) => {
  if (!string(ts, node)) return false
  let argument = node
  while (ts.isParenthesizedExpression(argument.parent)) argument = argument.parent
  const p = argument.parent
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return p.moduleSpecifier === argument
  if (ts.isExternalModuleReference(p)) return p.expression === argument
  if (ts.isLiteralTypeNode(p) && ts.isImportTypeNode(p.parent)) return p.parent.argument === p
  if (!ts.isCallExpression(p) || p.arguments[0] !== argument) return false
  const e = p.expression
  return e.kind === ts.SyntaxKind.ImportKeyword ||
    ts.isIdentifier(e) && e.text === "require" && bindings.role(e.text, "require") ||
    property(ts, e, "mock") && ts.isIdentifier(e.expression) && ["vi", "jest"].includes(e.expression.text) && bindings.role(e.expression.text, "mock")
}

function parsed(ts, text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  if (source.parseDiagnostics.length) throw new Error("test is not parseable TypeScript")
  // Resolve only immutable, unambiguous names. A declaration in another
  // scope is deliberately ambiguous: never prove a selector against a
  // same-spelled outer constant or mistake a local fake for a module loader.
  const declarations = new Map()
  const mutated = new Set()
  const declare = (name, role = null) => {
    if (ts.isIdentifier(name)) {
      const list = declarations.get(name.text) ?? []
      list.push(role); declarations.set(name.text, list)
    } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
      for (const item of name.elements) if (ts.isBindingElement(item)) declare(item.name)
  }
  const importedRole = (module, name) =>
    ["vitest", "@jest/globals", "bun:test", "chai"].includes(module) && name === "expect" ? "expect" :
    ["assert", "node:assert", "assert/strict", "node:assert/strict"].includes(module) && ["*", "default"].includes(name) ? "assert" :
    ["path", "node:path"].includes(module) ? (["join", "resolve"].includes(name) ? "path:" + name : ["*", "default"].includes(name) ? "path" : null) :
    module === "vitest" && name === "vi" || module === "@jest/globals" && name === "jest" ? "mock" :
    ["fs", "node:fs", "fs/promises", "node:fs/promises"].includes(module) ?
      ["readdir", "readdirSync"].includes(name) ? "reader" : ["*", "default"].includes(name) ? "fs" : null : null
  const declarationsVisit = n => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n))
      declare(n.name)
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n)) && n.name)
      declare(n.name)
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause) {
      const clause = n.importClause, module = n.moduleSpecifier.text
      if (clause.name) declare(clause.name, importedRole(module, "default"))
      const named = clause.namedBindings
      if (named && ts.isNamespaceImport(named)) declare(named.name, importedRole(module, "*"))
      else if (named) for (const spec of named.elements) declare(spec.name, importedRole(module, (spec.propertyName ?? spec.name).text))
    }
    if (ts.isImportEqualsDeclaration(n)) declare(n.name)
    ts.forEachChild(n, declarationsVisit)
  }
  declarationsVisit(source)
  const bindings = new Map()
  for (const [name, roles] of declarations) if (roles.length === 1 && (roles[0] === "path" || roles[0]?.startsWith("path:"))) bindings.set(name, null)
  bindings.role = (name, role) => !mutated.has(name) && (!declarations.has(name) ||
    declarations.get(name).length === 1 && declarations.get(name)[0] === role)
  const visit = n => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      if (!(n.parent.flags & ts.NodeFlags.Const) || bindings.has(n.name.text)) bindings.set(n.name.text, null) // shadowing is ambiguous
      else bindings.set(n.name.text, n.initializer)
    }
    ts.forEachChild(n, visit)
  }
  visit(source)
  for (const [name, roles] of declarations)
    if (roles.length !== 1) bindings.set(name, null)
  const markWrite = n => {
    while (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) n = n.expression
    if (ts.isIdentifier(n)) { mutated.add(n.text); bindings.set(n.text, null) }
  }
  const writes = n => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
      markWrite(n.left)
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && ts.isIdentifier(n.operand) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(n.operator)) markWrite(n.operand)
    ts.forEachChild(n, writes)
  }
  writes(source)
  return { source, bindings }
}

function candidates(ts, source, bindings) {
  const found = new Map()
  const visit = (n, key) => {
    let kind
    if (moduleLiteral(ts, n, bindings)) kind = "specifier"
    else if (pathCandidate(ts, n)) kind = "path"
    else if (dependencyCandidate(ts, n, bindings)) kind = "assertion"
    else if (ts.isCallExpression(n) && property(ts, n.expression, "glob") &&
      ts.isMetaProperty(n.expression.expression) && n.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
      n.expression.expression.name.text === "meta") {
      if (n.arguments[0]) {
        found.set(key + ":glob", { kind: "glob", node: n.arguments[0], options: n.arguments[1] })
      }
    } else if (ts.isCallExpression(n) && property(ts, n.expression, "filter") && n.arguments.length === 1) {
      found.set(key + ":filter", { kind: "filter", node: n.arguments[0], input: n.expression.expression })
    }
    if (kind) found.set(key, { kind, node: n })
    children(ts, n).forEach((c, i) => visit(c, key + "." + i))
  }
  visit(source, "root")
  const filters = [...found.values()].filter(c => c.kind === "filter")
  // A named extension regex is allowed only when all of its references are
  // confined to one proven directory filter; it cannot change an assertion.
  const addRegex = (n, key) => {
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name) && bindings.get(n.parent.name.text) === n) {
      const name = n.parent.name.text, refs = []
      const scan = c => {
        if (ts.isIdentifier(c) && c.text === name && c !== n.parent.name) refs.push(c)
        ts.forEachChild(c, scan)
      }
      scan(source)
      const owners = filters.filter(f => refs.length && refs.every(r => r.pos >= f.node.pos && r.end <= f.node.end))
      if (owners.length === 1) found.set(key + ":regex", { kind: "regex", node: n, input: owners[0].input, predicate: owners[0].node })
    }
    children(ts, n).forEach((c, i) => addRegex(c, key + "." + i))
  }
  addRegex(source, "root")
  return found
}

function specifierRename(file, old, next, renames, declarationImportStyle) {
  if (!old.startsWith(".") || !next.startsWith(".")) return false
  const ext = /\.(?:tsx?|jsx?)$/.exec(old)?.[0]
  if (!ext) return false // an extensionless specifier must stay as written
  const path = posix.normalize(posix.join(posix.dirname(file), old))
  const sources = ext === ".js" ? [path.slice(0, -3) + ".ts"] :
    ext === ".jsx" ? [path.slice(0, -4) + ".tsx"] : [path]
  const rename = renames.find(r => sources.includes(r.from))
  if (!rename || !samePathRename(rename)) return false
  const targetExt = posix.extname(rename.to)
  const permitted = declarationImportStyle === "js" ? (targetExt === ".vibex" ? ".jsx" : ".js") :
    declarationImportStyle === "ts" ? (targetExt === ".vibex" ? ".tsx" : ".ts") : targetExt
  return next === old.slice(0, -ext.length) + permitted
}
const samePathRename = r => (r.from.endsWith(".ts") && r.to === r.from.slice(0, -3) + ".vibe") ||
  (r.from.endsWith(".tsx") && r.to === r.from.slice(0, -4) + ".vibex")

function patterns(ts, node) {
  if (string(ts, node)) return [node.text]
  if (ts.isArrayLiteralExpression(node) && node.elements.every(n => string(ts, n))) return node.elements.map(n => n.text)
  throw new Error("glob patterns must be literal strings")
}
function expandExtensions(p) {
  const m = /\.\{([a-z,]+)\}$/.exec(p)
  return m ? m[1].split(",").map(ext => p.slice(0, m.index) + "." + ext) : [p]
}
function globWidening(before, after) {
  const old = before.flatMap(expandExtensions)
  const next = after.flatMap(expandExtensions)
  const expected = new Set(old)
  for (const p of old) if (!p.startsWith("!")) {
    if (p.endsWith(".ts")) expected.add(p.slice(0, -3) + ".vibe")
    if (p.endsWith(".tsx")) expected.add(p.slice(0, -4) + ".vibex")
  }
  const extra = next.filter(p => !expected.has(p))
  if (extra.some(p => !p.startsWith("!") || !p.endsWith(".d.vibe.ts"))) return false
  return next.some(p => p.startsWith("!") && p.endsWith(".d.vibe.ts")) && same(sorted(next.filter(p => expected.has(p))), sorted(expected))
}

// Evaluate a small, side-effect-free subset of extension predicates. Unsupported
// expressions are refused, never passed to eval, Function, a VM, or the target.
function evaluate(ts, node, env, bindings, seen = new Set()) {
  node = unwrap(ts, node)
  if (string(ts, node)) return node.text
  if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) return regex(node.text)
  if (ts.isIdentifier(node)) {
    if (Object.hasOwn(env, node.text)) return env[node.text]
    const value = bindings.get(node.text)
    if (!value || seen.has(node.text)) throw new Error("unresolved selector binding: " + node.text)
    return evaluate(ts, value, env, bindings, new Set([...seen, node.text]))
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken)
    return !evaluate(ts, node.operand, env, bindings, seen)
  if (ts.isBinaryExpression(node)) {
    const a = evaluate(ts, node.left, env, bindings, seen)
    const b = evaluate(ts, node.right, env, bindings, seen)
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.BarBarToken: return a || b
      case ts.SyntaxKind.AmpersandAmpersandToken: return a && b
      case ts.SyntaxKind.EqualsEqualsEqualsToken: return a === b
      case ts.SyntaxKind.ExclamationEqualsEqualsToken: return a !== b
      case ts.SyntaxKind.PlusToken: if (typeof a === "string" && typeof b === "string") return a + b
    }
  }
  if (ts.isCallExpression(node) && node.arguments.length === 1) {
    const e = node.expression
    const arg = evaluate(ts, node.arguments[0], env, bindings, seen)
    if (ts.isPropertyAccessExpression(e)) {
      const receiver = evaluate(ts, e.expression, env, bindings, seen)
      if (e.name.text === "endsWith" && typeof receiver === "string" && typeof arg === "string") return receiver.endsWith(arg)
      if (e.name.text === "test" && receiver instanceof RegExp && typeof arg === "string") return receiver.test(arg)
    }
  }
  throw new Error("unsupported selector expression")
}

function predicate(ts, n, bindings) {
  n = unwrap(ts, n)
  if (ts.isIdentifier(n) && bindings.get(n.text)) n = bindings.get(n.text)
  if (!ts.isArrowFunction(n) && !ts.isFunctionExpression(n)) throw new Error("filter must have a literal predicate")
  if (n.asteriskToken || n.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword))
    throw new Error("filter must be synchronous and non-generator")
  if (n.parameters.length !== 1 || !ts.isIdentifier(n.parameters[0].name) ||
    n.parameters[0].dotDotDotToken || n.parameters[0].initializer)
    throw new Error("filter must have one plain filename parameter")
  let body = n.body
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0]) || !body.statements[0].expression)
      throw new Error("filter body must only return a predicate")
    body = body.statements[0].expression
  }
  const name = n.parameters[0].name.text
  return value => {
    const result = evaluate(ts, body, { [name]: value }, bindings)
    if (typeof result !== "boolean") throw new Error("selector does not return a boolean")
    return result
  }
}
function directory(ts, input, bindings, file, seen = new Set()) {
  input = unwrap(ts, input)
  if (ts.isIdentifier(input) && !seen.has(input.text) && bindings.get(input.text))
    return directory(ts, bindings.get(input.text), bindings, file, new Set([...seen, input.text]))
  if (!ts.isCallExpression(input) || input.arguments.length !== 1 ||
    !(ts.isIdentifier(input.expression) && ["readdir", "readdirSync"].includes(input.expression.text) ||
      ts.isPropertyAccessExpression(input.expression) && ["readdir", "readdirSync"].includes(input.expression.name.text)))
    throw new Error("filter input is not a supported readdir call")
  const reader = input.expression
  if (ts.isIdentifier(reader) ? !bindings.role(reader.text, "reader") :
    !ts.isIdentifier(reader.expression) || !bindings.role(reader.expression.text, "fs"))
    throw new Error("readdir binding is shadowed or unproven")
  const dir = evaluate(ts, input.arguments[0], {}, bindings)
  if (typeof dir !== "string" || dir.startsWith("/")) throw new Error("readdir directory must be repository relative")
  // readdir's written path is relative to the process cwd, not the test file.
  return posix.normalize(dir)
}
function extensionPredicate(ts, n, bindings) {
  // The finite interpreter alone is not authority to change arbitrary logic.
  // Only extension tests, booleans and their AND/OR/NOT composition qualify.
  const visit = node => {
    node = unwrap(ts, node)
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return visit(node.body)
    if (ts.isBlock(node)) return node.statements.length === 1 && ts.isReturnStatement(node.statements[0]) && visit(node.statements[0].expression)
    if (ts.isIdentifier(node)) return bindings.get(node.text) ? visit(bindings.get(node.text)) : true
    if (ts.isPrefixUnaryExpression(node)) return node.operator === ts.SyntaxKind.ExclamationToken && visit(node.operand)
    if (ts.isBinaryExpression(node)) return [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind) && visit(node.left) && visit(node.right)
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isPropertyAccessExpression(node.expression)) {
      const e = node.expression
      if (e.name.text === "endsWith") return string(ts, node.arguments[0]) && [".ts", ".tsx", ".vibe", ".vibex", ".d.vibe.ts"].includes(node.arguments[0].text) && ts.isIdentifier(e.expression)
      const pattern = ts.isIdentifier(e.expression) ? bindings.get(e.expression.text) : e.expression
      if (e.name.text === "test" && pattern?.kind === ts.SyntaxKind.RegularExpressionLiteral && ts.isIdentifier(node.arguments[0])) {
        // Extension regexes only; preserve all other regex semantics.
        return /^\/\\\.(?:ts|tsx|\((?:\?:)?(?:ts|tsx|vibe|vibex)(?:\|(?:ts|tsx|vibe|vibex))*\))\$\/[iu]*$/.test(pattern.text)
      }
    }
    return false
  }
  return visit(n)
}

function compareSets(old, next) {
  const before = sorted(old.map(strip))
  const after = sorted(next.map(strip))
  return { ok: same(before, after) && new Set(before).size === before.length && new Set(after).size === after.length,
    beforeCount: before.length, afterCount: after.length, before, after }
}
function materialize(tree, root) {
  mkdirSync(root, { recursive: true })
  for (const file of Object.keys(tree)) {
    if (file.startsWith("/") || file.split("/").includes("..")) throw new Error("unsafe tree path")
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), "")
  }
}
function globOptions(ts, node) {
  const out = { exhaustive: false, caseSensitive: true }
  if (!node) return out
  if (!ts.isObjectLiteralExpression(node)) throw new Error("glob options must be a literal object")
  for (const p of node.properties) {
    if (!ts.isPropertyAssignment(p)) throw new Error("unsupported glob options")
    const name = p.name.text
    if (name === "base") throw new Error("glob base option needs an explicit root resolver")
    if (!["exhaustive", "caseSensitive"].includes(name)) continue
    if (![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(p.initializer.kind))
      throw new Error("glob selection options must be literal booleans")
    out[name] = p.initializer.kind === ts.SyntaxKind.TrueKeyword
  }
  return out
}
function selectGlob(glob, pats, root, file, options, globRoot) {
  if (globRoot !== undefined && (typeof globRoot !== "string" || posix.isAbsolute(globRoot) ||
    globRoot.includes("\\") || /^[A-Za-z]:/.test(globRoot) || posix.normalize(globRoot) === ".." ||
    posix.normalize(globRoot).startsWith("../")))
    throw new Error("globRoot must be repository-relative and stay within the snapshots")
  const base = posix.dirname(file)
  const normalized = pats.map(p => {
    const neg = p.startsWith("!")
    p = neg ? p.slice(1) : p
    if (!p.startsWith(".") && !p.startsWith("/")) throw new Error("unsupported glob alias: " + p)
    if (p.startsWith("/") && globRoot === undefined) throw new Error("rooted glob requires an explicit tool root")
    const value = posix.normalize(p.startsWith("/") ? posix.join(globRoot, p.slice(1)) : posix.join(base, p))
    if (value.startsWith("../")) throw new Error("glob leaves the repository")
    return (neg ? "!" : "") + value
  })
  return sorted(glob.sync(normalized, { cwd: root, onlyFiles: true, expandDirectories: false,
    dot: options.exhaustive, caseSensitiveMatch: options.caseSensitive, caseSensitive: options.caseSensitive,
    ignore: options.exhaustive ? [] : ["**/node_modules/**"], ...glob.options })).filter(p => p !== file)
}

export function verifyTestDiff({ ts, before, after, renames, declarationImportStyle = "vibe", glob, scratch, cwd = ".", globRoot }) {
  renames = renames.filter(r => samePathRename(r) && Object.hasOwn(before, r.from) && !Object.hasOwn(after, r.from) && Object.hasOwn(after, r.to) && !Object.hasOwn(before, r.to))
  const result = { ok: true, files: [] }
  let trees
  const globTrees = () => {
    if (!trees) {
      const root = mkdtempSync(join(scratch, "selectors-"))
      trees = { root, before: join(root, "before"), after: join(root, "after") }
      materialize(before, trees.before)
      materialize(after, trees.after)
    }
    return trees
  }
  try {
    for (const file of sorted(new Set([...Object.keys(before), ...Object.keys(after)]))) {
      if (!isProtectedFile(file) || before[file] === after[file] && Object.hasOwn(before, file) === Object.hasOwn(after, file)) continue
      const entry = { file, ok: true, hunks: [] }
      result.files.push(entry)
      const reject = reason => { entry.ok = false; entry.hunks.push({ kind: "forbidden", reason }) }
      if (!Object.hasOwn(before, file) || !Object.hasOwn(after, file)) { reject("test or fixture added, removed, or renamed"); continue }
      try {
        if (Buffer.isBuffer(before[file]) || Buffer.isBuffer(after[file])) throw new Error("binary test or fixture edits are forbidden")
        if (typeof before[file] !== "string" || typeof after[file] !== "string") throw new Error("missing test snapshot")
        const a = parsed(ts, before[file], file)
        const b = parsed(ts, after[file], file)
        const ac = candidates(ts, a.source, a.bindings), bc = candidates(ts, b.source, b.bindings)
        const oldEdits = [], nextEdits = []
        const mask = (text, edits) => [...edits].sort((a, b) => b.start - a.start).reduce((out, e) => out.slice(0, e.start) + e.text + out.slice(e.end), text)
        const maskedNode = (node, edits) => mask(node.getText(), edits.filter(e => e.start >= node.getStart() && e.end <= node.end)
          .map(e => ({ ...e, start: e.start - node.getStart(), end: e.end - node.getStart() })))
        // Classify inner literals first: a module rename inside an arbitrary
        // filter is still only a module rename, not a changed file selector.
        for (const [key, x] of [...ac].sort(([, a], [, b]) => (a.node.end - a.node.pos) - (b.node.end - b.node.pos))) {
          const y = bc.get(key)
          if (!y || x.kind !== y.kind || maskedNode(x.node, oldEdits) === maskedNode(y.node, nextEdits)) continue
          const hunk = { kind: ["specifier", "path", "assertion"].includes(x.kind) ? x.kind : "selector", selector: x.kind,
            beforeLine: a.source.getLineAndCharacterOfPosition(x.node.getStart()).line + 1,
            afterLine: b.source.getLineAndCharacterOfPosition(y.node.getStart()).line + 1,
            before: x.node.getText(), after: y.node.getText() }
          try {
            if (x.kind === "specifier") {
              const style = typeof declarationImportStyle === "function" ? declarationImportStyle(file) : declarationImportStyle
              if (!specifierRename(file, x.node.text, y.node.text, renames, style))
                throw new Error("specifier is not the same-path rename of a migrated module")
            } else if (x.kind === "path") {
              hunk.resolved = provePathRename({ ts, file, old: x.node, next: y.node, a, b, before, after, renames })
            } else if (x.kind === "assertion") {
              Object.assign(hunk, proveDependencyAddition({ ts, file, old: x.node, next: y.node, before, after }))
            } else if (x.kind === "glob") {
              const ap = patterns(ts, x.node), bp = patterns(ts, y.node)
              if (!globWidening(ap, bp)) throw new Error("glob change is not an extension widening plus sidecar exclusion")
              const toolGlob = typeof glob === "function" ? glob(file) : glob
              if (!toolGlob) throw new Error("target glob library unavailable")
              const options = globOptions(ts, x.options)
              const roots = globTrees()
              hunk.library = toolGlob.library
              hunk.matcherOptions = toolGlob.options ?? {}
              hunk.setCheck = compareSets(selectGlob(toolGlob, ap, roots.before, file, options, globRoot), selectGlob(toolGlob, bp, roots.after, file, options, globRoot))
              hunk.toolRoot = globRoot ?? null
              // Check that the new selector actually excludes sidecars even if
              // this snapshot happens not to contain any yet.
              const side = Object.keys(after).filter(p => /\.(vibe|vibex)$/.test(p)).map(p => p.replace(/\.(vibe|vibex)$/, ".d.vibe.ts"))
              for (const p of side) { mkdirSync(dirname(join(roots.after, p)), { recursive: true }); writeFileSync(join(roots.after, p), "") }
              const includesSidecar = selectGlob(toolGlob, bp, roots.after, file, options, globRoot).some(p => p.endsWith(".d.vibe.ts"))
              for (const p of side) if (!Object.hasOwn(after, p)) rmSync(join(roots.after, p))
              if (includesSidecar) throw new Error("selector includes declaration sidecars")
            } else {
              const ax = x.predicate ?? x.node, by = y.predicate ?? y.node
              if (!extensionPredicate(ts, ax, a.bindings) || !extensionPredicate(ts, by, b.bindings)) throw new Error("unsupported extension predicate")
              const ap = predicate(ts, ax, a.bindings), bp = predicate(ts, by, b.bindings)
              const ad = posix.normalize(posix.join(cwd, directory(ts, x.input, a.bindings, file)))
              const bd = posix.normalize(posix.join(cwd, directory(ts, y.input, b.bindings, file)))
              if (ad !== bd || ad.startsWith("../")) throw new Error("selector directory changed or leaves the repository")
              // Since only suffix predicates qualify, these representatives
              // cover every supported extension and the complement class.
              for (const name of ["probe.ts", "probe.tsx", "probe.js", "probe.json", "probe", "probe.d.vibe.ts"]) {
                if (bp(name) !== (name.endsWith(".d.vibe.ts") ? false : ap(name))) throw new Error("selector changes an existing extension")
              }
              if (bp("probe.vibe") !== ap("probe.ts") || bp("probe.vibex") !== ap("probe.tsx"))
                throw new Error("selector is not a matching VibeLang extension widening")
              const selected = (tree, dir, pred) => {
                const entries = new Set()
                const prefix = dir === "." ? "" : dir + "/"
                for (const path of Object.keys(tree)) if (path.startsWith(prefix)) {
                  const name = path.slice(prefix.length).split("/")[0]
                  if (name && pred(name)) entries.add(prefix + name)
                }
                return [...entries]
              }
              hunk.setCheck = compareSets(selected(before, ad, ap), selected(after, bd, bp))
            }
            if (hunk.setCheck && !hunk.setCheck.ok) throw new Error("selector adds or drops file identities")
            entry.hunks.push(hunk)
            oldEdits.push({ start: x.node.getStart(), end: x.node.end, text: "<allowed:" + key + ">" })
            nextEdits.push({ start: y.node.getStart(), end: y.node.end, text: "<allowed:" + key + ">" })
          } catch (error) {
            entry.ok = false
            const { before: _before, after: _after, ...location } = hunk
            entry.hunks.push({ ...location, kind: "forbidden", reason: error.message })
          }
        }
        if (mask(before[file], oldEdits) !== mask(after[file], nextEdits)) reject("changes remain outside permitted AST literals/selectors")
      } catch (error) { reject(error.message) }
    }
  } finally { if (trees) rmSync(trees.root, { recursive: true, force: true }) }
  result.ok = result.files.every(f => f.ok)
  return result
}

export function testDiffMarkdown(result) {
  const code = value => "`" + String(value).replaceAll("`", "\\`").replaceAll("\n", " ") + "`"
  return [
    "### Test and fixture diff (detail 272)",
    "",
    result.ok ? "PASS: every changed test or fixture preserves its oracle." : "FAIL: forbidden test or fixture edits.",
    "",
    ...result.files.flatMap(f => [
      "- " + code(f.file) + ": " + (f.ok ? "PASS" : "FAIL"),
      ...f.hunks.filter(h => h.kind !== "assertion").flatMap(h => [
        "  - " + h.kind + (h.beforeLine ? " at line " + h.beforeLine : "") + ": " + (h.reason ?? (code(h.before) + " → " + code(h.after))),
        ...(h.setCheck ? [
          "    - Before (" + h.setCheck.beforeCount + "): " + h.setCheck.before.map(code).join(", "),
          "    - After (" + h.setCheck.afterCount + "): " + h.setCheck.after.map(code).join(", ")
        ] : [])
      ])
    ]),
    ...(result.files.length ? [] : ["No test or fixture changed."]),
    "",
    "#### assertion edits",
    "",
    ...(() => {
      const edits = result.files.flatMap(f => f.hunks.filter(h => h.kind === "assertion").map(h =>
        "- " + code(f.file) + " at line " + h.beforeLine + ": add " + code(h.dependency) +
        " (" + code(h.version) + ") in " + code(h.package) + "; " + code(h.before) + " → " + code(h.after)))
      return edits.length ? edits : ["None."]
    })(),
    ""
  ].join("\n")
}

