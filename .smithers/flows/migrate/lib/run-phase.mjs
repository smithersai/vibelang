// Run-phase check for migrated modules (alchemy-62). VIP-1 decides a
// function's kind by its keyword: an `effect` function's call returns its
// body as a program, unrun. So when a conversion marks `effect` a function
// that the original module kept plain, the body that ran at the call now runs
// only when the program runs, and the call returns a program where it
// returned a value. Types and declarations can hide the change (alchemy's
// effectClass was typed through `as any`), so this check compares the two
// texts, function by function, by the name path that holds each function.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const order = { ok: 0, review: 1, eager: 2, value: 3 }
const worst = (a, b) => order[a.verdict] >= order[b.verdict] ? a : b
const ok = { verdict: "ok" }

/** Parse a .vibe text to ESTree with the toolchain's compiler. */
export function vibeTree(compiler, text, file, cwd = undefined) {
  const result = spawnSync(compiler, ["--estree", file], { cwd, input: text, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error("vibelang --estree failed for " + file + ": " + (result.error?.message ?? result.stderr?.trim()))
  const { ast, error } = JSON.parse(result.stdout)
  if (error) throw new Error(file + " does not parse: " + error.message)
  return ast
}

const estreeFunctions = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"])
const keyName = key => key?.type === "Identifier" ? key.name : key?.type === "Literal" ? String(key.value) : key?.type === "PrivateIdentifier" ? "#" + key.name : null

// Callback identity includes the holder, callee, argument and occurrence.
// Count plain callbacks too, so changing only a later callback cannot shift it.
function callbackPath(path, callee, index, ordinals) {
  const key = path.join(".") + "/" + callee + "(" + index + ")"
  const ordinal = ordinals.get(key) ?? 0
  ordinals.set(key, ordinal + 1)
  return [key + (ordinal ? "#" + ordinal : "")]
}
const returnedPath = (path, ordinals) => {
  const key = path.join(".") + "/return"
  const ordinal = ordinals.get(key) ?? 0
  ordinals.set(key, ordinal + 1)
  return [key + (ordinal ? "#" + ordinal : "")]
}
const estreeUnwrap = node => {
  while (node && ["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "ChainExpression"].includes(node.type)) node = node.expression
  return node
}
const estreeCallee = node => {
  node = estreeUnwrap(node)
  if (node?.type === "Identifier") return node.name
  if (node?.type === "MemberExpression") return estreeCallee(node.object) + (node.computed ? "[]" : "." + keyName(node.property))
  if (node?.type === "CallExpression") return estreeCallee(node.callee) + "()"
  return "?"
}
const tsCallee = (ts, node) => {
  node = unwrap(ts, node)
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return tsCallee(ts, node.expression) + "." + node.name.text
  if (ts.isElementAccessExpression(node)) return tsCallee(ts, node.expression) + "[]"
  if (ts.isCallExpression(node)) return tsCallee(ts, node.expression) + "()"
  return "?"
}

/** The `effect` functions of a .vibe module, by name path. */
export function effectFunctions(ast, text = "") {
  const tokens = ast.tokens ?? []
  const lineAt = offset => text ? text.slice(0, offset).split("\n").length : null
  const starts = new Map(tokens.map((token, i) => [token.range[0], i]))
  const marked = (from, to) => {
    for (let i = starts.get(from); i !== undefined && i < tokens.length && tokens[i].range[0] < to; i++) if (tokens[i].value === "effect") return true
    return false
  }
  const found = [], ordinals = new Map()
  const visit = (node, path, parent) => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) { for (const child of node) visit(child, path, parent); return }
    if (typeof node.type !== "string") return
    if (node.type === "ReturnStatement" && estreeFunctions.has(estreeUnwrap(node.argument)?.type)) {
      visit(node.argument, returnedPath(path, ordinals), node)
      return
    }
    if (node.type === "VibeCatchExpression") {
      visit(node.expression, path, node)
      visit(node.handler, callbackPath(path, "catch", 0, ordinals), node)
      return
    }
    if (node.type === "CallExpression") {
      // ESTree represents an effect block as an intrinsic builder holding a
      // lexical arrow. That arrow is the program body, not a changed function.
      if (node.callee?.synthesized && node.callee.name === "$effect") {
        for (const argument of node.arguments) visit(argument.body, path, argument)
        return
      }
      visit(node.callee, path, node)
      node.arguments.forEach((argument, index) => {
        const value = estreeUnwrap(argument)
        const next = estreeFunctions.has(value?.type) ? callbackPath(path, estreeCallee(node.callee), index, ordinals) : path
        visit(argument, next, node)
      })
      return
    }
    let next = path
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") next = [...path, node.id.name]
    else if ((node.type === "Property" || node.type === "MethodDefinition" || node.type === "PropertyDefinition") && keyName(node.key)) next = [...path, keyName(node.key)]
    else if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id?.name) next = [...path, node.id.name]
    if (estreeFunctions.has(node.type) && next.length) {
      const own = starts.has(node.range[0]) && tokens[starts.get(node.range[0])].value === "effect"
      const method = parent && (parent.type === "Property" || parent.type === "MethodDefinition") && parent.value === node && marked(parent.range[0], parent.key.range[0])
      if (own || method) found.push({ name: next.join("."), line: lineAt(node.range[0]), node })
    }
    for (const [key, value] of Object.entries(node)) if (!["tokens", "comments", "range", "loc", "parent"].includes(key)) {
      const returned = key === "body" && estreeFunctions.has(node.type) && estreeFunctions.has(estreeUnwrap(value)?.type)
      visit(value, returned ? returnedPath(next, ordinals) : next, node)
    }
  }
  visit(ast, [], null)
  return found
}

const nativeCatchPaths = new WeakMap()
const originalAt = (functions, path) => {
  const aliases = nativeCatchPaths.get(functions)
  for (let remaining = (aliases?.size ?? 0) + 1; remaining; remaining--) {
    const found = functions.get(path)
    if (found) return found
    let selected
    for (const pair of aliases ?? []) {
      if ((path === pair[0] || path.startsWith(pair[0] + ".") || path.startsWith(pair[0] + "/")) &&
          (!selected || pair[0].length > selected[0].length)) selected = pair
    }
    if (!selected) return
    path = selected[1] + path.slice(selected[0].length)
  }
}

/** The function-valued names of a TypeScript module, by the same name paths. */
export function originalFunctions(ts, text, file = "original.ts") {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = new Map(), ordinals = new Map(), catchPaths = new Map(), catchCalls = new Map()
  nativeCatchPaths.set(found, catchPaths)
  const nameOf = name => name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) ? name.text : null
  const visitReturned = (value, path) => {
    const shape = value && functionShape(ts, value)
    if (!shape) return false
    const next = returnedPath(path, ordinals)
    found.set(next.join("."), shape)
    visit(value, next)
    return true
  }
  const visit = (node, path) => {
    if (ts.isReturnStatement(node) && visitReturned(node.expression, path)) return
    if (ts.isCallExpression(node)) {
      visit(node.expression, path)
      // Effect.gen's generator belongs to the surrounding callback or named
      // function; Effect.fn already establishes that named function's kind.
      const program = coldGen(ts, node)
      const factory = effectFactory(ts, node)
      const member = effectMember(ts, node.expression)
      const catcher = member?.module === "Effect" && member.name === "catch" &&
        (node.arguments.length === 1 || node.arguments.length === 2)
      if (catcher) catchCalls.set(node, { path, original: null })
      node.arguments.forEach((argument, index) => {
        const value = unwrap(ts, argument)
        const shape = functionShape(ts, value)
        if (program || factory) {
          visit(shape?.node?.body ?? value, path)
        } else if (shape) {
          const next = callbackPath(path, tsCallee(ts, node.expression), index, ordinals)
          if (catcher && index === node.arguments.length - 1)
            catchCalls.get(node).original = next.join(".")
          found.set(next.join("."), shape)
          visit(value, next)
        } else visit(argument, path)
      })
      return
    }
    let next = path
    const named = nameOf(node.name)
    if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && named) next = [...path, named]
    if (next !== path) {
      const value = ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) ? node : node.initializer
      const shape = value && functionShape(ts, value)
      if (shape && !found.has(next.join("."))) found.set(next.join("."), shape)
    }
    ts.forEachChild(node, child => {
      if (child !== node.body || !visitReturned(child, next)) visit(child, next)
    })
  }
  visit(source, [])
  // Native catch syntax visits its source before its handler. Keep written
  // callback paths intact, and order only the native aliases separately.
  const nativeOrdinals = new Map()
  const nativeOrder = node => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(ts, node.expression)
      if (ts.isCallExpression(callee) && catchCalls.has(callee) &&
          callee.arguments.length === 1 && node.arguments.length === 1) {
        nativeOrder(node.arguments[0])
        nativeOrder(node.expression)
        return
      }
      const pair = catchCalls.get(node)
      if (pair) {
        nativeOrder(node.expression)
        node.arguments.forEach((argument, index) => {
          if (index === node.arguments.length - 1) {
            const native = callbackPath(pair.path, "catch", 0, nativeOrdinals).join(".")
            if (pair.original) catchPaths.set(native, pair.original)
          }
          nativeOrder(argument)
        })
        return
      }
    }
    ts.forEachChild(node, nativeOrder)
  }
  nativeOrder(source)
  return found
}

