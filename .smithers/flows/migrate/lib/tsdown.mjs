// tsdown configs are Rolldown configurations. Keep each config's source
// settings and install the native-source plugin before its other transforms.
import { readFileSync } from "node:fs"
import { join, posix } from "node:path"

const moduleName = "vibelang-unplugin/rolldown"
const configName = /(?:^|\/)tsdown\.config\.(?:[cm]?[jt]s)$/
const testPath = /(?:^|\/)(?:tests?|__tests__|[^/]*fixtures?[^/]*)(?:\/|$)/i

export function addTsdownPlugin(text, ts, file = "tsdown.config.ts") {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.getScriptKindFromFileName(file))
  const refusals = []
  const warn = (node, reason) => refusals.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason })
  if (source.parseDiagnostics.length) return { text, refusals: [{ line: 1, reason: "cannot edit an unparsable tsdown config" }], usesPlugin: false }
  if (/^(?:\/\/|\/\*)[^\n]*(?:@generated|code generated|file is generated)/im.test(text.slice(0, 500))) {
    return { text, refusals: [{ line: 1, reason: "generated tsdown config: update its source" }], usesPlugin: false }
  }
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression
    return node
  }
  const names = new Set()
  const identifiers = node => { if (ts.isIdentifier(node)) names.add(node.text); ts.forEachChild(node, identifiers) }
  identifiers(source)
  // Bind the same parsed nodes used by the edit traversal. An unresolved
  // dependency still has a local import symbol; no dependency files are read.
  const host = ts.createCompilerHost({ allowJs: true, noLib: true, noResolve: true })
  host.getSourceFile = name => ts.sys.resolvePath(name) === ts.sys.resolvePath(file) ? source : undefined
  const checker = ts.createProgram([file], { allowJs: true, noLib: true, noResolve: true }, host).getTypeChecker()
  const factories = []
  const remember = (name, member = "") => factories.push({
    name: name.text, text: name.text + member, symbol: checker.getSymbolAtLocation(name)
  })
  const define = new Set(), namespaces = new Set()
  for (const node of source.statements.filter(ts.isImportDeclaration)) {
    if (!ts.isStringLiteralLike(node.moduleSpecifier) || node.importClause?.isTypeOnly) continue
    const bindings = node.importClause?.namedBindings
    if (node.moduleSpecifier.text === "tsdown") {
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if (!item.isTypeOnly && (item.propertyName ?? item.name).text === "defineConfig") define.add(item.name.text)
      }
    }
    if (node.moduleSpecifier.text === moduleName) {
      if (node.importClause?.name) remember(node.importClause.name)
      if (bindings && ts.isNamespaceImport(bindings)) remember(bindings.name, ".default")
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          if (!item.isTypeOnly && (item.propertyName ?? item.name).text === "default") remember(item.name)
        }
      }
    }
  }
  const imported = factories.length > 0
  let fresh
  const factoryAt = node => {
    const found = factories.find(factory => factory.symbol && checker.resolveName(factory.name, node, ts.SymbolFlags.Value, false) === factory.symbol)
    if (found) return found.text
    if (!fresh) {
      fresh = "vibelang"
      for (let i = 1; names.has(fresh); i++) fresh = "vibelangPlugin" + i
    }
    return fresh
  }
  const propertyName = node => {
    const name = node?.name
    if (!name) return null
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
    if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(unwrap(name.expression))) return unwrap(name.expression).text
    return null
  }
  const isFactory = input => {
    const call = unwrap(input)
    if (!ts.isCallExpression(call)) return false
    const callee = unwrap(call.expression)
    const root = ts.isPropertyAccessExpression(callee) ? unwrap(callee.expression) : callee
    return ts.isIdentifier(root) && factories.some(factory => factory.symbol &&
      callee.getText(source) === factory.text && checker.getSymbolAtLocation(root) === factory.symbol)
  }
  const binds = (pattern, name) => ts.isIdentifier(pattern) ? pattern.text === name :
    (ts.isObjectBindingPattern(pattern) || ts.isArrayBindingPattern(pattern)) && pattern.elements.some(e => ts.isBindingElement(e) && binds(e.name, name))
  // Resolve only immutable local options/helpers, respecting parameter and block shadows.
  const binding = node => {
    const name = node.text
    for (let scope = node.parent; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some(p => binds(p.name, name))) return null
      if (ts.isCatchClause(scope) && scope.variableDeclaration && binds(scope.variableDeclaration.name, name)) return null
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue
      for (const statement of scope.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement
        if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
          if (binds(declaration.name, name)) {
            return ts.isIdentifier(declaration.name) && statement.declarationList.flags & ts.NodeFlags.Const ? declaration.initializer : null
          }
        }
      }
    }
    return null
  }
  const objects = new Set(), seen = new Set()
  const gather = input => {
    const node = unwrap(input)
    if (!node || seen.has(node)) return
    seen.add(node)
    if (ts.isObjectLiteralExpression(node)) { objects.add(node); return }
    if (ts.isArrayLiteralExpression(node)) { node.elements.forEach(gather); return }
    if (ts.isIdentifier(node)) {
      const value = binding(node)
      if (value) gather(value); else warn(node, "config options are imported, mutable or parameter-dependent; add vibelang() by hand")
      return
    }
    if (ts.isConditionalExpression(node)) { gather(node.whenTrue); gather(node.whenFalse); return }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
      if (!node.body) { warn(node, "config helper has no body"); return }
      if (!ts.isBlock(node.body)) { gather(node.body); return }
      const returns = block => {
        if (ts.isReturnStatement(block)) { gather(block.expression); return }
        if (block !== node.body && ts.isFunctionLike(block)) return
        ts.forEachChild(block, returns)
      }
      returns(node.body)
      return
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      if (ts.isIdentifier(callee) && define.has(callee.text) ||
          ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) && callee.name.text === "defineConfig") {
        gather(node.arguments[0]); return
      }
      if (ts.isIdentifier(callee)) {
        const value = binding(callee)
        if (value) { gather(value); return }
      }
    }
    warn(node, "cannot follow this tsdown config expression; add vibelang() by hand")
  }
  const exported = source.statements.filter(ts.isExportAssignment)
  for (const node of exported) gather(node.expression)
  if (!exported.length) warn(source, "tsdown config needs a static default export; add vibelang() by hand")
  const edits = [], arrays = new Set()
  const arrayOf = input => {
    const node = unwrap(input)
    if (ts.isArrayLiteralExpression(node)) return node
    if (ts.isIdentifier(node)) {
      const value = unwrap(binding(node))
      if (value && ts.isArrayLiteralExpression(value)) return value
    }
    return null
  }
  for (const object of objects) {
    const fields = object.properties.filter(p => propertyName(p) === "plugins")
    const plugins = fields.at(-1)
    if (object.properties.some(p => (ts.isSpreadAssignment(p) || p.name && ts.isComputedPropertyName(p.name) && propertyName(p) === null) && (!plugins || p.pos > plugins.pos))) {
      warn(object, "a spread or computed key may replace plugins; add vibelang() to the effective plugins by hand"); continue
    }
    if (plugins) {
      const list = ts.isPropertyAssignment(plugins) ? arrayOf(plugins.initializer) :
        ts.isShorthandPropertyAssignment(plugins) ? arrayOf(plugins.name) : null
      if (!list) { warn(plugins, "plugins is not an immutable array; add vibelang() by hand"); continue }
      if (arrays.has(list) || list.elements.some(isFactory)) continue
      arrays.add(list)
      edits.push({ at: list.elements[0]?.getStart(source) ?? list.getStart(source) + 1, text: factoryAt(list) + "()" + (list.elements.length ? ", " : "") })
    } else {
      const at = object.getStart(source) + 1
      const indent = /^\s*\n([ \t]+)\S/.exec(text.slice(at))?.[1]
      const factory = factoryAt(object)
      edits.push({ at, text: indent ? "\n" + indent + "plugins: [" + factory + "()]," : " plugins: [" + factory + "()]," })
    }
  }
  if (edits.length && fresh) {
    const last = source.statements.filter(ts.isImportDeclaration).at(-1)
    const quote = /from\s+'/.test(text) ? "'" : '"'
    const semi = last && last.getText(source).trimEnd().endsWith(";") ? ";" : ""
    const eol = last ? text.indexOf("\n", last.end) : -1
    const next = last && source.statements[source.statements.indexOf(last) + 1]
    const bodyOnLine = next && (eol < 0 || next.getStart(source) < eol)
    const at = last ? (bodyOnLine || eol < 0 ? last.end : eol + 1) : (text.startsWith("#!") ? text.indexOf("\n") + 1 : 0)
    edits.push({ at, text: (last && (bodyOnLine || eol < 0) ? "\n" : "") + "import " + fresh + " from " + quote + moduleName + quote + semi + "\n" })
  }
  let after = text
  for (const edit of edits.sort((a, b) => b.at - a.at)) after = after.slice(0, edit.at) + edit.text + after.slice(edit.at)
  return { text: after, refusals, usesPlugin: imported || edits.length > 0 }
}

