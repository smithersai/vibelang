// Plain functions stay plain (VIP-1). A plain-by-syntax compiler needs no
// preservation annotations: keep unwritten return types unwritten, including
// generators handed to Effect.fn, whose inference --fix must retain.
//
// Legacy-inference compilers instead need `: infer _` on value-only helpers
// and a written Generator type on ordinary generators. Functions returning
// Effects stay available for the compiler's TypeScript-form fixes.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { quote, run } from "./util.mjs"

/**
 * Whether a function that returns type returns a program: an Effect. A Layer
 * or a Stream is a description a plain function builds, `(n: number): infer _
 * => Layer.succeed(Port, { n })` declares `Layer.Layer<Port>` as TypeScript
 * does, where an Effect function would declare `Effect<Layer<Port>>`. An
 * Error with the Effect brand is a yieldable error, a Schema.TaggedError or
 * Data.TaggedError instance, and a value: t3code vcs.ts's
 * `static fromProcessExit(…) { return new VcsProcessExitError(…) }`, whose
 * callers `yield*` the error it returns to fail.
 */
function isProgram(ts, checker, type) {
  if (type.isUnion()) return type.types.some((member) => isProgram(ts, checker, member))
  const names = new Set(checker.getPropertiesOfType(checker.getApparentType(type)).map((p) => p.name))
  return names.has("~effect/Effect") && !(names.has("message") && names.has("name"))
}

/**
 * Whether node, a function passed as an argument, is a reader whose callee
 * has another overload that takes a function returning an Effect there:
 * TypeScript chose the overload whose callback returns a value, but the
 * toolchain reads an unannotated callback as an Effect function and picks
 * the other, so `Atom.make((get) => get(source)._tag === "Initial")` declared
 * `Atom<AsyncResult<boolean>>` where TypeScript declares `Atom<boolean>`
 * (t3code apps/web state/query.ts). Other callbacks take their kind from
 * their one signature and stay as written.
 */
function overloadedReader(ts, checker, node) {
  const call = node.parent
  if (!call || !(ts.isCallExpression(call) || ts.isNewExpression(call)) || !call.arguments?.includes(node)) return false
  const index = call.arguments.indexOf(node)
  const calleeType = checker.getTypeAtLocation(call.expression)
  const signatures = ts.isNewExpression(call) ? calleeType.getConstructSignatures() : calleeType.getCallSignatures()
  if (signatures.length < 2) return false
  // The return types of the callbacks a signature takes at index, or [] when it takes none there.
  const returns = (signature) => {
    const parameter = signature.getParameters()[index]
    if (!parameter) return []
    const type = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(parameter, call))
    return type.getCallSignatures().map((s) => checker.getReturnTypeOfSignature(s))
  }
  const resolved = checker.getResolvedSignature(call)
  const chosen = resolved ? returns(resolved) : []
  if (!chosen.length || chosen.some((t) => isProgram(ts, checker, t))) return false
  return signatures.some((signature) => returns(signature).some((t) => isProgram(ts, checker, t)))
}

/**
 * The call or new expression whose argument node fills, directly or as a
 * member of an object or array literal passed there, or null. TypeScript
 * types such a function from the parameter it fills, and so does a
 * legacy-inference toolchain: `Effect.try({ try: () => JSON.parse(text),
 * catch: (cause) => cause })` declares `Effect<unknown, unknown>` there
 * unannotated, and `new Proxy(target, { get: (_, key) => ... })` keeps its
 * handler's types (alchemy, 32 partition sources).
 */
function argumentOf(ts, node) {
  let child = node
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(child)) return parent
    const passesThrough = ts.isParenthesizedExpression(parent) || ts.isObjectLiteralExpression(parent) || ts.isArrayLiteralExpression(parent) ||
      ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === child) ||
      (ts.isConditionalExpression(parent) && parent.condition !== child)
    if (!passesThrough) return null
  }
  return null
}

// Effect's constructors whose generator argument is an Effect's body.
const effectBodyRunners = new Set(["gen", "genUntraced", "fn", "fnUntraced", "fnUntracedEager"])

