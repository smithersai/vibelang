import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)

// Bun's runtime resolve hook does not consistently receive bare package imports.
// Route literal ESM specifiers through the native loader's parsed import pass.
export function registerBunBundler(bundler, wrapperSource) {
  const [major, minor, patch] = Bun.version.split(".").map(Number)
  if (major < 1 || major === 1 && (minor < 4 || minor === 4 && patch < 4)) {
    throw new Error("Bundler register preloads need Bun 1.4.4 or later; on this Bun " + Bun.version +
      ", pass the vibelang-unplugin/" + bundler + " plugin explicitly.")
  }
  const routes = globalThis[Symbol.for("vibelang.bun.import-resolvers")] ??= new Map()
  const namespace = "vibelang-bundler-" + bundler
  Bun.plugin({
    name: namespace,
    setup(build) {
      build.onLoad({ filter: /.*/, namespace }, ({ path }) => ({
        contents: wrapperSource(pathToFileURL(path).href, bundler),
        loader: "js"
      }))
    }
  })
  routes.set(bundler, directory => namespace + ":" + Bun.resolveSync(bundler, directory))
  require("vibelang/bun")
}
