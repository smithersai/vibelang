// The persistent compile cache behind vibelang/project.
//
// A whole-project compile costs hundreds of milliseconds, and every Node
// process that imports .vibe source repeats it. The cache stores a successful
// compile's result with a fingerprint of everything the result depends on, and
// a later process reuses the result while the fingerprint still holds:
//
//   compiler     the compiler file, and the native binary its launcher runs
//   configs      the tsconfig, every config it extends, and its references,
//                and the tsconfig each other package's .vibe source checks
//                with (D297)
//   directories  each directory the project's include patterns scan, so an
//                added or deleted source file is seen
//   installs     lockfiles and package-manager state files above the project
//   files        every file the compile read, dependencies included
//   packages     the package.json nearest each of those files
//
// A source edit, an added or deleted file, a tsconfig change, a reinstalled
// dependency, and a rebuilt compiler each change the fingerprint. A failed
// compile is never stored. Entries are written to a temporary file and renamed
// into place, so a reader sees a whole entry or none, and any number of
// processes can share one directory.
import { createHash, randomBytes } from "node:crypto"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { userInfo } from "node:os"
import { temporaryRoot } from "./temporary.mjs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

// Bump when an entry's shape or meaning changes. 2: a compile checks only
// its project's own files (vibelang --loader-root).
// 3: loaders retain emission and select diagnostics per loaded source.
// 4: source maps name sources by absolute path again, not file URL.
// 5: sidecars beside their sources are compiler outputs.
// 6: a directory record names the vibe.sidecarDir children its listing omits.
// 7: configured sidecar layouts fingerprint inputs, including overlapping roots.
const format = 7
const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version

// A file whose timestamp is this close to a compile's start may have changed
// while the compiler read it. Linux stamps files from a clock that lags the
// real time by up to a tick (10 ms at HZ=100), and Windows by up to 16 ms.
const racyMilliseconds = 50
// Filesystems that keep whole seconds (FAT, HFS+) need a wider margin.
const coarseRacyMilliseconds = 2000

const isDependency = (path) => /[\\/]node_modules[\\/]/.test(path)
const digest = (data) => createHash("sha256").update(data).digest("base64url")

function owner() {
  if (typeof process.getuid === "function") return String(process.getuid())
  try {
    return userInfo().username.replace(/[^\w.-]/g, "_")
  } catch {
    return "user"
  }
}

/**
 * Returns the cache directory, or undefined when caching is off. `option` is
 * false to turn the cache off, or { directory }. VIBELANG_DISABLE_CACHE=1
 * turns it off everywhere; VIBELANG_CACHE_DIR moves it; the default is a
 * private directory under the system's temporary directory.
 */
export function cacheDirectory(option) {
  if (option === false) return undefined
  const disabled = process.env.VIBELANG_DISABLE_CACHE
  if (disabled && disabled !== "0" && disabled !== "false") return undefined
  if (option && typeof option === "object" && option.directory) return { path: resolve(option.directory), shared: true }
  if (process.env.VIBELANG_CACHE_DIR) return { path: resolve(process.env.VIBELANG_CACHE_DIR), shared: true }
  return { path: join(temporaryRoot(), `vibelang-cache-${owner()}`), shared: false }
}

// The default directory lives in a temporary directory other users can write
// to, so it must be this user's alone, or a stranger's entry could put code
// into this process. Returns why a directory is unsafe, or undefined.
function unsafe(cache) {
  if (cache.shared || typeof process.getuid !== "function") return undefined
  const stat = statOf(cache.path)
  if (stat === undefined) return undefined
  if (stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0) {
    return `${cache.path} belongs to another user or is writable by others`
  }
  return undefined
}

function prepare(cache) {
  mkdirSync(cache.path, { recursive: true, mode: 0o700 })
  const reason = unsafe(cache)
  if (reason !== undefined) throw new Error(reason)
}

const entryFile = (cache, key) =>
  join(cache.path, `${digest(JSON.stringify([format, version, key.project, key.root])).slice(0, 32)}.json`)