const unwrap = (ts, node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression
  return node
}
// Bind without resolving dependencies. Import declarations establish provenance;
// the checker distinguishes them from parameters and local shadowing bindings.
const bindings = new WeakMap()
function bindingInfo(ts, source) {
  if (bindings.has(source)) return bindings.get(source)
  const host = ts.createCompilerHost({ noLib: true, noResolve: true })
  host.getSourceFile = file => file === source.fileName ? source : undefined
  const checker = ts.createProgram([source.fileName], { noLib: true, noResolve: true }, host).getTypeChecker()
  const info = { checker, stable: new Map() }
  bindings.set(source, info)
  return info
}
const modules = new Set(["Effect", "Micro", "Stream", "Layer", "STM"])

function effectMember(ts, expression) {
  const member = unwrap(ts, expression)
  if (!ts.isPropertyAccessExpression(member) || member.questionDotToken) return null
  let namespace = unwrap(ts, member.expression), selected = null
  if (ts.isPropertyAccessExpression(namespace) && !namespace.questionDotToken) {
    selected = namespace.name.text
    namespace = unwrap(ts, namespace.expression)
  }
  if (!ts.isIdentifier(namespace)) return null
  const source = namespace.getSourceFile()
  const { checker, stable } = bindingInfo(ts, source)
  const symbol = checker.getSymbolAtLocation(namespace)
  if (symbol?.declarations?.length !== 1) return null
  const declaration = symbol.declarations[0]
  let clause, module
  if (ts.isImportSpecifier(declaration)) {
    clause = declaration.parent.parent
    if (selected || declaration.isTypeOnly) return null
    module = (declaration.propertyName ?? declaration.name).text
    if (clause.parent.moduleSpecifier.text !== "effect") return null
  } else if (ts.isNamespaceImport(declaration)) {
    clause = declaration.parent
    const path = clause.parent.moduleSpecifier.text
    module = selected ?? path.replace(/^effect\//, "")
    if (selected ? path !== "effect" : path !== "effect/" + module) return null
  } else return null
  if (clause.isTypeOnly || !modules.has(module)) return null
  if (!stable.has(symbol)) {
    let safe = true
    const visit = node => {
      if (!safe || ts.isTypeNode(node)) return
      if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === symbol && node !== declaration.name) {
        let use = node
        while ((ts.isPropertyAccessExpression(use.parent) && use.parent.expression === use) ||
          ts.isParenthesizedExpression(use.parent) || ts.isAsExpression(use.parent) || ts.isNonNullExpression(use.parent)) use = use.parent
        // Namespace escapes and writes invalidate a textual proof. No alias
        // analysis guess: each use must be a direct member call.
        const parent = use.parent
        if (!(ts.isCallExpression(parent) && parent.expression === use)) safe = false
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    stable.set(symbol, safe)
  }
  return stable.get(symbol) ? { module, name: member.name.text } : null
}

// Property reads, spreads and computed keys can invoke author code.
function inert(ts, expression) {
  const node = unwrap(ts, expression)
  if (!node) return false
  if (ts.isIdentifier(node) || ts.isLiteralExpression(node) ||
    [ts.SyntaxKind.ThisKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return true
  if (ts.isObjectLiteralExpression(node)) return node.properties.every(p =>
    (ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) && inert(ts, p.initializer)) ||
    (ts.isShorthandPropertyAssignment(p) && !p.objectAssignmentInitializer))
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(e => inert(ts, e))
  return false
}

function coldGen(ts, call) {
  if (call.questionDotToken || effectMember(ts, call.expression)?.name !== "gen") return false
  if (call.arguments.length !== 1 && call.arguments.length !== 2) return false
  const callback = unwrap(ts, call.arguments.at(-1))
  return ts.isFunctionExpression(callback) && !!callback.asteriskToken &&
    call.arguments.slice(0, -1).every(arg => inert(ts, arg))
}

function effectFactory(ts, call) {
  const callee = unwrap(ts, call.expression)
  if (ts.isCallExpression(callee)) return effectFactory(ts, callee)
  const member = effectMember(ts, callee)
  return member && ["fn", "fnUntraced"].includes(member.name)
}

/** A function as the original wrote it: an Effect function (`Effect.fn`), a plain one, or neither. */
function functionShape(ts, value) {
  const node = unwrap(ts, value)
  if (ts.isCallExpression(node) && effectFactory(ts, node)) return { kind: "effect" }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    if (node.asteriskToken) return { kind: "generator", node }
    return { kind: "plain", node }
  }
  return null
}

const valueKinds = ts => [ts.SyntaxKind.ObjectLiteralExpression, ts.SyntaxKind.ArrayLiteralExpression, ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.BigIntLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateExpression, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.NewExpression, ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.BinaryExpression,
  ts.SyntaxKind.PrefixUnaryExpression, ts.SyntaxKind.TypeOfExpression, ts.SyntaxKind.RegularExpressionLiteral]
const valueCalls = /^(Object|JSON|Array|Math|Number|String|Boolean|Symbol|Reflect|Promise)\./

/** What a returned expression hands back at the call: a program built lazily, a value, or something the text cannot say. */
function returned(ts, expression) {
  const node = unwrap(ts, expression)
  if (!node) return { verdict: "value", detail: "returns undefined" }
  if (ts.isConditionalExpression(node)) {
    const work = eagerWork(ts, node.condition)
    const condition = work ? { verdict: "eager", detail: work } : inert(ts, node.condition) ? ok : { verdict: "review", detail: "evaluates condition " + node.condition.getText().slice(0, 60) }
    return worst(condition, worst(returned(ts, node.whenTrue), returned(ts, node.whenFalse)))
  }
  if (valueKinds(ts).includes(node.kind)) return { verdict: "value", detail: "returns " + node.getText().slice(0, 60) }
  if (ts.isVoidExpression(node) || (ts.isIdentifier(node) && node.text === "undefined")) return { verdict: "value", detail: "returns undefined" }
  if (ts.isCallExpression(node)) {
    const callee = unwrap(ts, node.expression)
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "gen") {
      // A proven module import has no author-defined namespace getter.
      const inputs = effectMember(ts, callee) ? node.arguments : [callee.expression, ...node.arguments]
      for (const expression of inputs) {
        const work = eagerWork(ts, expression)
        if (work) return { verdict: "eager", detail: work }
      }
      if (coldGen(ts, node)) return ok
    }
    // Strict Effect constructors evaluate their value arguments at the call.
    // Work in a supplied thunk still belongs to that thunk, not this factory.
    const member = !node.questionDotToken && effectMember(ts, callee)
    if (member?.module === "Effect" && ["succeed", "fail", "die"].includes(member.name)) {
      for (const argument of node.arguments) {
        const work = eagerWork(ts, argument)
        if (work) return { verdict: "eager", detail: work }
      }
    }
    if (valueCalls.test(callee.getText())) return { verdict: "value", detail: "returns " + callee.getText() + "(…)" }
  }
  return { verdict: "review", detail: "returns " + node.getText().slice(0, 60) }
}

/** Work at the call, including reads that capture a snapshot or invoke author code. */
function eagerWork(ts, statement) {
  let found = null
  const visit = node => {
    if (found || ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isTypeNode(node)) return
    if (ts.isThrowStatement(node)) found = "throws at the call: " + node.getText().slice(0, 60)
    else if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node)) found = "calls at the call: " + node.getText().slice(0, 60)
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) found = "assigns at the call: " + node.getText().slice(0, 60)
    else if (ts.isPostfixUnaryExpression(node) || (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator))) found = "updates at the call: " + node.getText().slice(0, 60)
    else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) found = "reads at the call: " + node.getText().slice(0, 60)
    else if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) found = "destructures at the call: " + node.getText().slice(0, 60)
    else if (ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) found = "spreads at the call: " + node.getText().slice(0, 60)
    else ts.forEachChild(node, visit)
  }
  visit(statement)
  return found
}

