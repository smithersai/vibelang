// Source entries launched in another process need their own native loader,
// resolved in the spawning package, even when the child's cwd is elsewhere.
import { readFileSync } from "node:fs"
import { join, posix, resolve, sep } from "node:path"
import { packageScripts, testOnlyScripts } from "./test-files.mjs"

const marker = "// VibeLang source-child loader arguments."
const template = readFileSync(new URL("../templates/source-child.ts", import.meta.url), "utf8")
const api = name => name === "node:child_process" || name === "child_process"
  ? new Set(["spawn", "spawnSync"])
  : name === "effect/process/ChildProcess" ? new Set(["make"]) : null

// Refresh only the URL binding owned by a previously emitted helper. A
// namespace import obeys native no-import-alias rules without an exception.
// Keep manually observed bindings unchanged and report the boundary.
function refreshSourceChildImport(text, source, ts, checker) {
  const helpers = source.statements.filter(node => ts.isFunctionDeclaration(node) &&
    /^__vibelangSourceChild\d*$/.test(node.name?.text ?? ""))
  if (!helpers.length) return null
  const edits = [], refusals = []
  const inside = node => helpers.some(helper => helper.pos <= node.pos && node.end <= helper.end)
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "node:url" ||
      statement.importClause?.isTypeOnly) continue
    const clause = statement.importClause, named = clause?.namedBindings
    if (!named || !ts.isNamedImports(named)) continue
    for (const item of named.elements) {
      if (item.isTypeOnly || item.propertyName?.text !== "fileURLToPath" ||
        !/^__vibelangFileURLToPath\d*$/.test(item.name.text)) continue
      const binding = checker.getSymbolAtLocation(item.name), references = []
      const visit = node => {
        if (ts.isImportDeclaration(node)) return
        if (ts.isIdentifier(node)) {
          let target = checker.getSymbolAtLocation(node)
          if (ts.isShorthandPropertyAssignment(node.parent)) target = checker.getShorthandAssignmentValueSymbol(node.parent) ?? target
          if (ts.isExportSpecifier(node.parent)) target = checker.getExportSpecifierLocalTargetSymbol(node.parent) ?? target
          if (target === binding) references.push(node)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      if (!references.some(inside)) continue // An authored alias is not ours.
      const refuse = reason => refusals.push({
        line: source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1, reason
      })
      if (clause.name || named.elements.length !== 1) {
        refuse("generated source-child URL binding shares an authored import; retain it for manual review")
        continue
      }
      if (references.some(node => !inside(node) || !ts.isCallExpression(node.parent) || node.parent.expression !== node)) {
        refuse("generated source-child URL binding has manual references; retain it for manual review")
        continue
      }
      const quote = statement.moduleSpecifier.getText(source)[0]
      const semicolon = statement.getText(source).trimEnd().endsWith(";") ? ";" : ""
      edits.push({ start:statement.getStart(source), end:statement.end,
        text:"import * as " + item.name.text + " from " + quote + "node:url" + quote + semicolon })
      for (const node of references) edits.push({ start:node.getStart(source), end:node.end, text:item.name.text + ".fileURLToPath" })
    }
  }
  let after = text
  for (const edit of edits.sort((a,b) => b.start-a.start)) after = after.slice(0,edit.start) + edit.text + after.slice(edit.end)
  return { text:after, usesChild:true, refusals }
}