// A stamp is what a stat says about a file's content: [size, mtimeMs, ctimeMs, ino].
const stampOf = (stat) => [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]
const statOf = (path) => statSync(path, { throwIfNoEntry: false })
const sameStamp = (a, b, dependency) =>
  a[0] === b[0] && a[1] === b[1] && a[3] === b[3] && (dependency || a[2] === b[2])

// A file changed at or after `since`, or one whose stamp may be that recent.
function racy(stat, since, dependency) {
  const coarse = stat.mtimeMs % 1000 === 0 && stat.ctimeMs % 1000 === 0
  const latest = dependency ? stat.mtimeMs : Math.max(stat.mtimeMs, stat.ctimeMs)
  return latest >= since - (coarse ? coarseRacyMilliseconds : racyMilliseconds)
}

// Records a file the compile read, or returns undefined when it changed since
// `since`. A dependency's stamp alone identifies it: package managers write new
// files rather than editing installed ones, and hard links into a shared store
// change a file's ctime without changing it. A project file also keeps a hash,
// so a checkout that rewrites it with the same bytes does not miss.
function recordFile(path, since, hashDependencies = false) {
  const dependency = isDependency(path)
  const before = statOf(path)
  if (before === undefined || racy(before, since, dependency)) return undefined
  if (dependency && !hashDependencies) return { path, stamp: stampOf(before) }
  const hash = digest(readFileSync(path))
  const after = statOf(path)
  if (after === undefined || !sameStamp(stampOf(before), stampOf(after), dependency)) return undefined
  return { path, stamp: stampOf(before), hash }
}

// Records a file before the compile starts, whether or not it exists.
function snapshotFile(path) {
  const stat = statOf(path)
  if (stat === undefined) return { path, stamp: null }
  return { path, stamp: stampOf(stat), hash: digest(readFileSync(path)) }
}

function fileHolds(record) {
  const stat = statOf(record.path)
  if (stat === undefined || record.stamp === null) return stat === undefined && record.stamp === null
  const dependency = record.hash === undefined
  if (sameStamp(stampOf(stat), record.stamp, dependency)) return true
  if (dependency || stat.size !== record.stamp[0]) return false
  try {
    return digest(readFileSync(record.path)) === record.hash
  } catch {
    return false
  }
}

/**
 * Returns the native binary that compiler, the vibelang package's launcher,
 * runs (bin/vibelang's findBinary), or undefined when compiler is another
 * program or the launcher finds none.
 */
export function launcherBinary(compiler) {
  if (basename(dirname(compiler)) !== "bin" || basename(compiler) !== "vibelang") return undefined
  try {
    const manifest = JSON.parse(readFileSync(join(dirname(compiler), "../package.json"), "utf8"))
    if (manifest.name !== "vibelang") return undefined
  } catch {
    return undefined
  }
  if (!isNodeScript(compiler)) return undefined
  if (process.env.VIBELANG_BINARY) return resolve(process.env.VIBELANG_BINARY)
  const executable = process.platform === "win32" ? "vibelang.exe" : "vibelang"
  const local = join(dirname(compiler), "../native", executable)
  if (existsSync(local)) return local
  try {
    const name = process.platform === "win32" ? `@vibelang/cli-win32-${process.arch}` : `vibelang-${process.platform}-${process.arch}`
    const target = `${name}/package.json`
    return join(dirname(createRequire(compiler).resolve(target)), "bin", executable)
  } catch {
    return undefined
  }
}

// The compiler a project compiles with: the given file, and, for the vibelang
// package's launcher, the native binary it runs.
function compilerFiles(compiler) {
  const binary = launcherBinary(compiler)
  return binary === undefined ? [compiler] : [compiler, binary]
}

function isNodeScript(path) {
  let file
  try {
    file = openSync(path, "r")
    const header = Buffer.alloc(256)
    const bytes = readSync(file, header, 0, header.length, 0)
    return /^#![^\r\n]*\bnode(?:\s|$)/.test(header.subarray(0, bytes).toString("utf8"))
  } catch {
    return false
  } finally {
    if (file !== undefined) closeSync(file)
  }
}

// Stat-only and read at every lookup: a rebuilt compiler is a new file.
const compilerIdentity = (compiler) =>
  compilerFiles(compiler).map((path) => {
    const stat = statOf(path)
    return [path, stat === undefined ? null : stampOf(stat)]
  })