/** How marking this original plain function `effect` changes when its body runs. */
export function runPhaseOf(ts, node) {
  if (!node.body) return ok
  if (!ts.isBlock(node.body)) return returned(ts, node.body)
  let verdict = ok
  const returns = []
  const collect = n => { if (ts.isFunctionLike(n) || ts.isClassLike(n)) return; if (ts.isReturnStatement(n)) returns.push(n); ts.forEachChild(n, collect) }
  for (const statement of node.body.statements) {
    collect(statement)
    if (ts.isReturnStatement(statement)) continue
    const work = eagerWork(ts, statement)
    if (work) verdict = worst(verdict, { verdict: "eager", detail: work })
  }
  if (!returns.length) return worst(verdict, { verdict: "value", detail: "returns undefined" })
  for (const r of returns) verdict = worst(verdict, returned(ts, r.expression))
  return verdict
}

// A cold program's explicit success value must not disappear when its
// callback becomes an effect body. Nested functions have their own returns.
// A generator's `return yield* Effect.fail(e)` or `return yield* new E(...)`
// returns no value: the program fails there. In effect code `throw e` means
// "the Effect fails with `e`, a typed error: `return yield* Effect.fail(e)`"
// (Chapter 3), so the native rewrite writes `throw e` or `throw new E(...)`
// in its place. failingReturn names such a return: the constructor a `new`
// yields, or null for Effect.fail.
function failingReturn(ts, expression) {
  const node = unwrap(ts, expression)
  if (!node || !ts.isYieldExpression(node) || !node.asteriskToken) return undefined
  const yielded = unwrap(ts, node.expression)
  if (yielded && ts.isNewExpression(yielded)) {
    const name = entityText(ts, yielded.expression)
    return name ? { callee: name } : undefined
  }
  if (yielded && ts.isCallExpression(yielded) && !yielded.questionDotToken) {
    const member = effectMember(ts, yielded.expression)
    if (member?.module === "Effect" && member.name === "fail") return { callee: null }
  }
  return undefined
}