/**
 * Whether node, a generator, is the body of an Effect: the argument of
 * Effect.gen, or of Effect.fn and its kin, directly or after a name
 * (`Effect.fn("name")(function* ...)`), under any import name. Its yields
 * carry the Effect's failures and requirements, so a written `Generator<...>`
 * type erases them: alchemy's Fly SecretProvider declared
 * `Layer<Provider<Secret>, never, unknown>` under `Generator<any, Attributes, any>`.
 */
function effectBody(ts, checker, node) {
  if (!node.asteriskToken) return false
  const call = node.parent
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(node)) return false
  const callee = ts.isCallExpression(call.expression) ? call.expression.expression : call.expression
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : ts.isIdentifier(callee) ? callee : null
  if (!name || !effectBodyRunners.has(name.text)) return false
  let symbol = checker.getSymbolAtLocation(name)
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
  return !!symbol?.declarations?.some((d) => /[\\/]effect[\\/]/.test(d.getSourceFile().fileName))
}

/**
 * A function the toolchain would make an Effect function: written with no
 * modifier and no return annotation, not an Effect's generator body
 * (effectBody), not a callback (argumentOf) unless it is an overloaded
 * reader's (overloadedReader).
 */
function candidate(ts, checker, node) {
  if (!(ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return false
  if (!node.body || node.type) return false
  if (effectBody(ts, checker, node)) return false
  if (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async) return false
  if (ts.isMethodDeclaration(node) && !(ts.isClassLike(node.parent) || ts.isObjectLiteralExpression(node.parent))) return false
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) && ts.isClassLike(node.parent)) return true
  const call = argumentOf(ts, node)
  return !call || call === node.parent && overloadedReader(ts, checker, node)
}

/**
 * A VIP-40 `module name { }` body, which a platform or throwing split writes
 * before this pass runs. Its source is TypeScript ("A body is a TypeScript
 * file stored inside a `.vibe` file"), where `: infer _` is TS1338. A
 * `namespace` and `declare global` are not bodies.
 */
const typeScriptBody = (ts, node) => ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) &&
  !(node.flags & (ts.NodeFlags.Namespace | ts.NodeFlags.GlobalAugmentation))

// The local names that value imports of a native module the program cannot
// read bind: a .vibe or .vibex peer converted earlier, with no declaration
// beside it. Every use of such a name reads as any, so a function returning
// one has a return type nobody has read, not a value (alchemy partition: a
// consumer of an earlier-converted event source, marked plain, failed EK9203).
function unreadNativeBindings(ts, checker, sf) {
  const names = new Set()
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!/\.vibex?$/.test(statement.moduleSpecifier.text) || checker.getSymbolAtLocation(statement.moduleSpecifier)) continue
    const clause = statement.importClause
    if (!clause || clause.isTypeOnly) continue
    if (clause.name) names.add(clause.name.text)
    const bindings = clause.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text)
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) if (!element.isTypeOnly) names.add(element.name.text)
  }
  return names
}

