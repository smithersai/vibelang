// Vitest projects own their Vite plugin pipeline independently of the root.
import { posix } from "node:path"
import { listSources } from "./inventory.mjs"
import { nativeConfigDependency } from "./vite-config.mjs"
import { minimatch } from "./vendor/minimatch.mjs"

const property = (object, name, ts) => object.properties.find(p =>
  p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && p.name.text === name)
const unwrap = (node, ts) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression
  return node
}

// Read only literal paths and local path-builder expressions. Never execute a
// target's config while deciding which runner reaches a converted module.
function paths(source, ts, file) {
  const bindings = new Map(), pathImports = new Set()
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const)
      for (const d of statement.declarationList.declarations) if (ts.isIdentifier(d.name)) bindings.set(d.name.text, d.initializer)
    if (ts.isImportDeclaration(statement) && /^(?:node:)?path$/.test(statement.moduleSpecifier.text)) {
      if (statement.importClause?.name) pathImports.add(statement.importClause.name.text)
      const named = statement.importClause?.namedBindings
      if (named && ts.isNamespaceImport(named)) pathImports.add(named.name.text)
    }
  }
  const evaluate = (node, scope = new Map(), depth = 0) => {
    if (!node || depth > 30) return undefined
    node = unwrap(node, ts)
    const next = (n, s = scope) => evaluate(n, s, depth + 1)
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isIdentifier(node)) {
      if (scope.has(node.text)) return scope.get(node.text)
      if (node.text === "__dirname" && !bindings.has(node.text)) return posix.dirname(file)
      return next(bindings.get(node.text))
    }
    if (ts.isPropertyAccessExpression(node) && node.getText(source) === "import.meta.dirname") return posix.dirname(file)
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map(n => next(n))
      return values.every(v => typeof v === "string") ? values : undefined
    }
    if (!ts.isCallExpression(node)) return undefined
    const args = []
    for (const argument of node.arguments) {
      const spread = ts.isSpreadElement(argument), value = next(spread ? argument.expression : argument)
      if (spread ? !Array.isArray(value) : typeof value !== "string") return undefined
      args.push(...(spread ? value : [value]))
    }
    const callee = node.expression
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
        pathImports.has(callee.expression.text) && ["resolve", "join"].includes(callee.name.text)) {
      // Keep config-directory paths repository-relative rather than resolving
      // against this process's working directory.
      if (args.some(p => posix.isAbsolute(p))) return posix.resolve(...args)
      return posix.normalize(posix.join(...args))
    }
    if (ts.isIdentifier(callee)) {
      const fn = unwrap(bindings.get(callee.text), ts)
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && !ts.isBlock(fn.body)) {
        const locals = new Map(scope)
        for (const [i, parameter] of fn.parameters.entries()) {
          if (!ts.isIdentifier(parameter.name)) return undefined
          locals.set(parameter.name.text, parameter.dotDotDotToken ? args.slice(i) : args[i])
        }
        return next(fn.body, locals)
      }
    }
    return undefined
  }
  return node => evaluate(node)
}

/** Add the native plugin only to inline projects whose tests/setup reach native sources. */
export function addVitestProjectPlugins(text, ts, { root, file, packages, warn = message => { throw Error(message) } }) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const imported = source.statements.find(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "vibelang-vite" && n.importClause?.name)
  if (!imported) return text
  const plugin = imported.importClause.name.text, value = paths(source, ts, file)
  const sources = listSources(root, ".")
  let config
  const find = node => {
    if (config) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineConfig") {
      let arg = unwrap(node.arguments[0], ts)
      if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) {
        arg = unwrap(ts.isBlock(arg.body) ? arg.body.statements.filter(ts.isReturnStatement).at(-1)?.expression : arg.body, ts)
      }
      if (arg && ts.isObjectLiteralExpression(arg)) config = arg
    }
    if (!config) ts.forEachChild(node, find)
  }
  find(source)
  if (!config) return text
  const tests = property(config, "test", ts), options = tests && unwrap(tests.initializer, ts)
  if (!options || !ts.isObjectLiteralExpression(options)) return text
  const projects = property(options, "projects", ts), list = projects && unwrap(projects.initializer, ts)
  if (!list || !ts.isArrayLiteralExpression(list)) return text
  const baseProperty = property(config, "root", ts)
  const base = baseProperty ? value(baseProperty.initializer) : posix.dirname(file)
  if (typeof base !== "string") throw Error("Vitest root is dynamic; wire nested project loaders by hand")
  const reach = new Map()
  const reaches = file => {
    if (!reach.has(file)) reach.set(file, nativeConfigDependency({ root, file, packages, ts }))
    return reach.get(file)
  }
  const edits = []
  for (const element of list.elements) {
    try {
      const project = unwrap(element, ts)
      if (!ts.isObjectLiteralExpression(project)) continue // External project configs are wired separately.
      const projectTest = property(project, "test", ts), test = projectTest && unwrap(projectTest.initializer, ts)
      if (!test || !ts.isObjectLiteralExpression(test)) continue
      const name = property(test, "name", ts)?.initializer?.getText(source) ?? "unnamed"
      const refused = reason => { throw Error("Vitest project " + name + ": " + reason + "; wire its loader by hand") }
      const rootProperty = property(project, "root", ts)
      const projectPath = rootProperty ? value(rootProperty.initializer) : base
      if (typeof projectPath !== "string") refused("root is not a static path")
      const directory = posix.isAbsolute(projectPath) ? posix.relative(root, projectPath)
        : rootProperty && ts.isStringLiteralLike(unwrap(rootProperty.initializer, ts)) ? posix.join(base, projectPath) : projectPath
      if (directory === ".." || directory.startsWith("../")) refused("root is outside the target")
      const includeProperty = property(test, "include", ts)
      const include = includeProperty ? value(includeProperty.initializer) : ["**/*.{test,spec}.?(c|m)[jt]s?(x)"]
      const excludeProperty = property(test, "exclude", ts), exclude = excludeProperty ? value(excludeProperty.initializer) : []
      if (!Array.isArray(include) || !Array.isArray(exclude)) refused("include/exclude is not a literal list")
      const seeds = sources.filter(f => {
        const rel = posix.relative(directory, f)
        return include.some(p => minimatch(rel, p, { dot: true })) && !exclude.some(p => minimatch(rel, p, { dot: true }))
      })
      for (const field of ["setupFiles", "globalSetup"]) {
        const node = property(test, field, ts)
        if (!node) continue
        const entries = value(node.initializer)
        if (typeof entries !== "string" && !Array.isArray(entries)) refused(field + " is not a static path")
        seeds.push(...(typeof entries === "string" ? [entries] : entries).map(f => posix.join(directory, f)))
      }
      if (!seeds.some(reaches)) continue
      const plugins = property(project, "plugins", ts)
      const array = plugins && unwrap(plugins.initializer, ts)
      if (plugins && (!array || !ts.isArrayLiteralExpression(array))) refused("plugins is not an array literal")
      if (array?.elements.some(n => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === plugin)) continue
      const call = plugin + "({ register: true })"
      edits.push(plugins ? array.elements.length ? { at: array.elements[0].getStart(source), text: call + ", " }
        : { at: array.getStart(source) + 1, text: call }
        : { at: project.getStart(source) + 1, text: " plugins: [" + call + "]," })
    } catch (error) { warn(error.message) }
  }
  for (const edit of edits.sort((a, b) => b.at - a.at)) text = text.slice(0, edit.at) + edit.text + text.slice(edit.at)
  return text
}
