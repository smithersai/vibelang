// Lost-wrapper check for migrated modules, the reverse of run-phase.mjs. A
// conversion can drop an Effect constructor and still pass everything else: in
// a plain function, `Effect.succeed(xs)` becoming `xs`, or `Effect.fail(e)`
// becoming `throw e`, type-checks behind an `as` cast or a contextual type,
// declares the same API, and adds no wrapper for a wrapper-gain audit to see.
// So this check compares each function of the original TypeScript with the
// same function of the emitted JavaScript, and reports a function that is
// plain in the emitted JavaScript and hands back fewer Effect values.
//
// It reads the JavaScript because TypeScript's parser recovers badly on .vibe.
// Functions pair by name path: variable, property, method, function and class
// names, and for a callback the callee and the argument index that holds it,
// `make/parallel/Effect.map(0)`. Position breaks only ties under one path, so
// a call the compiler inserts or moves cannot shift a callback onto another's
// original. A body handed to `Effect.gen` belongs to the function around it,
// which lets `(x) => Effect.gen(function* …)` pair with the emitted
// `Effect.fnUntraced(function* …)`.
//
// Each arm of a returned `?:`, `??`, `||` or `&&` counts on its own, so one arm
// losing its wrapper shows. An arm counts as an Effect when it reads, outside
// nested functions, a member of Effect or a program from vibelang-runtime. A
// program handed back through a local name or a helper counts on neither side:
// the text cannot see it, and it needs types.
import { existsSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
const isTestFile = (path) => /\.(?:test|spec)\.[^/]+$/.test(path)
const inTestDirectory = (path) => /(?:^|\/)(?:test|tests|__tests__)\//.test(path)

const factories = /^Effect\.(fn|fnUntraced|fnUntracedEager)$/
const generatorRunners = /^Effect\.(gen|genUntraced)$/
// Runtime helpers the compiler wraps a generator body in, and those that hand back a value, not a program.
const frames = /^vibelang-runtime\.\$(joinedFrame|iteratorFrame)$/
const runtimeValues = /^vibelang-runtime\.\$(is|extract|normal)$/

/**
 * How a module binds Effect and the runtime: `namespaces`, each name for
 * Effect's namespace (`Effect`, and `E` in `import { Effect as E } from "effect"`
 * or `import * as E from "effect/Effect"`); `runtime`, each name for
 * vibelang-runtime's; and `members`, the single names imported from either.
 */
function bindingsOf(ts, source) {
  const namespaces = new Set(["Effect"]), runtime = new Set(), members = new Map()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings) continue
    const module = statement.moduleSpecifier.text, bindings = statement.importClause.namedBindings
    if (ts.isNamespaceImport(bindings)) {
      if (module === "effect/Effect") namespaces.add(bindings.name.text)
      if (module === "vibelang-runtime") runtime.add(bindings.name.text)
    } else if (ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text
        if (imported === "Effect" && /^effect(\/|$)/.test(module)) namespaces.add(element.name.text)
        if (module === "effect/Effect") members.set(element.name.text, "Effect." + imported)
        if (module === "vibelang-runtime") members.set(element.name.text, "vibelang-runtime." + imported)
      }
    }
  }
  return { namespaces, runtime, members }
}

const unwrap = (ts, node) => {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression
  return node
}

/** A callee's name, the same in both texts: type arguments, casts and callback bodies drop out, and each spelling of Effect's or the runtime's namespace reads one way. */
function calleeName(ts, node, bound) {
  node = unwrap(ts, node)
  if (ts.isIdentifier(node)) {
    if (bound.namespaces.has(node.text) || /^Effect_\d+$/.test(node.text)) return "Effect"
    if (bound.runtime.has(node.text)) return "vibelang-runtime"
    return bound.members.get(node.text) ?? node.text
  }
  if (node.kind === ts.SyntaxKind.ThisKeyword) return "this"
  if (ts.isPropertyAccessExpression(node)) {
    const left = calleeName(ts, node.expression, bound)
    // effect_1.Effect.map, the module-object spelling of Effect.map.
    if (node.name.text === "Effect" && /^effect(_\d+)?$/.test(left)) return "Effect"
    return left + "." + node.name.text
  }
  if (ts.isElementAccessExpression(node)) return calleeName(ts, node.expression, bound) + "[]"
  if (ts.isCallExpression(node)) return calleeName(ts, node.expression, bound) + "()"
  return "?"
}

const staticName = (ts, name) => {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return ts.isComputedPropertyName(name) ? "[" + name.expression.getText() + "]" : null
}
const isFunction = (ts, node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)

/** The method `m` of `{ m() { … } }.m`, or undefined. */
const namedMethod = (ts, node) => {
  if (!ts.isPropertyAccessExpression(node)) return undefined
  const object = unwrap(ts, node.expression)
  if (!ts.isObjectLiteralExpression(object)) return undefined
  return object.properties.find(property => ts.isMethodDeclaration(property) && property.name.getText() === node.name.text)
}