// The compiler files' contents, read only when their stamps differ from an
// entry's: a chmod, a hard link or a copy with the same bytes changes a stamp
// (its ctime, its mtime) but not what the compiler emits, and every Vite run
// recompiled every package after one (drive-t3code-apps, 2026-10-31).
const compilerDigests = (identity) =>
  identity.map(([path, stamp]) => (stamp === null ? null : digest(readFileSync(path))))

// tsconfig files are JSON with comments and trailing commas.
export function parseJsonc(text) {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      const start = i
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++
      out += text.slice(start, i + 1)
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      i = end === -1 ? text.length : end + 1
      out += " "
    } else out += char
  }
  // Trailing commas, outside strings.
  let result = ""
  for (let i = 0; i < out.length; i++) {
    const char = out[i]
    if (char === '"') {
      const start = i
      for (i++; i < out.length && out[i] !== '"'; i++) if (out[i] === "\\") i++
      result += out.slice(start, i + 1)
    } else if (char === ",") {
      let next = i + 1
      while (next < out.length && /\s/.test(out[next])) next++
      if (out[next] !== "}" && out[next] !== "]") result += char
    } else result += char
  }
  return JSON.parse(result.replace(/^﻿/, ""))
}

const relativeSpecifier = (specifier) => /^\.\.?(?:[\\/]|$)/.test(specifier) || isAbsolute(specifier)

// Resolves an `extends` the way TypeScript does: a path, with .json added when
// the file is missing, or a package specifier through node_modules.
function resolveExtends(specifier, directory) {
  if (relativeSpecifier(specifier)) {
    const path = resolve(directory, specifier)
    return existsSync(path) || path.endsWith(".json") ? path : `${path}.json`
  }
  const require = createRequire(join(directory, "tsconfig.json"))
  for (const candidate of [specifier, `${specifier}.json`, `${specifier}/tsconfig.json`]) {
    try {
      return require.resolve(candidate)
    } catch { /* the next candidate */ }
  }
  throw new Error(`cannot resolve the tsconfig ${specifier} extends from ${directory}`)
}

// Reads a project's tsconfig, every config it extends, and the configs its
// references name. Returns the main config's node and every file read.
function readConfigs(project) {
  const nodes = new Map()
  const files = []
  function read(path, optional) {
    let node = nodes.get(path)
    if (node !== undefined) return node
    node = { path, json: {}, parents: [] }
    nodes.set(path, node)
    files.push(path)
    if (optional && !existsSync(path)) return node
    node.json = parseJsonc(readFileSync(path, "utf8"))
    const parents = node.json.extends === undefined ? [] : [node.json.extends].flat()
    for (const specifier of parents) node.parents.push(read(resolveExtends(String(specifier), dirname(path)), false))
    for (const reference of Array.isArray(node.json.references) ? node.json.references : []) {
      if (typeof reference?.path !== "string") continue
      const target = resolve(dirname(path), reference.path)
      read(target.endsWith(".json") ? target : join(target, "tsconfig.json"), true)
    }
    return node
  }
  return { main: read(project, false), files }
}

// A setting from the config that sets it: its own, else the last of its
// parents that does. Returns the value and the directory it is relative to.
function setting(node, get) {
  const own = get(node.json)
  if (own !== undefined) return { value: own, base: dirname(node.path) }
  for (const parent of [...node.parents].reverse()) {
    const found = setting(parent, get)
    if (found !== undefined) return found
  }
  return undefined
}

