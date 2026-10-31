// The codemod: keep the batch's writable members writable, rename its
// modules to .vibe, point their packages' exports at them, rewrite the imports
// that name them by VibeLang's rules, then run `vibelang --fix` until it finds
// nothing more to fix, recording each rewrite it applied and each it refused.
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { applyEdits, parseImports, resolveRelative } from "./imports.mjs"
import { assertFinished, parseDiagnostics } from "./diagnostics.mjs"
import { isDeclarationFile, quote, run } from "./util.mjs"

/** x.ts becomes x.vibe. Only .ts modules are renamed. */
export function vibePath(path) {
  if (!path.endsWith(".ts") || isDeclarationFile(path)) throw new Error(`${path}: only a .ts module becomes .vibe`)
  return path.slice(0, -3) + ".vibe"
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

/** The directory of the package that owns file: the nearest with a package.json, or the root. */
export function packageDirOf(root, file) {
  let dir = posix.dirname(file)
  while (dir !== "." && !existsSync(join(root, dir, "package.json"))) dir = posix.dirname(dir)
  return dir
}

// The package.json fields that name a module by its path: maps, then single paths.
const moduleMaps = ["exports", "imports"]
const modulePaths = ["main", "module", "types", "typings"]

/** value with each path in it, at any depth of conditions, mapped by f. */
function mapTargets(value, f) {
  if (typeof value === "string") return f(value)
  if (Array.isArray(value)) return value.map((item) => mapTargets(item, f))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapTargets(item, f)]))
  return value
}

/** Each path in value, at any depth of conditions. */
function targetsOf(value) {
  const targets = []
  mapTargets(value, (target) => (targets.push(target), target))
  return targets
}

/** What the * of pattern (./src/*.ts) stands for in path, or undefined. */
function starOf(pattern, path) {
  const at = pattern.indexOf("*")
  if (at < 0) return undefined
  const head = pattern.slice(0, at)
  const tail = pattern.slice(at + 1)
  return path.startsWith(head) && path.endsWith(tail) && path.length > head.length + tail.length ? path.slice(head.length, path.length - tail.length) : undefined
}

// A subpath map has keys that start with . or #; any other object is conditions.
const isSubpathMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).some((key) => key.startsWith(".") || key.startsWith("#"))

// The package.json conditions whose target TypeScript reads as a declaration file.
const typeConditions = new Set(["types", "typings"])

/**
 * value with each target that names source, a package-relative .ts module,
 * pointed at the module after its rename: a `types` condition at its
 * declaration sidecar (x.d.vibe.ts), any other at its .vibe source, and an
 * entry that is the bare path at both, `{ "types": "./x.d.vibe.ts", "default":
 * "./x.vibe" }`. Stock TypeScript resolves a .vibe target to its sidecar, but
 * names a type it reaches that way only through a target that is the sidecar
 * itself: with ./x.vibe a consumer's inferred type that names one of the
 * module's types is TS2883. vibelang, its loaders and its bundler plugins read
 * the .vibe source in either case (Chapter 7's source preference).
 */
function pointAt(value, source, { condition, entry = false } = {}) {
  if (typeof value === "string") {
    if (posix.normalize(value) !== source) return value
    const stem = value.slice(0, -".ts".length)
    if (typeConditions.has(condition)) return stem + ".d.vibe.ts"
    return entry ? { types: stem + ".d.vibe.ts", default: stem + ".vibe" } : stem + ".vibe"
  }
  if (Array.isArray(value)) return value.map((item) => pointAt(item, source))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pointAt(item, source, { condition: key })]))
  return value
}

/**
 * The inverse of pointAt for one module, now .ts again: each target naming its
 * .vibe source or its sidecar names the .ts file, and an entry pointAt wrote
 * from a bare path is that path again.
 */
function pointBack(value, vibe) {
  const stem = vibe.slice(0, -".vibe".length)
  const ts = (target) => {
    if (posix.normalize(target) === vibe) return target.slice(0, -".vibe".length) + ".ts"
    if (posix.normalize(target) === stem + ".d.vibe.ts") return target.slice(0, -".d.vibe.ts".length) + ".ts"
    return target
  }
  if (typeof value === "string") return ts(value)
  if (Array.isArray(value)) return value.map((item) => pointBack(item, vibe))
  if (value && typeof value === "object") {
    const keys = Object.keys(value)
    if (keys.length === 2 && typeof value.types === "string" && typeof value.default === "string" && posix.normalize(value.types) === stem + ".d.vibe.ts" && posix.normalize(value.default) === vibe) return ts(value.default)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pointBack(item, vibe)]))
  }
  return value
}

/**
 * Points each renamed module's package at it (pointAt): an entry of `exports`
 * or `imports`, at any depth of conditions, or a `main` or `module` field that
 * named the .ts file names the .vibe file, and a `types` or `typings` field or
 * condition names the sidecar. A pattern that matches it (`"./*":
 * "./src/*.ts"`) gains an exact entry, which wins over the pattern, so the
 * package's other modules keep it. Returns the edits, { manifest, field, key,
 * added, module }, for restoreExports.
 */
