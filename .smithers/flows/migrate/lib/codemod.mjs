// The codemod: keep the batch's writable members writable, rename its
// modules to .vibe, point their packages' exports at them, rewrite the imports
// that name them by VibeLang's rules, then run `vibelang --fix` until it finds
// nothing more to fix, recording each rewrite it applied and each it refused.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join, posix, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "./declarations.mjs"
import { sidecarConfigIn, sidecarPath, sidecarSettings } from "./sidecar-config.mjs"
import { applyEdits, parseImports, resolveAliased, resolveRelative } from "./imports.mjs"
import { assertFinished, parseDiagnostics } from "./diagnostics.mjs"
import { isDeclarationFile, quote, run } from "./util.mjs"

/**
 * The tsconfig `paths` of each file's project, for rewriteImports and
 * restoreSpecifiers: aliases(file) reads the nearest tsconfig.json at or
 * above the file with TypeScript's own config reader (so `extends` and
 * `baseUrl` apply) and gives [{ pattern, targets }] with repository-relative
 * targets, longest pattern prefix first, as TypeScript tries them.
 */
export function pathAliases(ts, root) {
  const byConfig = new Map()
  const rewriteByConfig = new Map()
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} }
  // TypeScript tries an exact pattern first, then the longest prefix before the *.
  const rank = (pattern) => pattern.includes("*") ? pattern.indexOf("*") : Number.MAX_SAFE_INTEGER
  const nearest = (file) => {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      if (existsSync(join(root, dir, "tsconfig.json"))) return posix.join(dir, "tsconfig.json")
      if (dir === "." || dir === "/") return undefined
    }
  }
  const aliasesFor = (file) => {
    const config = nearest(file)
    if (config === undefined) return []
    if (!byConfig.has(config)) {
      let aliases = []
      try {
        const parsed = ts.getParsedCommandLineOfConfigFile(join(root, config), {}, host)
        rewriteByConfig.set(config, parsed?.options.rewriteRelativeImportExtensions === true)
        const paths = parsed?.options.paths ?? {}
        const base = parsed?.options.pathsBasePath ?? parsed?.options.baseUrl ?? posix.dirname(join(root, config))
        aliases = Object.entries(paths)
          .map(([pattern, targets]) => ({ pattern, targets: targets.map((target) => posix.relative(root, posix.resolve(base, target))) }))
          .sort((a, b) => rank(b.pattern) - rank(a.pattern))
      } catch {}
      byConfig.set(config, aliases)
    }
    return byConfig.get(config)
  }
  aliasesFor.rewriteRelativeImportExtensions = (file) => {
    aliasesFor(file)
    return rewriteByConfig.get(nearest(file)) === true
  }
  return aliasesFor
}

/** .ts and .mts source modules become .vibe. Declaration files stay put. */
export function vibePath(path) {
  if (!/\.(?:ts|mts)$/.test(path) || isDeclarationFile(path)) throw new Error(`${path}: only a .ts or .mts module becomes .vibe`)
  return path.replace(/\.(?:ts|mts)$/, ".vibe")
}

/**
 * A .mts module becomes .vibe only inside an ESM package: its nearest
 * package.json must declare type: "module", or the renamed module would emit
 * CommonJS. Checked before any file moves, by the legacy rename and by the
 * durable codemod state alike, so a replayed codemod cannot cross it either.
 */
export function assertModuleBoundary(root, from) {
  if (!from.endsWith(".mts")) return
  const manifest = join(root, packageDirOf(root, from), "package.json")
  if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, "utf8")).type !== "module") {
    throw new Error(`${from}: .mts requires an ESM package boundary (package.json type: "module") before becoming .vibe; preserve the existing CommonJS modules when configuring it`)
  }
}

/** Renames each file of the batch on disk; refuses to overwrite. */
export function renameBatch(root, files) {
  const renames = files.map((from) => ({ from, to: vibePath(from) }))
  for (const { from, to } of renames) {
    assertModuleBoundary(root, from)
    if (!existsSync(join(root, from))) throw new Error(`${from} does not exist`)
    if (existsSync(join(root, to))) throw new Error(`${to} already exists`)
  }
  for (const { from, to } of renames) renameSync(join(root, from), join(root, to))
  const ignored = ignoredTargets(root, renames.map((r) => r.to))
  if (ignored.length) {
    for (const { from, to } of renames) renameSync(join(root, to), join(root, from))
    throw new Error(`${ignored.join(", ")}: the repository ignores this path, so a commit would drop the module; keep it .ts or track the path`)
  }
  return renames
}

