import { captureTrackedSourceSnippets, refreshSourceSnippets } from "./source-snippets.mjs"
// The codemod: keep the batch's writable members writable, rename its
// modules to .vibe, point their packages' exports at them, rewrite the imports
// that name them by VibeLang's rules, then run `vibelang --fix` until it finds
// nothing more to fix, recording each rewrite it applied and each it refused.
import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, posix, relative, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "./declarations.mjs"
import { privateResolverExports } from "./import-meta-platform.mjs"
import { sidecarConfigIn, sidecarPath, sidecarSettings } from "./sidecar-config.mjs"
import { applyEdits, editableImports, resolveAliased, resolveRelative, splitSpecifier } from "./imports.mjs"
import { assertFinished, parseDiagnostics } from "./diagnostics.mjs"
import { isFixtureFile, isTestFile } from "./inventory.mjs"
import { isDeclarationFile, quote, run } from "./util.mjs"
import { fixProgramFiles, withFixFiles } from "./fix-scope.mjs"
import { fixProgressStream } from "./fix-progress.mjs"
import { Minimatch } from "./vendor/minimatch.mjs"

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
  const optionsByConfig = new Map()
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
        optionsByConfig.set(config, parsed?.options ?? {})
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
  aliasesFor.emittedExtension = (file, sourceExt) => {
    aliasesFor(file)
    return sourceExt === ".vibex" && optionsByConfig.get(nearest(file))?.jsx === ts.JsxEmit.Preserve ? ".jsx" : ".js"
  }
  aliasesFor.migratedSourceExtension = (file, sourceExt) => {
    aliasesFor(file)
    const options = optionsByConfig.get(nearest(file))
    if (!options) return sourceExt
    if (options.rewriteRelativeImportExtensions ||
        options.allowImportingTsExtensions && (options.noEmit || options.emitDeclarationOnly)) return sourceExt
    return /x$/.test(sourceExt) && options.jsx === ts.JsxEmit.Preserve ? ".jsx" : ".js"
  }
  return aliasesFor
}

/** TypeScript sources keep their JSX kind. Declaration files stay put. */
export function vibePath(path) {
  if (isDeclarationFile(path)) throw new Error(`${path}: declaration file; keep its source format`)
  if (!/\.(?:ts|tsx|mts)$/.test(path)) throw new Error(`${path}: unsupported source kind; only .ts, .tsx or .mts modules can migrate`)
  return path.endsWith(".tsx") ? path.slice(0, -4) + ".vibex" : path.replace(/\.(?:ts|mts)$/, ".vibe")
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
const emittedOf = (stem, extension = ".js") => "./.vibelang/js/" + posix.normalize(stem).replace(/^\.\//, "") + extension

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
function pointAt(value, source, { condition, entry = false, bare = false, sidecar = besideSidecar, runtimeExtension = ".js" } = {}) {
  if (typeof value === "string") {
    if (posix.normalize(value) !== source) return value
    const native = vibePath(value), extension = posix.extname(native), stem = value.replace(/\.(?:ts|tsx|mts)$/, "")
    if (typeConditions.has(condition)) return sidecar(stem, extension)
    if (condition === "main" || condition === "module" || condition === "vibelang-source" || bare) return native
    const runtime = { "vibelang-source": native, default: emittedOf(stem, runtimeExtension) }
    return entry ? { types: sidecar(stem, extension), ...runtime } : runtime
  }
  if (Array.isArray(value)) return value.map((item) => pointAt(item, source, { condition, bare, sidecar, runtimeExtension }))
  // A nested condition refines declaration lookup; it cannot turn it into runtime lookup.
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pointAt(item, source, { condition: typeConditions.has(condition) ? condition : key, bare, sidecar, runtimeExtension })]))
  return value
}

const besideSidecar = (stem, extension = ".vibe") => stem + ".d" + extension + ".ts"

/** A portable layout for a driver that has validated its source and configuration snapshot. */
export function sidecarPlanOf(root, dir) {
  const home = resolve(root, dir)
  const config = sidecarConfigIn(home)
  if (!config) return null
  const ts = loadTypeScript([root, fileURLToPath(new URL("../../../", import.meta.url))])
  const settings = sidecarSettings(config, ts, undefined, { sourceRootOnly: true })
  return settings ? {
    owner: posix.normalize(dir),
    sourceRoot: relative(home, settings.sourceRoot).replaceAll("\\", "/") || ".",
    directory: relative(home, settings.directory).replaceAll("\\", "/") || "."
  } : null
}

function sidecarFromPlan(root, dir, plan) {
  if (plan === null) return besideSidecar
  if (plan?.owner !== posix.normalize(dir) || typeof plan.sourceRoot !== "string" || typeof plan.directory !== "string")
    throw new Error("saved sidecar layout has an invalid owner or path")
  const home = resolve(root, dir)
  const settings = { home, sourceRoot: resolve(home, plan.sourceRoot), directory: resolve(home, plan.directory) }
  return (stem, extension = ".vibe") => {
    const path = relative(home, sidecarPath(resolve(home, stem + extension), settings)).replaceAll("\\", "/")
    return path.startsWith("./") || path.startsWith("../") ? path : "./" + path
  }
}

