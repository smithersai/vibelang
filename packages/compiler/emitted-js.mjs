// A migrated package's emitted JavaScript, for consumers that load no VibeLang
// plugin. The migrate flow commits each migrated package's emit under
// <package>/.vibelang/js/ and points the package's `default` export at it, so
// the `bun build` CLI and plain Node read JavaScript (opencode-32):
//
//   "./skill": { "types": "./src/skill.d.vibe.ts", "vibelang-source": "./src/skill.vibe",
//                "default": "./.vibelang/js/src/skill.js" }
//
// The loaders run the source instead: a module resolved to
// <package>/.vibelang/js/<path>.js is <package>/<path>.vibe when that exists.
import { existsSync } from "node:fs"
import { sep } from "node:path"

export const emittedDirectory = ".vibelang/js"
const marker = `${sep}.vibelang${sep}js${sep}`

/** The source of a file in a package's emitted JavaScript, or undefined. */
export function sourceOfEmitted(path) {
  if (typeof path !== "string" || !/\.(?:[cm]?js|jsx)$/.test(path)) return undefined
  const at = path.lastIndexOf(marker)
  if (at < 0) return undefined
  const extension = /\.(?:[cm]?js|jsx)$/.exec(path)[0]
  const stem = path.slice(0, at) + sep + path.slice(at + marker.length, -extension.length)
  const extensions = extension === ".mjs" ? [".mts", ".mjs"] : extension === ".cjs" ? [".cts", ".cjs"] : extension === ".jsx" ? [".tsx", ".jsx"] : [".ts", ".tsx", ".vibe", ".js"]
  return extensions.map(suffix => stem + suffix).find(source => existsSync(source))
}

/**
 * The module Bun's runtime loads for an emitted file whose source is source: a
 * re-export of the source module. Bun's runtime calls no onResolve for an
 * import it resolves itself, so the emitted path stays, and re-exporting keeps
 * one instance of the source module for the package's own relative imports
 * and its consumers' package imports alike. It exports `default` only when the
 * source has one (hasDefault), since `export *` never re-exports it: an
 * unconditional `export default source.default` gave a source with none an
 * undefined `default` key, so opencode's CLI `run` entry had 3 keys under the
 * preload and 2 without it.
 */
export function reexportOf(source, hasDefault) {
  const name = JSON.stringify(source)
  return hasDefault
    ? `export * from ${name}\nimport * as source from ${name}\nexport default source.default\n`
    : `export * from ${name}\n`
}