function entityText(ts, node) {
  node = unwrap(ts, node)
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node) && !node.questionDotToken && ts.isIdentifier(node.name)) {
    const left = entityText(ts, node.expression)
    return left && left + "." + node.name.text
  }
  return null
}

const estreeEntity = node => {
  node = estreeUnwrap(node)
  if (node?.type === "Identifier") return node.name
  if (node?.type === "MemberExpression" && !node.computed && !node.optional && node.property?.type === "Identifier") {
    const left = estreeEntity(node.object)
    return left && left + "." + node.property.name
  }
  return null
}

// Whether the native body's own throw statements stand for the failing
// returns: one throw for each, the same constructor for each `new`. A throw
// in a nested function or class is that function's.
function throwsFor(body, failures) {
  const thrown = []
  const visit = node => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) return node.forEach(visit)
    if (estreeFunctions.has(node.type) || ["ClassDeclaration", "ClassExpression"].includes(node.type)) return
    if (node.type === "ThrowStatement") {
      const argument = estreeUnwrap(node.argument)
      thrown.push(argument?.type === "NewExpression" ? estreeEntity(argument.callee) : null)
    }
    for (const [key, value] of Object.entries(node)) if (!["tokens", "comments", "range", "loc", "parent"].includes(key)) visit(value)
  }
  visit(body)
  for (const failure of [...failures].sort((a, b) => (a.callee === null) - (b.callee === null))) {
    const at = failure.callee === null ? 0 : thrown.indexOf(failure.callee)
    if (at < 0 || at >= thrown.length) return false
    thrown.splice(at, 1)
  }
  return true
}