// The directories TypeScript scans for a project's files, each recursive or
// not, and the excluded directories it skips. Over-approximate: a directory
// scanned here and not by TypeScript only costs a needless recompile.
function scannedDirectories(main) {
  const home = dirname(main.path)
  const expand = (value, base) => resolve(base, String(value).replaceAll("${configDir}", home))
  const include = setting(main, (json) => json.include)
  const files = setting(main, (json) => json.files)
  const specs = include !== undefined
    ? [include.value].flat().map((spec) => expand(spec, include.base))
    : files === undefined ? [join(home, "**/*")] : []
  const roots = specs.map((spec) => {
    // A backslash is a separator on Windows alone; elsewhere it is a name's.
    const parts = spec.split(process.platform === "win32" ? /[\\/]/ : /\//)
    const wild = parts.findIndex((part) => /[*?]/.test(part))
    if (wild === -1) {
      // TypeScript reads a last component without '.', '*' or '?' as a directory.
      return /[.*?]/.test(parts.at(-1)) ? { path: dirname(spec), recursive: false } : { path: spec, recursive: true }
    }
    return { path: parts.slice(0, wild).join(sep) || sep, recursive: wild < parts.length - 1 || parts[wild] === "**" }
  })
  const skip = new Set()
  const exclude = setting(main, (json) => json.exclude)
  if (exclude !== undefined) {
    for (const spec of [exclude.value].flat()) if (!/[*?]/.test(String(spec))) skip.add(expand(spec, exclude.base))
  } else {
    for (const option of ["outDir", "declarationDir"]) {
      const found = setting(main, (json) => json.compilerOptions?.[option])
      if (found !== undefined) skip.add(expand(found.value, found.base))
    }
  }
  const sidecars = setting(main, (json) => typeof json.vibe?.sidecarDir === "string" ? json.vibe.sidecarDir : undefined)
  return { roots, skip, home, sidecarDir: sidecars === undefined ? undefined : expand(sidecars.value, sidecars.base) }
}

// What a directory holds that could become part of a program: its source
// files and subdirectories, without the dotted names TypeScript's globs skip.
const sourceName = /\.(?:[cm]?[jt]sx?|vibe|json)$/i
// omitted names excluded child directories, such as outDir, so creating
// or removing one is no change.
function listing(path, omitted = []) {
  let entries
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch {
    return { names: null, directories: [] }
  }
  const names = []
  const directories = []
  // A declaration sidecar beside its .vibe source is an output (VIP-27),
  // excluded from the program just as it is by the compiler's resolver.
  // An orphan sidecar remains a TypeScript input.
  const sources = new Set(entries.filter((entry) => entry.name.endsWith(".vibe") &&
    (entry.isFile() || entry.isSymbolicLink() && statOf(join(path, entry.name))?.isFile())).map((entry) => entry.name))
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    let directory = entry.isDirectory()
    if (entry.isSymbolicLink()) directory = statOf(join(path, entry.name))?.isDirectory() ?? false
    if (directory) {
      if (omitted.includes(entry.name)) continue
      names.push(`${entry.name}/`)
      directories.push(join(path, entry.name))
    } else if (sourceName.test(entry.name)) {
      if (entry.name.endsWith(".d.vibe.ts") && sources.has(entry.name.slice(0, -".d.vibe.ts".length) + ".vibe")) continue
      names.push(entry.name)
    }
  }
  return { names: digest(names.sort().join("\n")), directories: directories.sort() }
}

const ignoredDirectories = new Set(["node_modules", "bower_components", "jspm_packages"])

// An opt-in output tree can overlap inputs. Fingerprint genuine file names
// throughout each scanned root, omitting paired outputs and empty directories.
// This sees a new source even in a previously output-only directory, while
// creating a nested sidecar directory does not invalidate a successful compile.
function sidecarInputNames(root, { recursive, excluded, sidecarDir, home }) {
  if (!statOf(root)?.isDirectory()) return null
  const names = []
  const ancestors = new Set()
  let unreadable = false
  const paired = (path) => {
    const suffix = ".d.vibe.ts"
    if (!path.endsWith(suffix)) return false
    if (statOf(path.slice(0, -suffix.length) + ".vibe")?.isFile()) return true
    const mirrored = relative(sidecarDir, path)
    if (mirrored === ".." || mirrored.startsWith(".." + sep) || isAbsolute(mirrored)) return false
    return statOf(join(home, mirrored.slice(0, -suffix.length) + ".vibe"))?.isFile() ?? false
  }
  const walk = (path, depth) => {
    if (excluded.includes(path)) return
    let canonical, entries
    try {
      canonical = realpathSync(path)
      if (ancestors.has(canonical)) return
      entries = readdirSync(path, { withFileTypes: true })
    } catch { unreadable = true; return }
    ancestors.add(canonical)
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const child = join(path, entry.name)
      const directory = entry.isDirectory() || entry.isSymbolicLink() && statOf(child)?.isDirectory()
      if (directory) {
        if (recursive && depth < 64 && !ignoredDirectories.has(entry.name)) walk(child, depth + 1)
      } else if (sourceName.test(entry.name) && (entry.isFile() || statOf(child)?.isFile()) && !paired(child)) names.push(child)
    }
    ancestors.delete(canonical)
  }
  walk(root, 0)
  return unreadable ? null : digest(names.sort().join("\n"))
}