export function wireTsdownConfigs({ root, all, ts, specsFor, write }) {
  const warnings = []
  if (!ts) return { warnings }
  for (const file of all.filter(f => configName.test(f) && !testPath.test(f))) {
    const before = readFileSync(join(root, file), "utf8")
    const result = addTsdownPlugin(before, ts, file)
    for (const refusal of result.refusals) warnings.push(file + ":" + refusal.line + ": " + refusal.reason)
    if (result.text !== before) write(file, result.text)
    if (!result.usesPlugin) continue
    let dir = posix.dirname(file)
    while (!all.includes(posix.join(dir, "package.json")) && dir !== ".") dir = posix.dirname(dir)
    const manifest = posix.join(dir, "package.json")
    if (!all.includes(manifest)) continue
    const text = readFileSync(join(root, manifest), "utf8")
    const pkg = JSON.parse(text)
    const field = ["dependencies", "optionalDependencies", "devDependencies"].find(key => pkg[key]?.["vibelang-unplugin"]) ?? "devDependencies"
    const spec = specsFor(dir)["vibelang-unplugin"]
    if (!spec) { warnings.push(file + ":1: no vibelang-unplugin version is configured"); continue }
    if (pkg[field]?.["vibelang-unplugin"] === spec) continue
    ;(pkg[field] ??= {})["vibelang-unplugin"] = spec
    write(manifest, JSON.stringify(pkg, null, 2) + "\n")
  }
  return { warnings }
}
