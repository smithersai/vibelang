// Node executes synchronous loader hooks in reverse registration order.
import { readFileSync } from "node:fs"
import { join, posix, resolve, sep } from "node:path"
import { packageScripts, testOnlyScripts } from "./test-files.mjs"

const registration = "vibelang/register"
const nodeModule = value => value === "node:module" || value === "module"

export function addNodeSourceHook(text, ts, { file = "register.mjs", type = "module" } = {}) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.getScriptKindFromFileName(file))
  const refusals = []
  const warn = (node, reason) => refusals.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason })
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node))) node = node.expression
    return node
  }
  const moduleImport = node => {
    node = unwrap(node)
    return node && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : null
  }
  const bindings = new Set(), namespaces = new Set()
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && nodeModule(node.moduleSpecifier.text) && !node.importClause?.isTypeOnly) {
      const clause = node.importClause
      if (clause?.name) namespaces.add(clause)
      const named = clause?.namedBindings
      if (named && ts.isNamespaceImport(named)) namespaces.add(named)
      if (named && ts.isNamedImports(named)) for (const item of named.elements) {
        if (!item.isTypeOnly && (item.propertyName ?? item.name).text === "registerHooks") bindings.add(item)
      }
    }
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      if (!(node.declarationList.flags & ts.NodeFlags.Const) || !nodeModule(moduleImport(declaration.initializer))) continue
      if (ts.isIdentifier(declaration.name)) namespaces.add(declaration)
      if (ts.isObjectBindingPattern(declaration.name)) for (const item of declaration.name.elements) {
        if ((item.propertyName ?? item.name).text === "registerHooks" && ts.isIdentifier(item.name)) bindings.add(item)
      }
    }
  }
  if (!bindings.size && !namespaces.size) {
    const commonJS = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" &&
          node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]) && nodeModule(node.arguments[0].text) && text.includes("registerHooks")) {
        warn(node, "CommonJS hook registration needs an ESM loader entry that awaits the native registration after installing repository hooks")
      }
      ts.forEachChild(node, commonJS)
    }
    commonJS(source)
    if (refusals.length) return { text, refusals, usesHook: false }
  }
  if (source.parseDiagnostics.length) return { text, refusals: [{ line: 1, reason: "cannot edit an unparsable Node hook registration" }], usesHook: false }
  // A binder gives imported names and lexical shadows different symbols. No
  // package is resolved and no repository JavaScript runs while finding calls.
  const options = { noLib: true, noResolve: true, allowJs: true }
  const host = { ...ts.createCompilerHost(options), getSourceFile: name => name === file ? source : undefined }
  const checker = ts.createProgram({ rootNames: [file], options, host }).getTypeChecker()
  const bound = (node, declarations) => checker.getSymbolAtLocation(node)?.declarations?.some(d => declarations.has(d))
  const hooks = []
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      const known = ts.isIdentifier(callee) && bound(callee, bindings) ||
        ts.isPropertyAccessExpression(callee) && callee.name.text === "registerHooks" &&
          (ts.isIdentifier(callee.expression) && bound(callee.expression, namespaces) || nodeModule(moduleImport(callee.expression)))
      if (known) {
        let statement = node.parent
        while (ts.isParenthesizedExpression(statement) || ts.isAwaitExpression(statement)) statement = statement.parent
        if (ts.isExpressionStatement(statement) && ts.isSourceFile(statement.parent)) hooks.push(statement)
        else warn(node, "Node hook registration is conditional or deferred; await import(\"vibelang/register\") after the repository installs its hooks")
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!hooks.length || refusals.length) return { text, refusals, usesHook: false }
  if (/\.[c][jt]s$/.test(file) || !/\.[m][jt]s$/.test(file) && type !== "module") {
    warn(hooks[0], "CommonJS hook registration needs an ESM loader entry that awaits import(\"vibelang/register\") after installing repository hooks")
    return { text, refusals, usesHook: false }
  }
  const leading = text.slice(0, source.statements[0]?.getStart(source) ?? text.length)
  if (/@generated|code generated|generated file|file is generated|do not edit/i.test(leading)) {
    warn(hooks[0], "generated Node hook registration: update its source")
    return { text, refusals, usesHook: false }
  }
  const old = []
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier) && statement.moduleSpecifier.text === registration) {
      if (statement.importClause) warn(statement, "the Node registration import has bindings; place a side-effect await import(\"vibelang/register\") after repository hooks by hand")
      else old.push(statement)
    } else if (ts.isExpressionStatement(statement) && moduleImport(statement.expression) === registration) old.push(statement)
  }
  const earlyImport = node => {
    if (ts.isCallExpression(node) && moduleImport(node) === registration) {
      let statement = node.parent
      while (ts.isParenthesizedExpression(statement) || ts.isAwaitExpression(statement)) statement = statement.parent
      if (!old.includes(statement)) warn(node, "the existing native registration is not a standalone preload; move it after repository hooks by hand")
    }
    ts.forEachChild(node, earlyImport)
  }
  earlyImport(source)
  if (refusals.length) return { text, refusals, usesHook: false }
  const last = source.statements.at(-1)
  if (old.length === 1 && old[0] === last && ts.isExpressionStatement(last) && ts.isAwaitExpression(last.expression)) {
    return { text, refusals, usesHook: true }
  }
  let after = text
  for (const statement of old.sort((a, b) => b.pos - a.pos)) after = after.slice(0, statement.getStart(source)) + after.slice(statement.end)
  after += (after.endsWith("\n") ? "" : "\n") + '\nawait import("vibelang/register");\n'
  return { text: after, refusals, usesHook: true }
}

