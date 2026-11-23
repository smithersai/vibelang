import { readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, isAbsolute, resolve } from "node:path"
import { extensionlessImport } from "./relative-imports.js"

// A tsconfig is JSON with comments and trailing commas (JSONC), and may start with a UTF-8 BOM.
function parseConfig(text) {
  const len = text.length
  const start = len > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0
  let out = ""
  let chunkStart = start
  for (let i = start; i < len; i++) {
    const ch = text.charCodeAt(i)
    if (ch === 34 /* " */) {
      for (i++; i < len; i++) {
        const c = text.charCodeAt(i)
        if (c === 92 /* \\ */) i++
        else if (c === 34 /* " */) break
      }
    } else if (ch === 47 /* / */ && i + 1 < len) {
      const next = text.charCodeAt(i + 1)
      if (next === 47 /* / */) {
        out += text.slice(chunkStart, i)
        const nl = text.indexOf("\n", i + 2)
        if (nl === -1) {
          out += "\n"
          chunkStart = len
          break
        }
        i = nl
        chunkStart = nl
      } else if (next === 42 /* * */) {
        out += text.slice(chunkStart, i) + " "
        const end = text.indexOf("*/", i + 2)
        if (end === -1) {
          chunkStart = len
          break
        }
        i = end + 1
        chunkStart = end + 2
      }
    } else if (ch === 44 /* , */) {
      let next = i + 1
      while (next < len) {
        const nc = text.charCodeAt(next)
        if (nc === 32 || nc === 9 || nc === 10 || nc === 13 || nc === 12 || nc === 11 || nc === 0xfeff || nc === 0xa0) {
          next++
        } else if (nc === 47 /* / */ && next + 1 < len) {
          const nn = text.charCodeAt(next + 1)
          if (nn === 47) {
            const nl = text.indexOf("\n", next + 2)
            next = nl === -1 ? len : nl + 1
          } else if (nn === 42) {
            const end = text.indexOf("*/", next + 2)
            next = end === -1 ? len : end + 2
          } else break
        } else break
      }
      if (next < len && (text.charCodeAt(next) === 125 /* } */ || text.charCodeAt(next) === 93 /* ] */)) {
        out += text.slice(chunkStart, i)
        chunkStart = i + 1
      }
    }
  }
  if (chunkStart < len) out += text.slice(chunkStart)
  return JSON.parse(out)
}

const isFile = (path) => {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() === true
  } catch (error) {
    // Bun throws when a directory probe descends through an existing asset.
    if (error.code === "ENOTDIR") return false
    throw error
  }
}

// The file an extends entry names: a path relative to the config, or a
// package's file, with tsconfig's `.json` and `/tsconfig.json` defaults.
function extendedConfig(from, name) {
  if (name.startsWith("./") || name.startsWith("../") || isAbsolute(name)) {
    const path = resolve(dirname(from), name)
    return isFile(path) ? path : isFile(path + ".json") ? path + ".json" : undefined
  }
  const require = createRequire(from)
  for (const request of [name, name + ".json", name + "/tsconfig.json"]) {
    try {
      const path = require.resolve(request)
      if (path.endsWith(".json")) return path
    } catch { /* the next form */ }
  }
  return undefined
}

const settings = new Map()
const rootDirsCache = new Map()
const jsxCache = new Map()
const parsedConfigs = new Map()
const compiledPatterns = new WeakMap()

function readParsedConfig(config) {
  if (parsedConfigs.has(config)) return parsedConfigs.get(config)
  let parsed
  try { parsed = parseConfig(readFileSync(config, "utf8")) } catch { parsed = undefined }
  parsedConfigs.set(config, parsed)
  return parsed
}

/**
 * Returns the `paths` a tsconfig sets, through its `extends` chain, with the
 * directory its substitutions are relative to: the `baseUrl` when one is set,
 * else the directory of the config that wrote `paths`, as TypeScript reads
 * them. It returns undefined for a config with no `paths`.
 */
