import { readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const sourceExtension = /\.(?:tsx?|vibex?)$/
const declaration = /\.d\.(?:ts|vibex?\.ts)$/

function stat(file) {
  try {
    return statSync(file)
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined
    throw error
  }
}

/**
 * Source files immediately inside directory, sorted by path. Declaration
 * outputs and directories are excluded; file symlinks follow normal fs rules.
 */
export function listSources(directory) {
  const root = resolve(directory)
  return readdirSync(root).filter(name => sourceExtension.test(name) && !declaration.test(name))
    .map(name => join(root, name)).filter(file => stat(file)?.isFile()).sort()
}

/**
 * An opt-in source-text lookup for tools whose references survived a rename.
 * An existing exact file wins. Only an absent .ts/.tsx source name tries its
 * .vibe/.vibex sibling. This does not change module import resolution.
 */
export function resolveSource(file) {
  const exact = resolve(file)
  const found = stat(exact)
  if (found) return found.isFile() ? exact : undefined
  if (declaration.test(exact) || !/\.tsx?$/.test(exact)) return undefined
  const native = exact.replace(/\.ts(x?)$/, ".vibe$1")
  return stat(native)?.isFile() ? native : undefined
}

export { fileHasVibeDirective, hasVibeDirective, isVibeLangFile } from "./vibe-directive.mjs"