/** The paths jj does not track once they exist, as a tracked module under an ignored directory is not tracked under its new name. Outside a jj repository, none. */
function ignoredTargets(root, paths) {
  const listed = spawnSync("jj", ["file", "list", ...paths.map((path) => `root:${path}`)], { cwd: root, encoding: "utf8" })
  if (listed.status !== 0) return []
  const tracked = new Set(listed.stdout.split("\n"))
  return paths.filter((path) => !tracked.has(path))
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

// The package-relative path of a module's emitted JavaScript, which the migrate
// flow commits under .vibelang/js/ (emitPackageJs): ./src/x -> ./.vibelang/js/src/x.js.
const emittedOf = (stem) => "./.vibelang/js/" + posix.normalize(stem).replace(/^\.\//, "") + ".js"

/**
 * value with each target that names source, a package-relative .ts module,
 * pointed at the module after its rename. A `types` condition names its
 * declaration sidecar (x.d.vibe.ts); a `main` or `module` field its .vibe
 * source; an `exports` or `imports` target the source under the
 * `vibelang-source` condition and the emitted JavaScript by `default`, and an
 * entry that is the bare path the sidecar too:
 *
 *   { "types": "./x.d.vibe.ts", "vibelang-source": "./x.vibe", "default": "./.vibelang/js/x.js" }
 *
 * The `bun build` CLI loads no plugin and plain Node no loader, so they read
 * the JavaScript (opencode-32); vibelang/register and vibelang/bun run the
 * source in its place (emitted-js.mjs). Stock TypeScript names a type it
 * reaches through a .vibe target only when that target is the sidecar itself:
 * with ./x.vibe a consumer's inferred type that names one of the module's
 * types is TS2883.
 */
function pointAt(value, source, { condition, entry = false, bare = false, sidecar = besideSidecar } = {}) {
  if (typeof value === "string") {
    if (posix.normalize(value) !== source) return value
    const stem = value.replace(/\.(?:ts|mts)$/, "")
    if (typeConditions.has(condition)) return sidecar(stem)
    if (condition === "main" || condition === "module" || condition === "vibelang-source" || bare) return stem + ".vibe"
    const runtime = { "vibelang-source": stem + ".vibe", default: emittedOf(stem) }
    return entry ? { types: sidecar(stem), ...runtime } : runtime
  }
  if (Array.isArray(value)) return value.map((item) => pointAt(item, source, { condition, bare, sidecar }))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pointAt(item, source, { condition: key, bare, sidecar })]))
  return value
}

const besideSidecar = (stem) => stem + ".d.vibe.ts"

/**
 * The sidecar path of a package-relative module stem, ./src/x: beside it,
 * ./src/x.d.vibe.ts, or under the vibe.sidecarDir the package's tsconfig.json
 * names, ./.vibe/declarations/src/x.d.vibe.ts (decided detail 268).
 */
export function sidecarOf(root, dir) {
  const home = resolve(root, dir)
  const config = sidecarConfigIn(home)
  if (!config) return besideSidecar
  const ts = loadTypeScript([root, fileURLToPath(new URL("../../../", import.meta.url))])
  const settings = sidecarSettings(config, ts)
  if (!settings) return besideSidecar
  return stem => {
    const path = relative(home, sidecarPath(resolve(home, stem + ".vibe"), settings)).replaceAll("\\", "/")
    return path.startsWith("./") || path.startsWith("../") ? path : "./" + path
  }
}

/**
 * The inverse of pointAt for one module, now .ts again: each target naming its
 * .vibe source or its sidecar names the .ts file, and an entry pointAt wrote
 * from a bare path is that path again.
 */
function pointBack(value, vibe, extension = ".ts", sidecar = besideSidecar) {
  const stem = vibe.slice(0, -".vibe".length)
  const sidecars = [stem + ".d.vibe.ts", posix.normalize(sidecar(stem))]
  const ts = (target) => {
    if (posix.normalize(target) === vibe) return target.slice(0, -".vibe".length) + extension
    if (posix.normalize(target) === stem + ".d.vibe.ts") return target.slice(0, -".d.vibe.ts".length) + extension
    if (sidecars.includes(posix.normalize(target))) return "./" + stem + extension
    return target
  }
  const is = (target, path) => typeof target === "string" && posix.normalize(target) === path
  if (typeof value === "string") return ts(value)
  if (Array.isArray(value)) return value.map((item) => pointBack(item, vibe, extension, sidecar))
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort().join(",")
    const emitted = posix.normalize(emittedOf(stem))
    // What pointAt wrote, the source condition naming the .ts file's spelling.
    if (keys === "default,vibelang-source" && is(value["vibelang-source"], vibe) && is(value.default, emitted)) return ts(value["vibelang-source"])
    if (keys === "default,types,vibelang-source" && typeof value.types === "string" && sidecars.includes(posix.normalize(value.types)) && is(value["vibelang-source"], vibe) && is(value.default, emitted)) return ts(value["vibelang-source"])
    // An earlier toolchain's entry, { types, default: ./x.vibe }.
    if (keys === "default,types" && typeof value.types === "string" && sidecars.includes(posix.normalize(value.types)) && is(value.default, vibe)) return ts(value.default)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pointBack(item, vibe, extension, sidecar)]))
  }
  return value
}

