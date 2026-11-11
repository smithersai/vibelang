"use strict"
// vibelang/metro: Metro bundles .vibe and .vibex modules.
//
//   // metro.config.cjs (an app's package.json has "type": "module")
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
// A module declaration's body compiles to a module of its own beside the
// file's, main.vibe.text.js for `module text` in main.vibe (VIP-40), and the
// file's JavaScript imports it by that name. No such file is on disk, and
// Metro transforms only files its file map found when it started. So
// withVibeLang writes a stand-in for each body before Metro starts, at the
// output's absolute path under node_modules/.cache/vibelang-metro in the
// project root; the resolver sends a body's name there, and the transformer
// serves the compile's output for it, under the output's own name.
//
// Metro's transform cache keys a module by its own text, but a .vibe module's
// JavaScript also depends on the contracts of the modules it imports. After a
// change that alters how an importer compiles, restart Metro with
// --reset-cache. A stand-in holds its file's text, so a body's key follows
// its file's.
const { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } = require("node:fs")
const { createRequire } = require("node:module")
const { dirname, isAbsolute, join, relative, resolve, sep } = require("node:path")

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

// A compile rewrites a .vibe module's relative imports to the emitted names, so
// ./a.ts reaches Metro as ./a.js. From source, those names are the files beside
// the module, as for vibelang/register.
const sources = { ".js": [".vibe", ".vibex", ".ts", ".tsx"], ".jsx": [".vibex", ".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] }
const isVibeLang = (file) => /\.vibex?$/.test(file)

let project
const vibelangProject = () => (project ??= require("./project.mjs"))

// The .vibe or .vibex file whose module declaration compiles to `path` when
// that output is not on disk, else undefined.
function bodySource(path) {
  const source = vibelangProject().moduleDeclarationSource(path)
  return source !== undefined && !existsSync(path) && existsSync(source) ? source : undefined
}

const standIns = join("node_modules", ".cache", "vibelang-metro")
const standInMarker = sep + standIns + sep
const standInOf = (root, output) => join(root, standIns, output.replace(/^([A-Za-z]):/, "$1"))
// The body output a stand-in stands for, or undefined when `path` is none.
function outputOf(path) {
  const at = path?.indexOf(standInMarker) ?? -1
  if (at === -1) return undefined
  const rest = path.slice(at + standInMarker.length)
  const output = sep === "/" ? "/" + rest : rest.replace(/^([A-Za-z])\\/, "$1:\\")
  return bodySource(output) === undefined ? undefined : output
}

// Writes `text` to the stand-in at `path` unless it already holds it, in one
// step, so Metro never reads half a file.
function writeStandIn(path, text) {
  try {
    if (readFileSync(path, "utf8") === text) return
  } catch {}
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, text)
  renameSync(temporary, path)
}

// `module name {` at the start of a top-level statement (VIP-40): at a line's
// start, or after `;`, `}` or the end of a comment, with no line break
// between `module` and the name. The scan reads text, not syntax, so a
// comment or string that looks like a declaration adds a stand-in that
// nothing requests.
const escape = String.raw`\\u(?:[0-9A-Fa-f]{4}|\{[0-9A-Fa-f]+\})`
const space = String.raw`(?:[^\S\r\n\u2028\u2029]|/\*(?:(?!\*/)[^\r\n\u2028\u2029])*\*/)`
const gap = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\r\n\u2028\u2029]*)*`
const declaration = new RegExp(
  String.raw`(?:^|[;}]|\*/)${space}*module${space}+((?:[\p{ID_Start}$_]|${escape})(?:[\p{ID_Continue}$\u200C\u200D]|${escape})*)${gap}\{`,
  "gmu"
)

// A module name's part of its output's file name (VIP-40): a-z, 0-9 and _
// stay; every other code point of the decoded name becomes -, its code point
// in lowercase hexadecimal, and -. So `module Über` is main.vibe.-dc-ber.js.
function fileNamePart(name) {
  let decoded
  try {
    decoded = name.replace(/\\u(?:\{([0-9A-Fa-f]+)\}|([0-9A-Fa-f]{4}))/g, (_, braced, four) => String.fromCodePoint(parseInt(braced ?? four, 16)))
  } catch {
    return undefined
  }
  return Array.from(decoded, (character) => /^[a-z0-9_]$/.test(character) ? character : `-${character.codePointAt(0).toString(16)}-`).join("")
}

// The outputs of the module declarations that `file`, holding `text`,
// declares: main.vibe.text.js, and for a .vibex file main.vibex.text.jsx too,
// its name under preserved JSX.
function declaredBodies(file, text) {
  const outputs = []
  for (const [, name] of text.matchAll(declaration)) {
    const part = fileNamePart(name)
    if (part === undefined) continue
    outputs.push(`${file}.${part}.js`)
    if (file.endsWith(".vibex")) outputs.push(`${file}.${part}.jsx`)
  }
  return outputs
}

function writeStandIns(root, file, text) {
  for (const output of declaredBodies(file, text)) writeStandIn(standInOf(root, output), text)
}

// Writes the stand-ins of the bodies that the .vibe and .vibex files under
// `directories` declare. Like Metro, the walk follows directory links; it
// skips dot directories and node_modules, whose modules Metro reaches as
// JavaScript.
function prepareStandIns(root, directories) {
  const visited = new Set()
  const walk = (directory) => {
    let real
    try {
      real = realpathSync(directory)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)
    let entries
    try {
      entries = readdirSync(real, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue
      const path = join(real, entry.name)
      if (entry.isDirectory() || entry.isSymbolicLink()) walk(path)
      else if (entry.isFile() && isVibeLang(entry.name)) writeStandIns(root, path, readFileSync(path, "utf8"))
    }
  }
  for (const directory of directories) {
    if (!directory.split(/[\\/]/).includes("node_modules")) walk(directory)
  }
}

function resolveEmittedNames(next, root) {
  return (context, name, platform) => {
    const resolve = next ?? context.resolveRequest
    // A body's imports resolve from its own place, beside its file.
    const body = outputOf(context.originModulePath)
    if (body !== undefined) context = { ...context, originModulePath: body }
    try {
      return resolve(context, name, platform)
    } catch (error) {
      const origin = context.originModulePath
      if (!(body !== undefined || isVibeLang(origin)) || !/^\.\.?\//.test(name)) throw error
      const target = join(dirname(origin), name)
      const source = bodySource(target)
      if (source !== undefined) {
        const filePath = standInOf(root, target)
        // The file's transform rewrites its stand-ins, but Metro's cache skips
        // that transform for a text it has seen, as after an undo. Metro
        // resolves again after every change, so the stand-in follows here.
        writeStandIn(filePath, readFileSync(source, "utf8"))
        if (context.fileSystemLookup?.(filePath).exists !== false) return { type: "sourceFile", filePath }
        throw new Error(`vibelang/metro: ${name} in ${origin} is a module declaration of ${source} that Metro did not see when it started. Its stand-in ${filePath} is now written; restart Metro.`)
      }
      const extension = Object.keys(sources).find((candidate) => name.endsWith(candidate))
      for (const replacement of extension === undefined ? [] : sources[extension]) {
        try {
          return resolve(context, name.slice(0, -extension.length) + replacement, platform)
        } catch {}
      }
      throw error
    }
  }
}

/**
 * The Metro config `config` with .vibe modules: .vibe in
 * resolver.sourceExts, a resolver for the emitted names of a .vibe module's
 * imports and its module declarations, and this module as the Babel
 * transformer before the one `config` names. `config` may be a config, a
 * promise of one, or a function of Metro's default config that returns
 * either. It writes the stand-ins of the module declarations under the
 * project root and watch folders, so wrap the config Metro runs.
 */
function withVibeLang(config) {
  if (typeof config === "function") return (...args) => withVibeLang(config(...args))
  if (typeof config?.then === "function") return config.then(withVibeLang)
  const root = config.projectRoot
  const transformer = config.transformer ?? {}
  const upstream = transformerOf(root, transformer.babelTransformerPath ?? "metro-babel-transformer")
  if (upstream !== transformerPath) process.env[upstreamVariable] = upstream
  const sourceExts = config.resolver?.sourceExts ?? defaultSourceExts(root)
  const projectRoot = root ?? process.cwd()
  prepareStandIns(projectRoot, [projectRoot, ...(config.watchFolders ?? [])])
  // A body is the app's code, as a sibling .ts file would be, so the source
  // map's ignore list leaves its stand-in out.
  const isThirdPartyModule = config.serializer?.isThirdPartyModule ?? ((module) => /(?:^|[/\\])node_modules[/\\]/.test(module.path))
  return {
    ...config,
    resolver: {
      ...config.resolver,
      sourceExts: [...sourceExts, ...["vibe", "vibex"].filter((extension) => !sourceExts.includes(extension))],
      resolveRequest: resolveEmittedNames(config.resolver?.resolveRequest, projectRoot)
    },
    serializer: { ...config.serializer, isThirdPartyModule: (module) => !module.path.includes(standInMarker) && isThirdPartyModule(module) },
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

// Metro's importLocationsPlugin records each import's location while Babel
// runs, as "line,column:line,column". Its transform worker then compares those
// keys with the syntax tree's locations to tell an import from a require, and
// so which of a package's `exports` conditions applies. The tree's locations
// move to the .vibe source, so the keys have to move with them.
function moveImportLocations(metadata, toSource) {
  const locations = metadata?.metro?.unstable_importDeclarationLocs
  if (!locations) return
  metadata.metro.unstable_importDeclarationLocs = new Set([...locations].map((key) => key.replace(/(\d+),(\d+)/g, (_, line, column) => {
    const position = toSource(Number(line), Number(column))
    return `${position.line},${position.column}`
  })))
}

/** Metro's Babel transformer interface: { filename, src, options, plugins } to { ast, metadata }. */
function transform(args) {
  const root = args.options?.projectRoot ?? process.cwd()
  const file = isAbsolute(args.filename) ? args.filename : resolve(root, args.filename)
  const { emitModule, toolSource, remapLocations, sourcePosition } = vibelangEmit()
  const body = outputOf(file)
  let source, filename = args.filename
  if (body !== undefined) {
    // The app's transformer reads a body under its output's name beside its
    // .vibe file, as it would read a sibling .ts file.
    source = emitModule(body, { preserveJsx: bodySource(body).endsWith(".vibex") })
    filename = relative(root, body)
  } else if (isVibeLang(file)) {
    source = toolSource(file, args.src)
    // A changed file's bodies change too: a stand-in that now holds the
    // file's text tells a watching Metro to transform its body again.
    if (source !== undefined) writeStandIns(root, file, String(args.src))
  }
  if (source === undefined) return upstream().transform(args)
  const moved = (result) => {
    if (result?.ast) remapLocations(result.ast, source.map)
    moveImportLocations(result?.metadata, sourcePosition(source.map))
    return result
  }
  const result = upstream().transform({ ...args, filename, src: source.code })
  return typeof result?.then === "function" ? result.then(moved) : moved(result)
}

function getCacheKey(...args) {
  const own = `vibelang/metro:${require("./package.json").version}:${process.env[upstreamVariable] ?? ""}`
  const inner = upstream().getCacheKey?.(...args)
  return inner === undefined ? own : `${own}$${inner}`
}

module.exports = { withVibeLang, transform, getCacheKey }
