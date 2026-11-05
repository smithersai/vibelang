import { createRequire } from "node:module"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)

// Bun's runtime resolve hook does not consistently receive bare package imports.
// The native loader's parsed import pass routes literal ESM imports to real
// modules, including on Bun versions whose dynamic imports miss plugin namespaces.
export function registerBunBundler(bundler, wrapperSource) {
  const [major, minor, patch] = Bun.version.split(".").map(Number)
  if (major < 1 || major === 1 && (minor < 4 || minor === 4 && patch < 1)) {
    throw new Error("Bundler register preloads need Bun 1.4.1 or later; on this Bun " + Bun.version +
      ", pass the vibelang-unplugin/" + bundler + " plugin explicitly.")
  }
  const routes = globalThis[Symbol.for("vibelang.bun.import-resolvers")] ??= new Map()
  const wrappers = new Map()
  let temporary
  routes.set(bundler, directory => {
    const original = Bun.resolveSync(bundler, directory)
    if (!wrappers.has(original)) {
      if (!temporary) {
        temporary = mkdtempSync(join(tmpdir(), "vibelang-bundlers-"))
        process.once("exit", () => {
          try { rmSync(temporary, { recursive: true, force: true }) }
          catch (error) {
            if (process.env.VIBELANG_UNPLUGIN_DEBUG) console.error(`vibelang-unplugin: wrapper cleanup failed (${error.code})`)
          }
        })
      }
      const path = join(temporary, wrappers.size + ".mjs")
      writeFileSync(path, wrapperSource(pathToFileURL(original).href, bundler), { mode: 0o600 })
      wrappers.set(original, pathToFileURL(path).href)
    }
    return wrappers.get(original)
  })
  require("vibelang/bun")
}
