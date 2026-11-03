// Source entries launched in another process need their own native loader,
// resolved in the spawning package, even when the child's cwd is elsewhere.
import { readFileSync } from "node:fs"
import { join, posix, resolve, sep } from "node:path"
import { packageScripts, testOnlyScripts } from "./test-files.mjs"
import { sourceChildArgvProof } from "./source-child-argv.mjs"

const marker = "// VibeLang source-child loader arguments."
const template = readFileSync(new URL("../templates/source-child.ts", import.meta.url), "utf8")
const legacyTemplate = readFileSync(new URL("../templates/source-child-legacy.ts", import.meta.url), "utf8")
// JSDoc type queries can observe a generated binding without a runtime
// identifier use. Include those nodes in ownership and fresh-name checks.
function syntaxChildren(node, ts, visit) {
  const children = new Set()
  ts.forEachChild(node, child => { children.add(child) })
  for (const doc of node.jsDoc ?? []) children.add(doc)
  for (const child of children) visit(child)
}

// TypeScript annotations disappear in .mjs/.js output. Retain their
// private helper contract as JSDoc, so checkJs sees the same tuple and args.
function sourceChildJavaScript(code, ts, typed = true) {
  if (typed) {
    const source = ts.createSourceFile("source-child.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const edits = []
    const doc = (tags, node) => {
      if (!tags.length) return
      const at = node.getStart(source)
      const indent = /^[ \t]*/.exec(code.slice(code.lastIndexOf("\n", at) + 1, at))[0]
      edits.push({ start: at, text: "/**\n" + tags.map(tag => indent + " * " + tag).join("\n") + "\n" + indent + " */\n" + indent })
    }
    const params = parameters => parameters.filter(parameter => parameter.type).map(parameter =>
      "@param {" + parameter.type.getText(source) + "} " + (parameter.initializer || parameter.questionToken ? "[" + parameter.name.getText(source) + "]" : parameter.name.getText(source)))
    const visit = node => {
      if (ts.isFunctionDeclaration(node) && /^__vibelangSourceChild\d*$/.test(node.name?.text ?? "")) {
        const tags = (node.typeParameters ?? []).map(parameter => "@template " + (parameter.constraint ? "{" + parameter.constraint.getText(source) + "} " : "") + parameter.name.text)
        tags.push(...params(node.parameters))
        if (node.type) tags.push("@returns {" + node.type.getText(source) + "}")
        doc(tags, node)
      }
      if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1) {
        const declaration = node.declarationList.declarations[0]
        if (declaration.type) doc(["@type {" + declaration.type.getText(source) + "}"], node)
        else if (declaration.initializer && ts.isArrowFunction(declaration.initializer)) doc(params(declaration.initializer.parameters), node)
      }
      syntaxChildren(node, ts, visit)
    }
    visit(source)
    for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.start)
  }
  let output = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: false }
  }).outputText
  if (typed) {
    // The TS printer collapses structural blank lines. Keep generated JS
    // statement groups readable under the target's unchanged native policy.
    const source = ts.createSourceFile("source-child.mjs", output, ts.ScriptTarget.Latest, true)
    const breaks = new Set()
    const visit = node => {
      if (ts.isSourceFile(node) || ts.isBlock(node)) for (let i = 1; i < node.statements.length; i++) {
        const previous = node.statements[i - 1], current = node.statements[i]
        if (!/\n[ \t]*\n/.test(output.slice(previous.end, current.getStart(source)))) breaks.add(previous.end)
      }
      syntaxChildren(node, ts, visit)
    }
    visit(source)
    for (const at of [...breaks].sort((a, b) => b - a)) output = output.slice(0, at) + "\n" + output.slice(at)
  }
  return output
}

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
        syntaxChildren(node, ts, visit)
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

