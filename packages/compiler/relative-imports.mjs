import { existsSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

// A specifier ending in one of these names its file's extension; TypeScript
// removes it before it tries its own (tspath's extensionsToRemove).
const namedExtension = /\.(?:d\.[cm]?ts|[cm]?[jt]s|[jt]sx|json|vibe)$/
// The files TypeScript tries for an extensionless import, in its order.
const implicitExtensions = [".ts", ".tsx", ".vibe", ".d.ts", ".js", ".jsx"]

/**
 * Returns the file TypeScript's Bundler resolution picks (TypeScript 7 removed
 * Node10: TS5108) for the
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