/**
 * Whether one of manifests (repository-relative package.json paths) maps a
 * subpath of its `exports` or `imports` to a .vibe file by a bare path, as
 * Smithers exports the modules it migrated before ("./Route":
 * "./src/Route.vibe"), which its export-map contracts read. The codemod then
 * writes a renamed module's entry the same way.
 */
export function bareVibeExports(root, manifests) {
  return manifests.some((manifest) => {
    let pkg
    try { pkg = JSON.parse(readFileSync(join(root, manifest), "utf8")) } catch { return false }
    return moduleMaps.some((field) => {
      const map = pkg[field]
      const values = isSubpathMap(map) ? Object.values(map) : [map]
      return values.some((value) => typeof value === "string" && value.endsWith(".vibe"))
    })
  })
}

/**
 * Points each renamed module's package at it (pointAt): an entry of `exports`
 * or `imports`, at any depth of conditions, or a `main` or `module` field that
 * named the .ts file names the .vibe file, and a `types` or `typings` field or
 * condition names the sidecar. A pattern that matches it (`"./*":
 * "./src/*.ts"`) gains an exact entry, which wins over the pattern, so the
 * package's other modules keep it. A bare entry becomes { types, default }
 * (TS2883, t3code), or stays a bare path to the .vibe file with bareEntries,
 * where the repository already exports its .vibe modules that way
 * (bareVibeExports). Returns the edits, { manifest, field, key, added,
 * module }, for restoreExports.
 */
export function rewriteExports(root, renames, { write = (file, text) => writeFileSync(join(root, file), text), bareEntries = false } = {}) {
  const edits = []
  const owners = new Map()
  for (const rename of renames) {
    const dir = packageDirOf(root, rename.from)
    if (existsSync(join(root, dir, "package.json"))) owners.set(dir, [...(owners.get(dir) ?? []), rename])
  }
  for (const [dir, moved] of owners) {
    const manifest = posix.join(dir, "package.json")
    const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8"))
    const sidecar = sidecarOf(root, dir)
    let changed = false
    for (const { from, to } of moved) {
      const source = posix.relative(dir, from)
      const record = (edit) => {
        edits.push({ manifest, ...edit, module: to })
        changed = true
      }
      for (const field of modulePaths) {
        if (typeof pkg[field] !== "string" || posix.normalize(pkg[field]) !== source) continue
        pkg[field] = pointAt(pkg[field], source, { condition: field, sidecar })
        record({ field })
      }
      for (const field of moduleMaps) {
        const map = pkg[field]
        if (!isSubpathMap(map)) {
          if (targetsOf(map).some((target) => posix.normalize(target) === source)) {
            pkg[field] = pointAt(map, source, { entry: !bareEntries, bare: bareEntries, sidecar })
            record({ field })
          }
          continue
        }
        const entries = []
        for (const [key, value] of Object.entries(map)) {
          if (!key.includes("*")) {
            if (targetsOf(value).some((target) => posix.normalize(target) === source)) record({ field, key })
            entries.push([key, pointAt(value, source, { entry: !bareEntries, bare: bareEntries, sidecar })])
            continue
          }
          const star = targetsOf(value).map((target) => starOf(target, `./${source}`)).find((match) => match !== undefined)
          const exact = star === undefined ? undefined : key.replace("*", star)
          if (exact !== undefined && !(exact in map) && !entries.some(([name]) => name === exact)) {
            entries.push([exact, pointAt(mapTargets(value, (target) => target.replaceAll("*", star)), source, { entry: !bareEntries, bare: bareEntries, sidecar })])
            record({ field, key: exact, added: true })
          }
          entries.push([key, value])
        }
        pkg[field] = Object.fromEntries(entries)
      }
    }
    if (changed) write(manifest, JSON.stringify(pkg, null, 2) + "\n")
  }
  return edits
}

