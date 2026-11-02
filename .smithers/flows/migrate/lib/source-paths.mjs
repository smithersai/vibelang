import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { posix, join } from "node:path"
import { Minimatch } from "minimatch"
import { compileRegex, disagreeingLiterals, enumeratesFiles, packageBase, regexIdentity, widenableRegexes, widenExtensionRegex } from "./regex-selectors.mjs"


const calleeKey = (ts, node) => {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return calleeKey(ts,node.expression) + "." + node.name.text
  if (ts.isCallExpression(node)) return calleeKey(ts,node.expression) + "()"
  if (ts.isElementAccessExpression(node)) return calleeKey(ts,node.expression) + "[]"
  return String(node.kind)
}

// A stable local role distinguishes edited filename operands from pre-existing
// data strings with the same spelling; no source or credential values enter it.
function literalContext(ts, node) {
  const roles = []
  let outerFunction = false
  let child = node
  for (let p=node.parent; p; child=p, p=p.parent) {
    if (!outerFunction && (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(child)) roles.push("call:" + calleeKey(ts,p.expression) + ":" + p.arguments.indexOf(child))
    if (ts.isPropertyAssignment(p) && p.initializer === child) roles.push("property:" + (p.name.text ?? p.name.kind))
    if (ts.isArrayLiteralExpression(p)) roles.push("array:" + p.elements.indexOf(child))
    if (ts.isFunctionLike(p)) outerFunction = true
    if (ts.isVariableDeclaration(p) || (ts.isFunctionLike(p) && p.name)) {
      roles.push("owner:" + (p.name && ts.isIdentifier(p.name) ? p.name.text : p.kind))
      break
    }
  }
  return roles.length ? roles.join("|") : "parent:" + node.parent.kind
}

function globScope(ts, source) {
  const literal = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
  const globFunctions = new Set(), globNamespaces = new Map()
  const methods = new Set(["glob", "globSync", "globby", "globbySync", "sync"])
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    const module = statement.moduleSpecifier.text
    if (!["node:fs", "fs", "node:fs/promises", "fs/promises", "glob", "fast-glob", "globby"].includes(module)) continue
    const clause = statement.importClause
    if (clause.name) {
      globNamespaces.set(clause.name.text, methods)
      if (!/^(?:node:)?fs(?:\/promises)?$/.test(module)) globFunctions.add(clause.name.text)
    }
    const bindings = clause.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) globNamespaces.set(bindings.name.text, methods)
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
      if (methods.has(element.propertyName?.text ?? element.name.text)) globFunctions.add(element.name.text)
    }
  }
  // Without a project checker, refuse an imported glob name shadowed anywhere
  // in this file rather than guessing which local function gets the pattern.
  const shadows = node => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isBindingElement(node)) &&
        node.name && ts.isIdentifier(node.name)) {
      globFunctions.delete(node.name.text)
      globNamespaces.delete(node.name.text)
    }
    ts.forEachChild(node, shadows)
  }
  shadows(source)
  const knownGlob = expression => {
    if (ts.isIdentifier(expression)) return globFunctions.has(expression.text)
    if (!ts.isPropertyAccessExpression(expression)) return false
    const base = expression.expression
    if (ts.isMetaProperty(base) && base.keywordToken === ts.SyntaxKind.ImportKeyword && ["glob", "globEager"].includes(expression.name.text)) return true
    return ts.isIdentifier(base) && globNamespaces.get(base.text)?.has(expression.name.text)
  }
  const globOwner = node => {
    for (let p=node.parent; p && !ts.isStatement(p); p=p.parent) {
      if (ts.isCallExpression(p) && knownGlob(p.expression)) return p
    }
    return null
  }
  const globCall = node => {
    const call = globOwner(node)
    if (!call || call.arguments.length !== 1) return false
    let pattern = call.arguments[0]
    while (ts.isParenthesizedExpression(pattern)) pattern = pattern.expression
    if (pattern === node) return true
    return ts.isArrayLiteralExpression(pattern) &&
      pattern.elements.every(element => literal(element) && !element.text.startsWith("!")) &&
      pattern.elements.includes(node)
  }
  return { globOwner, globCall }
}

