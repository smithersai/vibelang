// Publication scripts that map TypeScript source exports to their built paths.
import { readFileSync, writeFileSync } from "node:fs"
import { posix } from "node:path"
import { packageScripts, testOnlyScripts } from "./test-files.mjs"
import { repositoryPackages } from "./wire.mjs"

/**
 * Publication helpers map exports or nested imports conditions to built paths.
 * Recognize guarded suffix maps and named src/dist output functions, unwrap only
 * migration-marked targets, and add .vibe to the original suffix set. Native
 * condition maps and the helper's own JavaScript/declaration policy stay intact.
 * A second setup is a no-op.
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
  // A previous setup may already have expanded these mappers while wiring
  // exports only. Recognize that output too, so newly supported import maps
  // receive normalization without nesting another wrapper around old exports.
  const suffix = (node) => node?.kind === ts.SyntaxKind.RegularExpressionLiteral &&
    ["/\\.tsx?$/", "/\\.ts$/", "/\\.(?:tsx?|vibe)$/", "/\\.(?:ts|vibe)$/"].includes(node.text)
  const property = (node, name) => ts.isPropertyAccessExpression(node) && node.name.text === name
  const qualified = (node) => ts.isIdentifier(node) || (ts.isPropertyAccessExpression(node) && qualified(node.expression))
  // A publication mapper keeps the repository's own src/dist and declaration
  // policy. Only recognize a named function with the actual path-replace shape.
  const functions = new Map()
  const bindings = new Map()
  const unwrap = (node) => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression
    return node
  }
  const isJS = /\.[cm]?jsx?$/.test(fileName)
  const normalization = (expression, imports = false) => {
    const key = imports && expression === "key" ? "__vibelangKey" : "key"
    const target = imports && expression === "target" ? "__vibelangTarget" : "target"
    const parameter = isJS ? "[" + key + ", " + target + "]" : "[" + key + ", " + target + "]: [string, unknown]"
    const explicit = target + ' !== null && typeof ' + target + ' === "object" && "vibelang-source" in ' + target + ' && typeof ' + target + '["vibelang-source"] === "string"'
    const paired = target + ' !== null && typeof ' + target + ' === "object" && "default" in ' + target + ' && typeof ' + target + '.default === "string" && ' + target + '.default.endsWith(".vibe") && "types" in ' + target + ' && ' + target + '.types === ' + target + '.default.slice(0, -5) + ".d.vibe.ts"'
    let value = explicit + " ? " + target + '["vibelang-source"] : ' + paired + " ? " + target + ".default : " + target
    // Only the owning migration condition supplies a types source. Runtime
    // conditions retain the repository's own publication mapping policy.
    if (imports) value = key + ' === "types" && typeof ' + expression + '["vibelang-source"] === "string" ? ' + expression + '["vibelang-source"] : ' + value
    return "Object.fromEntries(Object.entries(" + expression + ").map((" + parameter + ") => [" + key + ", " + value + "]))"
  }
  const shape = (node) => {
    node = unwrap(node)
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return [node.kind, node.text]
    const children = []
    ts.forEachChild(node, child => { children.push(shape(child)) })
    return [node.kind, ...children]
  }
  const expressionNode = (text) => ts.createSourceFile("publication-normalizer.ts", "const normalized = (" + text + ");", ts.ScriptTarget.Latest, true)
    .statements[0].declarationList.declarations[0].initializer
  // Recognize only our exact old/new expression, independent of formatter
  // trivia, parentheses, casts and quote style. Unrelated maps stay opaque.
  const originalArgument = (argument) => {
    const call = unwrap(argument)
    if (!ts.isCallExpression(call) || !property(call.expression, "fromEntries") ||
        !ts.isIdentifier(call.expression.expression) || call.expression.expression.text !== "Object" || call.arguments.length !== 1) return argument
    const map = unwrap(call.arguments[0])
    if (!ts.isCallExpression(map) || !property(map.expression, "map")) return argument
    const entries = unwrap(map.expression.expression)
    if (!ts.isCallExpression(entries) || !property(entries.expression, "entries") ||
        !ts.isIdentifier(entries.expression.expression) || entries.expression.expression.text !== "Object" ||
        entries.arguments.length !== 1 || !qualified(entries.arguments[0])) return argument
    const original = entries.arguments[0], expression = original.getText(source)
    const actual = JSON.stringify(shape(call))
    return [false, true].some(imports => actual === JSON.stringify(shape(expressionNode(normalization(expression, imports))))) ? original : argument
  }
  const addFunction = (name, fn, binding = fn) => {
    const named = functions.get(name) || []
    named.push(fn)
    functions.set(name, named)
    bindings.set(fn, binding)
  }
  const functionNode = (node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
  const collectFunctions = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) addFunction(node.name.text, node)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const)) {
      const fn = unwrap(node.initializer)
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) addFunction(node.name.text, fn, node)
    }
    ts.forEachChild(node, collectFunctions)
  }
  collectFunctions(source)
  const pathMappers = new Map()
  const outputSuffix = (node) => ts.isStringLiteral(node) ? [".js", ".d.ts"].includes(node.text)
    : ts.isConditionalExpression(node) && outputSuffix(node.whenTrue) && outputSuffix(node.whenFalse)
  for (const [name, declarations] of functions) {
    if (declarations.length !== 1 || !declarations[0].body) continue
    const fn = declarations[0]
    let rebound = false
    const checkName = (node) => {
      if (node !== fn && node !== bindings.get(fn) && node.name && ts.isIdentifier(node.name) && node.name.text === name &&
          (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isImportSpecifier(node) ||
           ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isBindingElement(node) || ts.isClassDeclaration(node))) rebound = true
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && node.left.text === name &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) rebound = true
      ts.forEachChild(node, checkName)
    }
    checkName(source)
    if (rebound) continue
    const outputs = []
    const recordOutput = (expression) => {
      const call = unwrap(expression)
      if (!call || !ts.isCallExpression(call)) return
      const prefix = property(call.expression, "replace") && call.expression.expression
      if (prefix && ts.isCallExpression(prefix) && property(prefix.expression, "replace") &&
          prefix.arguments.length === 2 && ts.isStringLiteral(prefix.arguments[0]) && prefix.arguments[0].text === "./src/" &&
          ts.isIdentifier(prefix.expression.expression) && call.arguments.length === 2 && suffix(call.arguments[0]) && outputSuffix(call.arguments[1])) {
        const parameter = fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === prefix.expression.expression.text)
        if (parameter >= 0) outputs.push({ parameter, literal: call.arguments[0] })
      }
    }
    const scanReturns = (node) => {
      if (node !== fn.body && functionNode(node)) return
      if (ts.isReturnStatement(node)) recordOutput(node.expression)
      ts.forEachChild(node, scanReturns)
    }
    if (ts.isBlock(fn.body)) scanReturns(fn.body)
    else recordOutput(fn.body)
    if (outputs.length === 1) pathMappers.set(name, outputs[0])
  }
  const importsConditions = (argument) => {
    if (!ts.isIdentifier(argument)) return false
    let parent = argument.parent
    while (parent && !functionNode(parent)) parent = parent.parent
    if (!parent || !ts.isArrowFunction(parent) || parent.parameters.length !== 1) return false
    const binding = parent.parameters[0].name
    if (!ts.isArrayBindingPattern(binding) || binding.elements.length !== 2 ||
        !binding.elements[1].name || !ts.isIdentifier(binding.elements[1].name) ||
        binding.elements[1].name.text !== argument.text) return false
    const map = parent.parent
    if (!ts.isCallExpression(map) || !property(map.expression, "map") || map.arguments[0] !== parent) return false
    const entries = map.expression.expression
    return ts.isCallExpression(entries) && entries.arguments.length === 1 &&
      property(entries.expression, "entries") && ts.isIdentifier(entries.expression.expression) &&
      entries.expression.expression.text === "Object" &&
      property(entries.arguments[0], "imports") && qualified(entries.arguments[0])
  }
  const visit = (node) => {
    if (ts.isCallExpression(node) && property(node.expression, "replace") && node.arguments.length === 2 &&
        suffix(node.arguments[0]) && ts.isStringLiteral(node.arguments[1]) &&
        [".js", ".d.ts"].includes(node.arguments[1].text)) literals.push(node.arguments[0])
    if (ts.isCallExpression(node) && property(node.expression, "map") && node.arguments.length === 1) {
      const entries = node.expression.expression
      const callback = node.arguments[0]
      if (ts.isCallExpression(entries) && entries.arguments.length === 1 &&
          property(entries.expression, "entries") && ts.isIdentifier(entries.expression.expression) &&
          entries.expression.expression.text === "Object" && ((property(originalArgument(entries.arguments[0]), "exports") && qualified(originalArgument(entries.arguments[0]))) || importsConditions(originalArgument(entries.arguments[0]))) &&
          ts.isArrowFunction(callback) && callback.parameters.length === 1) {
        const binding = callback.parameters[0].name
        if (ts.isArrayBindingPattern(binding) && binding.elements.length === 2 && binding.elements[0].name && binding.elements[1].name && ts.isIdentifier(binding.elements[0].name) && ts.isIdentifier(binding.elements[1].name)) {
          const value = binding.elements[1].name.text
          const guards = []
          const outputs = []
          const scan = (child) => {
            if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
              const mapper = pathMappers.get(child.expression.text)
              const argument = mapper && child.arguments[mapper.parameter]
              if (argument && ts.isIdentifier(argument) && argument.text === value) outputs.push(mapper.literal)
            }
            if (ts.isCallExpression(child) && property(child.expression, "test") && suffix(child.expression.expression) &&
                child.arguments.length === 1 && ts.isIdentifier(child.arguments[0]) && child.arguments[0].text === value) guards.push(child.expression.expression)
            ts.forEachChild(child, scan)
          }
          scan(callback.body)
          if (guards.length || outputs.length) {
            maps.push({ argument: entries.arguments[0], original: originalArgument(entries.arguments[0]), guards })
            literals.push(...outputs)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!literals.length || !maps.length) return { text, changed: false }
  for (const { argument, original, guards } of maps) {
    const expression = original.getText(source)
    const normalized = normalization(expression, importsConditions(original))
    if (JSON.stringify(shape(argument)) !== JSON.stringify(shape(expressionNode(normalized)))) {
      edits.push({ start: argument.getStart(source), end: argument.end, text: isJS ? normalized : "(" + normalized + " as typeof " + expression + ")" })
    }
    literals.push(...guards)
  }
  for (const literal of new Set(literals)) {
    if (literal.text.includes("|vibe")) continue // Already expanded by setup.
    const expanded = literal.text === "/\\.ts$/" ? "/\\.(?:ts|vibe)$/" : "/\\.(?:tsx?|vibe)$/"
    edits.push({ start: literal.getStart(source), end: literal.end, text: expanded })
  }
  if (!edits.length) return { text, changed: false }
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
        warnings.push(`${file}: publication helper handles only TypeScript source paths; setup leaves tests as they are (decided detail 272)`)
        continue
      }
      writeFileSync(posix.join(root, file), after.text)
      changed.push(file)
    }
  }
  return { changed, warnings }
}
