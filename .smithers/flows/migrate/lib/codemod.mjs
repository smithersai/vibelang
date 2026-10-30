// The codemod: keep the batch's writable members writable, rename its
// modules to .vibe, rewrite the imports that name them by VibeLang's rules,
// then run `vibelang --fix` until it finds nothing more to fix, recording each
// rewrite it applied and each it refused.
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { applyEdits, parseImports, resolveRelative } from "./imports.mjs"
import { assertFinished, parseDiagnostics } from "./diagnostics.mjs"
import { quote, run } from "./util.mjs"

/** x.ts becomes x.vibe. Only .ts modules are renamed. */
export function vibePath(path) {
  if (!path.endsWith(".ts") || path.endsWith(".d.ts")) throw new Error(`${path}: only a .ts module becomes .vibe`)
  return path.slice(0, -3) + ".vibe"
}

/**
 * Keeps the members that TypeScript declares writable writable in VibeLang,
 * where a member of an interface or an object type is readonly unless it is
 * written `mutable` (D134), so a renamed module declares the same types:
 * before the batch is renamed, each property or index signature without
 * `readonly` gains `mutable`. An object type that is Readonly's type argument,
 * whose members Readonly makes readonly, and one that is a type argument of a
 * class's extends clause, such as Data.TaggedError's fields, which Effect
 * makes readonly, are left as they are. ts is TypeScript's compiler API.
 * Returns the files changed, each with its count: { file, count }.
 */
export function keepMutableMembers(ts, root, files) {
  const changed = []
  for (const file of files) {
    const path = join(root, file)
    const text = readFileSync(path, "utf8")
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const starts = []
    const visit = (node) => {
      if ((ts.isPropertySignature(node) || ts.isIndexSignatureDeclaration(node)) && writableMember(ts, node)) starts.push(node.getStart(source))
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (!starts.length) continue
    writeFileSync(path, applyEdits(text, starts.map((start) => ({ start, end: start, text: "mutable " }))))
    changed.push({ file, count: starts.length })
  }
  return changed
}

/** Whether member, a property or index signature, is writable where VibeLang would make it readonly. */
function writableMember(ts, member) {
  if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword)) return false
  const owner = member.parent
  if (ts.isInterfaceDeclaration(owner)) return true
  if (!ts.isTypeLiteralNode(owner)) return false
  const use = owner.parent
  if (ts.isTypeReferenceNode(use) && ts.isIdentifier(use.typeName) && use.typeName.text === "Readonly") return false
  return !(ts.isExpressionWithTypeArguments(use) && ts.isHeritageClause(use.parent))
}

/** Renames each file of the batch on disk; refuses to overwrite. */
export function renameBatch(root, files) {
  const renames = files.map((from) => ({ from, to: vibePath(from) }))
  for (const { from, to } of renames) {
    if (!existsSync(join(root, from))) throw new Error(`${from} does not exist`)
    if (existsSync(join(root, to))) throw new Error(`${to} already exists`)
  }
  for (const { from, to } of renames) renameSync(join(root, from), join(root, to))
  return renames
}

/**
 * The specifier that names target from a file, by VibeLang's rules: a .vibe
 * file imports a local module by its source name (./user.vibe, ./util.ts). A
 * .ts file names a .vibe module by its source name too, ./user.vibe for
 * ./user.js or ./user.ts: stock TypeScript, and every checker built on it,
 * resolves only that name, to the module's declaration sidecar
 * user.d.vibe.ts (vibelang setting declarationSidecars), while vibelang,
 * its loaders and its bundler plugins resolve it to the source, and vibelang
 * emits and declares it as ./user.js (D298). An extensionless specifier stays
 * as written, since its declaration would gain .js. A .vibe specifier of a
 * module that revert returned to .ts names its .ts source again.
 */
export function rewriteSpecifier(importer, specifier, target) {
  const targetExt = posix.extname(target)
  const ext = posix.extname(specifier)
  const vibeImporter = importer.endsWith(".vibe")
  if (vibeImporter || (targetExt === ".vibe" && [".js", ".ts", ".mts"].includes(ext))) {
    if (ext === targetExt) return specifier
    if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vibe"].includes(ext)) return specifier.slice(0, -ext.length) + targetExt
    // Extensionless: name the file, or the directory's index file.
    const base = posix.normalize(posix.join(posix.dirname(importer), specifier))
    if (target === `${base}/index${targetExt}`) return `${specifier.replace(/\/$/, "")}/index${targetExt}`
    return specifier + targetExt
  }
  if (ext === ".vibe") return specifier.slice(0, -ext.length) + targetExt
  return specifier
}

/**
 * Puts back the specifiers the codemod rewrote to name a module that revert
 * returns to .ts: each edit { file, from, to } of a TypeScript importer whose
 * `to` names `module` (repository-relative, now .ts) gets its `from` again,
 * so ./user.js stays ./user.js. Returns the edits made.
 */
export function restoreSpecifiers(root, edits, module) {
  const vibe = module.replace(/\.ts$/, ".vibe")
  const restored = []
  const byFile = new Map()
  for (const edit of edits) {
    if (edit.file.endsWith(".vibe") || resolveRelative(edit.file, edit.to, new Set([vibe])) !== vibe) continue
    byFile.set(edit.file, [...(byFile.get(edit.file) ?? []), edit])
  }
  for (const [file, fileEdits] of byFile) {
    const path = join(root, file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, "utf8")
    const changes = []
    for (const i of parseImports(text)) {
      const edit = fileEdits.find((e) => e.to === i.specifier)
      if (!edit) continue
      changes.push({ start: i.start, end: i.end, text: edit.from })
      restored.push({ file, from: i.specifier, to: edit.from })
    }
    if (changes.length) writeFileSync(path, applyEdits(text, changes))
  }
  return restored
}

