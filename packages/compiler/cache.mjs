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
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir, userInfo } from "node:os"
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path"

// Bump when an entry's shape or meaning changes. 2: a compile checks only
// its project's own files (vibelang --loader-root).
// 3: loaders retain emission and select diagnostics per loaded source.
// 4: source maps name sources by absolute path again, not file URL.
const format = 4
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
  return { path: join(tmpdir(), `vibelang-cache-${owner()}`), shared: false }
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
function recordFile(path, since) {
  const dependency = isDependency(path)
  const before = statOf(path)
  if (before === undefined || racy(before, since, dependency)) return undefined
  if (dependency) return { path, stamp: stampOf(before) }
  const hash = digest(readFileSync(path))
  const after = statOf(path)
  if (after === undefined || !sameStamp(stampOf(before), stampOf(after), false)) return undefined
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
    const parts = spec.split(/[\\/]/)
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
  return { roots, skip }
}

// What a directory holds that could become part of a program: its source
// files and subdirectories, without the dotted names TypeScript's globs skip.
const sourceName = /\.(?:[cm]?[jt]sx?|vibe|json)$/i
function listing(path) {
  let entries
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch {
    return { names: null, directories: [] }
  }
  const names = []
  const directories = []
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    let directory = entry.isDirectory()
    if (entry.isSymbolicLink()) directory = statOf(join(path, entry.name))?.isDirectory() ?? false
    if (directory) {
      names.push(`${entry.name}/`)
      directories.push(join(path, entry.name))
    } else if (sourceName.test(entry.name)) names.push(entry.name)
  }
  return { names: digest(names.sort().join("\n")), directories: directories.sort() }
}

const ignoredDirectories = new Set(["node_modules", "bower_components", "jspm_packages"])

// Records each scanned directory's stamp and listing before the compile, so a
// file added or removed while the compiler runs shows up as a change.
function snapshotDirectories(main) {
  const { roots, skip } = scannedDirectories(main)
  const records = new Map()
  const visit = (path, recursive, depth) => {
    if (records.has(path) || skip.has(path)) return
    const stat = statOf(path)
    const { names, directories } = listing(path)
    records.set(path, [path, stat === undefined ? null : [stat.mtimeMs, stat.ino], names])
    if (!recursive || depth > 64) return
    for (const child of directories) if (!ignoredDirectories.has(basename(child))) visit(child, true, depth + 1)
  }
  for (const root of roots) visit(root.path, root.recursive, 0)
  return [...records.values()]
}

function directoryHolds([path, stamp, names]) {
  const stat = statOf(path)
  if (stat !== undefined && stamp !== null && stat.mtimeMs === stamp[0] && stat.ino === stamp[1]) return true
  return listing(path).names === names
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
    if (JSON.stringify(entry.compiler) !== JSON.stringify(identity)) return { miss: "compiler changed" }
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
      return {
        started,
        compiler: compilerIdentity(compiler),
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
    const records = []
    const packages = new Map()
    const nearest = new Map()
    for (const path of files) {
      const record = recordFile(path, snapshot.started)
      if (record === undefined) return debug(`not caching ${project}: ${path} changed during or too close to the compile`)
      records.push(record)
      const manifest = nearestFile(dirname(path), "package.json", nearest)
      if (manifest !== null && !packages.has(manifest)) packages.set(manifest, undefined)
    }
    for (const path of packages.keys()) {
      const record = recordFile(path, snapshot.started)
      if (record === undefined) return debug(`not caching ${project}: ${path} changed during or too close to the compile`)
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
      const record = recordFile(path, snapshot.started)
      if (record === undefined) return debug(`not caching ${project}: ${path} changed during or too close to the compile`)
      settings.set(path, record)
    }
    const outputs = new Map()
    for (const [path, output] of result.outputs) {
      const existing = outputs.get(output)
      if (existing) existing.paths.push(path)
      else outputs.set(output, { paths: [path], code: output.code, map: output.map })
    }
    const entry = {
      format, version, project, root,
      compiler: snapshot.compiler,
      configs: [...snapshot.configs, ...settings.values()],
      directories: snapshot.directories,
      installs: snapshot.installs,
      packages: [...packages.values()],
      files: records,
      inputs: result.inputs,
      warnings: result.warnings,
      outputs: [...outputs.values()]
    }
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
