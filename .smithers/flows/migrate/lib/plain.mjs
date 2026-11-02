// Plain functions stay plain. Every function in a .ts module is plain: calling
// it gives its result (VIP-1). On this toolchain a .vibe function with no
// modifier and no return annotation compiles to an Effect function instead,
// unless it is an inline callback (rules.md, "A function with no modifier is
// plain"), so a renamed helper's callers and declarations would change:
//
//   const makeId = (brand: string) => Schema.String.pipe(Schema.brand(brand))
//   export const ThreadId = makeId("ThreadId")   // EK1001; importers see Effect<Schema>
//
// Before the rename, the codemod writes `: infer _`, which keeps TypeScript's
// inferred return type, on each such function whose TypeScript return type is
// not an Effect. A Layer or a Stream it builds is a value, as a schema is, and
// so is a yieldable error, which carries the Effect brand only so `yield*`
// fails with it:
//
//   const makeId = (brand: string): infer _ => Schema.String.pipe(Schema.brand(brand))
//
// A plain generator gets its inferred Generator type written out, since
// `infer _` names no generator type; one whose type cannot be written without
// a new import is left, and listed. A function that returns an Effect is left
// for vibelang --fix, whose TypeScript-form fixes make it an effect function.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, sep } from "node:path"
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
 * A function the toolchain would make an Effect function: written with no
 * modifier and no return annotation, not an inline callback unless it is an
 * overloaded reader's (overloadedReader).
 */
function candidate(ts, checker, node) {
  if (!(ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return false
  if (!node.body || node.type) return false
  if (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async) return false
  if (ts.isMethodDeclaration(node) && !(ts.isClassLike(node.parent) || ts.isObjectLiteralExpression(node.parent))) return false
  const parent = node.parent
  const callback = (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(node)
  return !callback || overloadedReader(ts, checker, node)
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
 * The edits that keep sf's plain functions plain: `: infer _` on each candidate
 * whose TypeScript return type is no program, a written Generator type on a
 * plain generator. Also the generators left, by line.
 */
export function plainEdits(ts, checker, sf, { flipped = false } = {}) {
  const edits = []
  const left = []
  const visit = (node) => {
    if (candidate(ts, checker, node)) {
      const signature = checker.getSignatureFromDeclaration(node)
      const returned = signature && checker.getReturnTypeOfSignature(signature)
      const unknownType = !returned || returned.flags & ts.TypeFlags.Any
      // A return type the program could not read: a body that names an Effect module may build a program.
      const program = unknownType ? /\b(Effect|Stream|Layer)\s*\./.test(node.body.getText(sf)) : isProgram(ts, checker, returned)
      if (!program) {
        if (node.asteriskToken) {
          const written = checker.typeToString(returned, node, ts.TypeFormatFlags.NoTruncation)
          if (/^(Generator|Iterable|IterableIterator)</.test(written) && !written.includes("import(")) edits.push(...annotation(ts, sf, node, written))
          else left.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
        } else if (!flipped) {
          edits.push(...annotation(ts, sf, node, "infer _"))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { edits, left }
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
 * had to leave a generator in.
 */
export function markPlainFunctions(ts, root, files, tsconfigs, { read, write, exists, flipped = false } = {}) {
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
    const program = ts.createProgram({ rootNames: group.map((f) => join(root, f)), options, host: compilerHost })
    const checker = program.getTypeChecker()
    for (const file of group) {
      const sf = program.getSourceFile(join(root, file))
      if (!sf) continue
      const { edits, left } = plainEdits(ts, checker, sf, { flipped })
      if (!edits.length && !left.length) continue
      if (edits.length) write ? write(file, applyPlainEdits(sf.text, edits)) : ts.sys.writeFile(join(root, file), applyPlainEdits(sf.text, edits))
      result[file] = { marked: edits.filter((e) => e.text !== "(").length, left }
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
    if (/\bf: \(\) => number;/.test(declared)) return true
    if (/\bf: \(\) => (?:[\w$]+\.)?Effect(?:\.Effect)?<number(?:,|>)/.test(declared)) return false
    throw new Error("function-model probe emitted an unknown declaration; source files were not rewritten")
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}