/**
 * The sidecar path of a package-relative module stem, ./src/x: beside it,
 * ./src/x.d.vibe.ts, or under the vibe.sidecarDir the package's tsconfig.json
 * names, ./.vibe/declarations/src/x.d.vibe.ts (decided detail 268).
 */
export function sidecarOf(root, dir) {
  return sidecarFromPlan(root, dir, sidecarPlanOf(root, dir))
}

/**
 * The inverse of pointAt for one module, now .ts again: each target naming its
 * .vibe source or its sidecar names the .ts file, and an entry pointAt wrote
 * from a bare path is that path again.
 */
function pointBack(value, vibe, extension = ".ts", sidecar = besideSidecar) {
  const extensionOf = posix.extname(vibe), stem = vibe.slice(0, -extensionOf.length)
  const beside = stem + ".d" + extensionOf + ".ts"
  const sidecars = [beside, posix.normalize(sidecar(stem, extensionOf))]
  const ts = (target) => {
    if (posix.normalize(target) === vibe) return target.slice(0, -extensionOf.length) + extension
    if (posix.normalize(target) === beside) return target.slice(0, -(".d" + extensionOf + ".ts").length) + extension
    if (sidecars.includes(posix.normalize(target))) return "./" + stem + extension
    return target
  }
  const is = (target, path) => typeof target === "string" && posix.normalize(target) === path
  if (typeof value === "string") return ts(value)
  if (Array.isArray(value)) return value.map((item) => pointBack(item, vibe, extension, sidecar))
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort().join(",")
    const emitted = [".js", ".jsx"].map(extension => posix.normalize(emittedOf(stem, extension)))
    // What pointAt wrote, the source condition naming the .ts file's spelling.
    if (keys === "default,vibelang-source" && is(value["vibelang-source"], vibe) && emitted.some(path => is(value.default, path))) return ts(value["vibelang-source"])
    if (keys === "default,types,vibelang-source" && typeof value.types === "string" && sidecars.includes(posix.normalize(value.types)) && is(value["vibelang-source"], vibe) && emitted.some(path => is(value.default, path))) return ts(value["vibelang-source"])
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
      return values.some((value) => typeof value === "string" && /\.vibex?$/.test(value))
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
 * (bareVibeExports). Source file allowlists gain an exact replacement only
 * when they selected the original source and do not exclude its new path.
 * Returns export and fileEntry edits for restoreExports.
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
      let runtimeExtension = ".js"
      if (from.endsWith(".tsx")) {
        const ts = loadTypeScript([root, fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
        runtimeExtension = pathAliases(ts, root).emittedExtension(from, ".vibex")
      }
      const record = (edit) => {
        edits.push({ manifest, ...edit, module: to })
        changed = true
      }
      for (const edit of inventoryEdits(pkg, source, posix.relative(dir, to))) record(edit)
      for (const field of modulePaths) {
        if (typeof pkg[field] !== "string" || posix.normalize(pkg[field]) !== source) continue
        pkg[field] = pointAt(pkg[field], source, { condition: field, sidecar, runtimeExtension })
        record({ field })
      }
      for (const field of moduleMaps) {
        const map = pkg[field]
        if (!isSubpathMap(map)) {
          if (targetsOf(map).some((target) => posix.normalize(target) === source)) {
            pkg[field] = pointAt(map, source, { entry: !bareEntries, bare: bareEntries, sidecar, runtimeExtension })
            record({ field })
          }
          continue
        }
        const entries = []
        for (const [key, value] of Object.entries(map)) {
          if (!key.includes("*")) {
            if (targetsOf(value).some((target) => posix.normalize(target) === source)) record({ field, key })
            entries.push([key, pointAt(value, source, { entry: !bareEntries, bare: bareEntries, sidecar, runtimeExtension })])
            continue
          }
          const star = targetsOf(value).map((target) => starOf(target, `./${source}`)).find((match) => match !== undefined)
          const exact = star === undefined ? undefined : key.replace("*", star)
          if (exact !== undefined && !(exact in map) && !entries.some(([name]) => name === exact)) {
            entries.push([exact, pointAt(mapTargets(value, (target) => target.replaceAll("*", star)), source, { entry: !bareEntries, bare: bareEntries, sidecar, runtimeExtension })])
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
 * Refresh declaration targets as one complete selection. A driver may restore
 * plans only for the same validated source/configuration snapshot. onPlan runs
 * after a new owner is planned and before any manifest is written.
 */
export function refreshSidecarExports(root, tracked, configs, {
  write = (file, text) => writeFileSync(join(root, file), text), onWarning = () => {},
  plans = new Map(), onPlan = () => {}
} = {}) {
  const owners = new Set([...configs].map(file => packageDirOf(root, file)))
  const callbacks = new Map(), moved = new Map(), beside = new Set()
  for (const file of tracked) {
    if (/\.d\.vibex?\.ts$/.test(file)) beside.add(posix.normalize(file))
    if (!/\.vibex?$/.test(file)) continue
    const extension = posix.extname(file)
    const old = file.slice(0, -extension.length) + ".d" + extension + ".ts"
    beside.add(posix.normalize(old))
    const dir = packageDirOf(root, file)
    if (!owners.has(dir)) continue
    if (!callbacks.has(dir)) {
      const saved = plans.has(dir)
      const plan = saved ? plans.get(dir) : sidecarPlanOf(root, dir)
      callbacks.set(dir, sidecarFromPlan(root, dir, plan))
      if (!saved) onPlan(dir, plan)
    }
    const locate = callbacks.get(dir), sidecar = stem => locate(stem, extension), stem = "./" + posix.relative(dir, file).slice(0, -extension.length)
    const next = posix.normalize(posix.join(dir, sidecar(stem)))
    if (posix.normalize(old) !== next) moved.set(posix.normalize(old), { next, dir, sidecar })
  }
  if (!moved.size) return []
  const edits = []
  for (const manifest of tracked.filter(file => posix.basename(file) === "package.json")) {
    const dir = posix.dirname(manifest)
    const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8"))
    const start = edits.length
    const update = (value, path) => {
      if (Array.isArray(value)) return value.map((item, index) => update(item, [...path, index]))
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, update(item, [...path, key])]))
      if (typeof value !== "string" || !/\.d\.vibex?\.ts$/.test(value)) return value
      const target = posix.normalize(posix.join(dir, value))
      let next = moved.get(target)?.next
      if (target.includes("*")) {
        const matches = [...moved].filter(([file]) => starOf(target, file) !== undefined)
        if (!matches.length) return value
        const first = matches[0][1]
        const pattern = posix.normalize(posix.join(first.dir, first.sidecar("./" + posix.relative(first.dir, target).replace(/\.d\.vibex?\.ts$/, ""))))
        const uniform = [...beside].filter(file => starOf(target, file) !== undefined).every(file => moved.has(file)) &&
          matches.every(([file, plan]) => pattern.replaceAll("*", starOf(target, file)) === plan.next)
        if (!uniform) {
          onWarning(manifest + ": " + path.join("/") + " has sidecars in more than one layout; retain the wildcard for review")
          return value
        }
        next = pattern
      }
      if (next === undefined) return value
      let relativeTarget = posix.relative(dir, next)
      if (value.startsWith("./") && !relativeTarget.startsWith("./") && !relativeTarget.startsWith("../")) relativeTarget = "./" + relativeTarget
      if (relativeTarget === value) return value
      edits.push({ manifest, path, from: value, to: relativeTarget })
      return relativeTarget
    }
    for (const field of ["types", "typings", "typesVersions", ...moduleMaps]) if (Object.hasOwn(pkg, field)) pkg[field] = update(pkg[field], [field])
    if (edits.length !== start) write(manifest, JSON.stringify(pkg, null, 2) + "\n")
  }
  return edits
}

// File allowlists include matching directories as well as exact files. Keep
// authored exclusions and add only a renamed source selected before conversion.
function inventoryMatches(pattern, file) {
  const matcher = new Minimatch(posix.normalize(pattern).replace(/^\.?\//, ""), { dot: true, nonegate: true, nocomment: true })
  for (let path = file; path !== "."; path = posix.dirname(path)) if (matcher.match(path)) return true
  return false
}

function inventoryEdits(pkg, source, target) {
  const edits = []
  for (const [field, owner] of [["files", pkg], ["publishConfig", pkg.publishConfig]]) {
    const patterns = owner?.files
    if (!Array.isArray(patterns)) continue
    const includes = path => patterns.some(pattern => typeof pattern === "string" && !pattern.startsWith("!") && inventoryMatches(pattern, path))
    const excludes = path => patterns.some(pattern => typeof pattern === "string" && pattern.startsWith("!") && inventoryMatches(pattern.slice(1), path))
    if (includes(source) && !excludes(source) && !includes(target) && !excludes(target)) {
      patterns.push(target)
      edits.push({ field, fileEntry: target })
    }
  }
  return edits
}

/**
 * Undoes the edits of rewriteExports for one module that revert returns to
 * .ts (repository-relative, now .ts): an added entry goes, and a rewritten one
 * names the .ts file again (pointBack). Returns the edits it undid.
 */
export function restoreExports(root, edits, module) {
  const vibe = vibePath(module)
  const undone = edits.filter((edit) => edit.module === vibe)
  for (const edit of undone) {
    const path = join(root, edit.manifest)
    if (!existsSync(path)) continue
    const pkg = JSON.parse(readFileSync(path, "utf8"))
    if (edit.privateCompanion !== undefined) {
      if (edit.field !== "exports" || compilerCompanionOf(edit.module) !== edit.privateCompanion)
        throw new Error("invalid private compiler companion export receipt")
      if (!pkg.exports || !Object.hasOwn(pkg.exports, edit.key)) continue
      if (pkg.exports[edit.key] !== null) throw new Error(edit.manifest + ": private companion export changed during migration")
      delete pkg.exports[edit.key]
      writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
      continue
    }
    const source = posix.relative(posix.dirname(edit.manifest), vibe)
    const sidecar = sidecarOf(root, posix.dirname(edit.manifest))
    // Routing can remove generated maps before a recorded source is returned.
    // Replaying its journal must leave those absent fields and keys alone.
    if (edit.fileEntry === undefined && edit.key !== undefined &&
        (pkg[edit.field] === null || typeof pkg[edit.field] !== "object" ||
         !Object.hasOwn(pkg[edit.field], edit.key))) continue
    if (edit.fileEntry !== undefined) {
      const owner = edit.field === "publishConfig" ? pkg.publishConfig : pkg
      if (Array.isArray(owner?.files)) owner.files = owner.files.filter(file => file !== edit.fileEntry)
    } else if (edit.added) delete pkg[edit.field][edit.key]
    else if (edit.key !== undefined) pkg[edit.field][edit.key] = pointBack(pkg[edit.field][edit.key], source, posix.extname(module), sidecar)
    else pkg[edit.field] = pointBack(pkg[edit.field], source, posix.extname(module), sidecar)
    writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
  }
  return undone
}

/** text with each word that is path, or ./path, replaced by replacement: a word is bounded by the command's spaces, quotes, = and ;&|(). */
export function replaceWord(text, path, replacement) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text.replace(new RegExp(`(^|[\\s"'=(])(\\./)?${escaped}(?=$|[\\s"';&|)])`, "g"), (_, before, dot) => before + (dot ?? "") + replacement)
}

/**
 * Points each package script at a renamed entry point. In the scripts of the
 * module's package and of every package above it, a word naming the module by
 * its path from that manifest, `scripts/run.ts` or `./scripts/run.ts`, names
 * `scripts/run.vibe`, which `node --import vibelang/register` runs: the .ts
 * file is gone. Returns the edits, { manifest, script, module }, for
 * restoreScripts.
 */
export function rewriteScripts(root, renames, { read = (file) => readFileSync(join(root, file), "utf8"), write = (file, text) => writeFileSync(join(root, file), text) } = {}) {
  const edits = []
  const byManifest = new Map()
  for (const rename of renames) {
    for (let dir = posix.dirname(rename.from); ; dir = posix.dirname(dir)) {
      if (existsSync(join(root, dir, "package.json"))) byManifest.set(dir, [...(byManifest.get(dir) ?? []), rename])
      if (dir === ".") break
    }
  }
  for (const [dir, moved] of byManifest) {
    const manifest = posix.join(dir, "package.json")
    const pkg = JSON.parse(read(manifest))
    if (pkg.scripts === null || typeof pkg.scripts !== "object") continue
    let changed = false
    for (const [script, command] of Object.entries(pkg.scripts)) {
      if (typeof command !== "string") continue
      let next = command
      for (const { from, to } of moved) {
        const rewritten = replaceWord(next, posix.relative(dir, from), posix.relative(dir, to))
        if (rewritten !== next) edits.push({ manifest, script, module: to })
        next = rewritten
      }
      if (next !== command) {
        pkg.scripts[script] = next
        changed = true
      }
    }
    if (changed) write(manifest, JSON.stringify(pkg, null, 2) + "\n")
  }
  return edits
}

/**
 * Undoes rewriteScripts for one module that revert returns to .ts
 * (repository-relative, now .ts): each script it pointed at the .vibe file
 * names the .ts file again. Returns the edits it undid.
 */
export function restoreScripts(root, edits, module) {
  const vibe = vibePath(module)
  const undone = edits.filter((edit) => edit.module === vibe)
  for (const edit of undone) {
    const path = join(root, edit.manifest)
    if (!existsSync(path)) continue
    const pkg = JSON.parse(readFileSync(path, "utf8"))
    const dir = posix.dirname(edit.manifest)
    if (typeof pkg.scripts?.[edit.script] !== "string") continue
    pkg.scripts[edit.script] = replaceWord(pkg.scripts[edit.script], posix.relative(dir, vibe), posix.relative(dir, module))
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
export function rewriteSpecifier(importer, specifier, target, { base: aliased } = {}) {
  const { path, suffix } = splitSpecifier(specifier)
  if (suffix) return rewriteSpecifier(importer, path, target, { base: aliased }) + suffix
  const targetExt = posix.extname(target)
  const ext = posix.extname(specifier)
  if (/^\.vibex?$/.test(targetExt)) {
    // The target is a renamed module: every importer names it by its source name.
    if (ext === targetExt) return specifier
    if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vibe", ".vibex"].includes(ext)) return specifier.slice(0, -ext.length) + targetExt
    // Extensionless: name the file, or the directory's index file.
    const base = aliased ?? posix.normalize(posix.join(posix.dirname(importer), specifier))
    if (target === posix.normalize(`${base}/index${targetExt}`)) return `${specifier.replace(/\/$/, "")}/index${targetExt}`
    return specifier + targetExt
  }
  // The target stays TypeScript, or revert returned it to TypeScript: only a
  // specifier the codemod spelled .vibe changes, back to the file's extension.
  // Every other written specifier stays as the repository wrote it, in a .vibe
  // importer as in a .ts one (decided detail 272): VibeLang resolves ./c.js,
  // ../d/index.js and ./e as TypeScript does, and a declaration keeps the
  // written spelling, so the published .d.ts matches the original byte for byte
  // (foldkit: 18 declarations differed only by this rewrite).
  if (/^\.vibex?$/.test(ext)) return specifier.slice(0, -ext.length) + targetExt
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
  const vibe = vibePath(module)
  const restored = []
  const byFile = new Map()
  for (const edit of edits) {
    let file = edit.file
    if (/\.vibex?$/.test(file) && !existsSync(join(root, file))) {
      // Revert may already have returned this importer to TypeScript. Its
      // recorded path still names .vibe; find the restored source, never a
      // still-native importer or an ambiguous pair of TypeScript sources.
      const candidates = (file.endsWith(".vibex") ? [".tsx"] : [".ts", ".mts", ".cts"]).map(ext => file.slice(0, -posix.extname(file).length) + ext)
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
    for (const i of editableImports(() => importParser(root), file, text)) {
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
const specifierExtensions = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vibe", ".vibex"]

export const importerFile = /\.(?:ts|tsx|mts|cts|vibe|vibex|js|jsx|mjs|cjs)$/

// A VIP-40 body is a TypeScript file: its JavaScript, extensionless and alias
// names stay as written, and a name of a source file follows that file's
// rename as it does in a sibling .ts file. Parse the body ranges so comments,
// strings, regexps and templates cannot impersonate a boundary.
const sourceFileName = /\.(?:[cm]?tsx?|vibex?)$/
let importTypeScript
const importParser = root => importTypeScript ??= loadTypeScript([root, fileURLToPath(new URL("../../../", import.meta.url)), fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
function nativeImportRanges(text, root, jsx = false) {
  if (!/\bmodule\b/.test(text)) return []
  const ts = importParser(root)
  const kind = jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile("imports.ts", text, ts.ScriptTarget.Latest, true, kind)
  const ranges = []
  const native = node => node && ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && node.name.text && !(node.flags & ts.NodeFlags.Namespace) && node.body && ts.isModuleBlock(node.body)
  const visit = node => {
    if (native(node)) {
      ranges.push([node.body.pos, node.body.end])
      return
    }
    // TypeScript can consume `module` as a recovery expression after a
    // VibeLang do expression. Parse again at that real identifier token;
    // unlike a text search, this never starts inside a quoted literal.
    if (ts.isIdentifier(node) && node.text === "module") {
      const start = node.getStart(source)
      const tail = ts.createSourceFile("imports.ts", text.slice(start), ts.ScriptTarget.Latest, true, kind).statements[0]
      if (native(tail)) ranges.push([start + tail.body.pos, start + tail.body.end])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return ranges
}

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
    const nativeBodies = /\.vibex?$/.test(file) ? nativeImportRanges(text, root, file.endsWith(".vibex")) : []
    for (const i of editableImports(() => importParser(root), file, text)) {
      const { path: modulePath, suffix } = splitSpecifier(i.specifier)
      if (!sourceFileName.test(modulePath) && nativeBodies.some(([start, end]) => start <= i.start && i.start < end)) continue
      if (javascript && !/\.(?:[cm]?tsx?|vibex?)$/.test(modulePath)) continue
      if (kept.get(file)?.has(i.specifier)) continue
      // A tsconfig paths alias (`@/x`) names a module as a relative specifier does (opencode-39).
      const aliased = resolveRelative(file, i.specifier, files) === undefined ? resolveAliased(file, i.specifier, files, aliases) : undefined
      const target = aliased?.target ?? resolveRelative(file, i.specifier, files)
      if (!target || (only && !only.has(file) && !only.has(target))) continue
      // A paths alias to a module that stays TypeScript keeps its authored
      // spelling: it resolved under this configuration before the rename, and
      // `~/leaf.ts`, a non-relative TypeScript name, is TS2877 under
      // rewriteRelativeImportExtensions (t3code web, 23 modules).
      if (aliased && !/\.vibex?$/.test(target) && !/\.vibex?$/.test(modulePath)) continue
      // Detail 272's first addendum: a test's or fixture's extensionless specifier needs
      // no edit (the test-diff protects both alike),
      // an import's or a Vitest or Jest mock's alike. Bun's mock.module("../src/x") does
      // need one: it does not reach x.vibe as written.
      if (i.kind !== "mock" && (isTestFile(file) || isFixtureFile(file)) && !specifierExtensions.includes(posix.extname(modulePath))) continue
      let next = rewriteSpecifier(file, modulePath, target, { base: aliased?.base })
      if (aliased && /\.vibex?$/.test(target) && (aliased.exact || aliases?.rewriteRelativeImportExtensions?.(file))) {
        // An exact paths key cannot gain a source suffix. Native TS2877 also
        // rejects non-relative source names under rewriteRelativeImportExtensions.
        // Use the same resolved source through a relative name the compiler can emit.
        next = posix.relative(posix.dirname(file), target)
        if (!next.startsWith(".")) next = "./" + next
      }
      // Detail 296: use the project's native emission policy for a
      // relative name of a migrated source, including a newly renamed file.
      if (next.startsWith(".") && /\.vibex?$/.test(next) && /\.vibex?$/.test(target)) {
        const sourceExt = posix.extname(target)
        const chosen = aliases?.migratedSourceExtension?.(file, sourceExt) ?? sourceExt
        next = next.slice(0, -sourceExt.length) + chosen
      }
      // A revert meets the same policy for a .vibe name no edit recorded, such as
      // one emission routing wrote: ./x.ts is TS5097 where ./x.js is the native name.
      if (next.startsWith(".") && /\.vibex?$/.test(modulePath) && /\.tsx?$/.test(next) && /\.tsx?$/.test(target)) {
        const sourceExt = posix.extname(next)
        const chosen = aliases?.migratedSourceExtension?.(file, sourceExt) ?? sourceExt
        next = next.slice(0, -sourceExt.length) + chosen
      }
      next += suffix
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
const refusalSiteLine = /^vibelang --fix: refused site: (.+?):(\d+):(\d+)-(\d+):(\d+) \[(\d+),(\d+)\) ([A-Z]+\d+)( new)?: (.*)$/
const refusalLine = /^vibelang --fix: (.+?):(\d+): ([A-Z]+\d+) not fixed: the fixed program would report (.*)$/

/** Reads one `vibelang --fix` run: the rewrites applied per file, by kind, and the refusals. */
export function parseFixOutput(output, { cwd, root } = {}) {
  const relative = (file) => (cwd && root ? posix.relative(root, posix.join(cwd, file)) : file)
  const files = {}
  const refused = []
  let total = 0
  for (const line of output.split(/\r?\n/)) {
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
    const site = refusalSiteLine.exec(line)
    if (site) {
      refused.push({ file: relative(site[1]), line: Number(site[2]), column: Number(site[3]),
        endLine: Number(site[4]), endColumn: Number(site[5]), start: Number(site[6]), end: Number(site[7]),
        code: site[8], ...(site[9] ? { newSite: true } : {}), error: site[10] })
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

// The compiler's platform repair moves a host read into a new companion beside
// its module, x.vibe's x.platform.ts, headed by this line. Under --only it may
// create the companion of a listed module that no file claims yet (chapter 7,
// Selecting ordinary fix files); the batch owns that file.
export const compilerCompanionMarker = "// Generated platform helpers for this VibeLang module.\n"

/** The companion the compiler's platform repair names for module, or null. */
export const compilerCompanionOf = module => /\.vibe$/.test(module) ? module.replace(/\.vibe$/, ".platform.ts") : null

const claimsCompanion = (root, companion) =>
  [".ts", ".tsx", ".js", ".d.ts"].some(extension => existsSync(join(root, companion.replace(/\.ts$/, extension))))

/** Whether file, relative to root, is a companion the compiler wrote. */
export const isCompilerCompanion = (root, file) => {
  try { return readFileSync(join(root, file), "utf8").startsWith(compilerCompanionMarker) } catch { return false }
}

/**
 * Runs `vibelang -p tsconfig --fix --noEmit --declaration` until a run fixes nothing, at
 * most maxRounds times. Returns every round's report, the merged rewrites by
 * file and kind, the refusals, the diagnostics of the last run, and the
 * companions the compiler created for selected modules. With only, ordinary
 * repairs use --only for the batch's files (relative to root).
 * With privateCompanions, exact exclusions keep proven fresh helpers private;
 * onPrivateCompanion journals the export edits before writePrivateManifest;
 * privateCompanionReceipts replays that owned plan after an interruption.
 * A defensive snapshot still restores nonselected sources if a compiler writes
 * outside its selection, including on interruption. An earlier batch's file,
 * hand repairs included, stays as committed. An empty selection starts no fix.
 */
export async function fixToFixedPoint(options) {
  if (options.only?.length === 0) {
    return { settled: true, rounds: [], byFile: {}, refused: [], restored: [], diagnostics: [], companions: [] }
  }
  const companionRoot = resolve(options.root ?? options.cwd ?? ".")
  const fresh = [...new Set((options.only ?? []).map(compilerCompanionOf).filter(Boolean))]
    .filter(companion => !claimsCompanion(companionRoot, companion))
  const fixed = await fixToFixedPointUnscoped(options)
  const owned = new Set(fresh.filter(companion => isCompilerCompanion(companionRoot, companion)))
  // The durable plan proves absence before the earlier repair. A marker alone
  // still cannot adopt a companion that existed before migration.
  if (options.privateCompanions) for (const receipt of options.privateCompanionReceipts ?? []) {
    if (!receipt.privateExports || !(options.only ?? []).some(file => compilerCompanionOf(file) === receipt.companion)) continue
    if (isCompilerCompanion(companionRoot, receipt.companion)) owned.add(receipt.companion)
  }
  const companions = [...owned].sort()
  const companionExports = options.privateCompanions ? await privateCompilerCompanionExports(companionRoot, companions, options) : []
  return { ...fixed, companions, ...(companionExports.length ? { companionExports } : {}) }
}

// A fresh-file receipt proves this helper had no original counterpart. Apply
// the same exact wildcard exclusions as other private generated helpers,
// without reclassifying an authored module or altering the compiler's code.
async function privateCompilerCompanionExports(root, companions, { onPrivateCompanion, writePrivateManifest, log }) {
  const edits = []
  for (const companion of companions) {
    if (!isCompilerCompanion(root, companion)) continue
    const file = companion.replace(/\.platform\.ts$/, ".vibe")
    const documents = new Map()
    const privateExports = privateResolverExports(root, file, companion, {
      exists: path => posix.normalize(path) !== posix.normalize(companion) && existsSync(join(root, path)),
      read: path => { const text = readFileSync(join(root, path), "utf8"); documents.set(path, text); return text },
    })
    if (!privateExports) continue
    const before = documents.get(privateExports.manifest), pkg = JSON.parse(before)
    const exportEdits = privateExports.keys.map(key => ({
      manifest: privateExports.manifest, field: "exports", key, module: file, privateCompanion: companion,
    }))
    const record = { file, companion, privateExports, exportEdits }
    for (const key of privateExports.keys) pkg.exports[key] = null
    // Persist the plan before its atomic manifest write. An interrupted plan
    // can be undone even when its key was never installed.
    if (log) appendFileSync(log + ".scope.log", JSON.stringify({ stage: "private-compiler-companion-plan", ...record }) + "\n")
    const recorded = onPrivateCompanion?.(record)
    if (recorded && typeof recorded.then === "function") await recorded
    const path = join(root, privateExports.manifest)
    if (readFileSync(path, "utf8") !== before) throw new Error(privateExports.manifest + ": changed during private companion preparation")
    const after = JSON.stringify(pkg, null, 2) + "\n", mode = statSync(path).mode & 0o777
    if (writePrivateManifest) {
      const written = writePrivateManifest(privateExports.manifest, after, mode)
      if (written && typeof written.then === "function") await written
    } else writeFileSync(path, after)
    edits.push(record)
    if (log) appendFileSync(log + ".scope.log", JSON.stringify({ stage: "private-compiler-companion", ...record }) + "\n")
  }
  return edits
}

async function fixToFixedPointUnscoped(options) {
  const files = await fixProgramFiles(options)
  const snippetRoot = resolve(options.root ?? options.cwd ?? ".")
  const snippetTs = () => loadTypeScript([snippetRoot, resolve(options.compiler ?? ".", "..")])
  const snippets = await captureTrackedSourceSnippets(snippetRoot, { ts: snippetTs })
  const directory = options.only ? mkdtempSync(join(tmpdir(), "vibelang-fix-selection-")) : undefined
  try {
    const selectionFile = directory && join(directory, "files.txt")
    if (selectionFile) {
      const root = resolve(options.root ?? options.cwd ?? ".")
      // A list file keeps spaces and commas in a source path literal. Resolve
      // physical identities just as the scope snapshot does for linked roots.
      writeFileSync(selectionFile, [...new Set(options.only.map(file => realpathSync(resolve(root, file))))].join("\n") + "\n")
      if (options.log) appendFileSync(`${options.log}.scope.log`, `# fix scope ${JSON.stringify({ stage: "selected", files: options.only.length, selected: options.only })}\n`)
    }
    return await withFixFiles(files, () => fixToFixedPointInScope({ ...options, selectionFile }, files), options.log)
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true })
    refreshSourceSnippets(snippetRoot, snippets, { ts: snippetTs })
  }
}

async function fixToFixedPointInScope({ compiler, tsconfig, cwd, root, maxRounds = 4, log, only, timeoutMs, selectionFile, onProgress = event => process.stderr.write("MIGRATE_FIX_PROGRESS " + JSON.stringify(event) + "\n") }, scopeFiles) {
  const rounds = []
  const byFile = {}
  const refused = []
  const kept = only && new Set(only)
  const others = new Map()
  const selected = new Map()
  const identities = new Map()
  const identity = path => {
    const absolute = resolve(path)
    if (!identities.has(absolute)) {
      try { identities.set(absolute, realpathSync(absolute)) }
      catch { identities.set(absolute, absolute) }
    }
    return identities.get(absolute)
  }
  const sourceRoot = resolve(root ?? cwd ?? ".")
  if (kept) {
    for (const file of kept) {
      const id = identity(resolve(sourceRoot, file))
      if (!selected.has(id)) selected.set(id, file)
    }
    // A compiler can print physical paths while the caller uses a symlinked
    // checkout. Select by file identity and retain the caller's report names.
    for (const path of scopeFiles) {
      const id = identity(path)
      if (!selected.has(id)) others.set(path, { file: relative(identity(sourceRoot), id).split(sep).join("/"), original: readFileSync(path) })
    }
  }
  // `restored` lists the modules whose committed bytes the rounds put back.
  const restored = []
  let last
  // A compiler older than --only (VibeLang 0.0.11) rejects it with TS5023 and
  // fixes nothing. The round reruns without it: the snapshot above puts back
  // every nonselected source after each round, and the report keeps the
  // selected files only, so the batch still changes only its own files.
  let onlySupported = true
  for (let round = 1; round <= maxRounds; round++) {
    // --declaration: what --fix keeps for a declaration file it keeps under a tsconfig that says noEmit too.
    let result, pid
    const audit = log && resolve(`${log}.${round}.audit`)
    const progressLog = log && `${log}.${round}.progress.jsonl`
    if (progressLog) writeFileSync(progressLog, "")
    const invoke = async selection => {
      const progress = fixProgressStream(event => {
        const record = { event: "compiler-fix-progress", invocation: round, pid, ...event }
        if (progressLog) appendFileSync(progressLog, JSON.stringify(record) + "\n")
        onProgress?.(record)
      })
      try {
        return await run(`${quote(compiler)} -p ${quote(tsconfig)} --fix${selection} --noEmit --declaration --pretty false --singleThreaded`, {
          cwd, log: log && `${log}.${round}.log`, timeoutMs,
          ...(audit ? { env: { VIBELANG_FIX_AUDIT_DIR: audit } } : {}),
          onStderr: (chunk, process) => { pid = process.pid; progress.write(chunk) }
        })
      } finally { progress.end() }
    }
    try {
      const selected = selectionFile && onlySupported
      result = await invoke(selected ? ` --only ${quote("@" + selectionFile)}` : "")
      if (selected && result.code !== 0 && /TS5023: Unknown compiler option ['"]--only['"]/i.test(result.stdout + result.stderr)) {
        onlySupported = false
        if (log) {
          writeFileSync(`${log}.${round}.only-unsupported.log`, readFileSync(`${log}.${round}.log`))
          appendFileSync(`${log}.scope.log`, `# fix scope ${JSON.stringify({ stage: "only-unsupported", round, restoring: others.size })}\n`)
        }
        result = await invoke("")
      }
    } finally {
      // An interrupted compiler may keep verified writes without printing
      // per-file statistics. Restore the whole nonselected byte snapshot.
      for (const [path, { file, original }] of others) {
        if (existsSync(path) && readFileSync(path).equals(original)) continue
        writeFileSync(path, original)
        restored.push(file)
      }
    }
    const parsed = parseFixOutput(result.stdout, { cwd, root })
    if (kept) {
      const owned = {}
      for (const [file, kinds] of Object.entries(parsed.files)) {
        const name = selected.get(identity(resolve(sourceRoot, file)))
        if (name !== undefined) mergeFixes(owned, { [name]: kinds })
      }
      parsed.files = owned
      parsed.total = Object.values(owned).reduce((n, kinds) => n + Object.values(kinds).reduce((a, b) => a + b, 0), 0)
      parsed.refused = parsed.refused.flatMap(r => {
        const file = selected.get(identity(resolve(sourceRoot, r.file)))
        return file === undefined ? [] : [{ ...r, file }]
      })
    }
    assertFinished(result, log && `${log}.${round}.log`)
    rounds.push({ round, code: result.code, fixes: parsed.total, files: parsed.files, refused: parsed.refused, ...(audit ? { audit } : {}) })
    mergeFixes(byFile, parsed.files)
    refused.push(...parsed.refused)
    last = result
    if (parsed.total === 0) break
  }
  const settled = rounds.at(-1).fixes === 0
  return { settled, rounds, byFile, refused, restored: [...new Set(restored)].sort(), diagnostics: parseDiagnostics(last.stdout + last.stderr, { cwd, root }),
    ...(selectionFile && !onlySupported ? { onlyUnsupported: true } : {}) }
}

/** Totals of the rewrites that fired, by kind, over every file. */
export function rewriteTotals(byFile) {
  const totals = {}
  for (const kinds of Object.values(byFile)) for (const [kind, n] of Object.entries(kinds)) totals[kind] = (totals[kind] ?? 0) + n
  return totals
}