const scopeIndices = new WeakMap()
function scopeIndex(ts, scope) {
  if (scopeIndices.has(scope)) return scopeIndices.get(scope)
  const names = new Map(), calls = new Map(), bindings = new Set()
  const visit = node => {
    if (ts.isIdentifier(node)) names.set(node.text, (names.get(node.text) ?? 0) + 1)
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
         ts.isParameter(node) || ts.isBindingElement(node) || ts.isImportSpecifier(node) ||
         ts.isNamespaceImport(node) || ts.isImportClause(node)) && node.name && ts.isIdentifier(node.name)) bindings.add(node.name.text)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
      const key = node.expression.expression.text
      if (!calls.has(key)) calls.set(key, [])
      calls.get(key).push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(scope)
  const index = { names, calls, bindings }
  scopeIndices.set(scope, index)
  return index
}

function excludesSidecars(ts, source, node) {
  let declaration = node.parent, method = "includes"
  while (ts.isParenthesizedExpression(declaration)) declaration = declaration.parent
  if (ts.isNewExpression(declaration)) {
    if (!ts.isIdentifier(declaration.expression) || declaration.expression.text !== "Set" ||
        declaration.arguments?.length !== 1 || declaration.arguments[0] !== node ||
        scopeIndex(ts, source).bindings.has("Set")) return false
    method = "has"
    declaration = declaration.parent
    while (ts.isParenthesizedExpression(declaration)) declaration = declaration.parent
  }
  if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) return false
  let scope = node.parent
  while (scope && !ts.isFunctionLike(scope)) scope = scope.parent
  scope ??= source
  const list = declaration.name.text, index = scopeIndex(ts, scope)
  if ((index.names.get(list) ?? 0) - 1 !== 1) return false
  const literal = n => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
  const unwrap = n => { while (ts.isParenthesizedExpression(n)) n = n.expression; return n }
  for (const membership of index.calls.get(list) ?? []) {
    if (membership.expression.name.text !== method || membership.arguments.length !== 1) continue
    let conjunction = membership.parent
    while (ts.isParenthesizedExpression(conjunction)) conjunction = conjunction.parent
    if (!ts.isBinaryExpression(conjunction) || conjunction.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken ||
        unwrap(conjunction.right) !== membership) continue
    const guard = unwrap(conjunction.left)
    if (!ts.isPrefixUnaryExpression(guard) || guard.operator !== ts.SyntaxKind.ExclamationToken) continue
    const call = unwrap(guard.operand)
    if (!ts.isCallExpression(call) || call.questionDotToken || !ts.isPropertyAccessExpression(call.expression) ||
        call.expression.name.text !== "endsWith" || !ts.isIdentifier(call.expression.expression) ||
        call.arguments.length !== 1 || !literal(call.arguments[0]) || call.arguments[0].text !== ".d.vibe.ts") continue
    const file = call.expression.expression.text
    const extension = unwrap(membership.arguments[0])
    if (!ts.isCallExpression(extension) || extension.questionDotToken || extension.arguments.length !== 1 ||
        !ts.isPropertyAccessExpression(extension.expression) || !["slice", "substring"].includes(extension.expression.name.text) ||
        !ts.isIdentifier(extension.expression.expression) || extension.expression.expression.text !== file) continue
    const dot = unwrap(extension.arguments[0])
    if (!ts.isCallExpression(dot) || dot.questionDotToken || dot.arguments.length !== 1 ||
        !ts.isPropertyAccessExpression(dot.expression) || dot.expression.name.text !== "lastIndexOf" ||
        !ts.isIdentifier(dot.expression.expression) || dot.expression.expression.text !== file ||
        !literal(dot.arguments[0]) || dot.arguments[0].text !== ".") continue
    return true
  }
  return false
}