export function addSourceChildLoaders(text, ts, { file = "child.ts", type = "module" } = {}) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.getScriptKindFromFileName(file))
  const refusals = []
  const warn = (node, reason) => refusals.push({
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason
  })
  if (source.parseDiagnostics.length) return { text, usesChild: false, refusals: [{ line: 1, reason: "cannot edit an unparsable source-child launcher" }] }
  const bindings = new Map(), namespaces = new Map()
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteralLike(node.moduleSpecifier) || node.importClause?.isTypeOnly) continue
    const methods = api(node.moduleSpecifier.text)
    if (!methods) continue
    const clause = node.importClause
    if (clause?.name) namespaces.set(clause, methods)
    const named = clause?.namedBindings
    if (named && ts.isNamespaceImport(named)) namespaces.set(named, methods)
    if (named && ts.isNamedImports(named)) for (const item of named.elements) {
      if (!item.isTypeOnly && methods.has((item.propertyName ?? item.name).text)) bindings.set(item, true)
    }
  }
  const options = { noLib: true, noResolve: true, allowJs: true }
  const host = { ...ts.createCompilerHost(options), getSourceFile: name => name === file ? source : undefined }
  const checker = ts.createProgram({ rootNames: [file], options, host }).getTypeChecker()
  const symbol = node => checker.getSymbolAtLocation(node)
  const bound = (node, map) => symbol(node)?.declarations?.find(d => map.has(d))
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression
    return node
  }
  const calls = []
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      let known = ts.isIdentifier(callee) && bound(callee, bindings)
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const owner = ts.isIdentifier(callee.expression) && bound(callee.expression, namespaces)
        const property = ts.isPropertyAccessExpression(callee) ? callee.name.text
          : ts.isStringLiteralLike(callee.argumentExpression) ? callee.argumentExpression.text : undefined
        known ||= owner && namespaces.get(owner).has(property)
      }
      if (known) calls.push(node)
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          ts.isIdentifier(node.expression) && node.expression.text === "require") &&
          node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && api(node.arguments[0].text)) {
        warn(node, "a dynamically loaded child-process API needs native source preloads wired by hand")
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!calls.length) return { text, usesChild: false, refusals }
  const leading = text.slice(0, source.statements[0]?.getStart(source) ?? text.length)
  if (/@generated|code generated|generated file|file is generated|do not edit/i.test(leading)) {
    warn(calls[0], "generated child-process launcher: update its source")
    return { text, usesChild: false, refusals }
  }
  if (/\.[c][jt]s$/.test(file) || !/\.[m][jt]s$/.test(file) && type !== "module") {
    warn(calls[0], "a CommonJS child-process launcher needs an ESM source entry to resolve native preloads")
    return { text, usesChild: false, refusals }
  }

  if (text.includes(marker)) {
    const refreshed = refreshSourceChildImport(text, source, ts, checker)
    if (refreshed) return refreshed
  }

  const identifiers = new Set()
  const collect = node => { if (ts.isIdentifier(node)) identifiers.add(node.text); ts.forEachChild(node, collect) }
  collect(source)
  const fresh = name => {
    const base = name
    for (let i = 2; identifiers.has(name); i++) name = base + i
    identifiers.add(name)
    return name
  }
  const helper = fresh("__vibelangSourceChild"), url = fresh("__vibelangNodeURL")
  const edits = []
  for (const call of calls) {
    if (call.arguments.length < 2 || call.arguments.length > 3 || call.arguments.some(ts.isSpreadElement)) {
      warn(call, "source-child arguments must be an explicit command, argv array and optional options object")
      continue
    }
    const argument = unwrap(call.arguments[1])
    let array = argument
    if (ts.isIdentifier(argument)) {
      const binding = symbol(argument)
      const declaration = binding?.declarations?.find(ts.isVariableDeclaration)
      let references = 0
      const count = node => {
        if (ts.isIdentifier(node) && node !== declaration?.name && symbol(node) === binding) references++
        ts.forEachChild(node, count)
      }
      count(source)
      if (!declaration || !(declaration.parent.flags & ts.NodeFlags.Const) || references !== 1) {
        warn(call, "source-child argv is shared or mutable; wire its typed-source preloads by hand")
        continue
      }
      array = unwrap(declaration.initializer)
    }
    if (!array || !ts.isArrayLiteralExpression(array)) {
      warn(call, "source-child argv is not a literal array or a single-use const array; wire native preloads by hand")
      continue
    }
    const command = unwrap(call.arguments[0])
    if (ts.isStringLiteralLike(command) && !/^(?:node|nodejs|bun)(?:\.exe)?$/i.test(command.text.replace(/\\/g, "/").split("/").at(-1))) continue
    const start = call.arguments[0].getStart(source), end = call.arguments[1].end
    if (edits.some(edit => start < edit.end && end > edit.start)) {
      warn(call, "nested child-process arguments need their source preloads wired separately")
      continue
    }
    edits.push({
      start, end,
      text: "..." + helper + "(" + call.arguments[0].getText(source) + ", " + call.arguments[1].getText(source) + ")"
    })
  }
  if (!edits.length) return { text, usesChild: false, refusals }
  let rendered = template.replaceAll("__vibelangSourceChild", helper).replaceAll("__vibelangNodeURL", url)
  if (/\.[cm]?jsx?$/.test(file)) rendered = ts.transpileModule(rendered, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: false }
  }).outputText
  // Imports go after the directive prologue, before any executable statement,
  // including a call on the same line as an existing import.
  const helperSource = ts.createSourceFile(file, rendered, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const importNode = helperSource.statements.find(ts.isImportDeclaration)
  const helperImport = rendered.slice(importNode.getStart(helperSource), importNode.end)
  const body = rendered.slice(importNode.end).replace(/^export \{\};?\s*$/gm, "")
  let index = 0
  while (index < source.statements.length && ts.isExpressionStatement(source.statements[index]) &&
    ts.isStringLiteralLike(source.statements[index].expression)) index++
  const at = source.statements[index]?.getStart(source) ?? text.length
  edits.push({ start: at, end: at, text: helperImport + "\n" })
  edits.push({ start: text.length, end: text.length, text: "\n" + body + "\n" })
  let after = text
  for (const edit of edits.sort((a, b) => b.start - a.start)) after = after.slice(0, edit.start) + edit.text + after.slice(edit.end)
  return { text: after, usesChild: true, refusals }
}