function dropsProgramValue(ts, before, after) {
  if (!before.body || !after.body) return false
  let value = false
  const failures = []
  const returnsValue = node => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = unwrap(ts, node.expression)
      const failing = failingReturn(ts, expression)
      if (failing) failures.push(failing)
      else if (!ts.isVoidExpression(expression) && !(ts.isIdentifier(expression) && expression.text === "undefined")) value = true
    }
    ts.forEachChild(node, returnsValue)
  }
  const programs = expression => {
    const node = unwrap(ts, expression)
    if (!node) return
    if (ts.isCallExpression(node) && coldGen(ts, node)) returnsValue(unwrap(ts, node.arguments.at(-1)).body)
    else if (ts.isConditionalExpression(node)) { programs(node.whenTrue); programs(node.whenFalse) }
  }
  const scanReturns = node => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return
    if (ts.isReturnStatement(node)) programs(node.expression)
    else ts.forEachChild(node, scanReturns)
  }
  if (ts.isBlock(before.body)) scanReturns(before.body)
  else programs(before.body)
  // A failing return the native body does not throw in its place reads as a dropped value.
  if (failures.length && !(after.body.type === "BlockStatement" && throwsFor(after.body, failures))) value = true
  if (!value) return false
  const hasValue = node => {
    if (!node || typeof node !== "object") return false
    if (Array.isArray(node)) return node.some(hasValue)
    if (estreeFunctions.has(node.type) || ["ClassDeclaration", "ClassExpression"].includes(node.type)) return false
    if (node.type === "ReturnStatement") {
      const expression = estreeUnwrap(node.argument)
      return !!expression && !(expression.type === "Identifier" && expression.name === "undefined") &&
        !(expression.type === "UnaryExpression" && expression.operator === "void")
    }
    return Object.entries(node).some(([key, value]) => !["tokens", "comments", "range", "loc", "parent"].includes(key) && hasValue(value))
  }
  if (after.body.type !== "BlockStatement") {
    const expression = estreeUnwrap(after.body)
    return (expression.type === "Identifier" && expression.name === "undefined") ||
      (expression.type === "UnaryExpression" && expression.operator === "void")
  }
  return !hasValue(after.body)
}

