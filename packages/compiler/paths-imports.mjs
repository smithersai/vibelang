import { readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, isAbsolute, resolve } from "node:path"
import { extensionlessImport } from "./relative-imports.mjs"

// A tsconfig is JSON with comments and trailing commas (JSONC).
function parseConfig(text) {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      const start = i
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++
      out += text.slice(start, i + 1)
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2)
      if (i < 0) break
      i++
    } else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"))
}

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() === true

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
    let parsed
    try { parsed = parseConfig(readFileSync(config, "utf8")) } catch { parsed = undefined }
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

// The pattern of paths that specifier matches: an exact key, else the key
// with one `*` whose prefix is longest, as TypeScript's matchPatternOrExact.
function matchingPattern(paths, specifier) {
  if (Object.hasOwn(paths, specifier) && !specifier.includes("*")) return { key: specifier, star: "" }
  let best
  for (const key of Object.keys(paths)) {
    const star = key.indexOf("*")
    if (star < 0 || key.indexOf("*", star + 1) >= 0) continue
    const prefix = key.slice(0, star), suffix = key.slice(star + 1)
    if (specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix) &&
        (best === undefined || prefix.length > best.prefix)) {
      best = { key, prefix: prefix.length, star: specifier.slice(prefix.length, specifier.length - suffix.length) }
    }
  }
  return best
}

// The file TypeScript loads for path, a substitution made absolute: the file
// itself when it names a .vibe or .ts-family extension, the .vibe or
// TypeScript source of a .js name (D298), else extensionlessImport's rule.
function loadFile(path) {
  if (/\.(?:vibe|d\.[cm]?ts|[cm]?ts|tsx|json)$/.test(path)) return isFile(path) ? path : undefined
  if (/\.js$/.test(path)) {
    const stem = path.slice(0, -".js".length)
    return [".ts", ".tsx", ".vibe", ".d.ts", ".js"].map((extension) => stem + extension).find(isFile)
  }
  if (/\.(?:[cm]js|jsx)$/.test(path)) return isFile(path) ? path : undefined
  return extensionlessImport(dirname(path), "./" + basename(path) + (/[\\/]$/.test(path) ? "/" : ""))
}

/**
 * Returns the file TypeScript resolves the non-relative import `specifier`,
 * written in `directory`, to through the `paths` of `config`: the first
 * substitution of the matching pattern that names a file, or undefined when
 * no pattern matches or no substitution resolves, where TypeScript goes on to
 * node_modules. A loader that finds .vibe only for relative imports misses a
 * `@/x` alias to x.vibe; this is the alias half of extensionlessImport.
 */
export function aliasImport(config, specifier) {
  if (config === undefined || specifier.startsWith("./") || specifier.startsWith("../") || isAbsolute(specifier)) return undefined
  const options = pathsOf(config)
  if (options?.paths === undefined) return undefined
  const match = matchingPattern(options.paths, specifier)
  if (match === undefined) return undefined
  const base = options.baseUrl ?? options.pathsBase
  for (const substitution of [options.paths[match.key]].flat()) {
    if (typeof substitution !== "string") continue
    const found = loadFile(resolve(base, substitution.replace("*", match.star)))
    if (found !== undefined) return found
  }
  return undefined
}

/** Forgets the configs read so far, for a process that edits them. */
export function forgetPaths() { settings.clear() }
