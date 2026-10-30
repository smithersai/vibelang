// Conservative synchronous source analysis. A failed proof is unknown, never never.
import ts from "typescript"
import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"

const combine = results => results.includes("unknown") ? "unknown" :
  [...new Set(results.filter(t => t !== "never"))].sort().join(" | ") || "never"
const namedErrors = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "URIError", "EvalError", "ReferenceError", "AggregateError", "DOMException", "SchemaError"])
const safeNative = new Set([
  "Object.assign", "Object.freeze", "Object.seal", "Object.preventExtensions",
  "Object.keys", "Object.values", "Object.entries", "Object.is", "Object.isFrozen",
  "Object.isSealed", "Object.isExtensible", "Object.hasOwn", "Array.isArray",
  "Number.isNaN", "Number.isFinite", "Number.isInteger", "Number.isSafeInteger",
  "Number.parseInt", "Number.parseFloat", "String", "Boolean", "Symbol", "Symbol.for", "Date.now",
  "parseInt", "parseFloat", "isNaN", "isFinite",
])
export const safeMathMethods = new Set("abs acos acosh asin asinh atan atan2 atanh cbrt ceil clz32 cos cosh exp expm1 f16round floor fround hypot imul log log10 log1p log2 max min pow random round sign sin sinh sqrt tan tanh trunc".split(" "))
const nullableObjectMethods = new Set(["Object.getPrototypeOf", "Object.getOwnPropertyNames", "Object.getOwnPropertySymbols", "Object.getOwnPropertyDescriptor", "Object.getOwnPropertyDescriptors"])
// Shared by lib classification and source proofs; never infer safety from a namespace prefix.
export function scalarNativeThrows(name, kind = "call") {
  if (name === "AggregateError") return "unknown" // iterates its errors argument
  if (kind === "construct") {
    if (name === "String") return "TypeError" // new String(Symbol()) differs from String(Symbol())
    return name === "Boolean" || namedErrors.has(name) ? "never" : undefined
  }
  if (nullableObjectMethods.has(name)) return "TypeError"
  if (safeNative.has(name) || name.startsWith("Math.") && safeMathMethods.has(name.slice(5))) return "never"
  return undefined
}
const universallySafeNative = new Set([
  "Object.freeze", "Object.seal", "Object.preventExtensions", "Object.is", "Object.isFrozen",
  "Object.isSealed", "Object.isExtensible", "Array.isArray", "Number.isNaN", "Number.isFinite",
  "Number.isInteger", "Number.isSafeInteger", "String", "Boolean", "Date.now",
])
export class SourceAnalysis {
  constructor({ dualPath } = {}) {
    this.dualPath = dualPath && resolve(dualPath)
    this.files = new Map()
    this.memo = new Map()
  }
  file(path) {
    path = resolve(path)
    if (this.files.has(path)) return this.files.get(path)
    if (!existsSync(path)) return undefined
    const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const data = { ast, definitions: new Map(), imports: new Map() }
    this.files.set(path, data)
    for (const statement of ast.statements) {
      if (ts.isImportDeclaration(statement) && statement.importClause) {
        const from = resolve(dirname(path), statement.moduleSpecifier.text)
        const bindings = statement.importClause.namedBindings
        if (bindings && ts.isNamespaceImport(bindings)) data.imports.set(bindings.name.text, { from })
        if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements)
          data.imports.set(element.name.text, { from, name: element.propertyName?.text ?? element.name.text })
      }
      if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
        if (statement.name) data.definitions.set(statement.name.text, statement)
      }
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations)
        if ((statement.declarationList.flags & ts.NodeFlags.Const) && ts.isIdentifier(declaration.name) && declaration.initializer)
          data.definitions.set(declaration.name.text, declaration.initializer)
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements)
          data.imports.set(element.name.text, { from: resolve(dirname(path), statement.moduleSpecifier.text), name: element.propertyName?.text ?? element.name.text })
      }
    }
    // A module binding assigned after declaration cannot be proved from its initializer.
    const reassigned = new Set()
    const writes = node => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(node.left))
        reassigned.add(node.left.text)
      ts.forEachChild(node, writes)
    }
    writes(ast)
    for (const name of reassigned) data.definitions.delete(name)
    return data
  }
  resolveExpression(node, data, seen = new Set()) {
    if (!node || seen.has(node)) return undefined
    seen.add(node)
    if (ts.isParenthesizedExpression(node)) return this.resolveExpression(node.expression, data, seen)
    if (ts.isIdentifier(node)) {
      if (data.definitions.has(node.text)) return this.resolveExpression(data.definitions.get(node.text), data, seen)
      const imported = data.imports.get(node.text)
      if (imported?.name) {
        const other = this.file(imported.from)
        if (other) {
          const target = other.definitions.get(imported.name)
          return target ? this.resolveExpression(target, other, seen) : this.resolveImport(imported.from, imported.name, seen)
        }
      }
      return undefined
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const imported = data.imports.get(node.expression.text)
      if (imported && !imported.name) return this.resolveImport(imported.from, node.name.text, seen)
    }
    // dual builds a data-first/data-last wrapper. Both full invocations run body.
    if (ts.isCallExpression(node) && this.dualImport(node, data)) {
      // A dynamic selector executes at invocation time and may itself throw.
      // Unwrapping only the body would silently discard that contract.
      const arity = node.arguments[0]
      if (!arity || !ts.isNumericLiteral(arity)) return undefined
      const body = node.arguments.at(-1)
      if (body) return this.resolveExpression(body, data, seen)
    }
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return { node, data }
    return undefined
  }
  resolveImport(path, name, seen = new Set()) {
    const data = this.file(path)
    if (!data) return undefined
    const node = data.definitions.get(name)
    if (node) return this.resolveExpression(node, data, seen)
    const imported = data.imports.get(name)
    if (imported?.name) return this.resolveImport(imported.from, imported.name, seen)
    return undefined
  }
  callable(path, name) { return this.resolveImport(path, name) }
  dualImport(node, data) {
    if (!this.dualPath) return undefined
    if (data.ast.fileName === this.dualPath && ts.isIdentifier(node.expression) && node.expression.text === "dual")
      return { from: this.dualPath, name: "dual" }
    const imported = ts.isIdentifier(node.expression) ? data.imports.get(node.expression.text) :
      ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
      node.expression.name.text === "dual" ? data.imports.get(node.expression.expression.text) : undefined
    return imported?.from === this.dualPath && (!imported.name || imported.name === "dual") ? imported : undefined
  }
  // Only numeric arities prove that fewer arguments defer the body. A dynamic
  // predicate can run arbitrary selection code and needs a separate proof.
  dualArity(path, name, seen = new Set()) {
    const data = this.file(path)
    if (!data || seen.has(path + "#" + name)) return undefined
    seen.add(path + "#" + name)
    const node = data.definitions.get(name)
    if (!node) {
      const imported = data.imports.get(name)
      return imported?.name ? this.dualArity(imported.from, imported.name, seen) : undefined
    }
    if (ts.isIdentifier(node)) return this.dualArity(path, node.text, seen)
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const imported = data.imports.get(node.expression.text)
      return imported && !imported.name ? this.dualArity(imported.from, node.name.text, seen) : undefined
    }
    if (!ts.isCallExpression(node) || !this.dualImport(node, data)) return undefined
    const arity = node.arguments[0]
    return arity && ts.isNumericLiteral(arity) ? Number(arity.text) : undefined
  }
  returned(callable) {
    if (!callable?.node.body) return undefined
    const { node, data } = callable
    if (!ts.isBlock(node.body)) return this.resolveExpression(node.body, data)
    const returns = []
    const visit = child => {
      if (ts.isReturnStatement(child) && child.expression) returns.push(this.resolveExpression(child.expression, data))
      else if (!ts.isFunctionLike(child) && !ts.isClassLike(child)) ts.forEachChild(child, visit)
    }
    ts.forEachChild(node.body, visit)
    return returns.length === 1 ? returns[0] : undefined
  }
  analyze(callable, stack = new Set()) {
    if (!callable) return "unknown"
    let { node, data } = callable
    if (this.memo.has(node)) return this.memo.get(node)
    if (stack.has(node)) return "unknown" // an unresolved recursive proof stays conservative
    stack = new Set(stack).add(node)
    if (ts.isClassLike(node)) {
      if (node.members.some(member => ts.isPropertyDeclaration(member) && member.initializer &&
          !member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword))) return "unknown"
      const ctor = node.members.find(ts.isConstructorDeclaration)
      if (!ctor) return node.heritageClauses?.length ? "unknown" : "never"
      node = ctor
    }
    if (!node.asteriskToken && node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) return "never"
    if (!node.body) return "unknown"
    const throws = []
    // A callback or local binding must shadow a module-level helper with the same name.
    const names = binding => ts.isIdentifier(binding) ? [binding.text] :
      binding.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : names(element.name))
    const bound = new Set(node.parameters?.flatMap(p => names(p.name)) ?? [])
    const collect = child => {
      if (ts.isFunctionLike(child) || ts.isClassLike(child)) {
        if (child.name && ts.isIdentifier(child.name)) bound.add(child.name.text)
        return
      }
      if (ts.isVariableDeclaration(child)) for (const name of names(child.name)) bound.add(name)
      ts.forEachChild(child, collect)
    }
    collect(node.body)
    const visit = child => {
      if (ts.isFunctionLike(child)) {
        if (child.name && ts.isComputedPropertyName(child.name)) visit(child.name.expression)
        return
      }
      if (ts.isSpreadElement(child) || ts.isArrayBindingPattern(child) || ts.isForOfStatement(child) ||
          ts.isTaggedTemplateExpression(child) || ts.isVariableDeclarationList(child) && (child.flags & ts.NodeFlags.Using) ||
          ts.isBinaryExpression(child) && (ts.isArrayLiteralExpression(child.left) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
            [ts.SyntaxKind.InstanceOfKeyword, ts.SyntaxKind.SlashToken, ts.SyntaxKind.SlashEqualsToken,
             ts.SyntaxKind.PercentToken, ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.AsteriskAsteriskToken,
             ts.SyntaxKind.AsteriskAsteriskEqualsToken].includes(child.operatorToken.kind))) throws.push("unknown")
      if (ts.isClassLike(child)) { throws.push("unknown"); return }
      if (ts.isThrowStatement(child)) {
        const expression = child.expression
        const name = ts.isNewExpression(expression) ? expression.expression.getText(data.ast).split(".").at(-1) : undefined
        throws.push(namedErrors.has(name) ? name : "unknown")
      }
      if (ts.isCallExpression(child) || ts.isNewExpression(child)) {
        const callee = child.expression
        const text = callee.getText(data.ast)
        const root = text.split(".")[0]
        const shadowed = bound.has(root) || data.definitions.has(root) || data.imports.has(root)
        let nativeThrows = !shadowed ? scalarNativeThrows(text, ts.isNewExpression(child) ? "construct" : "call") : undefined
        // JS dist parameters have lost their types. A typed lib contract proves safety only
        // when arguments are known safe, or the intrinsic accepts every value without validation.
        const value = (arg, seen = new Set()) => {
          if (!arg || seen.has(arg)) return arg
          seen.add(arg)
          if (ts.isParenthesizedExpression(arg)) return value(arg.expression, seen)
          if (ts.isIdentifier(arg) && !bound.has(arg.text) && data.definitions.has(arg.text))
            return value(data.definitions.get(arg.text), seen)
          return arg
        }
        const primitive = arg => {
          arg = value(arg)
          return arg && (ts.isStringLiteral(arg) || ts.isNumericLiteral(arg) || ts.isVoidExpression(arg) ||
            [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(arg.kind))
        }
        const nonNull = arg => {
          arg = value(arg)
          return arg && (primitive(arg) && arg.kind !== ts.SyntaxKind.NullKeyword && !ts.isVoidExpression(arg) ||
            ts.isObjectLiteralExpression(arg) || ts.isArrayLiteralExpression(arg) || ts.isFunctionLike(arg) ||
            ts.isClassLike(arg) || ts.isNewExpression(arg) || arg.kind === ts.SyntaxKind.ThisKeyword && ts.isConstructorDeclaration(node))
        }
        if (nativeThrows === "never" && !universallySafeNative.has(text)) {
          const args = child.arguments ?? []
          const valid = text.startsWith("Object.") ? args.length && nonNull(args[0]) : args.every(primitive)
          if (!valid) nativeThrows = "unknown"
        }
        if (nativeThrows !== undefined) {
          throws.push(nativeThrows)
        } else {
          const target = bound.has(root) ? undefined : this.resolveExpression(callee, data)
          throws.push(this.analyze(target, stack))
        }
      }
      ts.forEachChild(child, visit)
    }
    for (const parameter of node.parameters ?? []) visit(parameter)
    if (!node.asteriskToken) visit(node.body)
    const result = combine(throws)
    this.memo.set(callable.node, result)
    return result
  }
}
