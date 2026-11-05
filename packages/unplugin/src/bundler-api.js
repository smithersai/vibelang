import rolldownPlugin from "./rolldown.js"
import esbuildPlugin from "./esbuild.js"

const apis = { rolldown: new WeakMap(), esbuild: new WeakMap() }

async function pluginsWithNative(plugins) {
  const flat = []
  async function visit(value) {
    value = await value
    if (Array.isArray(value)) {
      for (const item of value) await visit(item)
    }
    else if (value) flat.push(value)
  }
  await visit(plugins)
  return flat.some(plugin => plugin.name === "vibelang") ? flat : [...flat, rolldownPlugin()]
}

function rolldownOptions(options) {
  if (Array.isArray(options)) return options.map(rolldownOptions)
  if (!options || typeof options !== "object") return options
  // Rolldown awaits nested plugin promises, including for synchronous watch().
  return { ...options, plugins: [pluginsWithNative(options.plugins)] }
}

function esbuildOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return options
  if (options.plugins !== undefined && !Array.isArray(options.plugins)) return options
  const plugins = options.plugins || []
  return { ...options, plugins: plugins.some(plugin => plugin?.name === "vibelang")
    ? [...plugins]
    : [...plugins, esbuildPlugin()] }
}

export function wrapBundler(original, bundler) {
  const cached = apis[bundler].get(original)
  if (cached) return cached
  const api = { ...original }
  const names = bundler === "rolldown" ? ["rolldown", "build", "watch"] : ["build", "context"]
  const configure = bundler === "rolldown" ? rolldownOptions : esbuildOptions
  for (const name of names) {
    if (typeof original[name] !== "function") continue
    api[name] = new Proxy(original[name], {
      apply(target, receiver, args) {
        return Reflect.apply(target, receiver, [configure(args[0]), ...args.slice(1)])
      }
    })
  }
  if (bundler === "esbuild" && original.default) {
    api.default = { ...original.default, build: api.build, context: api.context }
  }
  apis[bundler].set(original, api)
  return api
}