/**
 * Rewrites the relative imports of every file in scope (repository-relative
 * paths after the renames) so each names its target as VibeLang reads it.
 * Returns the edits made: { file, from, to }.
 */
export function rewriteImports(root, scope) {
  const files = new Set(scope)
  const edits = []
  for (const file of scope) {
    if (!/\.(?:ts|tsx|mts|cts|vibe)$/.test(file)) continue
    const path = join(root, file)
    const text = readFileSync(path, "utf8")
    const changes = []
    for (const i of parseImports(text)) {
      const target = resolveRelative(file, i.specifier, files)
      if (!target) continue
      const next = rewriteSpecifier(file, i.specifier, target)
      if (next !== i.specifier) {
        changes.push({ start: i.start, end: i.end, text: next })
        edits.push({ file, from: i.specifier, to: next })
      }
    }
    if (changes.length) writeFileSync(path, applyEdits(text, changes))
  }
  return edits
}

const fixLine = /^vibelang --fix: (.+?): (\d+) (?:fix|fixes) \((.*)\)$/
const refusalLine = /^vibelang --fix: (.+?):(\d+): (EK\d+) not fixed: the fixed program would report (.*)$/

/** Reads one `vibelang --fix` run: the rewrites applied per file, by kind, and the refusals. */
export function parseFixOutput(output, { cwd, root } = {}) {
  const relative = (file) => (cwd && root ? posix.relative(root, posix.join(cwd, file)) : file)
  const files = {}
  const refused = []
  let total = 0
  for (const line of output.split("\n")) {
    const fixed = fixLine.exec(line)
    if (fixed) {
      const kinds = {}
      for (const part of fixed[3].split(", ")) {
        const m = /^(.+) ×(\d+)$/.exec(part)
        if (m) kinds[m[1]] = Number(m[2])
      }
      files[relative(fixed[1])] = kinds
      total += Number(fixed[2])
      continue
    }
    const refusal = refusalLine.exec(line)
    if (refusal) refused.push({ file: relative(refusal[1]), line: Number(refusal[2]), code: refusal[3], error: refusal[4] })
  }
  return { total, files, refused }
}

/** Adds one fix run's per-kind counts into a running total, by file. */
export function mergeFixes(into, files) {
  for (const [file, kinds] of Object.entries(files)) {
    into[file] ??= {}
    for (const [kind, n] of Object.entries(kinds)) into[file][kind] = (into[file][kind] ?? 0) + n
  }
  return into
}

/** Every .vibe file under dir, outside node_modules and hidden directories. */
function vibeFilesUnder(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...vibeFilesUnder(path))
    else if (entry.name.endsWith(".vibe")) out.push(path)
  }
  return out
}

/**
 * Runs `vibelang -p tsconfig --fix --noEmit` until a run fixes nothing, at
 * most maxRounds times. Returns every round's report, the merged rewrites by
 * file and kind, the refusals, and the diagnostics of the last run. With
 * only, the files (relative to root) whose rewrites a batch keeps: --fix
 * rewrites every .vibe file of the project, so each round puts every other
 * .vibe file back as it was, and an earlier batch's committed file, hand
 * repairs included, stays as committed.
 */
export async function fixToFixedPoint({ compiler, tsconfig, cwd, root, maxRounds = 4, log, only }) {
  const rounds = []
  const byFile = {}
  const refused = []
  const kept = only && new Set(only)
  const others = new Map()
  if (kept) {
    for (const path of vibeFilesUnder(cwd)) {
      const file = posix.relative(root, path)
      if (!kept.has(file)) others.set(file, readFileSync(path, "utf8"))
    }
  }
  let last
  for (let round = 1; round <= maxRounds; round++) {
    const result = await run(`${quote(compiler)} -p ${quote(tsconfig)} --fix --noEmit --pretty false`, { cwd, log: log && `${log}.${round}.log` })
    assertFinished(result, log && `${log}.${round}.log`)
    const parsed = parseFixOutput(result.stdout, { cwd, root })
    if (kept) {
      for (const file of Object.keys(parsed.files)) {
        if (kept.has(file)) continue
        if (others.has(file)) writeFileSync(join(root, file), others.get(file))
        delete parsed.files[file]
      }
      parsed.total = Object.values(parsed.files).reduce((n, kinds) => n + Object.values(kinds).reduce((a, b) => a + b, 0), 0)
      parsed.refused = parsed.refused.filter((r) => kept.has(r.file))
    }
    rounds.push({ round, code: result.code, fixes: parsed.total, files: parsed.files, refused: parsed.refused })
    mergeFixes(byFile, parsed.files)
    refused.push(...parsed.refused)
    last = result
    if (parsed.total === 0) break
  }
  const settled = rounds.at(-1).fixes === 0
  return { settled, rounds, byFile, refused, diagnostics: parseDiagnostics(last.stdout + last.stderr, { cwd, root }) }
}

/** Totals of the rewrites that fired, by kind, over every file. */
export function rewriteTotals(byFile) {
  const totals = {}
  for (const kinds of Object.values(byFile)) for (const [kind, n] of Object.entries(kinds)) totals[kind] = (totals[kind] ?? 0) + n
  return totals
}
