// Source-discovery regexes (decided 04:00Z (B), beside detail 272): a test or
// tool that enumerates files and filters them with an extension regex such as
// /\.tsx?$/.test(file) may select .vibe modules and must not select their
// generated x.d.vibe.ts sidecars. The codemod rewrites only that one regex
// literal; the codemod's receipt and verify's test diff prove the same thing.

// The extension groups a filter may end in, each matching .ts or .mts sources.
const extensionGroups = new Set([
  "ts", "tsx?", "(ts|tsx)", "(tsx|ts)", "(?:ts|tsx)", "(?:tsx|ts)",
  "m?ts", "m?tsx?", "[cm]?ts", "[mc]?ts", "[cm]?tsx?", "[mc]?tsx?"
])

function parts(text) {
  if (typeof text !== "string" || !text.startsWith("/")) return null
  const end = text.lastIndexOf("/")
  if (end <= 0) return null
  return { body: text.slice(1, end), flags: text.slice(end + 1) }
}

/** The regex literal's widened text, or null when it is not a plain extension filter. */
export function widenExtensionRegex(text) {
  const p = parts(text)
  if (!p || !/^[iu]*$/.test(p.flags)) return null
  const m = /^\\\.(.+)\$$/.exec(p.body)
  if (!m || !extensionGroups.has(m[1])) return null
  return "/(?<!\\.d\\.vibe)\\.(?:" + m[1] + "|vibe)$/" + p.flags
}

export function compileRegex(text) {
  const p = parts(text)
  if (!p || /[gy]/.test(p.flags)) return null
  try { return new RegExp(p.body, p.flags) } catch { return null }
}

const testCall = (ts, node) => {
  let expression = node
  while (ts.isParenthesizedExpression(expression.parent)) expression = expression.parent
  const access = expression.parent
  return access && ts.isPropertyAccessExpression(access) && access.expression === expression && access.name.text === "test" &&
    ts.isCallExpression(access.parent) && access.parent.expression === access && access.parent.arguments.length === 1 && !access.parent.questionDotToken
}

/**
 * Every use of this regex literal is R.test(x): written inline, or bound once
 * by a const whose every reference is R.test(x). A regex that strips, splits or
 * matches can't widen, since its result is a string, not a selection.
 */
export function onlyTested(ts, source, node) {
  if (testCall(ts, node)) return true
  let declaration = node.parent
  while (ts.isParenthesizedExpression(declaration)) declaration = declaration.parent
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined || !ts.isIdentifier(declaration.name) ||
      !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)) return false
  const name = declaration.name.text
  const refs = []
  let declared = 0
  const visit = n => {
    if (ts.isIdentifier(n) && n.text === name) {
      if (n === declaration.name) declared++
      else if (n.parent && ((ts.isVariableDeclaration(n.parent) || ts.isParameter(n.parent) || ts.isBindingElement(n.parent) ||
        ts.isFunctionDeclaration(n.parent) || ts.isClassDeclaration(n.parent)) && n.parent.name === n)) declared++
      else if (!(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)) refs.push(n)
    }
    ts.forEachChild(n, visit)
  }
  visit(source)
  return declared === 1 && refs.length > 0 && refs.every(ref => testCall(ts, ref))
}

// Resolve local references without loading or executing the target project.
const referenceIndices = new WeakMap()
function referenceIndex(ts, source) {
  if (referenceIndices.has(source)) return referenceIndices.get(source)
  const program = ts.createProgram([source.fileName], { noLib: true, noResolve: true }, {
    getSourceFile: name => name === source.fileName ? source : undefined,
    getDefaultLibFileName: () => "", writeFile: () => {}, getCurrentDirectory: () => "",
    getDirectories: () => [], fileExists: name => name === source.fileName,
    readFile: name => name === source.fileName ? source.text : undefined,
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n"
  })
  const checker = program.getTypeChecker(), refs = new Map()
  const symbol = n => ts.isExportSpecifier(n.parent) ? checker.getExportSpecifierLocalTargetSymbol(n.parent) :
    ts.isShorthandPropertyAssignment(n.parent) ?
    checker.getShorthandAssignmentValueSymbol(n.parent) : checker.getSymbolAtLocation(n)
  const visit = n => {
    if (ts.isIdentifier(n)) {
      const s = symbol(n)
      if (s) refs.set(s, [...(refs.get(s) ?? []), n])
    }
    ts.forEachChild(n, visit)
  }
  visit(source)
  const result = { symbol, refs }
  referenceIndices.set(source, result)
  return result
}