export function pathsOf(config, seen = new Set()) {
  if (settings.has(config)) return settings.get(config)
  let result
  if (!seen.has(config)) {
    seen.add(config)
    const parsed = readParsedConfig(config)
    const options = parsed?.compilerOptions ?? {}
    let inherited = { paths: undefined, pathsBase: undefined, baseUrl: undefined }
    const parents = parsed?.extends === undefined ? [] : [parsed.extends].flat()
    for (const parent of parents) {
      const path = typeof parent === "string" ? extendedConfig(config, parent) : undefined
      const from = path === undefined ? undefined : pathsOf(path, seen)
      if (from?.paths !== undefined) inherited = { ...inherited, paths: from.paths, pathsBase: from.pathsBase }
      if (from?.baseUrl !== undefined) inherited = { ...inherited, baseUrl: from.baseUrl }
    }
    const own = {
      paths: options.paths ?? inherited.paths,
      pathsBase: options.paths !== undefined ? dirname(config) : inherited.pathsBase,
      baseUrl: typeof options.baseUrl === "string" ? resolve(dirname(config), options.baseUrl) : inherited.baseUrl
    }
    result = own.paths === undefined && own.baseUrl === undefined ? undefined : own
  }
  settings.set(config, result)
  return result
}

function compilePaths(paths) {
  let compiled = compiledPatterns.get(paths)
  if (compiled !== undefined) return compiled
  const wildcards = []
  for (const key of Object.keys(paths)) {
    const star = key.indexOf("*")
    if (star < 0 || key.indexOf("*", star + 1) >= 0) continue
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    wildcards.push({ key, prefix, suffix, prefixLen: prefix.length, suffixLen: suffix.length, minLen: prefix.length + suffix.length })
  }
  // Stable sort by descending prefix length so the first match is longest-prefix, preserving key order on ties.
  wildcards.sort((a, b) => b.prefixLen - a.prefixLen)
  compiled = { wildcards }
  compiledPatterns.set(paths, compiled)
  return compiled
}

// The pattern of paths that specifier matches: an exact key, else the key
// with one `*` whose prefix is longest, as TypeScript's matchPatternOrExact.
function matchingPattern(paths, specifier) {
  if (Object.hasOwn(paths, specifier) && !specifier.includes("*")) return { key: specifier, star: "" }
  const { wildcards } = compilePaths(paths)
  const specLen = specifier.length
  for (let i = 0; i < wildcards.length; i++) {
    const entry = wildcards[i]
    if (specLen >= entry.minLen && specifier.startsWith(entry.prefix) && specifier.endsWith(entry.suffix)) {
      return { key: entry.key, prefix: entry.prefixLen, star: specifier.slice(entry.prefixLen, specLen - entry.suffixLen) }
    }
  }
  return undefined
}

// The file TypeScript loads for path, a substitution made absolute: the file
// itself when it names a .vibe or .ts-family extension, the declaration file
// of a .vibe name with no source, as in a published package, the .vibe or
// TypeScript source of a .js name (D298), else extensionlessImport's rule.
function loadFile(path, migratedTypeScript = false, fileExists = isFile) {
  if (/\.vibex?$/.test(path)) return [path, path.replace(/\.vibex?$/, ".d.ts")].find(fileExists)
  if (migratedTypeScript && path.endsWith(".ts") && !path.endsWith(".d.ts")) {
    const stem = path.slice(0, -3)
    // TypeScript reaches x.vibe through its native declaration x.d.ts, which
    // re-exports it (VIP-27); a runtime loads the module, never the declaration.
    const found = [path, stem + ".tsx", stem + ".d.ts", stem + ".vibe"].find(fileExists)
    return found === stem + ".d.ts" && fileExists(stem + ".vibe") ? stem + ".vibe" : found
  }
  if (/\.(?:d\.[cm]?ts|[cm]?ts|tsx|json)$/.test(path)) return fileExists(path) ? path : undefined
  if (/\.jsx?$/.test(path)) {
    const stem = path.replace(/\.jsx?$/, "")
    return (path.endsWith(".jsx") ? [".tsx", ".ts", ".vibex", ".vibe", ".d.ts", ".jsx", ".js"] : [".ts", ".tsx", ".vibe", ".vibex", ".d.ts", ".js"]).map((extension) => stem + extension).find(fileExists)
  }
  if (/\.(?:[cm]js|jsx)$/.test(path)) return fileExists(path) ? path : undefined
  return extensionlessImport(dirname(path), "./" + basename(path) + (/[\\/]$/.test(path) ? "/" : ""), fileExists)
}