// Records each scanned directory's stamp and listing before the compile, so a
// file added or removed while the compiler runs shows up as a change.
function snapshotDirectories(main) {
  const { roots, skip, home, sidecarDir } = scannedDirectories(main)
  if (sidecarDir !== undefined) return roots.map(({ path, recursive }) => {
    const options = { recursive, excluded: [...skip], sidecarDir, home }
    return [path, null, sidecarInputNames(path, options), [], options]
  })
  const records = new Map()
  const visit = (path, recursive, depth) => {
    if (records.has(path) || skip.has(path)) return
    const stat = statOf(path)
    const omitted = [...skip].filter((skipped) => dirname(skipped) === path).map((skipped) => basename(skipped))
    const { names, directories } = listing(path, omitted)
    records.set(path, [path, stat === undefined ? null : [stat.mtimeMs, stat.ino], names, omitted])
    if (!recursive || depth > 64) return
    for (const child of directories) if (!ignoredDirectories.has(basename(child))) visit(child, true, depth + 1)
  }
  for (const root of roots) visit(root.path, root.recursive, 0)
  return [...records.values()]
}

function directoryHolds([path, stamp, names, omitted = [], sidecarOptions]) {
  if (sidecarOptions !== undefined) return sidecarInputNames(path, sidecarOptions) === names
  const stat = statOf(path)
  if (stat !== undefined && stamp !== null && stat.mtimeMs === stamp[0] && stat.ino === stamp[1]) return true
  return listing(path, omitted).names === names
}

const installFiles = [
  "pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lock", "bun.lockb",
  "node_modules/.modules.yaml", "node_modules/.pnpm/lock.yaml", "node_modules/.package-lock.json",
  "node_modules/.yarn-state.yml", "node_modules/.yarn-integrity"
]

// Lockfiles and package-manager state in the project's directory and above:
// an install, an upgrade, or a relinked workspace package rewrites one.
function snapshotInstalls(project) {
  const records = []
  for (let directory = dirname(project); ; directory = dirname(directory)) {
    for (const name of installFiles) {
      const path = join(directory, name)
      const stat = statOf(path)
      records.push({ path, stamp: stat === undefined ? null : stampOf(stat) })
    }
    if (dirname(directory) === directory) return records
  }
}

const installHolds = (record) => {
  const stat = statOf(record.path)
  if (stat === undefined || record.stamp === null) return stat === undefined && record.stamp === null
  return sameStamp(stampOf(stat), record.stamp, true)
}

// The nearest file called name at or above directory, or null. found memoizes
// one name's answers by directory.
function nearestFile(directory, name, found) {
  if (found.has(directory)) return found.get(directory)
  const names = name === "tsconfig.json" ? ["vibe.config.json", "tsconfig.json", "jsconfig.json"] : [name]
  const candidate = names.map((name) => join(directory, name)).find(existsSync)
  const result = candidate !== undefined ? candidate : dirname(directory) === directory ? null : nearestFile(dirname(directory), name, found)
  found.set(directory, result)
  return result
}

/**
 * Opens the cache for one project's compile. Returns undefined when caching is
 * off; otherwise { file, lookup, begin, store }:
 *   lookup()                       { result } on a hit, else { miss: reason }
 *   begin()                        a snapshot of the inputs known before the compile
 *   store(snapshot, result, files) caches a successful compile and the files it read
 */
