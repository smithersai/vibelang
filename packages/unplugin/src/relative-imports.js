import { existsSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

// A specifier ending in one of these names its file's extension; TypeScript
// removes it before it tries its own (tspath's extensionsToRemove).
const namedExtension = /\.(?:d\.[cm]?ts|[cm]?[jt]s|[jt]sx|json|vibe)$/
// The files TypeScript tries for an extensionless import, in its order.
const implicitExtensions = [".ts", ".tsx", ".vibe", ".d.ts", ".js", ".jsx"]

/**
 * Returns the file TypeScript's Node10 and Bundler resolution picks for the
 * relative import `specifier` written in `directory` when it names no
 * extension: ./x is x.ts, x.tsx, x.vibe, x.d.ts, x.js or x.jsx, in that order,
 * else the directory x's index with the same extensions. It returns
 * undefined when the specifier names an extension, when x is a directory with
 * a package.json, or when no file is there. The loaders and bundlers resolve
 * x.vibe this way, where only TypeScript's own extensions are theirs.
 */
export function extensionlessImport(directory, specifier) {
  if (namedExtension.test(specifier)) return undefined
  const target = resolve(directory, specifier)
  const isFile = (path) => {
    try {
      return statSync(path, { throwIfNoEntry: false })?.isFile() === true
    } catch (error) {
      // Bun throws where a parent is a file, as in a.txt/index.ts; Node returns undefined.
      if (error.code === "ENOTDIR") return false
      throw error
    }
  }
  const stems = /(?:^|[\\/])\.{0,2}$/.test(specifier) ? [] : [target]
  if (!existsSync(join(target, "package.json"))) stems.push(join(target, "index"))
  for (const stem of stems) {
    const found = implicitExtensions.map((extension) => stem + extension).find(isFile)
    if (found !== undefined) return found
  }
  return undefined
}


// The compiler lists existing program files, so a failed relative import is
// absent from that list. Watch its source candidates as well: creating the
// missing file must recover a failed watch build without editing its importer.
export function missingRelativeInputs(diagnostics) {
  const inputs = new Set()
  for (const diagnostic of diagnostics) {
    if (!diagnostic.file) continue
    const specifier = diagnostic.code === "TS2307"
      ? /^Cannot find module '(.+)' or its corresponding type declarations\./.exec(diagnostic.text)?.[1]
      : diagnostic.code === "TS6263"
        ? /^Module '(.+)' was resolved to '.*', but '--allowArbitraryExtensions' is not set\./.exec(diagnostic.text)?.[1]
        : undefined
    if (!specifier || !/^\.\.?(?:[\\/]|$)/.test(specifier)) continue
    const target = resolve(dirname(diagnostic.file), specifier)
    if (/\.(?:vibex?|[cm]?tsx?|json)$/.test(target)) {
      inputs.add(target)
      continue
    }
    // A written JavaScript extension can resolve to a TypeScript or VibeLang
    // source. An extensionless import can also resolve to a directory index.
    const extension = /\.(?:[cm]?js|jsx)$/.exec(target)?.[0]
    const stem = extension ? target.slice(0, -extension.length) : target
    const extensions = extension === ".mjs" ? [".mts", ".d.mts", ".mjs"]
      : extension === ".cjs" ? [".cts", ".d.cts", ".cjs"]
      : implicitExtensions
    for (const suffix of extensions) inputs.add(stem + suffix)
    if (!extension) for (const suffix of implicitExtensions) inputs.add(join(target, "index") + suffix)
  }
  return [...inputs]
}