// Whether node reads one of names as a value: an identifier, not a property name.
function readsName(ts, node, names) {
  let found = false
  const visit = (n) => {
    if (found) return
    if (ts.isIdentifier(n) && names.has(n.text) && !(n.parent && (ts.isPropertyAccessExpression(n.parent) || ts.isQualifiedName(n.parent)) && n.parent.name === n)) found = true
    else ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

/** The text after a function's parameter list, or around a bare arrow parameter, that annotates its return. */
function annotation(ts, sf, node, text) {
  const children = node.getChildren(sf)
  const close = children.find((c) => c.kind === ts.SyntaxKind.CloseParenToken)
  if (close) return [{ pos: close.end, text: ": " + text }]
  const parameter = node.parameters[0]
  return [{ pos: parameter.getStart(sf), text: "(" }, { pos: parameter.end, text: "): " + text }]
}

/**
 * Legacy-inference edits: `: infer _` for value-only functions, a written
 * Generator type for plain generators, and unprintable generators by line.
 * A function whose unknown return comes from a native peer the program
 * cannot read is left for the compiler, which reads the peer, and listed by
 * line in unread. Plain-by-syntax needs none of these edits or legacy leftovers.
 */
export function plainEdits(ts, checker, sf, { flipped = false } = {}) {
  const edits = []
  const left = []
  const unread = []
  // Plain by syntax reads no types, so it has nothing unread.
  if (flipped) return { edits, left }
  const natives = unreadNativeBindings(ts, checker, sf)
  const visit = (node) => {
    if (typeScriptBody(ts, node)) return
    if (candidate(ts, checker, node)) {
      const signature = checker.getSignatureFromDeclaration(node)
      const returned = signature && checker.getReturnTypeOfSignature(signature)
      const unknownType = !returned || returned.flags & ts.TypeFlags.Any
      if (unknownType && natives.size && readsName(ts, node.body, natives)) {
        unread.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
        ts.forEachChild(node, visit)
        return
      }
      // A return type the program could not read: a body that names an Effect module may build a program.
      const program = unknownType ? /\b(Effect|Stream|Layer)\s*\./.test(node.body.getText(sf)) : isProgram(ts, checker, returned)
      if (!program) {
        if (node.asteriskToken) {
          const written = checker.typeToString(returned, node, ts.TypeFormatFlags.NoTruncation)
          if (/^(Generator|Iterable|IterableIterator)</.test(written) && !written.includes("import(")) edits.push(...annotation(ts, sf, node, written))
          else left.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
        } else {
          edits.push(...annotation(ts, sf, node, "infer _"))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return unread.length ? { edits, left, unread } : { edits, left }
}

/** text with edits applied; edits at one position keep their order. */
export function applyPlainEdits(text, edits) {
  const sorted = edits.map((e, i) => ({ ...e, i })).sort((a, b) => b.pos - a.pos || b.i - a.i)
  for (const e of sorted) text = text.slice(0, e.pos) + e.text + text.slice(e.pos)
  return text
}

/**
 * Writes the plain marks into each .ts file of files (paths relative to root)
 * before the codemod renames them, reading types through the TypeScript
 * program of the first of tsconfigs (paths relative to root) that includes
 * the file. Returns { file: { marked, left } } for each file it changed or
 * had to leave a generator in. renamed maps each module the batch renames
 * to the TypeScript source it is renamed from, both relative to root.
 */
export function markPlainFunctions(ts, root, files, tsconfigs, { read, write, exists, flipped = false, renamed = new Map() } = {}) {
  // The compiler probe already proved that syntax preserves plain functions.
  // Do not load package graphs for a legacy annotation pass that cannot edit them.
  if (flipped) return {}
  // read/write/exists take paths relative to root; the codemod passes its
  // prepared state's overlay, so the marks see the platform split's writes.
  const inRoot = (path) => { const rel = relative(root, path); return rel.startsWith("..") || isAbsolute(rel) ? null : rel.split(sep).join("/") }
  const readFile = (path) => { const rel = read && inRoot(path); return rel ? read(rel) ?? undefined : ts.sys.readFile(path) }
  const fileExists = (path) => { const rel = exists && inRoot(path); return rel ? exists(rel) : ts.sys.fileExists(path) }
  const host = { ...ts.sys, readFile, fileExists, onUnRecoverableConfigFileDiagnostic: () => {} }
  const configs = tsconfigs.map((tsconfig) => ts.getParsedCommandLineOfConfigFile(join(root, tsconfig), {}, host)).filter(Boolean)
  const groups = new Map()
  for (const file of files) {
    const config = configs.find((c) => c.fileNames.includes(join(root, file))) ?? configs[0]
    groups.set(config, [...(groups.get(config) ?? []), file])
  }
  const result = {}
  for (const [config, group] of groups) {
    const options = { ...(config?.options ?? {}), noEmit: true, skipLibCheck: true }
    const compilerHost = ts.createCompilerHost(options, true)
    Object.assign(compilerHost, { readFile, fileExists })
    // The batch's imports already name its renamed modules, ./peer.vibe for
    // ./peer.ts, and no declaration of peer.vibe exists before the compiler
    // runs. Stock TypeScript would read every import of such a peer as any,
    // and a function returning the peer's Effect would be marked plain. Read
    // the peer from the source it is renamed from, which is still here.
    if (renamed.size) {
      compilerHost.resolveModuleNameLiterals = (literals, containingFile, redirected, compilerOptions, containingSourceFile) => literals.map((literal) => {
        const mode = containingSourceFile && ts.getModeForUsageLocation ? ts.getModeForUsageLocation(containingSourceFile, literal, compilerOptions) : undefined
        const resolved = ts.resolveModuleName(literal.text, containingFile, compilerOptions, compilerHost, undefined, redirected, mode)
        if (resolved.resolvedModule || !/^\.\.?\//.test(literal.text)) return resolved
        const from = renamed.get(inRoot(resolve(dirname(containingFile), literal.text)))
        if (!from) return resolved
        const extension = from.endsWith(".tsx") ? ts.Extension.Tsx : from.endsWith(".mts") ? ts.Extension.Mts : from.endsWith(".cts") ? ts.Extension.Cts : ts.Extension.Ts
        return { resolvedModule: { resolvedFileName: join(root, from), extension, isExternalLibraryImport: false, resolvedUsingTsExtension: true } }
      })
    }
    const program = ts.createProgram({ rootNames: group.map((f) => join(root, f)), options, host: compilerHost })
    const checker = program.getTypeChecker()
    for (const file of group) {
      const sf = program.getSourceFile(join(root, file))
      if (!sf) continue
      const { edits, left, unread = [] } = plainEdits(ts, checker, sf, { flipped })
      if (!edits.length && !left.length && !unread.length) continue
      if (edits.length) write ? write(file, applyPlainEdits(sf.text, edits)) : ts.sys.writeFile(join(root, file), applyPlainEdits(sf.text, edits))
      result[file] = { marked: edits.filter((e) => e.text !== "(").length, left, ...(unread.length ? { unread } : {}) }
    }
  }
  return result
}

/**
 * Whether compiler keeps a function without a modifier plain, as VIP-1 says:
 * it declares `export const f = () => 1` as `() => number`. A toolchain
 * before VIP-1's flip declares `() => Effect.Effect<number, …>`. On a flipped
 * toolchain `: infer _` means nothing and TypeScript rejects it (TS1338), so
 * the pass writes none (decided detail 269): a function is plain by its
 * syntax, and its declaration is TypeScript's without one. modules is a
 * node_modules directory that resolves effect, as the target's does; dir is
 * where the probe may write.
 */
export async function toolchainKeepsFunctionsPlain({ compiler, modules, dir }) {
  mkdirSync(dir, { recursive: true })
  const probe = mkdtempSync(join(dir, "plain-probe-"))
  try {
    symlinkSync(modules, join(probe, "node_modules"))
    writeFileSync(join(probe, "package.json"), '{"type":"module"}')
    writeFileSync(join(probe, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", strict: true, types: [], skipLibCheck: true, declaration: true, emitDeclarationOnly: true, outDir: "out" }, include: ["probe.vibe"] }))
    writeFileSync(join(probe, "probe.vibe"), "export const f = () => 1\n")
    const result = await run(`${quote(compiler)} -p tsconfig.json --pretty false`, { cwd: probe, timeoutMs: 120000 })
    if (result.code !== 0 || result.signal || result.timedOut) {
      const reason = result.timedOut ? "timed out" : result.signal ? `signal ${result.signal}` : `exit ${result.code}`
      throw new Error(`function-model probe failed (${reason}); source files were not rewritten`)
    }
    let declared
    try { declared = readFileSync(join(probe, "out/probe.d.ts"), "utf8") }
    catch { throw new Error("function-model probe emitted no declaration; source files were not rewritten") }
    // VIP-27 permits the compiler's generated never contract on this fixed,
    // undocumented source. Other annotations and unknown result types still fail.
    const signature = declared.match(/\bf:\s*(?:\/\*\*\s+@throws\s+\{never\}\s+\*\/\s*)?\(\)\s*=>\s*([^;]+);/)?.[1]
    if (signature === "number") return true
    if (/^(?:[\w$]+\.)?Effect(?:\.Effect)?<number(?:,|>)/.test(signature ?? "")) return false
    // Only this constant probe's declaration is included, never customer source.
    const shape = JSON.stringify(declared.replace(/\s+/g, " ").slice(0, 240))
    throw new Error("function-model probe emitted an unknown declaration; source files were not rewritten; probe declaration: " + shape)
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}