const unwrap = (ts, n) => {
  while (ts.isParenthesizedExpression(n)) n = n.expression
  return n
}

/**
 * Detail 272 / RD-022: a named regex may widen only when every resolved use
 * is a selection predicate over an enumerated filename. Merely listing a
 * directory elsewhere, or merely calling R.test(x), proves no such dataflow.
 * This bounded proof deliberately refuses aliases and unknown consumers.
 * Inline predicates retain their existing admission, except assertions.
 */
export function onlySelectionUses(ts, source, node) {
  const assertion = n => {
    for (let p = n.parent; p && !ts.isStatement(p); p = p.parent)
      if (ts.isCallExpression(p) && /^(?:expect|assert)(?:\.|$)/.test(p.expression.getText(source))) return true
    return false
  }
  if (assertion(node)) return false
  if (testCall(ts, node)) return true
  let declaration = node.parent
  while (ts.isParenthesizedExpression(declaration)) declaration = declaration.parent
  if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name) ||
      !(declaration.parent.flags & ts.NodeFlags.Const)) return false
  if (declaration.parent.parent.modifiers?.some(m => [ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.DefaultKeyword].includes(m.kind))) return false
  const { symbol, refs } = referenceIndex(ts, source)
  const binding = symbol(declaration.name)
  if (!binding || binding.declarations?.length !== 1) return false
  const uses = (refs.get(binding) ?? []).filter(n => n !== declaration.name)
  const singleDeclaration = n => {
    const ds = symbol(n)?.declarations
    return ds?.length === 1 ? ds[0] : null
  }
  // Trust the imported enumerator's identity, never a locally spelled lookalike.
  const imported = (n, methods) => {
    n = unwrap(ts, n)
    const member = ts.isPropertyAccessExpression(n) ? n.name.text : null
    const d = singleDeclaration(member ? n.expression : n)
    if (!d) return false
    if (member && (ts.isNamespaceImport(d) || ts.isImportClause(d))) {
      const imp = ts.isNamespaceImport(d) ? d.parent.parent : d.parent
      return ["fs", "node:fs"].includes(imp.moduleSpecifier?.text) && methods.has(member)
    }
    if (!member && ts.isImportSpecifier(d)) {
      const imp = d.parent.parent.parent
      return ["fs", "node:fs"].includes(imp.moduleSpecifier?.text) && methods.has(d.propertyName?.text ?? d.name.text)
    }
    return false
  }
  const listing = (n, seen = new Set()) => {
    n = unwrap(ts, n)
    if (ts.isIdentifier(n)) {
      const d = singleDeclaration(n)
      if (!d || seen.has(d) || !ts.isVariableDeclaration(d) || !d.initializer ||
          !(d.parent.flags & ts.NodeFlags.Const)) return false
      // A const array is still mutable. Admit only a single consumption,
      // not another callback that could change it through its array argument.
      const s = symbol(n), next = new Set([...seen, d])
      const reads = (refs.get(s) ?? []).filter(ref => ref !== d.name)
      if (reads.length !== 1 || reads[0] !== n) return false
      return listing(d.initializer, next)
    }
    if (!ts.isCallExpression(n) || n.questionDotToken) return false
    if (imported(n.expression, new Set(["readdirSync", "globSync"]))) return true
    const e = n.expression
    if (!ts.isPropertyAccessExpression(e)) return false
    return e.name.text === "map" && n.arguments.length === 1 && ts.isIdentifier(n.arguments[0]) &&
      n.arguments[0].text === "String" && !symbol(n.arguments[0]) && listing(e.expression, seen)
  }
  return uses.length > 0 && uses.every(ref => {
    if (!testCall(ts, ref) || assertion(ref)) return false
    let receiver = ref
    while (ts.isParenthesizedExpression(receiver.parent)) receiver = receiver.parent
    const call = receiver.parent.parent
    // Only pure boolean composition may carry the result to the filter.
    let result = call
    for (;;) {
      const p = result.parent
      if (ts.isParenthesizedExpression(p) ||
          ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken ||
          ts.isBinaryExpression(p) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(p.operatorToken.kind)) result = p
      else break
    }
    let callback = result.parent
    if (ts.isReturnStatement(callback) && ts.isBlock(callback.parent) &&
        callback.parent.statements.length === 1) callback = callback.parent.parent
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return false
    if (callback.modifiers?.length || callback.asteriskToken || callback.parameters.length !== 1) return false
    const writesParameter = n => ts.isBinaryExpression(n) && (n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      ts.isPrefixUnaryExpression(n) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(n.operator) ||
      ts.isPostfixUnaryExpression(n) || ts.forEachChild(n, writesParameter)
    if (writesParameter(callback.body)) return false
    const param = callback.parameters[0]
    const input = unwrap(ts, call.arguments[0])
    if (!ts.isIdentifier(param.name) || param.initializer || param.dotDotDotToken ||
        !ts.isIdentifier(input) || symbol(input) !== symbol(param.name)) return false
    let argument = callback
    while (ts.isParenthesizedExpression(argument.parent)) argument = argument.parent
    const filter = argument.parent
    return ts.isCallExpression(filter) && filter.arguments.length === 1 && filter.arguments[0] === argument &&
      ts.isPropertyAccessExpression(filter.expression) && filter.expression.name.text === "filter" &&
      listing(filter.expression.expression)
  })
}