// Upgrade only the exact helper body this generator emitted. An authored
// observation or edit remains visible for review instead of being rewritten.
function refreshSourceChildPolicy(text, source, ts, checker, calls, file) {
  const helper = source.statements.find(node => ts.isFunctionDeclaration(node) && /^__vibelangSourceChild\d*$/.test(node.name?.text ?? ""))
  if (!helper) return null
  const imports = source.statements.filter(ts.isImportDeclaration)
  const currentSchema = imports.find(node => node.moduleSpecifier.text === "effect/Schema" && node.importClause?.namedBindings &&
    ts.isNamespaceImport(node.importClause.namedBindings) && /^__vibelangSchema\d*$/.test(node.importClause.namedBindings.name.text) &&
    helper.getText(source).includes(node.importClause.namedBindings.name.text + ".is("))
  const urlImport = imports.find(node => node.moduleSpecifier.text === "node:url" && node.importClause?.namedBindings &&
    ts.isNamespaceImport(node.importClause.namedBindings) && /^__vibelang(?:NodeURL|FileURLToPath)\d*$/.test(node.importClause.namedBindings.name.text))
  if (!urlImport) return null
  const url = urlImport.importClause.namedBindings.name.text
  if (currentSchema) {
    const canonical = template.replaceAll("__vibelangSourceChild", helper.name.text).replaceAll("__vibelangNodeURL", url)
      .replaceAll("__vibelangSchema", currentSchema.importClause.namedBindings.name.text)
    const javascript = /\.[cm]?jsx?$/.test(file)
    const raw = javascript ? sourceChildJavaScript(canonical, ts, false) : canonical
    const typed = javascript ? sourceChildJavaScript(canonical, ts) : canonical
    const parsed = ts.createSourceFile(file, typed, ts.ScriptTarget.Latest, true)
    const expected = parsed.statements.find(ts.isFunctionDeclaration)
    const expectedDocs = (expected.jsDoc ?? []).map(doc => doc.getText(parsed)).join("\n")
    const actualDocs = (helper.jsDoc ?? []).map(doc => doc.getText(source)).join("\n")
    if (helper.getText(source) === expected.getText(parsed) && actualDocs === expectedDocs) return null
    const previous = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true)
    if (javascript && helper.getText(source) === previous.statements.find(ts.isFunctionDeclaration).getText(previous) &&
        (!actualDocs || actualDocs === expectedDocs)) {
      const prefix = actualDocs ? "" : expectedDocs + "\n"
      return { text: text.slice(0, helper.getStart(source)) + prefix + expected.getText(parsed) + text.slice(helper.end), usesChild: true, refusals: [] }
    }
    return { text, usesChild: true, refusals: [{
      line: source.getLineAndCharacterOfPosition(helper.getStart(source)).line + 1,
      reason: "generated source-child helper has manual edits; retain it for policy review"
    }] }
  }
  const symbol = checker.getSymbolAtLocation(helper.name)
  const wrappers = calls.flatMap(call => {
    const spread = call.arguments[0], inner = spread && ts.isSpreadElement(spread) ? spread.expression : undefined
    return inner && ts.isCallExpression(inner) && checker.getSymbolAtLocation(inner.expression) === symbol ? [inner.expression] : []
  })
  let owned = true
  const visit = node => {
    if (ts.isIdentifier(node) && node !== helper.name && checker.getSymbolAtLocation(node) === symbol && !wrappers.includes(node)) owned = false
    syntaxChildren(node, ts, visit)
  }
  visit(source)
  let rendered = legacyTemplate.replaceAll("__vibelangSourceChild", helper.name.text).replaceAll("__vibelangNodeURL", url)
  const javascript = /\.[cm]?jsx?$/.test(file)
  const render = code => javascript ? ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: false }
  }).outputText : code
  rendered = render(rendered)
  const parsed = ts.createSourceFile(file, rendered, ts.ScriptTarget.Latest, true)
  const oldFunction = parsed.statements.find(ts.isFunctionDeclaration)
  if (!owned || helper.getText(source) !== oldFunction.getText(parsed)) return { text, usesChild: true, refusals: [{
    line: source.getLineAndCharacterOfPosition(helper.getStart(source)).line + 1,
    reason: "generated source-child helper has manual observations or edits; retain it for policy review"
  }] }
  const names = new Set()
  const collect = node => { if (ts.isIdentifier(node)) names.add(node.text); syntaxChildren(node, ts, collect) }
  collect(source)
  let schema = "__vibelangSchema"
  for (let i = 2; names.has(schema); i++) schema = "__vibelangSchema" + i
  const nextTemplate = template.replaceAll("__vibelangSourceChild", helper.name.text).replaceAll("__vibelangNodeURL", url).replaceAll("__vibelangSchema", schema)
  const next = javascript ? sourceChildJavaScript(nextTemplate, ts) : nextTemplate
  const nextSource = ts.createSourceFile(file, next, ts.ScriptTarget.Latest, true)
  const nextImports = nextSource.statements.filter(ts.isImportDeclaration)
  const schemaImport = nextImports.find(node => node.moduleSpecifier.text === "effect/Schema")
  const nextFunction = nextSource.statements.find(ts.isFunctionDeclaration)
  const functionDocs = (nextFunction.jsDoc ?? []).map(doc => doc.getText(nextSource)).join("\n")
  let after = text.slice(0, helper.getStart(source)) + (functionDocs ? functionDocs + "\n" : "") + nextFunction.getText(nextSource) + text.slice(helper.end)
  after = after.slice(0, urlImport.end) + "\n" + next.slice(schemaImport.getStart(nextSource), schemaImport.end) + after.slice(urlImport.end)
  return { text: after, usesChild: true, refusals: [] }
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
  const nonSourceArgv = sourceChildArgvProof({ source, ts, checker, template })
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
    syntaxChildren(node, ts, visit)
  }
  visit(source)
  if (!calls.length) return { text, usesChild: false, refusals }
  const leading = text.slice(0, source.statements[0]?.getStart(source) ?? text.length)
  if (/@generated|code generated|generated file|file is generated|do not edit/i.test(leading)) {
    warn(calls[0], "generated child-process launcher: update its source")
    return { text, usesChild: false, refusals }
  }
  const commonJS = /\.[c][jt]s$/.test(file) || !/\.[m][jt]s$/.test(file) && type !== "module"
  if (!commonJS && text.includes(marker)) {
    const helper = source.statements.find(node => ts.isFunctionDeclaration(node) && /^__vibelangSourceChild\d*$/.test(node.name?.text ?? ""))
    if (helper) {
      const binding = symbol(helper.name), wrappers = []
      for (const call of calls) {
        const spread = call.arguments[0], inner = spread && ts.isSpreadElement(spread) ? spread.expression : undefined
        if (inner && ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && symbol(inner.expression) === binding &&
            inner.arguments.length === 2 && !inner.arguments.some(ts.isSpreadElement)) wrappers.push({ spread, inner })
      }
      if (wrappers.some(({ inner }) => nonSourceArgv(inner.arguments[1], inner.arguments[0]))) {
        const references = target => {
          const found = []
          const visit = node => {
            if (ts.isImportDeclaration(node)) return
            if (ts.isIdentifier(node)) {
              let value = symbol(node)
              if (ts.isShorthandPropertyAssignment(node.parent)) value = checker.getShorthandAssignmentValueSymbol(node.parent) ?? value
              if (ts.isExportSpecifier(node.parent)) value = checker.getExportSpecifierLocalTargetSymbol(node.parent) ?? value
              if (value === target && node !== helper.name) found.push(node)
            }
            syntaxChildren(node, ts, visit)
          }
          visit(source)
          return found
        }
        const unnecessary = wrappers.filter(({ inner }) => nonSourceArgv(inner.arguments[1], inner.arguments[0]))
        const owned = references(binding).every(node => wrappers.some(({ inner }) => inner.expression === node))
        let urlImport, urlBinding
        for (const node of source.statements) {
          if (!ts.isImportDeclaration(node) || node.moduleSpecifier.text !== "node:url" || node.importClause?.isTypeOnly || node.importClause?.name) continue
          const named = node.importClause?.namedBindings
          const name = named && ts.isNamespaceImport(named) ? named.name
            : named && ts.isNamedImports(named) && named.elements.length === 1 && named.elements[0].propertyName?.text === "fileURLToPath" ? named.elements[0].name : undefined
          if (name && /^__vibelang(?:FileURLToPath|NodeURL)\d*$/.test(name.text) &&
              references(symbol(name)).every(node => helper.pos <= node.pos && node.end <= helper.end)) { urlImport = node; urlBinding = name.text; break }
        }
        // Match only byte-exact bodies this generator owns. Manual edits or
        // uses stay intact with a located warning instead of being discarded.
        const schemaImport = source.statements.find(node => ts.isImportDeclaration(node) &&
          node.moduleSpecifier.text === "effect/Schema" && node.importClause?.namedBindings &&
          ts.isNamespaceImport(node.importClause.namedBindings) &&
          /^__vibelangSchema\d*$/.test(node.importClause.namedBindings.name.text) &&
          references(symbol(node.importClause.namedBindings.name)).every(node => helper.pos <= node.pos && node.end <= helper.end))
        const schema = schemaImport?.importClause.namedBindings.name.text
        const legacy = legacyTemplate.replace(/import \* as __vibelangNodeURL from "node:url"/, 'import { fileURLToPath as __vibelangFileURLToPath } from "node:url"')
          .replaceAll("__vibelangNodeURL.fileURLToPath", "__vibelangFileURLToPath")
        let append
        if (owned && urlImport) for (const base of [legacy, ...(schema ? [template] : [])]) for (const namespace of [false, true]) {
          let rendered = base.replaceAll("__vibelangSourceChild", helper.name.text)
          rendered = base === legacy ? rendered.replaceAll("__vibelangFileURLToPath", urlBinding)
            : rendered.replaceAll("__vibelangNodeURL", urlBinding).replaceAll("__vibelangSchema", schema ?? "__vibelangSchema")
          if (namespace && base === legacy) rendered = rendered.replaceAll(urlBinding + "(", urlBinding + ".fileURLToPath(")
          const versions = /\.[cm]?jsx?$/.test(file)
            ? [sourceChildJavaScript(rendered, ts, false), ...(base === template ? [sourceChildJavaScript(rendered, ts)] : [])]
            : [rendered]
          for (const version of versions) {
            const parsed = ts.createSourceFile(file, version, ts.ScriptTarget.Latest, true)
            const imported = parsed.statements.filter(ts.isImportDeclaration).at(-1)
            const body = version.slice(imported.end).replace(/^export \{\};?\s*$/gm, "")
            const candidate = "\n" + body + "\n"
            if (text.endsWith(candidate)) { append = candidate; break }
          }
        }
        if (append) {
          const edits = unnecessary.map(({ spread, inner }) => ({ start: spread.getStart(source), end: spread.end,
            text: inner.arguments[0].getText(source) + ", " + inner.arguments[1].getText(source) }))
          const removeHelper = unnecessary.length === wrappers.length
          if (removeHelper) {
            edits.push({ start: text.length - append.length, end: text.length, text: "" })
            for (const imported of [urlImport, schemaImport].filter(Boolean)) {
              const newline = /^\r?\n/.exec(text.slice(imported.end))?.[0].length ?? 0
              edits.push({ start: imported.getStart(source), end: imported.end + newline, text: "" })
            }
          }
          let after = text
          for (const edit of edits.sort((a,b) => b.start-a.start)) after = after.slice(0,edit.start) + edit.text + after.slice(edit.end)
          return addSourceChildLoaders(after, ts, { file, type })
        }
        warn(helper, "non-source launcher has a manually edited or observed generated helper; retain it for review")
        return { text, usesChild: true, refusals }
      }
    }
  }

  if (commonJS) {
    warn(calls[0], "a CommonJS child-process launcher needs an ESM source entry to resolve native preloads")
    return { text, usesChild: false, refusals }
  }

  if (text.includes(marker)) {
    const declared = source.statements.find(node => ts.isFunctionDeclaration(node) && /^__vibelangSourceChild\d*$/.test(node.name?.text ?? ""))
    if (declared) {
      const target = checker.getSymbolAtLocation(declared.name)
      let observed = false
      const inspect = node => {
        let value = ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : undefined
        if (ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)) value = checker.getShorthandAssignmentValueSymbol(node.parent) ?? value
        if (ts.isIdentifier(node) && ts.isExportSpecifier(node.parent)) value = checker.getExportSpecifierLocalTargetSymbol(node.parent) ?? value
        if (ts.isIdentifier(node) && node !== declared.name && value === target &&
            !(ts.isCallExpression(node.parent) && node.parent.expression === node &&
              ts.isSpreadElement(node.parent.parent) && ts.isCallExpression(node.parent.parent.parent) &&
              calls.includes(node.parent.parent.parent))) observed = true
        syntaxChildren(node, ts, inspect)
      }
      inspect(source)
      if (observed) return { text, usesChild: true, refusals: [{
        line: source.getLineAndCharacterOfPosition(declared.getStart(source)).line + 1,
        reason: "generated source-child helper has manual observations; retain it for policy review"
      }] }
    }
    const refreshed = refreshSourceChildImport(text, source, ts, checker)
    if (refreshed?.refusals.length) return refreshed
    if (refreshed && refreshed.text !== text) return addSourceChildLoaders(refreshed.text, ts, { file, type })
    const upgraded = refreshSourceChildPolicy(text, source, ts, checker, calls, file)
    if (upgraded) return upgraded
    if (refreshed) return refreshed
  }

  const identifiers = new Set()
  const collect = node => { if (ts.isIdentifier(node)) identifiers.add(node.text); syntaxChildren(node, ts, collect) }
  collect(source)
  const fresh = name => {
    const base = name
    for (let i = 2; identifiers.has(name); i++) name = base + i
    identifiers.add(name)
    return name
  }
  const helper = fresh("__vibelangSourceChild"), url = fresh("__vibelangNodeURL"), schema = fresh("__vibelangSchema")
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
    if (nonSourceArgv(array, call.arguments[0])) continue
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
  let rendered = template.replaceAll("__vibelangSourceChild", helper).replaceAll("__vibelangNodeURL", url).replaceAll("__vibelangSchema", schema)
  if (/\.[cm]?jsx?$/.test(file)) rendered = sourceChildJavaScript(rendered, ts)
  // Imports go after the directive prologue, before any executable statement,
  // including a call on the same line as an existing import.
  const helperSource = ts.createSourceFile(file, rendered, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const importNodes = helperSource.statements.filter(ts.isImportDeclaration)
  const helperImport = importNodes.map(node => rendered.slice(node.getStart(helperSource), node.end)).join("\n")
  const body = rendered.slice(importNodes.at(-1).end).replace(/^export \{\};?\s*$/gm, "")
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
  const rootPackage = all.includes("package.json") ? JSON.parse(readFileSync(join(root, "package.json"), "utf8")) : {}
  const declaredEffect = pkg => pkg.dependencies?.effect ?? pkg.devDependencies?.effect ?? pkg.peerDependencies?.effect
  for (const manifest of manifests) {
    const dir = posix.dirname(manifest)
    const current = JSON.parse(readFileSync(join(root, manifest), "utf8"))
    const effectVersion = specsFor(dir).effect ?? declaredEffect(current) ?? declaredEffect(rootPackage)
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
      if (!result.usesChild) {
        if (result.text !== text) write(file, result.text)
        continue
      }
      if (!specsFor(dir).vibelang) { warnings.push(file + ":1: no vibelang version is configured for source children"); continue }
      if (!effectVersion) { warnings.push(file + ":1: source-child Schema boundary needs the selected toolchain Effect pin or a declared effect dependency; retain the native launcher"); continue }
      if (result.text !== text) write(file, result.text)
      wired = true
      runtime ||= current.private !== true && !/(?:^|\/)(?:scripts?|tools?|configs?|build)\//.test(posix.relative(dir, file))
    }
    if (!wired) continue
    const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8"))
    const field = runtime || pkg.dependencies?.vibelang ? "dependencies" : "devDependencies"
    ;(pkg[field] ??= {}).vibelang = specsFor(dir).vibelang
    if (!pkg.dependencies?.effect && (field === "dependencies" || !pkg.devDependencies?.effect)) {
      pkg[field].effect = effectVersion
    }
    if (field === "dependencies" && pkg.devDependencies) {
      delete pkg.devDependencies.vibelang
      delete pkg.devDependencies.effect
    }
    write(manifest, JSON.stringify(pkg, null, 2) + "\n")
  }
  return { warnings }
}