const selectorKey = (kind, context, value) => JSON.stringify([kind, context ?? null, value])
function selectorCounts(ts, text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const counts = new Map()
  const { globCall, globOwner } = globScope(ts, source)
  const literal = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
  const add = (kind, node, value) => {
    for (const context of [literalContext(ts, node), undefined]) {
      const key = selectorKey(kind, context, value)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const visit = node => {
    if (literal(node) && globCall(node)) add("source-glob", node, node.text)
    if (literal(node) && globOwner(node)) add("known-glob-context", node, null)
    if (ts.isArrayLiteralExpression(node) && node.elements.every(literal) && excludesSidecars(ts, source, node)) add("source-extensions", node, node.elements.map(n => n.text))
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) add("source-regex", node, node.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return counts
}

function compiledSelector(pattern, matcherCache) {
    if (matcherCache.has(pattern)) return matcherCache.get(pattern)
    // Bound brace expansion before asking Minimatch to compile. Data snippets
    // and combinatorial selectors must not monopolize an entire codemod run.
    let expansion = 1
    const braces = []
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i]
      if (ch === "{") braces.push(1)
      else if (ch === "," && braces.length) braces[braces.length - 1]++
      else if (ch === "}" && braces.length) expansion *= braces.pop()
      // Numeric and alphabetic brace ranges have a separate expansion cost.
      if (ch === "." && pattern[i + 1] === "." && braces.length) expansion = 257
      if (expansion > 256) {
        matcherCache.set(pattern, null)
        return null
      }
    }
    let matcher
    try { matcher = new Minimatch(pattern, { nonegate: true, nocomment: true, windowsPathsNoEscape: true, nocaseMagicOnly: true, optimizationLevel: 2, platform: process.platform, nocase: process.platform === "win32" || process.platform === "darwin" }) }
    catch { matcher = null }
    matcherCache.set(pattern, matcher)
    return matcher
}

function globBases(file, inventory) {
  const bases = new Set(["."])
  for (let base = posix.dirname(file); ; base = posix.dirname(base)) {
    bases.add(base)
    if (base === "." || posix.dirname(base) === base) break
  }
  for (const path of inventory ?? []) if (posix.basename(path) === "package.json") bases.add(posix.dirname(path))
  return [...bases]
}

/** Exact logical source identities, including a check that generated sidecars stay out. */
export function selectorIdentity(kind, before, after, file, renames, inventory, matcherCache = new Map()) {
  if (!inventory || renames.some(r => !inventory.includes(r.from) && !inventory.includes(r.to))) return {
    kind, pass: false, reason: "complete source inventory including every renamed module required", contexts: []
  }
  const fromOf = new Map(renames.map(r => [r.to, r.from])), toOf = new Map(renames.map(r => [r.from, r.to]))
  const originals = [...new Set(inventory.map(path => fromOf.get(path) ?? path))].sort()
  if (kind === "source-regex") {
    const proof = regexIdentity(before, after, originals, originals.map(path => toOf.get(path) ?? path), renames, packageBase(file, originals))
    return { kind, ...proof }
  }
  const mappedOriginals = originals.map(path => toOf.get(path) ?? path)
  const actual = [...new Set([...mappedOriginals, ...mappedOriginals.filter(path => path.endsWith(".vibe")).map(path => path.replace(/\.vibe$/, ".d.vibe.ts"))])]
  const old = kind === "source-glob" ? compiledSelector(before, matcherCache) : null
  const next = kind === "source-glob" ? compiledSelector(after, matcherCache) : null
  if (kind === "source-glob" && (!old || !next)) return { kind, pass: false, reason: "bounded matcher could not prove the selector", contexts: [] }
  const contexts = []
  for (const base of kind === "source-glob" ? globBases(file, inventory) : ["."]) {
    const matches = (pattern, matcher, path) => kind === "source-glob" ? matcher.match(posix.relative(base, path)) :
      !path.endsWith(".d.vibe.ts") && pattern.includes(posix.extname(path))
    const beforeNames = originals.filter(path => matches(before, old, path))
    const afterNames = actual.filter(path => matches(after, next, path)).sort()
    const mapped = afterNames.map(path => fromOf.get(path) ?? path).sort()
    const beforeSet = new Set(beforeNames), afterSet = new Set(mapped)
    const added = mapped.filter(path => !beforeSet.has(path)), dropped = beforeNames.filter(path => !afterSet.has(path))
    const sidecars = afterNames.filter(path => path.endsWith(".d.vibe.ts"))
    contexts.push({ base, before: beforeNames, after: afterNames, mapped, beforeCount: beforeNames.length, afterCount: afterNames.length, added, dropped,
      pass: JSON.stringify(beforeNames) === JSON.stringify(mapped) && !sidecars.length, ...(sidecars.length ? { sidecars } : {}) })
  }
  return { kind, pass: contexts.every(c => c.pass), contexts }
}

/** Recheck the final tracked inventory against the exact source names proved before rewriting. */
export function checkSelectorEdits(codemod, inventory, { ts, read } = {}) {
  const present = new Set(inventory), counts = new Map(), matcherCache = new Map()
  const allRenames = codemod?.renames ?? []
  const renames = read ? allRenames.filter(r => present.has(r.to)) : allRenames
  return (codemod?.referenceEdits ?? []).filter(edit => edit.selectorKind ||
    ["source-glob", "source-extensions", "source-regex"].includes(edit.kind) || (read && edit.kind === "source-reference")).map(edit => {
    let kind = edit.selectorKind ?? edit.kind
    let after = edit.to
    if (read) {
      const rename = allRenames.find(r => r.from === edit.file || r.to === edit.file)
      const file = [edit.file, rename?.from, rename?.to].find(file => file && present.has(file))
      if (!file || !ts) return { file: edit.file, line: edit.line, kind, pass: false, reason: "current selector source is unavailable" }
      if (!counts.has(file)) {
        try { counts.set(file, selectorCounts(ts, read(file), file)) }
        catch { counts.set(file, new Map()) }
      }
      if (edit.kind === "source-reference" && edit.module && !present.has(edit.module)) after = edit.from
      if (kind === "source-reference") {
        // Older filename receipts carried no selector marker. A known glob
        // context still needs its original proof; it cannot become ordinary data.
        if (!counts.get(file).get(selectorKey("known-glob-context", edit.context, null))) return null
        kind = "source-glob"
      }
      const actual = counts.get(file).get(selectorKey(kind, edit.context, after)) ?? 0
      if (!actual || actual !== (edit.selectorCount ?? 1)) return {
        file: edit.file, line: edit.line, kind, pass: false, reason: "current selector differs from its recorded proof"
      }
    }
    const original = codemod.selectorChecks?.find(proof => proof.file === edit.file && proof.line === edit.line && proof.kind === kind && proof.pass)
    if (!original) return { file: edit.file, line: edit.line, kind, pass: false, reason: "missing original selected-set proof" }
    const current = selectorIdentity(kind, edit.from, after, edit.file, renames, inventory, matcherCache)
    const unchanged = JSON.stringify(original.contexts.map(c => [c.base,c.before])) === JSON.stringify(current.contexts.map(c => [c.base,c.before]))
    return { file: edit.file, line: edit.line, ...current, pass: current.pass && unchanged,
      ...(unchanged ? {} : { reason: "logical source inventory changed after the selector proof" }) }
  }).filter(Boolean)
}

// Literal-only discovery wiring. Assertion expectations, test names, type
// literals, comments and code embedded in strings are never rewrite targets.
export function rewriteSourceLiterals(ts, text, file, renames, { selectors = true, exactContexts, inventory, matcherCache = new Map() } = {}) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.json$/.test(file) ? ts.ScriptKind.JSON : ts.ScriptKind.TS)
  const changes = [], warnings = [], edits = [], selectorChecks = []
  const bases = globBases(file, inventory)
  const line = n => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1
  const literal = n => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
  const quote = (value, node) => {
    const q = text[node.getStart(source)]
    const body = JSON.stringify(value).slice(1, -1)
    return q === "'" ? "'" + body.replaceAll("'", "\\'").replaceAll('\\"', '"') + "'" : q === "`" ? "`" + body.replaceAll("`", "\\`").replaceAll("${", "\\${") + "`" : '"' + body + '"'
  }
  const put = (node, value, kind, module, selectorKind) => {
    if (value === node.text) return
    if (kind === "source-glob" || selectorKind) {
      const proof = { file, line: line(node), ...selectorIdentity(selectorKind ?? kind, node.text, value, file, renames, inventory, matcherCache) }
      selectorChecks.push(proof)
      if (!proof.pass) {
        warnings.push(file + ":" + line(node) + ": source selector changes the selected set or lacks a complete inventory; rewrite refused")
        return
      }
    }
    changes.push({ start: node.getStart(source), end: node.end, text: quote(value, node) })
    edits.push({ file, from: node.text, to: value, kind, context: literalContext(ts,node), beforeLiteral: text.slice(node.getStart(source), node.end), ...(module ? { module } : {}), ...(selectorKind ? { selectorKind } : {}), line: line(node) })
  }
  const renameByPath = new Map(renames.map(r => [r.from, r]))
  const targetOf = value => {
    const direct = renameByPath.get(posix.normalize(value))
    const relative = renameByPath.get(posix.normalize(posix.join(posix.dirname(file), value)))
    return direct && relative && direct !== relative ? undefined : direct ?? relative
  }
  const pathPattern = value => value.length < 200 && (value.includes("/") || /\.(?:[cm]?[jt]sx?|vibe)(?:$|[,}])|\.\{(?:[cm]?[jt]sx?|vibe)[,}]/.test(value))
  const matcherOf = pattern => compiledSelector(pattern, matcherCache)
  const moduleMap = node => {
    if (!/(?:^|\/)package\.json$/.test(file)) return false
    for (let p=node.parent; p; p=p.parent) if (ts.isPropertyAssignment(p) && ["exports", "imports"].includes(p.name.text)) return true
    return false
  }
  const configGlob = /(?:^|\/)(?:(?:tsconfig|jsconfig)(?:\.[^/]*)?|vibe\.config)\.jsonc?$/.test(file)
  const { globOwner, globCall } = globScope(ts, source)
  const literalOnly = node => {
    if (ts.isLiteralTypeNode(node.parent) && !ts.isImportTypeNode(node.parent.parent)) return true
    if (ts.isVariableDeclaration(node.parent) && node.parent.type && ts.isLiteralTypeNode(node.parent.type)) return true
    if (ts.isCallExpression(node.parent)) {
      const call = node.parent, name = call.expression.getText(source)
      const at = call.arguments.indexOf(node)
      if (/^(?:it|test|describe|bench)(?:[.(]|$)/.test(name) && at === 0) return true
      if (/^(?:assert|expect)(?:\.|$)/.test(name) && literal(node)) return true
      if (/\.to[A-Z][A-Za-z]+$/.test(name)) return true
    }
    for (let n = node.parent; n && !ts.isStatement(n); n = n.parent) {
      if (ts.isCallExpression(n)) {
        const name = n.expression.getText(source)
        if (/\.to[A-Z][A-Za-z]+$/.test(name) && n.arguments.some(arg => node.pos >= arg.pos && node.end <= arg.end)) return true
        if (/^assert(?:\.|$)/.test(name) && n.arguments.slice(1).some(arg => node.pos >= arg.pos && node.end <= arg.end)) return true
      }
    }
    return false
  }
  const visit = node => {
    if (literal(node) && !literalOnly(node) && !moduleMap(node)) {
      const move = targetOf(node.text)
      if (move && (!exactContexts || exactContexts.has(literalContext(ts,node)))) {
        const discovery = globOwner(node)
        if (discovery && !globCall(node)) warnings.push(file + ":" + line(node) + ": source selector options or transformed patterns lack a selected-set proof; rewrite refused")
        else put(node, node.text.slice(0, -posix.extname(move.from).length) + posix.extname(move.to), "source-reference", move.to, discovery ? "source-glob" : undefined)
      }
      else if (selectors && pathPattern(node.text) && /[*?{}]/.test(node.text) && !node.text.startsWith("!") && !configGlob) {
        const pattern = node.text
        const matcher = matcherOf(pattern)
        if (!matcher) {
          warnings.push(file + ":" + line(node) + ": source glob exceeds bounded matcher expansion; wire its selector manually")
          ts.forEachChild(node, visit)
          return
        }
        const matches = value => matcher.match(value)
        const selected = renames.filter(r => bases.some(base => matches(posix.relative(base, r.from))))
        const nativeCovered = selected.every(r => {
          const sidecar = r.to.replace(/\.vibe$/, ".d.vibe.ts")
          return bases.filter(base => matches(posix.relative(base, r.from))).every(base =>
            matches(posix.relative(base, r.to)) && !matches(posix.relative(base, sidecar)))
        })
        if (selected.length && !nativeCovered && !globCall(node)) {
          warnings.push(file + ":" + line(node) + ": source glob selects renamed files; its matcher dialect needs manual native/sidecar wiring")
        } else if (selected.length && !nativeCovered) {
          // Retain TypeScript sources while adding native ones. The negative
          // stem excludes generated x.d.vibe.ts without excluding x.d.ts.
          const next = pattern.replace(/([^/]+)\.([cm]?ts)$/, (_, stem, ext) => (stem === "*" ? "!(*.d.vibe)" : stem) + ".{" + ext + ",vibe}")
          if (next !== pattern) put(node, next, "source-glob")
          else warnings.push(file + ":" + line(node) + ": source glob selects renamed files but needs a manual native extension/sidecar selector")
        }
      }
    }
    if (selectors && ts.isArrayLiteralExpression(node) && node.elements.length && node.elements.every(literal)) {
      const values = node.elements.map(n => n.text)
      if (values.includes(".ts") && !values.includes(".vibe") && values.every(v => /^\.[a-z0-9.]+$/i.test(v))) {
        if (excludesSidecars(ts, source, node) && !literalOnly(node)) {
          const last = node.elements.at(-1)
          const proof = { file, line: line(node), ...selectorIdentity("source-extensions", values, [...values, ".vibe"], file, renames, inventory, matcherCache) }
          selectorChecks.push(proof)
          if (proof.pass) {
            changes.push({ start: last.end, end: last.end, text: ", " + quote(".vibe", last) })
            edits.push({ file, from: values, to: [...values, ".vibe"], kind: "source-extensions", context: literalContext(ts,node), line: line(node) })
          } else warnings.push(file + ":" + line(node) + ": extension selector changes the selected set or lacks a complete inventory; rewrite refused")
        } else {
          // A bare allowlist cannot express a filename exclusion. Keep an
          // explicit repair warning instead of collecting generated sidecars.
          warnings.push(file + ":" + line(node) + ": source-extension allowlist needs .vibe and a .d.vibe.ts exclusion; only a literal-safe selector can be rewritten automatically")
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  // An extension regex that filters a listed directory, /\.tsx?$/.test(file),
  // selects .vibe modules and not their sidecars (decided 04:00Z (B), detail 272).
  if (selectors && renames.length && enumeratesFiles(ts, source)) {
    const asserted = node => {
      for (let n = node.parent; n && !ts.isStatement(n); n = n.parent)
        if (ts.isCallExpression(n) && /^(?:expect|assert)(?:\.|$)/.test(n.expression.getText(source))) return true
      return false
    }
    const regexes = widenableRegexes(ts, source).filter(node => !literalOnly(node) && !asserted(node))
      .filter(node => renames.some(r => compileRegex(node.text).test(r.from)))
    if (regexes.length) {
      // Every regex the file filters with widens, or none does: a half-widened filter changes the selection.
      const widened = new Set(regexes)
      const selected = renames.filter(r => regexes.some(node => compileRegex(node.text).test(r.from)))
      const pending = [...changes].sort((a, b) => b.start - a.start).reduce((out, c) => out.slice(0, c.start) + c.text + out.slice(c.end), text)
      const disagree = disagreeingLiterals(ts, source, ts.createSourceFile(file, pending, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), selected, node => widened.has(node))
      const proofs = regexes.map(node => ({ node, next: widenExtensionRegex(node.text),
        proof: { file, line: line(node), ...selectorIdentity("source-regex", node.text, widenExtensionRegex(node.text), file, renames, inventory, matcherCache) } }))
      const named = [...new Set(disagree.map(d => d.rename).filter(Boolean))]
      const refused = disagree.length ? "another path test in the file tells a renamed module from its TypeScript source (" +
        disagree.slice(0, 5).map(d => "line " + d.line + " " + d.literal).join(", ") + ")" + (named.length ? "; keep " + named.slice(0, 10).join(", ") + (named.length > 10 ? " and " + (named.length - 10) + " more" : "") + " as TypeScript, or wire the test by hand" : "") :
        proofs.some(p => !p.proof.pass) ? (proofs.find(p => !p.proof.pass).proof.reason ?? "the selected set changes or the inventory is incomplete") : null
      for (const { node, next, proof } of proofs) {
        if (refused) Object.assign(proof, { pass: false, reason: refused, ...(disagree.length ? { disagree } : {}) })
        selectorChecks.push(proof)
        if (refused) {
          warnings.push(file + ":" + line(node) + ": extension regex " + node.text + " cannot widen to .vibe: " + refused + "; rewrite refused")
          continue
        }
        changes.push({ start: node.getStart(source), end: node.end, text: next })
        edits.push({ file, from: node.text, to: next, kind: "source-regex", context: literalContext(ts, node), line: line(node) })
      }
    }
  }
  changes.sort((a, b) => b.start - a.start)
  for (const change of changes) text = text.slice(0, change.start) + change.text + text.slice(change.end)
  const selected = edits.filter(edit => edit.selectorKind || ["source-glob", "source-extensions", "source-regex"].includes(edit.kind))
  if (selected.length) {
    const counts = selectorCounts(ts, text, file)
    for (const edit of selected) edit.selectorCount = counts.get(selectorKey(edit.selectorKind ?? edit.kind, edit.context, edit.to)) ?? 0
  }
  return { text, edits, warnings, selectorChecks }
}

/** Restore exact filename literals for a module returned to TypeScript.
 * Additive glob/extension selectors remain valid for the mixed repository. */
export function restoreSourceLiterals(ts, root, edits, module, renames) {
  const vibe = renames.find(r => r.from === module)?.to ?? module.replace(/\.[cm]?ts$/, ".vibe")
  const restored = []
  const byFile = new Map()
  for (const edit of edits) {
    if (edit.kind !== "source-reference" || edit.module !== vibe) continue
    const fallback = renames.find(r => r.to === edit.file)?.from
    const candidates = edit.file.endsWith(".vibe") ? [fallback, ...[".ts", ".mts", ".cts"].map(ext => edit.file.replace(/\.vibe$/, ext))] : [edit.file.replace(/\.[cm]?ts$/, ".vibe")]
    const available = [...new Set(candidates.filter(f => f && existsSync(join(root, f))))]
    if (!existsSync(join(root, edit.file)) && available.length > 1) throw new Error(edit.file + ": ambiguous restored source for literal wiring")
    const file = existsSync(join(root, edit.file)) ? edit.file : available[0]
    if (!file || !existsSync(join(root, file))) continue
    byFile.set(file, [...(byFile.get(file) ?? []), edit])
  }
  for (const [file, changes] of byFile) {
    const text = readFileSync(join(root, file), "utf8")
    const result = restoreLiteralMap(ts, text, file, changes)
    if (result.text !== text) {
      writeFileSync(join(root, file), result.text)
      restored.push(...result.edits)
    }
  }
  return restored
}

function restoreLiteralMap(ts, text, file, changes) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const replacements = [], edits = []
  const visit = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const edit = changes.find(e => e.to === node.text && (!e.context || e.context === literalContext(ts,node)))
      if (edit) {
        let expected = ts.isLiteralTypeNode(node.parent) && !ts.isImportTypeNode(node.parent.parent)
        for (let p = node.parent; p && !ts.isStatement(p); p = p.parent) {
          if (!ts.isCallExpression(p)) continue
          const name = p.expression.getText(source)
          if (/^(?:assert|expect)(?:\.|$)/.test(name) && p.arguments.includes(node)) expected = true
          if (/\.to[A-Z][A-Za-z]+$/.test(name) && p.arguments.some(a => node.pos >= a.pos && node.end <= a.end)) expected = true
          if (/^assert(?:\.|$)/.test(name) && p.arguments.slice(1).some(a => node.pos >= a.pos && node.end <= a.end)) expected = true
          if (/^(?:it|test|describe|bench)(?:[.(]|$)/.test(name) && p.arguments[0] === node) expected = true
        }
        if (!expected) {
          const q = text[node.getStart(source)]
          let value = JSON.stringify(edit.from).slice(1, -1)
          if (q === "'") value = value.replaceAll("'", "\\'")
          replacements.push({ start: node.getStart(source), end: node.end, text: edit.beforeLiteral ?? (q + value + q) })
          edits.push({ file, from: node.text, to: edit.from, kind: "source-reference" })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  replacements.sort((a,b) => b.start-a.start)
  for (const r of replacements) text = text.slice(0,r.start) + r.text + text.slice(r.end)
  return { text, edits }
}