/**
 * Undoes the edits of rewriteExports for one module that revert returns to
 * .ts (repository-relative, now .ts): an added entry goes, and a rewritten one
 * names the .ts file again (pointBack). Returns the edits it undid.
 */
export function restoreExports(root, edits, module) {
  const vibe = module.replace(/\.(?:ts|mts)$/, ".vibe")
  const undone = edits.filter((edit) => edit.module === vibe)
  for (const edit of undone) {
    const path = join(root, edit.manifest)
    if (!existsSync(path)) continue
    const pkg = JSON.parse(readFileSync(path, "utf8"))
    const source = posix.relative(posix.dirname(edit.manifest), vibe)
    const sidecar = sidecarOf(root, posix.dirname(edit.manifest))
    if (edit.added) delete pkg[edit.field][edit.key]
    else if (edit.key !== undefined) pkg[edit.field][edit.key] = pointBack(pkg[edit.field][edit.key], source, posix.extname(module), sidecar)
    else pkg[edit.field] = pointBack(pkg[edit.field], source, posix.extname(module), sidecar)
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
 * ./user.js (D298). Vitests and Jests mocks (vi.mock, vi.importActual,
 * jest.requireActual) take this rule as an import does, so a mock keeps
 * naming the module its test imports. A .vibe specifier of a module that
 * revert returned to .ts names its .ts source again.
 */
export function rewriteSpecifier(importer, specifier, target, { mock = false, base: aliased } = {}) {
  const targetExt = posix.extname(target)
  const ext = posix.extname(specifier)
  const vibeImporter = importer.endsWith(".vibe") || (mock && targetExt === ".vibe")
  if (vibeImporter || targetExt === ".vibe") {
    if (ext === targetExt) return specifier
    if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vibe"].includes(ext)) return specifier.slice(0, -ext.length) + targetExt
    // Extensionless: name the file, or the directory's index file.
    const base = aliased ?? posix.normalize(posix.join(posix.dirname(importer), specifier))
    if (target === posix.normalize(`${base}/index${targetExt}`)) return `${specifier.replace(/\/$/, "")}/index${targetExt}`
    return specifier + targetExt
  }
  if (ext === ".vibe") return specifier.slice(0, -ext.length) + targetExt
  return specifier
}

/**
 * Puts back the specifiers the codemod rewrote to name a module that revert
 * returns to .ts: each edit { file, from, to } of an importer whose
 * `to` names `module` (repository-relative, now .ts) gets its `from` again,
 * so ./user.js stays ./user.js, and an edit is used once. Returns the edits
 * made.
 */
export function restoreSpecifiers(root, edits, module, aliases) {
  const vibe = module.replace(/\.(?:ts|mts)$/, ".vibe")
  const restored = []
  const byFile = new Map()
  for (const edit of edits) {
    let file = edit.file
    if (file.endsWith(".vibe") && !existsSync(join(root, file))) {
      // Revert may already have returned this importer to TypeScript. Its
      // recorded path still names .vibe; find the restored source, never a
      // still-native importer or an ambiguous pair of TypeScript sources.
      const candidates = [".ts", ".mts", ".cts"].map(ext => file.slice(0, -".vibe".length) + ext)
        .filter(path => existsSync(join(root, path)))
      if (candidates.length !== 1) continue
      file = candidates[0]
    }
    const named = resolveRelative(file, edit.to, new Set([vibe])) ?? resolveAliased(file, edit.to, new Set([vibe]), aliases)?.target
    if (named !== vibe) continue
    byFile.set(file, [...(byFile.get(file) ?? []), edit])
  }
  for (const [file, fileEdits] of byFile) {
    const path = join(root, file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, "utf8")
    const changes = []
    // Each edit puts back one specifier, in source order, as rewriteImports
    // recorded them: an import of ./user.js and a mock of ./user.ts both
    // became ./user.vibe, and each gets its own spelling again.
    const pending = [...fileEdits]
    for (const i of parseImports(text)) {
      const at = pending.findIndex((e) => e.to === i.specifier)
      if (at < 0) continue
      const [edit] = pending.splice(at, 1)
      changes.push({ start: i.start, end: i.end, text: edit.from })
      restored.push({ file, from: i.specifier, to: edit.from })
    }
    if (changes.length) writeFileSync(path, applyEdits(text, changes))
  }
  return restored
}

/**
 * The files whose imports the codemod reads: TypeScript, VibeLang, and
 * JavaScript, such as a script that imports ../src/Monitor.ts (smithers
 * swebench: three .mjs scripts kept the .ts name and failed
 * import/no-unresolved).
 */
export const importerFile = /\.(?:ts|tsx|mts|cts|vibe|js|jsx|mjs|cjs)$/

/**
 * Rewrites the relative imports of every file in scope (repository-relative
 * paths after the renames) so each names its target as VibeLang reads it.
 * With moved, the modules a batch renamed (or revert put back), only the
 * imports of those modules and the imports in them change: a specifier that
 * names an earlier migration's .vibe module by its .ts name stays as the
 * repository wrote it. A JavaScript file's import changes only when it names
 * the module's source file, ../src/Monitor.ts, since ./x.js there names a
 * JavaScript file. Returns the edits made: { file, from, to }.
 */
export function rewriteImports(root, scope, moved, aliases, { preserve = [], read = (file) => readFileSync(join(root, file), "utf8"), write = (file, text) => writeFileSync(join(root, file), text) } = {}) {
  const files = new Set(scope)
  const only = moved && new Set(moved)
  const kept = new Map()
  for (const edit of preserve) {
    if (!kept.has(edit.file)) kept.set(edit.file, new Set())
    kept.get(edit.file).add(edit.to)
  }
  const edits = []
  for (const file of scope) {
    if (!importerFile.test(file)) continue
    const javascript = /\.[cm]?jsx?$/.test(file)
    const path = join(root, file)
    const text = read(file)
    const changes = []
    for (const i of parseImports(text)) {
      if (javascript && !/\.(?:[cm]?tsx?|vibe)$/.test(i.specifier)) continue
      if (kept.get(file)?.has(i.specifier)) continue
      // A tsconfig paths alias (`@/x`) names a module as a relative specifier does (opencode-39).
      const aliased = resolveRelative(file, i.specifier, files) === undefined ? resolveAliased(file, i.specifier, files, aliases) : undefined
      const target = aliased?.target ?? resolveRelative(file, i.specifier, files)
      if (!target || (only && !only.has(file) && !only.has(target))) continue
      // A paths alias to a module that stays TypeScript keeps its authored
      // spelling: it resolved under this configuration before the rename, and
      // `~/leaf.ts`, a non-relative TypeScript name, is TS2877 under
      // rewriteRelativeImportExtensions (t3code web, 23 modules).
      if (aliased && !target.endsWith(".vibe") && posix.extname(i.specifier) !== ".vibe") continue
      let next = rewriteSpecifier(file, i.specifier, target, { mock: i.kind === "mock", base: aliased?.base })
      if (aliased && target.endsWith(".vibe") && aliases?.rewriteRelativeImportExtensions?.(file)) {
        // Native TS2877 rejects non-relative source names under this option.
        // Use the same resolved source through a name the compiler can emit.
        next = posix.relative(posix.dirname(file), target)
        if (!next.startsWith(".")) next = "./" + next
      }
      if (next !== i.specifier) {
        changes.push({ start: i.start, end: i.end, text: next })
        edits.push({ file, from: i.specifier, to: next })
      }
    }
    if (changes.length) write(file, applyEdits(text, changes))
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
export async function fixToFixedPoint({ compiler, tsconfig, cwd, root, maxRounds = 4, log, only, timeoutMs }) {
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
      if (!kept.has(file)) others.set(file, readFileSync(path))
    }
  }
  let last
  for (let round = 1; round <= maxRounds; round++) {
    // --declaration: what --fix keeps for a declaration file it keeps under a tsconfig that says noEmit too.
    let result
    try {
      result = await run(`${quote(compiler)} -p ${quote(tsconfig)} --fix --noEmit --declaration --pretty false --singleThreaded`, { cwd, log: log && `${log}.${round}.log`, timeoutMs })
    } finally {
      // An interrupted compiler may keep verified writes without printing
      // per-file statistics. Restore the whole nonselected byte snapshot.
      for (const [file, original] of others) {
        const path = join(root, file)
        if (!existsSync(path) || !readFileSync(path).equals(original)) writeFileSync(path, original)
      }
    }
    const parsed = parseFixOutput(result.stdout, { cwd, root })
    if (kept) {
      for (const file of Object.keys(parsed.files)) {
        if (kept.has(file)) continue
        delete parsed.files[file]
      }
      parsed.total = Object.values(parsed.files).reduce((n, kinds) => n + Object.values(kinds).reduce((a, b) => a + b, 0), 0)
      parsed.refused = parsed.refused.filter((r) => kept.has(r.file))
    }
    assertFinished(result, log && `${log}.${round}.log`)
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