export function wireNodeSourceHooks({ root, all, manifests, ts, specsFor, write }) {
  const warnings = []
  if (!ts) return { warnings }
  for (const manifest of manifests) {
    const dir = posix.dirname(manifest)
    const current = JSON.parse(readFileSync(join(root, manifest), "utf8"))
    const scripts = packageScripts(root, dir).filter(file => all.includes(file))
    const candidates = scripts.map(file => ({ file, text: readFileSync(join(root, file), "utf8") }))
      .filter(({ text }) => text.includes("registerHooks") && /["'](?:node:)?module["']/.test(text))
    if (!candidates.length) continue
    // Read project metadata only in packages with hook entries. Inherited
    // outDir/outFile values are relative to the config that declares them.
    const outputs = [], outputFiles = []
    const configs = all.filter(file => posix.dirname(file) === dir && ["tsconfig", "jsconfig"].some(prefix =>
      posix.basename(file) === prefix + ".json" || posix.basename(file).startsWith(prefix + ".") && posix.basename(file).endsWith(".json")))
    for (const config of configs) {
      const parsed = ts.getParsedCommandLineOfConfigFile(resolve(root, config), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} })
      if (parsed?.options.outDir) outputs.push(resolve(parsed.options.outDir))
      if (parsed?.options.outFile) outputFiles.push(resolve(parsed.options.outFile))
    }
    const testOnly = testOnlyScripts(root, dir, scripts, current)
    let wired = false
    for (const { file, text } of candidates) {
      const absolute = resolve(root, file)
      if (testOnly.has(file) || outputFiles.includes(absolute) || outputs.some(out => absolute === out || absolute.startsWith(out + sep))) continue
      const result = addNodeSourceHook(text, ts, { file, type: current.type ?? "commonjs" })
      for (const refusal of result.refusals) warnings.push(file + ":" + refusal.line + ": " + refusal.reason)
      if (!result.usesHook) continue
      if (!specsFor(dir).vibelang) { warnings.push(file + ":1: no vibelang version is configured for the Node loader"); continue }
      if (result.text !== text) write(file, result.text)
      wired = true
    }
    if (!wired) continue
    const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8"))
    const field = ["dependencies", "optionalDependencies", "devDependencies"].find(f => pkg[f]?.vibelang) ?? "devDependencies"
    ;(pkg[field] ??= {}).vibelang = specsFor(dir).vibelang
    write(manifest, JSON.stringify(pkg, null, 2) + "\n")
  }
  return { warnings }
}