const enumerators = new Set(["readdir", "readdirSync", "opendir", "opendirSync", "glob", "globSync", "globby", "globbySync", "walk", "walkSync"])

/** The file lists a directory: the regex filters file names, not arbitrary strings. */
export function enumeratesFiles(ts, source) {
  let found = false
  const visit = n => {
    if (found) return
    if (ts.isCallExpression(n)) {
      const e = n.expression
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null
      if (name && enumerators.has(name)) { found = true; return }
    }
    ts.forEachChild(n, visit)
  }
  visit(source)
  return found
}

const moduleSpecifier = (ts, n) => {
  const p = n.parent
  return p && ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === n ||
    ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p) && ts.isImportTypeNode(p.parent))
}

const pathLiterals = (ts, source) => {
  const out = []
  const visit = n => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !moduleSpecifier(ts, n) || n.kind === ts.SyntaxKind.RegularExpressionLiteral) out.push(n)
    ts.forEachChild(n, visit)
  }
  visit(source)
  return out
}
// A path probe ignores g and y: it asks whether the regex matches, not where the last match ended.
const probeRegex = text => {
  const p = parts(text)
  if (!p) return null
  try { return new RegExp(p.body, p.flags.replace(/[gy]/g, "")) } catch { return null }
}
const probe = (ts, node) => {
  if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
    const re = probeRegex(node.text)
    return re ? path => [re.test(path)] : null
  }
  const text = node.text
  return path => text.length > 200 ? [] : [path.endsWith(text), path.includes(text), path.startsWith(text)]
}

/**
 * The file's other path tests treat each selected module's TypeScript path and
 * its .vibe path alike, so the rest of the filter (`!file.endsWith(".gen.ts")`,
 * `!/\.(test|browser)\.tsx?$/.test(file)`, `file.includes(".test.")`) keeps
 * its answer for the renamed file. Literals pair in source order between the
 * file before and after this pass, so a filename literal the codemod renames
 * with its module is probed in its new spelling. Lists each that disagrees;
 * `skip(before, after)` names the regex pairs being widened.
 */