export function projectCache({ project, root, compiler, cache, debug = () => {} }) {
  const location = cacheDirectory(cache)
  if (location === undefined) return undefined
  const key = { project, root }
  const file = entryFile(location, key)

  function lookup() {
    const reason = unsafe(location)
    if (reason !== undefined) return { miss: reason }
    let entry
    try {
      entry = JSON.parse(readFileSync(file, "utf8"))
    } catch (error) {
      return { miss: error?.code === "ENOENT" ? "no entry" : "unreadable entry" }
    }
    try {
      return validate(entry)
    } catch {
      return { miss: "unreadable entry" }
    }
  }

  function validate(entry) {
    if (entry.format !== format || entry.version !== version || entry.project !== project || entry.root !== root) {
      return { miss: "entry for another version" }
    }
    const identity = compilerIdentity(compiler)
    if (JSON.stringify(entry.compiler) !== JSON.stringify(identity)) {
      const same = entry.compilerDigests !== undefined && entry.compiler.length === identity.length &&
        entry.compiler.every(([path], i) => path === identity[i][0]) &&
        JSON.stringify(entry.compilerDigests) === JSON.stringify(compilerDigests(identity))
      if (!same) return { miss: "compiler changed" }
    }
    const config = entry.configs.find((record) => !fileHolds(record))
    if (config) return { miss: `${config.path} changed` }
    const directory = entry.directories.find((record) => !directoryHolds(record))
    if (directory) return { miss: `${directory[0]} gained or lost a file` }
    const install = entry.installs.find((record) => !installHolds(record))
    if (install) return { miss: `${install.path} changed` }
    for (const list of [entry.packages, entry.files]) {
      const changed = list.find((record) => !fileHolds(record))
      if (changed) return { miss: `${changed.path} changed` }
    }
    const outputs = new Map()
    for (const { paths, code, map } of entry.outputs) {
      const output = { code, map }
      for (const path of paths) outputs.set(path, output)
    }
    return { result: { outputs, inputs: entry.inputs, files: entry.files.map((record) => record.path), errors: [], warnings: entry.warnings } }
  }

  function begin() {
    const started = Date.now()
    try {
      const configs = readConfigs(project)
      const identity = compilerIdentity(compiler)
      return {
        started,
        compiler: identity,
        compilerDigests: compilerDigests(identity),
        configs: configs.files.map(snapshotFile),
        directories: snapshotDirectories(configs.main),
        installs: snapshotInstalls(project)
      }
    } catch (error) {
      debug(`not caching ${project}: ${error.message}`)
      return undefined
    }
  }

  function store(snapshot, result, files) {
    if (snapshot === undefined || result.errors.length) return
    try {
      write(snapshot, result, files)
    } catch (error) {
      debug(`not caching ${project}: ${error.message}`)
    }
  }

  function write(snapshot, result, files) {
    const built = entryOf({ project, root, snapshot, result, files })
    if (built.reason !== undefined) return debug(`not caching ${project}: ${built.reason}`)
    const entry = built.entry
    const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
    try {
      prepare(location)
      writeFileSync(temporary, JSON.stringify(entry), { mode: 0o600 })
      renameSync(temporary, file)
    } catch (error) {
      rmSync(temporary, { force: true })
      debug(`not caching ${project}: ${error.message}`)
    }
  }

  return { file, lookup, begin, store }
}

