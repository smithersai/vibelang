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

/** The .vibe source of a file in a package's emitted JavaScript, or undefined. */
export function sourceOfEmitted(path) {
  if (typeof path !== "string" || !path.endsWith(".js")) return undefined
  const at = path.lastIndexOf(marker)
  if (at < 0) return undefined
  const source = path.slice(0, at) + sep + path.slice(at + marker.length, -".js".length) + ".vibe"
  return existsSync(source) ? source : undefined
}

/**
 * The module Bun's runtime loads for an emitted file whose source is source: a
 * re-export of the source module. Bun's runtime calls no onResolve for an
 * import it resolves itself, so the emitted path stays, and re-exporting keeps
 * one instance of the source module for the package's own relative imports
 * and its consumers' package imports alike.
 */
export function reexportOf(source) {
  const name = JSON.stringify(source)
  return `export * from ${name}\nimport * as source from ${name}\nexport default source.default\n`
}
