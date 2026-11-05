import * as nodeModule from "node:module"

const require = nodeModule.createRequire(import.meta.url)
const apiURL = new URL("./bundler-api.js", import.meta.url).href
const registryKey = Symbol.for("vibelang-unplugin.registered-bundlers")

function wrapperSource(original, bundler, commonjs = false) {
  const methods = bundler === "rolldown" ? ["rolldown", "build", "watch"] : ["build", "context"]
  return [
    `import * as original from ${JSON.stringify(original)}`,
    `import { wrapBundler } from ${JSON.stringify(apiURL)}`,
    `export * from ${JSON.stringify(original)}`,
    `const api = wrapBundler(original, ${JSON.stringify(bundler)})`,
    ...methods.map(name => `export const ${name} = api.${name}`),
    ...(bundler === "esbuild" ? ["export default api.default"] : []),
    ...(commonjs ? [`const required = ${bundler === "esbuild" ? "api.default" : "api"}; export { required as "module.exports" }`] : [])
  ].join("\n")
}

export function registerBundler(bundler) {
  if (typeof Bun !== "undefined") {
    throw new Error("Bundler register preloads require Node; under Bun, pass the vibelang-unplugin/" + bundler + " plugin to the bundler.")
  }
  const registered = globalThis[registryKey] ??= new Set()
  if (registered.has(bundler)) return
  require("vibelang/register")
  const wrappers = new Map()
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context)
      if (specifier !== bundler) return result
      const commonjs = context.conditions.includes("require")
      const url = new URL(result.url)
      // CommonJS keys its module cache by filename, ignoring URL queries.
      // A distinct virtual filename keeps the wrapper separate from the package.
      url.pathname += ".vibelang-" + bundler + (commonjs ? "-require" : "") + ".mjs"
      wrappers.set(url.href, wrapperSource(result.url, bundler, commonjs))
      return { ...result, url: url.href, format: "module" }
    },
    load(url, context, nextLoad) {
      const source = wrappers.get(url)
      return source === undefined ? nextLoad(url, context) : { format: "module", source, shortCircuit: true }
    }
  })
  registered.add(bundler)
  if (process.env.VIBELANG_UNPLUGIN_DEBUG) console.error(`vibelang-unplugin: registered ${bundler} source bundles`)
}