// A cache entry for a compile's result: the snapshot taken before the compile,
// and a record of each file it read, the package.json nearest each, and the
// tsconfigs that decide another package's .vibe source. Returns { entry }, or
// { reason } when a file changed during or too close to the compile.
function entryOf({ project, root, snapshot, result, files, hashDependencies = false }) {
  const changed = (path) => ({ reason: `${path} changed during or too close to the compile` })
  const records = []
  const packages = new Map()
  const nearest = new Map()
  for (const path of files) {
    const record = recordFile(path, snapshot.started, hashDependencies)
    if (record === undefined) return changed(path)
    records.push(record)
    const manifest = nearestFile(dirname(path), "package.json", nearest)
    if (manifest !== null && !packages.has(manifest)) packages.set(manifest, undefined)
  }
  for (const path of packages.keys()) {
    const record = recordFile(path, snapshot.started, hashDependencies)
    if (record === undefined) return changed(path)
    packages.set(path, record)
  }
  // The checker gives a .vibe file of another package the settings of the
  // nearest tsconfig.json above it and what that extends (D297), so those
  // configs decide this compile too.
  const settings = new Map()
  const nearestConfigs = new Map()
  for (const path of files) {
    if (!path.endsWith(".vibe")) continue
    const config = nearestFile(dirname(path), "tsconfig.json", nearestConfigs)
    if (config === null || config === project || settings.has(config)) continue
    for (const file of readConfigs(config).files) if (!settings.has(file) && existsSync(file)) settings.set(file, undefined)
  }
  for (const path of settings.keys()) {
    const record = recordFile(path, snapshot.started, hashDependencies)
    if (record === undefined) return changed(path)
    settings.set(path, record)
  }
  const outputs = new Map()
  for (const [path, output] of result.outputs) {
    const existing = outputs.get(output)
    if (existing) existing.paths.push(path)
    else outputs.set(output, { paths: [path], code: output.code, map: output.map })
  }
  return {
    entry: {
      format, version, project, root,
      compiler: snapshot.compiler,
      compilerDigests: snapshot.compilerDigests,
      configs: [...snapshot.configs, ...settings.values()],
      directories: snapshot.directories,
      installs: snapshot.installs,
      packages: [...packages.values()],
      files: records,
      inputs: result.inputs,
      warnings: result.warnings,
      outputs: [...outputs.values()]
    }
  }
}

// Loader records (opencode cold start). A migrated package commits its
// emitted JavaScript under .vibelang/js/ for tools that load no VibeLang
// plugin, but a loader cannot run that JavaScript in place of the source:
// nothing proves it is what the current sources, configs, dependencies and
// compiler emit, and emit is type-directed. So every cold process compiled
// each workspace package it reached (opencode's CLI child: schema, server,
// protocol, ai and codemode, 7 to 13 s each on a 4-vCPU box).
//
// A loader record is a cache entry made portable and committed beside the
// project, at <project dir>/.vibelang/js/.loader/<tsconfig name>.json: the
// loader's own compile result, with every input known by its content alone.
// Paths are relative to the workspace (the nearest directory above the project
// with a lockfile), file stamps give way to digests (dependencies included),
// the compiler is the digest of the native binary, the installs are the
// workspace's lockfiles, and source maps leave out the source text, which the
// reader takes from the files it has just checked. On a cache miss a loader
// checks the record input by input; when every one holds it uses the recorded
// result and caches it as its own compile. A record that fails any check
// costs only the compile it would have saved.
const recordFormat = 1
const recordBase = "<vibelang-record-base>"
const lockfiles = installFiles.filter((name) => !name.includes("/"))

/** The loader record of a project. */
export const loaderRecordFile = (project) => join(dirname(project), ".vibelang", "js", ".loader", `${basename(project)}.json`)

// The directory a record's paths are relative to: the nearest one at or above
// the project's that holds a lockfile, else the project's own.
function workspaceOf(project) {
  for (let directory = dirname(project); ; directory = dirname(directory)) {
    if (lockfiles.some((name) => existsSync(join(directory, name)))) return directory
    if (dirname(directory) === directory) return dirname(project)
  }
}

// The file whose bytes decide what a compiler emits: the native binary that a
// launcher runs, else the compiler itself. Digests are kept per process.
const binaryDigests = new Map()
function binaryDigest(compiler) {
  let path = compiler
  try { path = realpathSync(compiler) } catch { /* a missing compiler has no digest */ }
  path = launcherBinary(path) ?? path
  const stat = statOf(path)
  if (stat === undefined) return null
  const known = binaryDigests.get(path)
  if (known !== undefined && sameStamp(known.stamp, stampOf(stat), false)) return known.digest
  const value = digest(readFileSync(path))
  binaryDigests.set(path, { stamp: stampOf(stat), digest: value })
  return value
}

const contentHolds = (record) => {
  const stat = statOf(record.path)
  if (record.hash === null) return stat === undefined
  if (stat === undefined || stat.size !== record.size) return false
  try {
    return digest(readFileSync(record.path)) === record.hash
  } catch {
    return false
  }
}

