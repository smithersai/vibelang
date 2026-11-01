// Rolldown is also called from source modules and exported plugin factories,
// beyond rolldown.config files. Tests retain their original bundler calls.
import { readFileSync } from "node:fs"
import { join, posix, resolve, sep } from "node:path"
import { packageScripts, testOnlyScripts } from "./test-files.mjs"

const pluginModule = "vibelang-unplugin/rolldown"
const methods = new Set(["rolldown", "watch"])
export function addRolldownPlugins(text, ts, { file = "build.ts", type = "module", pinnedThrough = -1 } = {}) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.getScriptKindFromFileName(file))
  const refusals = []
  const warn = (node, reason) => refusals.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason })
  if (source.parseDiagnostics.length) return { text, wired: false, refusals: [{ line: 1, reason: "cannot edit unparsable Rolldown source" }] }
  const functions = new Set(), namespaces = new Set(), typeNamespaces = new Set(), pluginTypes = new Set(), pluginBindings = new Set()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue
    const clause = statement.importClause, named = clause?.namedBindings
    if (statement.moduleSpecifier.text === pluginModule && clause?.name && !clause.isTypeOnly) pluginBindings.add(clause)
    if (statement.moduleSpecifier.text !== "rolldown" || !clause) continue
    if (clause.name) { typeNamespaces.add(clause); if (!clause.isTypeOnly) { namespaces.add(clause); functions.add(clause) } }
    if (named && ts.isNamespaceImport(named)) {
      typeNamespaces.add(named)
      if (!clause.isTypeOnly) namespaces.add(named)
    }
    if (named && ts.isNamedImports(named)) for (const item of named.elements) {
      const imported = (item.propertyName ?? item.name).text
      if (/^(?:Plugin|PluginOption|InputPluginOption)$/.test(imported)) pluginTypes.add(item)
      if (!clause.isTypeOnly && !item.isTypeOnly && methods.has(imported)) functions.add(item)
    }
  }
  const options = { noLib: true, noResolve: true, allowJs: true }
  const host = { ...ts.createCompilerHost(options), getSourceFile: name => name === file ? source : undefined }
  const checker = ts.createProgram({ rootNames: [file], options, host }).getTypeChecker()
  const symbol = node => checker.getSymbolAtLocation(node)
  const bound = (node, set) => symbol(node)?.declarations?.some(d => set.has(d))
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) ||
      ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression
    return node
  }
  const returned = fn => {
    if (!fn.body) return []
    if (!ts.isBlock(fn.body)) return [fn.body]
    const out = []
    const visit = node => {
      if (node !== fn.body && ts.isFunctionLike(node)) return
      if (ts.isReturnStatement(node) && node.expression) out.push(node.expression)
      else ts.forEachChild(node, visit)
    }
    visit(fn.body)
    return out
  }
  const moduleValue = (node, seen = new Set()) => {
    node = unwrap(node)
    if (!node || seen.has(node)) return false
    seen.add(node)
    if (ts.isIdentifier(node) && bound(node, namespaces)) return true
    if (!ts.isCallExpression(node)) return false
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === "rolldown") return true
    if (!ts.isIdentifier(node.expression) || node.arguments.length) return false
    for (const d of symbol(node.expression)?.declarations ?? []) {
      const fn = ts.isVariableDeclaration(d) ? unwrap(d.initializer) : d
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn))) {
        const values = returned(fn)
        if (values.length && values.every(value => moduleValue(value, new Set(seen)))) return true
      }
    }
    return false
  }
  // Bind lazy imports, including const loadRolldown = () => import("rolldown").
  const bindModules = node => {
    if (ts.isVariableDeclaration(node) && node.parent.flags & ts.NodeFlags.Const && moduleValue(node.initializer)) {
      if (ts.isIdentifier(node.name)) namespaces.add(node)
      if (ts.isObjectBindingPattern(node.name)) for (const item of node.name.elements) {
        if (ts.isIdentifier(item.name) && methods.has((item.propertyName ?? item.name).text)) functions.add(item)
      }
    }
    ts.forEachChild(node, bindModules)
  }
  bindModules(source)
  const calls = [], sets = []
  const references = binding => {
    let count = 0
    const visit = node => { if (ts.isIdentifier(node) && node !== binding.name && symbol(node) === symbol(binding.name)) count++; ts.forEachChild(node, visit) }
    visit(source)
    return count
  }
  const literal = node => {
    node = unwrap(node)
    if (node && ts.isIdentifier(node)) {
      const d = symbol(node)?.declarations?.find(ts.isVariableDeclaration)
      if (d && d.parent.flags & ts.NodeFlags.Const && references(d) === 1) node = unwrap(d.initializer)
    }
    return node
  }
  const exported = new Set()
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      for (const d of symbol(statement.expression)?.declarations ?? []) exported.add(d)
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const item of statement.exportClause.elements) for (const d of symbol(item.propertyName ?? item.name)?.declarations ?? []) exported.add(d)
    }
    if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) exported.add(d)
      else exported.add(statement)
    }
  }
  const pluginType = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return false
    seen.add(node)
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName
      if (ts.isIdentifier(name)) {
        if (bound(name, pluginTypes)) return true
        for (const d of symbol(name)?.declarations ?? []) if (ts.isTypeAliasDeclaration(d) && pluginType(d.type, seen)) return true
      } else if (ts.isQualifiedName(name) && ts.isIdentifier(name.left) && bound(name.left, typeNamespaces) &&
        /^(?:Plugin|PluginOption|InputPluginOption)$/.test(name.right.text)) return true
    }
    let found = false
    ts.forEachChild(node, child => { if (pluginType(child, seen)) found = true })
    return found
  }
  for (const node of exported) {
    const initial = ts.isVariableDeclaration(node) ? unwrap(node.initializer) : node
    if (!pluginType(node.type ?? initial?.type)) continue
    if (initial && ts.isArrayLiteralExpression(initial)) sets.push(initial)
    else if (initial && ts.isFunctionLike(initial)) for (const value of returned(initial)) {
      const array = unwrap(value)
      if (ts.isArrayLiteralExpression(array)) sets.push(array)
      else warn(value, "an exported Rolldown plugin set does not return a literal array; add the native plugin by hand")
    }
  }
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      let known = ts.isIdentifier(callee) && bound(callee, functions)
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const property = ts.isPropertyAccessExpression(callee) ? callee.name.text :
          ts.isStringLiteralLike(callee.argumentExpression) ? callee.argumentExpression.text : undefined
        known ||= methods.has(property) && (ts.isIdentifier(callee.expression) && bound(callee.expression, namespaces) || moduleValue(callee.expression))
      }
      if (known) calls.push(node)
      if (ts.isIdentifier(callee) && callee.text === "require" && node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === "rolldown") warn(node, "CommonJS Rolldown loading needs the native plugin wired by hand")
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!calls.length && !sets.length) return { text, wired: false, refusals }
  const leading = text.slice(0, source.statements[0]?.getStart(source) ?? text.length)
  if (/@generated|code generated|generated file|file is generated|do not edit/i.test(leading) ||
      /\.[c][jt]s$/.test(file) || !/\.[m][jt]s$/.test(file) && type !== "module") {
    warn(calls[0] ?? sets[0], "generated or CommonJS Rolldown source: update its source or wire the plugin by hand")
    return { text, wired: false, refusals }
  }
  const names = new Set()
  const collect = node => { if (ts.isIdentifier(node)) names.add(node.text); ts.forEachChild(node, collect) }
  collect(source)
  let name = [...pluginBindings][0]?.name.text ?? "vibelangRolldown"
  if (!pluginBindings.size) for (let i = 2; names.has(name); i++) name = "vibelangRolldown" + i
  const native = name + "()"
  const edits = [], arrays = new Set()
  let covered = 0
  const addArray = array => {
    if (arrays.has(array)) return
    arrays.add(array)
    covered++
    if (array.elements.some(element => ts.isCallExpression(element) && ts.isIdentifier(element.expression) && bound(element.expression, pluginBindings))) return
    const index = Math.min(array.elements.length, pinnedThrough + 1)
    if (index === 0) edits.push({ at: array.getStart(source) + 1, text: native + (array.elements.length ? ", " : "") })
    else if (index < array.elements.length) edits.push({ at: array.elements[index].pos, text: " " + native + "," })
    else edits.push({ at: array.end - 1, text: (array.elements.hasTrailingComma ? "" : ", ") + native + (array.elements.hasTrailingComma ? "," : "") })
  }
  const propertyName = p => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : null
  const safeSpread = (node, seen = new Set()) => {
    node = literal(node)
    if (!node || !ts.isObjectLiteralExpression(node) || seen.has(node)) return false
    seen.add(node)
    return node.properties.every(p => ts.isSpreadAssignment(p) ? safeSpread(p.expression, seen) : propertyName(p) && propertyName(p) !== "plugins")
  }
  for (const call of calls) {
    const object = call.arguments.length === 1 && !ts.isSpreadElement(call.arguments[0]) ? literal(call.arguments[0]) : null
    if (!object || !ts.isObjectLiteralExpression(object)) { warn(call, "Rolldown options are not a literal or single-use const object; add the native plugin by hand"); continue }
    const plugins = object.properties.filter(p => propertyName(p) === "plugins")
    const property = plugins[0]
    if (plugins.length > 1 || property && (!ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(unwrap(property.initializer)))) {
      warn(call, "Rolldown plugins are not one literal array; add the native plugin by hand"); continue
    }
    const after = property ? object.properties.slice(object.properties.indexOf(property) + 1) : object.properties
    if (after.some(p => ts.isSpreadAssignment(p) && !safeSpread(p.expression))) {
      warn(call, "a spread may override Rolldown plugins; add the native plugin after resolving its options"); continue
    }
    if (property) addArray(unwrap(property.initializer))
    else { covered++; edits.push({ at: object.end - 1, text: (object.properties.length && !object.properties.hasTrailingComma ? ", " : "") + "plugins: [" + native + "]" }) }
  }
  for (const array of sets) addArray(array)
  if (!edits.length) return { text, wired: covered > 0, refusals }
  if (!pluginBindings.size) {
    let index = 0
    while (index < source.statements.length && ts.isExpressionStatement(source.statements[index]) && ts.isStringLiteralLike(source.statements[index].expression)) index++
    edits.push({ at: source.statements[index]?.getStart(source) ?? text.length, text: 'import ' + name + ' from "' + pluginModule + '";\n' })
  }
  let after = text
  for (const edit of edits.sort((a, b) => b.at - a.at)) after = after.slice(0, edit.at) + edit.text + after.slice(edit.at)
  return { text: after, wired: true, refusals }
}

