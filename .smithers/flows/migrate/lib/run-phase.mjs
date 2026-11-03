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

/** The `effect` functions of a .vibe module, by name path. */
export function effectFunctions(ast, text = "") {
  const tokens = ast.tokens ?? []
  const lineAt = offset => text ? text.slice(0, offset).split("\n").length : null
  const starts = new Map(tokens.map((token, i) => [token.range[0], i]))
  const marked = (from, to) => {
    for (let i = starts.get(from); i !== undefined && i < tokens.length && tokens[i].range[0] < to; i++) if (tokens[i].value === "effect") return true
    return false
  }
  const found = []
  const visit = (node, path, parent) => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) { for (const child of node) visit(child, path, parent); return }
    if (typeof node.type !== "string") return
    let next = path
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") next = [...path, node.id.name]
    else if ((node.type === "Property" || node.type === "MethodDefinition" || node.type === "PropertyDefinition") && keyName(node.key)) next = [...path, keyName(node.key)]
    else if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id?.name) next = [...path, node.id.name]
    if (estreeFunctions.has(node.type) && next.length) {
      const own = starts.has(node.range[0]) && tokens[starts.get(node.range[0])].value === "effect"
      const method = parent && (parent.type === "Property" || parent.type === "MethodDefinition") && parent.value === node && marked(parent.range[0], parent.key.range[0])
      if (own || method) found.push({ name: next.join("."), line: lineAt(node.range[0]) })
    }
    for (const [key, value] of Object.entries(node)) if (!["tokens", "comments", "range", "loc", "parent"].includes(key)) visit(value, next, node)
  }
  visit(ast, [], null)
  return found
}

/** The function-valued names of a TypeScript module, by the same name paths. */
export function originalFunctions(ts, text, file = "original.ts") {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = new Map()
  const nameOf = name => name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) ? name.text : null
  const visit = (node, path) => {
    let next = path
    const named = nameOf(node.name)
    if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && named) next = [...path, named]
    if (next !== path) {
      const value = ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) ? node : node.initializer
      const shape = value && functionShape(ts, value)
      if (shape && !found.has(next.join("."))) found.set(next.join("."), shape)
    }
    ts.forEachChild(node, child => visit(child, next))
  }
  visit(source, [])
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
    if (node.asteriskToken) return { kind: "generator" }
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
      for (const expression of [callee.expression, ...node.arguments]) {
        const work = eagerWork(ts, expression)
        if (work) return { verdict: "eager", detail: work }
      }
      if (coldGen(ts, node)) return ok
    }
    if (valueCalls.test(callee.getText())) return { verdict: "value", detail: "returns " + callee.getText() + "(…)" }
  }
  return { verdict: "review", detail: "returns " + node.getText().slice(0, 60) }
}

/** Statements that do work at the call: a throw, a call, an assignment or a loop outside nested functions. */
function eagerWork(ts, statement) {
  let found = null
  const visit = node => {
    if (found || ts.isFunctionLike(node) || ts.isClassLike(node)) return
    if (ts.isThrowStatement(node)) found = "throws at the call: " + node.getText().slice(0, 60)
    else if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node)) found = "calls at the call: " + node.getText().slice(0, 60)
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) found = "assigns at the call: " + node.getText().slice(0, 60)
    else if (ts.isPostfixUnaryExpression(node) || (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator))) found = "updates at the call: " + node.getText().slice(0, 60)
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
    const before = functions.get(fn.name)
    if (!before || before.kind !== "plain") continue
    const phase = runPhaseOf(ts, before.node)
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