/**
 * Returns the file TypeScript resolves the non-relative import `specifier`,
 * written in `directory`, to through the `paths` of `config`: the first
 * substitution of the matching pattern that names a file, or undefined when
 * no pattern matches or no substitution resolves, where TypeScript goes on to
 * node_modules. A loader that finds .vibe only for relative imports misses a
 * `@/x` alias to x.vibe; this is the alias half of extensionlessImport.
 * The Bun runtime opts into migrated TypeScript names for native launchers;
 * ordinary resolver callers keep their written TypeScript extension rules.
 * A build adapter can include in-memory files through fileExists.
 */
export function aliasImport(config, specifier, { migratedTypeScript = false, fileExists = isFile } = {}) {
  if (config === undefined || specifier.startsWith("./") || specifier.startsWith("../") || isAbsolute(specifier)) return undefined
  const options = pathsOf(config)
  if (options?.paths === undefined) return undefined
  const match = matchingPattern(options.paths, specifier)
  if (match === undefined) return undefined
  const base = options.baseUrl ?? options.pathsBase
  for (const substitution of [options.paths[match.key]].flat()) {
    if (typeof substitution !== "string") continue
    const found = loadFile(resolve(base, substitution.replace("*", match.star)), migratedTypeScript, fileExists)
    if (found !== undefined) return found
  }
  return undefined
}

/** Forgets the configs read so far, for a process that edits them. */
export function forgetPaths() {
  settings.clear()
  rootDirsCache.clear()
  jsxCache.clear()
  parsedConfigs.clear()
}

/**
 * compilerOptions.rootDirs as absolute paths, including inherited configs:
 * each relative to the config that sets it, `${configDir}` to the first.
 */
export function rootDirsOf(config, seen = new Set(), leaf = config) {
  if (config === undefined) return undefined
  const cacheKey = config === leaf ? config : `${config}\0${leaf}`
  if (seen.size === 0 && rootDirsCache.has(cacheKey)) return rootDirsCache.get(cacheKey)
  if (seen.has(config)) return undefined
  seen.add(config)
  const parsed = readParsedConfig(config)
  if (parsed === undefined) {
    seen.delete(config)
    if (seen.size === 0) rootDirsCache.set(cacheKey, undefined)
    return undefined
  }
  let inherited
  const parents = parsed.extends === undefined ? [] : [parsed.extends].flat()
  for (const parent of parents) {
    const path = typeof parent === "string" ? extendedConfig(config, parent) : undefined
    const rootDirs = path === undefined ? undefined : rootDirsOf(path, seen, leaf)
    if (rootDirs !== undefined) inherited = rootDirs
  }
  seen.delete(config)
  const own = parsed.compilerOptions?.rootDirs
  const result = Array.isArray(own) ? own.filter(dir => typeof dir === "string").map(dir => resolve(dirname(config), dir.replaceAll("${configDir}", dirname(leaf)))) : inherited
  if (seen.size === 0) rootDirsCache.set(cacheKey, result)
  return result
}

/** JSX output mode, including inherited configs, for emitted-source lookup. */
export function jsxOf(config, seen = new Set()) {
  if (config === undefined) return undefined
  if (seen.size === 0 && jsxCache.has(config)) return jsxCache.get(config)
  if (seen.has(config)) return undefined
  seen.add(config)
  const parsed = readParsedConfig(config)
  if (parsed === undefined) {
    seen.delete(config)
    if (seen.size === 0) jsxCache.set(config, undefined)
    return undefined
  }
  let inherited
  const parents = parsed.extends === undefined ? [] : [parsed.extends].flat()
  for (const parent of parents) {
    const path = typeof parent === "string" ? extendedConfig(config, parent) : undefined
    const jsx = path === undefined ? undefined : jsxOf(path, seen)
    if (jsx !== undefined) inherited = jsx
  }
  seen.delete(config)
  const result = parsed.compilerOptions?.jsx ?? inherited
  if (seen.size === 0) jsxCache.set(config, result)
  return result
}