export function rewriteExports(root, renames) {
  const edits = []
  const owners = new Map()
  for (const rename of renames) {
    const dir = packageDirOf(root, rename.from)
    if (existsSync(join(root, dir, "package.json"))) owners.set(dir, [...(owners.get(dir) ?? []), rename])
  }
  for (const [dir, moved] of owners) {
    const manifest = posix.join(dir, "package.json")
    const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8"))
    let changed = false
    for (const { from, to } of moved) {
      const source = posix.relative(dir, from)
      const record = (edit) => {
        edits.push({ manifest, ...edit, module: to })
        changed = true
      }
      for (const field of modulePaths) {
        if (typeof pkg[field] !== "string" || posix.normalize(pkg[field]) !== source) continue
        pkg[field] = pointAt(pkg[field], source, { condition: field })
        record({ field })
      }
      for (const field of moduleMaps) {
        const map = pkg[field]
        if (!isSubpathMap(map)) {
          if (targetsOf(map).some((target) => posix.normalize(target) === source)) {
            pkg[field] = pointAt(map, source, { entry: true })
            record({ field })
          }
          continue
        }
        const entries = []
        for (const [key, value] of Object.entries(map)) {
          if (!key.includes("*")) {
            if (targetsOf(value).some((target) => posix.normalize(target) === source)) record({ field, key })
            entries.push([key, pointAt(value, source, { entry: true })])
            continue
          }
          const star = targetsOf(value).map((target) => starOf(target, `./${source}`)).find((match) => match !== undefined)
          const exact = star === undefined ? undefined : key.replace("*", star)
          if (exact !== undefined && !(exact in map) && !entries.some(([name]) => name === exact)) {
            entries.push([exact, pointAt(mapTargets(value, (target) => target.replaceAll("*", star)), source, { entry: true })])
            record({ field, key: exact, added: true })
          }
          entries.push([key, value])
        }
        pkg[field] = Object.fromEntries(entries)
      }
    }
    if (changed) writeFileSync(join(root, manifest), JSON.stringify(pkg, null, 2) + "\n")
  }
  return edits
}

/**
 * Undoes the edits of rewriteExports for one module that revert returns to
 * .ts (repository-relative, now .ts): an added entry goes, and a rewritten one
 * names the .ts file again (pointBack). Returns the edits it undid.
 */
export function restoreExports(root, edits, module) {
  const vibe = module.replace(/\.ts$/, ".vibe")
  const undone = edits.filter((edit) => edit.module === vibe)
  for (const edit of undone) {
    const path = join(root, edit.manifest)
    if (!existsSync(path)) continue
    const pkg = JSON.parse(readFileSync(path, "utf8"))
    const source = posix.relative(posix.dirname(edit.manifest), vibe)
    if (edit.added) delete pkg[edit.field][edit.key]
    else if (edit.key !== undefined) pkg[edit.field][edit.key] = pointBack(pkg[edit.field][edit.key], source)
    else pkg[edit.field] = pointBack(pkg[edit.field], source)
    writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
  }
  return undone
}

/**
 * The specifier that names target from a file, by VibeLang's rules: a .vibe
 * file imports a local module by its source name (./user.vibe, ./util.ts). A
 * .ts file names a .vibe module by its source name too: stock TypeScript,
 * and every checker built on it, resolves that name to the declaration
 * sidecar user.d.vibe.ts under allowArbitraryExtensions (VIP-27, chapter 7).
 * This includes extensionless file and directory-index imports, which stock
 * TypeScript cannot resolve to the sidecar as originally written. VibeLang
 * and its loaders resolve the source, and emit and declare ./user.vibe as
 * ./user.js (D298). A .vibe specifier of a module that revert returned to .ts
 * names its .ts source again.
 */
export function rewriteSpecifier(importer, specifier, target, { mock = false } = {}) {
  const targetExt = posix.extname(target)
  const ext = posix.extname(specifier)
  const vibeImporter = importer.endsWith(".vibe") || (mock && targetExt === ".vibe")
  if (vibeImporter || targetExt === ".vibe") {
    if (ext === targetExt) return specifier
    if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vibe"].includes(ext)) return specifier.slice(0, -ext.length) + targetExt
    // Extensionless: name the file, or the directory's index file.
    const base = posix.normalize(posix.join(posix.dirname(importer), specifier))
    if (target === posix.normalize(`${base}/index${targetExt}`)) return `${specifier.replace(/\/$/, "")}/index${targetExt}`
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
 * With moved, the modules a batch renamed (or revert put back), only the
 * imports of those modules and the imports in them change: a specifier that
 * names an earlier migration's .vibe module by its .ts name stays as the
 * repository wrote it. Returns the edits made: { file, from, to }.
 */
export function rewriteImports(root, scope, moved) {
  const files = new Set(scope)
  const only = moved && new Set(moved)
  const edits = []
  for (const file of scope) {
    if (!/\.(?:ts|tsx|mts|cts|vibe)$/.test(file)) continue
    const path = join(root, file)
    const text = readFileSync(path, "utf8")
    const changes = []
    for (const i of parseImports(text)) {
      const target = resolveRelative(file, i.specifier, files)
      if (!target || (only && !only.has(file) && !only.has(target))) continue
      const next = rewriteSpecifier(file, i.specifier, target, { mock: i.kind === "mock" })
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
 * Runs `vibelang -p tsconfig --fix --noEmit --declaration` until a run fixes nothing, at
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
    // The whole repository: the package's project also reaches an earlier
    // batch's .vibe module in another package, which --fix rewrites too.
    for (const path of vibeFilesUnder(root)) {
      const file = posix.relative(root, path)
      if (!kept.has(file)) others.set(file, readFileSync(path, "utf8"))
    }
  }
  let last
  for (let round = 1; round <= maxRounds; round++) {
    // --declaration: what --fix keeps for a declaration file it keeps under a tsconfig that says noEmit too.
    const result = await run(`${quote(compiler)} -p ${quote(tsconfig)} --fix --noEmit --declaration --pretty false`, { cwd, log: log && `${log}.${round}.log` })
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