const escaped = (path) => JSON.stringify(path).slice(1, -1)
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * The loader record of one project's compile: { file, begin, write, lookup }.
 *   begin()                        a snapshot of the inputs known before the compile
 *   write(snapshot, result, files) writes the record of a compile with no error
 *   lookup()                       { result, files } when every input holds, else { miss: reason }
 */
export function loaderRecord({ project, root, compiler }) {
  const file = loaderRecordFile(project)

  function begin() {
    const configs = readConfigs(project)
    return {
      started: Date.now(),
      compiler: binaryDigest(compiler),
      configs: configs.files.map(snapshotFile),
      directories: snapshotDirectories(configs.main)
    }
  }

  function write(snapshot, result, files) {
    if (result.errors.length) throw new Error(`${project} did not compile; a record holds only a compile with no error`)
    const base = workspaceOf(project)
    const built = entryOf({ project, root, snapshot: { ...snapshot, compilerDigests: undefined, installs: [] }, result, files, hashDependencies: true })
    if (built.reason !== undefined) throw new Error(`cannot record ${project}: ${built.reason}`)
    const content = (record) => record.stamp === null || record.hash === undefined
      ? { path: record.path, hash: null }
      : { path: record.path, size: record.stamp[0], hash: record.hash }
    const installs = []
    for (let directory = dirname(project); ; directory = dirname(directory)) {
      for (const name of lockfiles) installs.push(content(snapshotFile(join(directory, name))))
      if (directory === base || dirname(directory) === directory) break
    }
    const entry = {
      ...built.entry,
      compiler: snapshot.compiler,
      compilerDigests: undefined,
      configs: built.entry.configs.map(content),
      directories: built.entry.directories.map(([path, , ...listed]) => [path, null, ...listed]),
      installs,
      packages: built.entry.packages.map(content),
      files: built.entry.files.map(content),
      outputs: built.entry.outputs.map(({ paths, code, map }) =>
        ({ paths, code, map: map && { ...map, sourcesContent: undefined } }))
    }
    let text = JSON.stringify(entry)
    if (text.includes(recordBase)) throw new Error(`cannot record ${project}: its compile names ${recordBase}`)
    text = text.replace(new RegExp(escapeRegExp(escaped(base)) + '(?=["/]|\\\\\\\\)', "g"), recordBase)
    const record = { format: recordFormat, base: relative(dirname(file), base).split(sep).join("/") || ".", entry: JSON.parse(text) }
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify(record, null, 1) + "\n")
      renameSync(temporary, file)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw error
    }
    return file
  }

  function lookup() {
    let record
    try {
      record = JSON.parse(readFileSync(file, "utf8"))
    } catch (error) {
      return { miss: error?.code === "ENOENT" ? "no record" : "unreadable record" }
    }
    try {
      return validate(record)
    } catch {
      return { miss: "unreadable record" }
    }
  }

  function validate(record) {
    if (record.format !== recordFormat || typeof record.base !== "string") return { miss: "record of another format" }
    const base = resolve(dirname(file), record.base)
    const entry = JSON.parse(JSON.stringify(record.entry).replaceAll(recordBase, () => escaped(base)))
    if (entry.format !== format || entry.version !== version) return { miss: "record of another version" }
    if (entry.project !== project || entry.root !== root) return { miss: "record of another project" }
    if (entry.compiler !== binaryDigest(compiler)) return { miss: "record of another compiler" }
    const directory = entry.directories.find((record) => !directoryHolds(record))
    if (directory) return { miss: `${directory[0]} gained or lost a file` }
    for (const list of [entry.configs, entry.installs, entry.packages, entry.files]) {
      const changed = list.find((record) => !contentHolds(record))
      if (changed) return { miss: `${changed.path} changed` }
    }
    const outputs = new Map()
    for (const { paths, code, map } of entry.outputs) {
      if (map) map.sourcesContent = map.sources.map((source) => readFileSync(source, "utf8"))
      const output = { code, map }
      for (const path of paths) outputs.set(path, output)
    }
    const files = entry.files.map((record) => record.path)
    return { result: { outputs, inputs: entry.inputs, files, errors: [], warnings: entry.warnings }, files }
  }

  return { file, begin, write, lookup }
}