export function wireSourceChildren({ root, all, manifests, ts, specsFor, write }) {
  const warnings = []
  if (!ts) return { warnings }
  for (const manifest of manifests) {
    const dir = posix.dirname(manifest)
    const current = JSON.parse(readFileSync(join(root, manifest), "utf8"))
    const scripts = packageScripts(root, dir).filter(file => all.includes(file))
    const candidates = scripts.map(file => ({ file, text: readFileSync(join(root, file), "utf8") }))
      .filter(({ text }) => /["'](?:node:)?child_process["']|["']effect\/process\/ChildProcess["']/.test(text))
    if (!candidates.length) continue
    const protectedFiles = testOnlyScripts(root, dir, scripts, current)
    const outputs = [], outputFiles = []
    const configs = all.filter(file => posix.dirname(file) === dir && /^(?:tsconfig|jsconfig)(?:\.[^.]+)*\.json$/.test(posix.basename(file)))
    for (const config of configs) {
      const parsed = ts.getParsedCommandLineOfConfigFile(resolve(root, config), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} })
      if (parsed?.options.outDir) outputs.push(resolve(parsed.options.outDir))
      if (parsed?.options.outFile) outputFiles.push(resolve(parsed.options.outFile))
    }
    let wired = false, runtime = false
    for (const { file, text } of candidates) {
      const absolute = resolve(root, file)
      if (outputFiles.includes(absolute) || outputs.some(out => absolute === out || absolute.startsWith(out + sep))) continue
      const result = addSourceChildLoaders(text, ts, { file, type: current.type ?? "commonjs" })
      if (protectedFiles.has(file)) {
        if (result.usesChild) warnings.push(file + ":1: test-owned child launcher stays unchanged (decided detail 272)")
        continue
      }
      for (const refusal of result.refusals) warnings.push(file + ":" + refusal.line + ": " + refusal.reason)
      if (!result.usesChild) continue
      if (!specsFor(dir).vibelang) { warnings.push(file + ":1: no vibelang version is configured for source children"); continue }
      if (result.text !== text) write(file, result.text)
      wired = true
      runtime ||= current.private !== true && !/(?:^|\/)(?:scripts?|tools?|configs?|build)\//.test(posix.relative(dir, file))
    }
    if (!wired) continue
    const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8"))
    const field = runtime || pkg.dependencies?.vibelang ? "dependencies" : "devDependencies"
    ;(pkg[field] ??= {}).vibelang = specsFor(dir).vibelang
    if (field === "dependencies" && pkg.devDependencies) delete pkg.devDependencies.vibelang
    write(manifest, JSON.stringify(pkg, null, 2) + "\n")
  }
  return { warnings }
}