export function disagreeingLiterals(ts, beforeSource, afterSource, renames, skip) {
  const before = pathLiterals(ts, beforeSource), after = pathLiterals(ts, afterSource)
  const at = n => beforeSource.getLineAndCharacterOfPosition(n.getStart(beforeSource)).line + 1
  if (before.length !== after.length) return [{ line: 0, literal: "", reason: "the pass changes the file's literals other than in place" }]
  const out = []
  for (let i = 0; i < before.length; i++) {
    const b = before[i], a = after[i]
    if (b.kind !== a.kind) return [{ line: at(b), literal: b.getText(beforeSource), reason: "literal kinds differ" }]
    if (skip(b, a)) continue
    const old = probe(ts, b), next = probe(ts, a)
    if (!old || !next) { out.push({ line: at(b), literal: b.getText(beforeSource), reason: "unsupported regex" }); continue }
    const r = renames.find(r => JSON.stringify(old(r.from)) !== JSON.stringify(next(r.to)))
    if (r) out.push({ line: at(b), literal: b.getText(beforeSource), rename: r.from })
  }
  return out
}

/** Extension-regex candidates; each still needs a use and selected-set proof. */
export function widenableRegexes(ts, source) {
  const out = []
  const visit = n => {
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral && widenExtensionRegex(n.text)) {
      let d = n.parent
      while (ts.isParenthesizedExpression(d)) d = d.parent
      if (onlyTested(ts, source, n) || ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) &&
          ts.isVariableDeclarationList(d.parent) && d.parent.flags & ts.NodeFlags.Const) out.push(n)
    }
    ts.forEachChild(n, visit)
  }
  visit(source)
  return out
}

/**
 * Selected-set identity on paths: the old regex over the TypeScript tree and
 * the widened one over the migrated tree (every .vibe module with its
 * sidecar) select the same files once each .vibe path maps back to its source.
 */
export function regexIdentity(before, after, beforePaths, afterPaths, renames, base = ".") {
  const old = compileRegex(before), next = compileRegex(after)
  if (!old || !next) return { pass: false, reason: "regex does not compile", contexts: [] }
  // A module is one identity under its stem: x.ts, x.vibe, and the x.d.vibe.ts
  // sidecar an earlier batch committed, which the unwidened regex selects.
  const fromOf = new Map(renames.map(r => [r.to, r.from]))
  const beforeSet0 = new Set(beforePaths)
  const logicalBefore = p => p.endsWith(".d.vibe.ts") && beforeSet0.has(p.slice(0, -10) + ".vibe") ? fromOf.get(p.slice(0, -10) + ".vibe") ?? p.slice(0, -10) + ".ts" : p
  const logicalAfter = p => fromOf.get(p) ?? (p.endsWith(".vibe") && beforeSet0.has(p.slice(0, -5) + ".d.vibe.ts") ? p.slice(0, -5) + ".ts" : p)
  const withSidecars = [...new Set([...afterPaths, ...afterPaths.filter(p => p.endsWith(".vibe")).map(p => p.slice(0, -5) + ".d.vibe.ts")])]
  const beforeNames = [...new Set(beforePaths.filter(p => old.test(p)).map(logicalBefore))].sort()
  const afterNames = withSidecars.filter(p => next.test(p)).sort()
  const mapped = afterNames.map(logicalAfter).sort()
  const beforeSet = new Set(beforeNames), afterSet = new Set(mapped)
  const added = mapped.filter(p => !beforeSet.has(p)), dropped = beforeNames.filter(p => !afterSet.has(p))
  const sidecars = afterNames.filter(p => p.endsWith(".d.vibe.ts"))
  const pass = !added.length && !dropped.length && !sidecars.length && mapped.length === new Set(mapped).size
  // The lists name the files under the selecting file's package; the identity holds for every path.
  const scoped = p => base === "." || p.startsWith(base + "/")
  const before_ = beforeNames.filter(scoped), after_ = afterNames.filter(p => scoped(logicalAfter(p)))
  return { pass, contexts: [{ base, before: before_, after: after_, mapped: after_.map(logicalAfter).sort(), beforeCount: before_.length, afterCount: after_.length,
    repository: { beforeCount: beforeNames.length, afterCount: afterNames.length }, added, dropped, pass, ...(sidecars.length ? { sidecars } : {}) }] }
}

/** The directory of the nearest package.json above file, or "." */
export function packageBase(file, paths) {
  const set = new Set(paths)
  for (let dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "."; ; dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : ".") {
    if (set.has(dir === "." ? "package.json" : dir + "/package.json")) return dir
    if (dir === ".") return "."
  }
}