/**
 * Each `effect` function of the migrated module whose original was plain,
 * with what the change does: "value" (the call returned a value, now a
 * program), "eager" (work the call did now waits for the run) or "review"
 * (the text cannot tell whether the original returned a program).
 */
export function runPhaseChanges({ ts, original, originalPath, vibe, vibeText = "" }) {
  const functions = originalFunctions(ts, original, originalPath)
  const changes = []
  for (const fn of effectFunctions(vibe, vibeText)) {
    const before = originalAt(functions, fn.name)
    if (!before || before.kind !== "plain") continue
    let phase = runPhaseOf(ts, before.node)
    if (phase.verdict === "ok" && dropsProgramValue(ts, before.node, fn.node)) phase = { verdict: "value", detail: "drops the original program's returned value" }
    if (phase.verdict !== "ok") changes.push({ name: fn.name, line: fn.line, ...phase })
  }
  return changes
}

/** Whether a change stops the batch: the text proves the run phase moved. */
export const blocking = change => change.verdict === "value" || change.verdict === "eager"

/**
 * verify's run-phase check over a batch's migrated sources. original(file)
 * returns the module's text before the codemod ({ path, text }) or null.
 * A source the compiler cannot parse is listed as unchecked: compile's own
 * gate fails it.
 */
export function runPhaseCheck({ compiler, ts, target, files, original }) {
  const changes = [], unchecked = []
  for (const file of files.filter(file => /\.vibex?$/.test(file))) {
    const before = original(file)
    if (!before) continue
    const text = readFileSync(join(target, file), "utf8")
    let vibe
    try { vibe = vibeTree(compiler, text, join(target, file), target) } catch (error) { unchecked.push({ file, reason: error.message }); continue }
    for (const change of runPhaseChanges({ ts, original: before.text, originalPath: before.path, vibe, vibeText: text })) changes.push({ file, ...change })
  }
  return { changes, unchecked, blocking: changes.filter(blocking) }
}