/** Whether an expression reads a member of Effect or calls a program from the runtime, outside nested functions. Types are never read: `x as Effect.Effect<A>` is no Effect. */
function readsEffect(ts, expression, bound) {
  let found = false
  const visit = (node) => {
    if (found || ts.isFunctionLike(node) || ts.isClassLike(node)) return
    if (ts.isPropertyAccessExpression(node) && /^Effect\./.test(calleeName(ts, node, bound))) found = true
    else if (ts.isIdentifier(node) && /^Effect\./.test(bound.members.get(node.text) ?? "")) found = true
    else if (ts.isCallExpression(node) && /^vibelang-runtime\./.test(calleeName(ts, node.expression, bound)) && !runtimeValues.test(calleeName(ts, node.expression, bound))) found = true
    else ts.forEachChild(node, visit)
  }
  visit(expression)
  return found
}

/** A returned expression's arms: each result a `?:`, `??`, `||` or `&&` can hand back. */
function arms(ts, expression) {
  const node = unwrap(ts, expression)
  if (ts.isConditionalExpression(node)) return [...arms(ts, node.whenTrue), ...arms(ts, node.whenFalse)]
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) return [...arms(ts, node.left), ...arms(ts, node.right)]
  return [node]
}

/** What a function's body hands back and does at the call. */
function bodyShape(ts, fn, bound) {
  const shape = { effects: 0, returns: 0, throws: 0, castReturn: false }
  const count = (expression) => {
    for (const arm of arms(ts, expression)) {
      shape.returns++
      if (readsEffect(ts, arm, bound)) shape.effects++
    }
    let inner = expression
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression
    if (ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) shape.castReturn = true
  }
  if (!fn.body) return shape
  if (!ts.isBlock(fn.body)) { count(fn.body); return shape }
  const visit = (node) => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return
    if (ts.isThrowStatement(node)) shape.throws++
    if (ts.isReturnStatement(node) && node.expression) count(node.expression)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(fn.body, visit)
  return shape
}

const castAround = (ts, fn) => {
  for (let node = fn.parent; node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isTypeAssertionExpression(node)); node = node.parent) {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return true
  }
  return false
}

/**
 * The functions of a module's text by name path. Each has `effects` and
 * `returns` (its returns that read Effect, and all its returns), `throws`
 * (outside nested functions), `generator` and `factory` (the function a
 * `Effect.fn` holds, a program at every call).
 */
export function functionsOf(ts, text, file = "module.ts") {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const bound = bindingsOf(ts, source)
  const found = new Map(), ordinals = new Map()
  const add = (path, fn, factory) => {
    const ordinal = ordinals.get(path) ?? 0
    ordinals.set(path, ordinal + 1)
    const key = ordinal ? `${path}#${ordinal}` : path
    const shape = bodyShape(ts, fn, bound)
    found.set(key, { ...shape, name: key, generator: !!fn.asteriskToken, factory, cast: castAround(ts, fn) || shape.castReturn, line: source.getLineAndCharacterOfPosition(fn.getStart(source)).line + 1 })
    return key
  }
  // `named`: the path's last segment still waits for the function it names.
  const visit = (node, path, named) => {
    if (ts.isCallExpression(node)) {
      visit(node.expression, path, false)
      const callee = calleeName(ts, node.expression, bound)
      const factory = factories.test(callee.replace(/\(\)$/, ""))
      if (frames.test(callee) && node.arguments.length) { visit(node.arguments[0], path, named); return }
      node.arguments.forEach((argument, index) => {
        const value = unwrap(ts, argument)
        if (generatorRunners.test(callee) && ts.isFunctionExpression(value)) { visit(value.body, path, false); return }
        if (factory && ts.isStringLiteralLike(value)) return
        if (factory && index === 0) {
          // The compiler also writes `Effect.fnUntraced({ *run(x) { … } }.run)` to keep a name.
          const held = namedMethod(ts, value) ?? value
          // Effect.fn("name")(Effect.fnUntraced(function* …)), as the compiler writes `Effect.fn("name")(x => Effect.gen(…))`.
          if (!isFunction(ts, held)) { visit(argument, path, named); return }
          visit(held.body, add(path + (named ? "" : "/anon"), held, true), false)
          return
        }
        visit(argument, `${path}/${callee}(${index})`, true)
      })
      return
    }
    if (isFunction(ts, node)) {
      if (!node.body) return
      // A function expression's own name is private to it; what holds it names it.
      const own = ts.isConstructorDeclaration(node) ? "constructor" : ts.isFunctionExpression(node) && named ? null : staticName(ts, node.name)
      const prefix = ts.isGetAccessorDeclaration(node) ? "get " : ts.isSetAccessorDeclaration(node) ? "set " : ""
      const key = add(own !== null ? `${path}/${prefix}${own}` : path + (named ? "" : "/anon"), node, false)
      visit(node.body, key, false)
      return
    }
    if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) && staticName(ts, node.name) !== null) {
      ts.forEachChild(node, child => child !== node.name && visit(child, `${path}/${staticName(ts, node.name)}`, !ts.isClassLike(node)))
      return
    }
    ts.forEachChild(node, child => visit(child, path, named))
  }
  ts.forEachChild(source, child => visit(child, "", false))
  return found
}