// Preserve indexed plugin positions tests assert. Tests themselves stay untouched.
function pinnedIndex(text, ts, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.getScriptKindFromFileName(file))
  let pinned = -1
  const visit = node => {
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isNumericLiteral(node.argumentExpression) &&
        ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === "name") {
      pinned = Math.max(pinned, Number(node.argumentExpression.text))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return pinned
}

export function wireRolldownSources({ root, all, manifests, ts, specsFor, write }) {
  const warnings = []
  if (!ts) return { warnings }
  for (const manifest of manifests) {
    const dir = posix.dirname(manifest), current = JSON.parse(readFileSync(join(root, manifest), "utf8"))
    const scripts = packageScripts(root, dir).filter(file => all.includes(file))
    const candidates = scripts.map(file => ({ file, text: readFileSync(join(root, file), "utf8") }))
      .filter(({ text }) => /["']rolldown["']/.test(text))
    if (!candidates.length) continue
    const protectedFiles = testOnlyScripts(root, dir, scripts, current)
    const pinnedThrough = Math.max(-1, ...[...protectedFiles].map(file => pinnedIndex(readFileSync(join(root, file), "utf8"), ts, file)))
    const outputs = [], outputFiles = []
    for (const config of all.filter(file => posix.dirname(file) === dir && /^(?:tsconfig|jsconfig)(?:\.[^.]+)*\.json$/.test(posix.basename(file)))) {
      const parsed = ts.getParsedCommandLineOfConfigFile(resolve(root, config), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} })
      if (parsed?.options.outDir) outputs.push(resolve(parsed.options.outDir))
      if (parsed?.options.outFile) outputFiles.push(resolve(parsed.options.outFile))
    }
    let wired = false, runtime = false
    for (const { file, text } of candidates) {
      const absolute = resolve(root, file)
      if (outputFiles.includes(absolute) || outputs.some(out => absolute === out || absolute.startsWith(out + sep))) continue
      const result = addRolldownPlugins(text, ts, { file, type: current.type ?? "commonjs", pinnedThrough })
      if (protectedFiles.has(file)) {
        if (result.wired) warnings.push(file + ":1: test-owned Rolldown build stays unchanged (decided detail 272); its source graph must stay TypeScript")
        continue
      }
      for (const refusal of result.refusals) warnings.push(file + ":" + refusal.line + ": " + refusal.reason)
      if (!result.wired) continue
      if (!specsFor(dir)["vibelang-unplugin"]) { warnings.push(file + ":1: no vibelang-unplugin version is configured"); continue }
      if (result.text !== text) write(file, result.text)
      wired = true
      runtime ||= current.private !== true && !/(?:^|\/)(?:scripts?|tools?|configs?|build)\//.test(posix.relative(dir, file))
    }
    if (!wired) continue
    const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8"))
    const field = runtime || pkg.dependencies?.["vibelang-unplugin"] ? "dependencies" : "devDependencies"
    for (const dependency of ["vibelang-unplugin", "vibelang"]) if (specsFor(dir)[dependency]) {
      ;(pkg[field] ??= {})[dependency] = specsFor(dir)[dependency]
      if (field === "dependencies" && pkg.devDependencies) delete pkg.devDependencies[dependency]
    }
    write(manifest, JSON.stringify(pkg, null, 2) + "\n")
  }
  return { warnings }
}
