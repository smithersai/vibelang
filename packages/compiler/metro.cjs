"use strict"
// vibelang/metro: Metro bundles .vibe modules.
//
//   // metro.config.js
//   module.exports = require("vibelang/metro").withVibeLang(config)
//
// withVibeLang adds .vibe to the resolver's source extensions, after
// TypeScript's, and makes this module the Babel transformer. The app's own
// transformer (config.transformer.babelTransformerPath, else Metro's default,
// metro-babel-transformer) stays in place behind it: for a .vibe module it
// receives the module's JavaScript from its project's compile
// (vibelang/emit), and the syntax tree it returns is moved back to .vibe
// positions, so Metro's source maps name .vibe lines. Every other module
// reaches it unchanged.
//
// Metro's transform cache keys a module by its own text, but a .vibe module's
// JavaScript also depends on the contracts of the modules it imports. After a
// change that alters how an importer compiles, restart Metro with
// --reset-cache.
const { createRequire } = require("node:module")
const { isAbsolute, join, resolve } = require("node:path")

// The app's transformer reaches Metro's transform workers, which load this
// module by path, through the environment the workers inherit.
const upstreamVariable = "VIBELANG_METRO_TRANSFORMER"
const transformerPath = __filename

const fromRoot = (root, request) => createRequire(join(root ?? process.cwd(), "package.json")).resolve(request)

/** Metro's own source extensions when a config names none. */
function defaultSourceExts(root) {
  try {
    return require(fromRoot(root, "metro-config/src/defaults/defaults")).sourceExts
  } catch {
    return ["js", "jsx", "json", "ts", "tsx"]
  }
}

// The path of the transformer a config names: a path, or a package Metro's
// worker would resolve from Metro's own location, as Metro's default config
// names metro-babel-transformer.
function transformerOf(root, name) {
  if (isAbsolute(name)) return name
  try {
    return fromRoot(root, name)
  } catch {
    return createRequire(fromRoot(root, "metro-transform-worker")).resolve(name)
  }
}

/**
 * The Metro config `config` with .vibe modules: .vibe in
 * resolver.sourceExts, and this module as the Babel transformer before the
 * one `config` names. `config` may be a config, a promise of one, or a
 * function of Metro's default config that returns either.
 */
function withVibeLang(config) {
  if (typeof config === "function") return (...args) => withVibeLang(config(...args))
  if (typeof config?.then === "function") return config.then(withVibeLang)
  const root = config.projectRoot
  const transformer = config.transformer ?? {}
  const upstream = transformerOf(root, transformer.babelTransformerPath ?? "metro-babel-transformer")
  if (upstream !== transformerPath) process.env[upstreamVariable] = upstream
  const sourceExts = config.resolver?.sourceExts ?? defaultSourceExts(root)
  return {
    ...config,
    resolver: { ...config.resolver, sourceExts: sourceExts.includes("vibe") ? sourceExts : [...sourceExts, "vibe"] },
    transformer: { ...transformer, babelTransformerPath: transformerPath }
  }
}

function upstream() {
  const path = process.env[upstreamVariable]
  if (!path) throw new Error(`vibelang/metro: ${upstreamVariable} is not set; wrap the Metro config in withVibeLang`)
  return require(path)
}

let emit
const vibelangEmit = () => (emit ??= require("./emit.mjs"))

/** Metro's Babel transformer interface: { filename, src, options, plugins } to { ast, metadata }. */
function transform(args) {
  const file = isAbsolute(args.filename) ? args.filename : resolve(args.options?.projectRoot ?? process.cwd(), args.filename)
  const { toolSource, remapLocations } = vibelangEmit()
  const source = file.endsWith(".vibe") ? toolSource(file, args.src) : undefined
  if (source === undefined) return upstream().transform(args)
  const moved = (result) => {
    if (result?.ast) remapLocations(result.ast, source.map)
    return result
  }
  const result = upstream().transform({ ...args, src: source.code })
  return typeof result?.then === "function" ? result.then(moved) : moved(result)
}

function getCacheKey(...args) {
  const own = `vibelang/metro:${require("./package.json").version}:${process.env[upstreamVariable] ?? ""}`
  const inner = upstream().getCacheKey?.(...args)
  return inner === undefined ? own : `${own}$${inner}`
}

module.exports = { withVibeLang, transform, getCacheKey }