/** Whether the emitted function still hands a program back on every path: a generator, or nothing but Effect returns and no throw at the call. */
const keepsProgram = fn => fn.generator || fn.factory || (fn.returns > 0 && fn.effects === fn.returns && fn.throws === 0)

/** The functions the original had that return Effect values and the emitted text lost, and those it has no function for. */
export function lostWrappers({ ts, original, originalPath = "original.ts", emitted, emittedPath = "emitted.js" }) {
  const before = functionsOf(ts, original, originalPath), after = functionsOf(ts, emitted, emittedPath)
  const flags = [], unpaired = []
  let paired = 0
  for (const [name, fn] of before) {
    const returned = fn.factory ? 1 : fn.generator ? 0 : fn.effects
    const counterpart = after.get(name)
    if (counterpart) paired++
    if (returned === 0) continue
    if (!counterpart) unpaired.push({ function: name, line: fn.line, effectReturns: returned })
    else if (!keepsProgram(counterpart) && counterpart.effects < returned) flags.push({ function: name, line: fn.line, effectReturns: returned, emittedEffectReturns: counterpart.effects, cast: fn.cast })
  }
  return { flags, unpaired, paired }
}

/** The allow-list of a run, `[{ file, function, reason }]`. `function: "*"` excuses a module the check cannot read, and no flag. An entry with no reason allows nothing. */
export function readAllowList(path) {
  if (!existsSync(path)) return { entries: [], invalid: [] }
  const list = JSON.parse(readFileSync(path, "utf8"))
  if (!Array.isArray(list)) throw new Error(path + " must be a JSON array of { file, function, reason }")
  const valid = entry => typeof entry?.file === "string" && typeof entry?.function === "string" && typeof entry?.reason === "string" && entry.reason.trim() !== ""
  return { entries: list.filter(valid), invalid: list.filter(entry => !valid(entry)) }
}

/** The package directory that holds a repository path, the longest of `packages`, and the emitted JavaScript of the module there. */
export function emittedPathOf(file, packages) {
  const dir = packages.filter(d => d === "." || file.startsWith(d + "/")).sort((a, b) => b.length - a.length)[0]
  if (dir === undefined) return null
  const inside = dir === "." ? file : file.slice(dir.length + 1)
  return { dir, path: posix.join(dir, ".vibelang/js", inside.replace(/\.vibex$/, ".jsx").replace(/\.vibe$/, ".js")), inside }
}

/**
 * verify's lost-wrapper check over a batch's migrated sources. original(file)
 * returns the module's text before the codemod ({ path, text }) or null, and
 * emitted(file) the text of its JavaScript ({ path, text }) or null. A test
 * module has no emitted JavaScript and is its own oracle. A module neither
 * test nor readable is listed as unchecked and stops the batch, as a flag
 * does, until the allow-list excuses it (a module no project compiles, such
 * as an example): this check answers for the module or says it cannot.
 * renamed(file) says whether this run's codemod renamed the module. One it
 * did not rename has no original to compare, as in run-phase.mjs, and is
 * listed under noOriginal without stopping the batch; one it renamed and kept
 * no original for is unchecked.
 */
export function lostWrapperCheck({ ts, files, original, emitted, renamed = () => true, allow = { entries: [], invalid: [] } }) {
  const flags = [], allowed = [], unpaired = [], unchecked = [], excused = [], noOriginal = []
  let modules = 0, paired = 0
  const used = new Set()
  const cannotRead = (file, reason) => {
    const entry = allow.entries.find(e => e.file === file && e.function === "*")
    if (entry) { used.add(entry); excused.push({ file, reason, allowedBecause: entry.reason }) }
    else unchecked.push({ file, reason })
  }
  for (const file of files.filter(f => /\.vibex?$/.test(f))) {
    if (isTestFile(file)) continue
    const before = original(file)
    if (!before) {
      if (renamed(file)) cannotRead(file, "no original text retained for it")
      else noOriginal.push(file)
      continue
    }
    const after = emitted(file)
    if (!after) {
      if (!inTestDirectory(file)) cannotRead(file, "no emitted JavaScript for it")
      continue
    }
    modules++
    const found = lostWrappers({ ts, original: before.text, originalPath: before.path, emitted: after.text, emittedPath: after.path })
    paired += found.paired
    unpaired.push(...found.unpaired.map(entry => ({ file, ...entry })))
    for (const flag of found.flags) {
      const entry = allow.entries.find(e => e.file === file && e.function === flag.function)
      if (entry) { used.add(entry); allowed.push({ file, ...flag, reason: entry.reason }) }
      else flags.push({ file, ...flag })
    }
  }
  return { modules, paired, flags, allowed, unpaired, unchecked, excused, noOriginal, invalidAllow: allow.invalid, unusedAllow: allow.entries.filter(e => !used.has(e)), blocking: flags }
}
