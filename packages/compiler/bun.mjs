import { loaderScope } from "./loader-scope.mjs"
import Module, { createRequire, SourceMap } from "node:module"
import { exportsDefault } from "./bun-export-surface.mjs"
import { inlineSourceMap } from "./inline-source-map.mjs"
import { extensionlessImport, pathSpecifier } from "./relative-imports.mjs"
import { reexportOf, sourceOfEmitted } from "./emitted-js.mjs"
import { aliasImport } from "./paths-imports.mjs"
import { diagnosticsForFile } from "./diagnostics.mjs"
// bun --preload vibelang/bun: Bun loads .vibe modules from source.
//
// The Bun counterpart of vibelang/register, for `bun run`, `bun test`, and a
// bunfig.toml `preload`. A .vibe module's JavaScript comes from one
// whole-project compile per tsconfig per process: emit is type-directed, so no
// module compiles alone. The project is the nearest tsconfig.json above the
// module, or VIBELANG_PROJECT for the modules in its directory (a module of
// another workspace package compiles with its own tsconfig.json). A compile's result is cached on disk
// (vibelang/project), so a later process reuses it while the project's inputs
// are unchanged. A module declaration of a .vibe module is a module of its
// own, main.vibe.text.js beside main.vibe for module text (D403), which is not
// on disk; its JavaScript comes from the same compile.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, join, resolve, isAbsolute } from "node:path"
import { compileProjectSync, findCompiler, findProject, formatDiagnostic, moduleDeclarationSource, nearestProject, projectImports, workspaceProject } from "./project.mjs"

if (typeof Bun === "undefined") {
  throw new Error("vibelang/bun is a Bun preload; under Node, use node --import vibelang/register")
}

const isDirectory = (path) => { try { return statSync(path).isDirectory() } catch { return false } }
const isRelative = (specifier) => specifier.startsWith("./") || specifier.startsWith("../")
// Only a relative import or a tsconfig paths alias can name a .vibe module,
// and a dependency has none: a workspace package's real path is outside
// node_modules. Scanning dependencies, or resolving their imports twice, is
// what would make a preload slow.
const inDependency = (path) => /[\\/]node_modules[\\/]/.test(path)

// The tsconfig whose paths apply to a module in directory: the nearest one,
// which also compiles it.
const configs = new Map()
function configOf(directory) {
  if (!configs.has(directory)) configs.set(directory, nearestProject(join(directory, "index.ts")))
  return configs.get(directory)
}

// The .vibe module that TypeScript resolves specifier, written in directory,
// to: a relative import by extensionlessImport, and an alias of the nearest
// tsconfig's paths (`@/x` for `"@/*": ["./src/*"]`) by aliasImport. Bun
// resolves an alias itself, but never to a .vibe file.
//
// Reading a tsconfig's paths resolves a package it extends
// ("@tsconfig/bun/tsconfig.json") with require.resolve, which calls the
// CommonJS hook below before those paths are cached. A resolution the lookup
// starts itself is never a .vibe import, so it goes to Bun alone; otherwise
// each nested call reads the same config again until the stack runs out
// (2,653 hook calls for one require("fs")).
// Native launchers may keep a literal TypeScript import after migration.
// Existing native files keep Bun's precedence; only a missing source falls
// back, and declaration names never become executable modules.
function migratedTypeScriptImport(directory, specifier) {
  if (!(isRelative(specifier) || isAbsolute(specifier)) ||
      !specifier.endsWith(".ts") || specifier.endsWith(".d.ts")) return undefined
  const target = resolve(directory, specifier)
  if (existsSync(target) || existsSync(target.slice(0, -3) + ".tsx")) return undefined
  const source = target.slice(0, -3) + ".vibe"
  return existsSync(source) ? source : undefined
}

let looking = false
function vibeImport(directory, specifier) {
  if (looking) return undefined
  looking = true
  try {
    const source = migratedTypeScriptImport(directory, specifier) ?? (isRelative(specifier) ? extensionlessImport(directory, specifier) : aliasImport(configOf(directory), specifier, { migratedTypeScript: true }))
    return source !== undefined && /\.vibex?$/.test(source) ? source : undefined
  } finally { looking = false }
}

// Bun honors Node's CommonJS hook for extensionless require requests.
const resolveFilename = Module._resolveFilename
function resolveVibeFilename(specifier, parent, ...args) {
  if (typeof specifier === "string" && parent?.filename && !inDependency(parent.filename)) {
    const source = vibeImport(dirname(parent.filename), specifier)
    if (source !== undefined) return source
  }
  return resolveFilename.call(this, specifier, parent, ...args)
}
// Bun 1.3.13 calls a replaced hook without the parent for a require that
// createRequire(url) made, so the request resolves from the working
// directory instead of url, and Nuxt's createRequire(import.meta.url)
// .resolve("srvx/node") fails (alchemy-30). Such a runtime keeps its own
// hook: a CommonJS require of a .vibe module there names the extension.
let parentless = false
Module._resolveFilename = function (specifier, parent, ...args) {
  if (parent === undefined) parentless = true
  return resolveVibeFilename.call(this, specifier, parent, ...args)
}
try { createRequire(import.meta.url).resolve("./bun.mjs") } catch { /* The probe only watches the hook's arguments. */ }
Module._resolveFilename = parentless ? resolveFilename : resolveVibeFilename

const results = new Map()
const sourceMaps = new Map()

// Modules their first project left out, each with the project findProject named.
const owners = new Map()
const programs = new Map()

function projectOf(file) {
  if (owners.has(file)) return owners.get(file)
  if (process.env.VIBELANG_PROJECT) {
    const named = resolve(process.env.VIBELANG_PROJECT)
    return workspaceProject(file, dirname(named), named)
  }
  const project = nearestProject(file)
  if (project === undefined) throw new Error(`vibelang/bun: no tsconfig.json above ${file}`)
  return project
}

function emitted(file) {
  file = resolve(file)
  const project = projectOf(file)
  let result = results.get(project)
  if (result === undefined) {
    result = compileProjectSync({ project, [loaderScope]: true })
    results.set(project, result)
  }
  if (!result.outputs.has(file) && !owners.has(file)) {
    const other = findProject(file, { tried: project, compiler: findCompiler(dirname(project)), programs }).project
    if (other !== undefined) {
      owners.set(file, other)
      return emitted(file)
    }
  }
  const errors = diagnosticsForFile(result.errors, file, result.files)
  if (errors.length) {
    throw new Error(`vibelang: ${project} did not compile\n${errors.map(formatDiagnostic).join("\n")}`)
  }
  const output = result.outputs.get(file)
  if (output === undefined) {
    throw new Error(`vibelang/bun: ${project} does not include ${file}; set VIBELANG_PROJECT to a tsconfig that does`)
  }
  sourceMaps.set(file, output.map)
  return output
}

// A module declaration's output that is not on disk: the compile serves it.
function isModuleOutput(path) {
  const source = path === undefined ? undefined : moduleDeclarationSource(path)
  return source !== undefined && !existsSync(path) && existsSync(source)
}

// Bun loads a file that is not on disk only from a namespace of the plugin's
// own; an importer in it names it before its path.
const moduleNamespace = "vibelang-module"
const pathOf = (importer) => importer?.startsWith(`${moduleNamespace}:`) ? importer.slice(moduleNamespace.length + 1) : importer

// Bun runtime resolution does not call onResolve for an extensionless
// import. Replace, in the importing source itself, only the relative names
// and paths aliases that TypeScript resolves to .vibe, and keep the loader,
// so Bun transpiles the module as it would without vibelang.
// The common path needs only a scan; dependencies keep Bun's own loader.
//
// The rewrite is synchronous. Bun makes a module whose onLoad returns a
// pending Promise an async module, and require() of an async module throws
// "require() async module ... is unsupported" (Bun 1.4.4,
// src/jsc/bindings/ModuleLoader.cpp: handleOnLoadResult wraps a Promise in a
// pending module, and the require path throws while it is pending). opencode's
// plugin runtime require()s a native barrel whose schema modules are .vibe.
// A quoted copy of a specifier can also be a string, a comment, a type or the
// argument of a call to a shadowed require, so each copy gets a marked name of
// its own, and the copies that a scan of the marked source reports as imports
// are the ones replaced.
//
// The scan is Bun.Transpiler's scan(), a parse, not scanImports(). Bun 1.4.4's
// scanImports() reports a require("./x") call even where require is a local
// binding, and drops a dynamic import whose specifier is not ASCII, such as
// import("./leaf-\u96ea"); scan() reports neither require() calls nor
// type-only imports. A CommonJS require and `import x = require()` reach a
// .vibe module through the CommonJS resolve hook above instead.
const esImports = (code, loader) => new Bun.Transpiler({ loader }).scan(code).imports
const relativeJs = /^\.\.?\/.*\.jsx?$/
// The compiler writes relative output specifiers as URL paths. Bun's source
// resolver takes filesystem names instead, so decode compiled imports once.
function decodedImport(specifier) {
  try { return decodeURIComponent(specifier) } catch { return specifier }
}
const importGraphs = new Map()
function sourceImportPath(importer, specifier) {
  const source = moduleDeclarationSource(importer) ?? importer
  if (!/\.vibex?$/.test(source) || !/%[0-9a-f]{2}/i.test(specifier)) return specifier
  const project = projectOf(source)
  let imports = importGraphs.get(project)
  if (imports === undefined) {
    imports = projectImports({ project, compiler: findCompiler(dirname(project)) }).imports
    importGraphs.set(project, imports)
  }
  // A written .js specifier is already a native filesystem name. Only a
  // source-extension rewrite introduced URL escaping; preserve authored
  // literal-percent names even when the decoded sibling also exists.
  const original = realpathSync(source)
  if (imports.some((entry) => entry.specifier === specifier &&
      (entry.importer === source || realpathSync(entry.importer) === original))) return specifier
  return decodedImport(specifier)
}
const escapeRegExp = (value) => value.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&")
// What a module declaration's output imports, from its .vibe file's directory.
// A relative .js name is the emitted name of a .vibe or .ts file beside it.
// Bun.resolveSync would pass it to the onResolve hook below with the directory
// as its importer, one level too high, so it is looked up here.
function fromModuleOutput(directory, specifier, importer, fromSource = false) {
  if (relativeJs.test(specifier)) {
    const target = resolve(directory, fromSource ? specifier : sourceImportPath(importer, specifier))
    if (existsSync(target)) return target
    const stem = target.replace(/\.jsx?$/, "")
    return [".ts", ".tsx", ".vibe", ".vibex"].map((extension) => stem + extension).find(existsSync)
  }
  try {
    const resolved = Bun.resolveSync(specifier, directory)
    return isAbsolute(resolved) ? resolved : undefined
  } catch { return undefined /* Bun reports it at the import. */ }
}
// Bundler preloads register their literal ESM routes before application loading.
// Sharing this parser-backed pass preserves the ordinary native-source loader
// and leaves strings, comments, type imports and shadowed calls untouched.
const registeredImport = (directory, specifier) =>
  globalThis[Symbol.for("vibelang.bun.import-resolvers")]?.get(specifier)?.(directory)

function resolveImports(path, contents, loader, inNamespace = false) {
  const map = sourceMaps.get(path)
  const replacements = new Map()
  const entries = esImports(contents, loader)
  function resolveSpecifier(specifier) {
    let source = registeredImport(dirname(path), specifier) ?? vibeImport(dirname(path), specifier)
    if (source === undefined && inNamespace) source = fromModuleOutput(dirname(path), specifier, path)
    return source
  }
  const encoded = (specifier) => map !== undefined && relativeJs.test(specifier) && /%[0-9a-f]{2}/i.test(specifier)
  let sourceMap
  function originalSpecifier(specifier, offset) {
    if (!encoded(specifier)) return undefined
    sourceMap ??= new SourceMap(map)
    const before = contents.slice(0, offset)
    const entry = sourceMap.findEntry(before.split("\n").length - 1, offset - before.lastIndexOf("\n") - 1)
    const text = map.sourcesContent?.[map.sources.indexOf(entry.originalSource)]
    if (text === undefined || entry.originalLine === undefined) return undefined
    const from = text.split(/\r?\n/).slice(entry.originalLine).join("\n").slice(entry.originalColumn)
    const literal = from.match(/^(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`)/)
    if (literal === null) return undefined
    // Two source imports can share emitted text while naming different files.
    // Their individual map positions retain the original literal and target.
    try { return esImports("import(" + literal[0] + ")", "js")[0]?.path } catch { return undefined }
  }
  for (const entry of entries) {
    const source = encoded(entry.path) ? entry.path : resolveSpecifier(entry.path)
    if (source !== undefined) replacements.set(entry.path, source)
  }
  if (replacements.size === 0) return { contents, loader }
  const spellings = new Set()
  for (const specifier of replacements.keys()) {
    const escaped = JSON.stringify(specifier).slice(1, -1)
    const unquoted = escaped.replace(/\\"/g, '"')
    for (const spelling of [specifier, escaped, unquoted.replace(/'/g, "\\'"),
      unquoted.replace(/`/g, "\\`").replace(/\$\{/g, "\\${")]) spellings.add(spelling)
  }
  const quoted = new RegExp("([\"'`])(" + [...spellings].map(escapeRegExp).join("|") + ")\\1", "g")
  // Mark each literal copy before parsing, preserving its original escapes.
  // A fresh suffix also keeps authored imports from looking like a mark.
  let marker = "#vibelang-copy-"
  while (contents.includes(marker) || entries.some((entry) => entry.path.includes(marker))) marker += "_"
  let copies = 0
  const marked = contents.replace(quoted, (_, quote, spelling) => quote + spelling + marker + copies++ + quote)
  const imports = new Map()
  for (const entry of esImports(marked, loader)) {
    const split = entry.path.lastIndexOf(marker)
    if (split < 0) continue
    const copy = Number(entry.path.slice(split + marker.length))
    if (Number.isSafeInteger(copy) && copy >= 0 && copy < copies) imports.set(copy, entry.path.slice(0, split))
  }
  let copy = 0
  const rewritten = contents.replace(quoted, (match, quote, spelling, offset) => {
    const specifier = imports.get(copy++)
    if (!replacements.has(specifier)) return match
    const original = originalSpecifier(specifier, offset)
    const target = original === undefined ? resolveSpecifier(specifier) ?? replacements.get(specifier)
      : fromModuleOutput(dirname(path), original, path, true) ?? resolveSpecifier(original) ?? original
    return JSON.stringify(target).replace(/[^\x00-\x7f]/g,
      (character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"))
  })
  return { contents: rewritten, loader }
}

// Bun's runtime reads a source map only from a module marked `// @bun`, its
// mark for its own build output. It runs such a module as it is and reads its
// text as ASCII, which is what `bun build` writes. So a module with other text,
// or one that needs the transpiler, stays unmarked and loses its map: the whole
// map, never its behavior. The transpiler compiles JSX, gives a module require,
// __dirname and __filename, and lowers decorators JavaScriptCore cannot parse.
// Its output has no comments and leaves a shadowing binding alone, so a string
// that spells a name only costs the map.
const transpiler = new Bun.Transpiler({ loader: "js", target: "bun" })
function needsTranspiler(code) {
  if (code.startsWith("#!") || /[^\x00-\x7f]/.test(code)) return true
  try {
    return /\brequire\b|\b__dirname\b|\b__filename\b|__decorat|__legacyDecorat/.test(transpiler.transformSync(code))
  } catch {
    return true // JSX, which `jsx: preserve` and `jsx: react-native` leave for Bun
  }
}

function withSourceMap({ contents, loader }, map, source) {
  // A runtime onLoad result has no native file descriptor for Bun to watch.
  // A distinct file-attribute import registers the original source without
  // parsing it or sharing its compiled module identity. Bun retains the file
  // dependency for a bound import; a side-effect-only asset import is elided.
  const names = contents.replace(/\\u(?:\{([0-9a-f]+)\}|([0-9a-f]{4}))/gi, (text, braced, fixed) => {
    const character = parseInt(braced ?? fixed, 16)
    return character < 128 ? String.fromCharCode(character) : text
  })
  let binding = "__vibelangSourceWatch"
  while (names.includes(binding)) binding += "_"
  const dependency = JSON.stringify(source + "?vibelang-watch")
    .replace(/[^\x00-\x7f]/g, (character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"))
  const line = contents.split("\n").length
  contents += `\nimport ${binding} from ${dependency} with { type: "file" };\n`
  if (map !== undefined) {
    const mappings = map.mappings.split(";")
    while (mappings.length <= line) mappings.push("")
    mappings[line] = "A"
    map = { ...map, mappings: mappings.join(";") }
  }
  if (map === undefined || needsTranspiler(contents)) return { contents, loader }
  // The mark is a line above the code the map describes.
  return { contents: `// @bun\n${contents}\n${inlineSourceMap({ ...map, mappings: ";" + map.mappings })}\n`, loader: "js" }
}

Bun.plugin({
  name: "vibelang",
  setup(build) {
    const discovered = new Set()
    const rewrittenFiles = new Set()
    let discovering = false
    const loaderOf = (file) => file.endsWith("tsx") ? "tsx" : file.endsWith("jsx") ? "jsx" : /\.[cm]?ts$/.test(file) ? "ts" : "js"
    // Register only importers that actually need rewriting. A broad onLoad
    // changes Bun's native CommonJS export interop, even for dependencies
    // that never import a .vibe module.
    const commonJS = (file, code) => /\.(?:cjs|cts)$/.test(file) ||
      /\bmodule\s*(?:\.\s*exports|\[\s*["']exports["']\s*\])|\bexports\s*[.[]/.test(code)
    const exactly = (file, physical) => new RegExp("^(?:" + [...new Set([file, physical])].map(escapeRegExp).join("|") + ")$")
    function discover(file, code, loader = loaderOf(file)) {
      file = resolve(file)
      const emittedSource = code !== undefined
      if (!emittedSource && !/\.[cm]?[jt]sx?$/.test(file)) return
      let physical = file
      try { physical = realpathSync(file) } catch { if (!emittedSource) return }
      if (discovered.has(physical)) return
      discovered.add(physical)
      if (inDependency(physical)) return
      let imports, rewritten
      try {
        code ??= readFileSync(file, "utf8")
        rewritten = esImports(code, loader)
        imports = [...new Bun.Transpiler({ loader }).scanImports(code), ...rewritten]
      } catch { return }
      const needsRewrite = rewritten.some((entry) =>
        registeredImport(dirname(file), entry.path) !== undefined || vibeImport(dirname(file), entry.path) !== undefined)
      if (needsRewrite && !emittedSource && !commonJS(file, code)) {
        build.onLoad({ filter: exactly(file, physical) },
          ({ path }) => resolveImports(path, readFileSync(path, "utf8"), loaderOf(path)))
        rewrittenFiles.add(physical)
      }
      for (const entry of imports) {
        try {
          const target = isRelative(entry.path) ? extensionlessImport(dirname(file), entry.path) : vibeImport(dirname(file), entry.path)
          discover(target ?? Bun.resolveSync(entry.path, dirname(file)))
        } catch { /* Builtins, assets and unresolved imports keep native handling. */ }
      }
    }
    // An emitted package file's re-export names its source by an absolute
    // path, an import the native package entry never made. Another plugin may
    // claim that path: OpenTUI's runtime plugin (@opentui/core 0.7.0
    // runtime-plugin.js) gives a project file it sees by an absolute specifier
    // an async onLoad, so opencode's TUI require() of a package whose default
    // export is .vibelang/js/src/index.js threw "require() async module". Bun
    // calls the first matching onLoad, so the plugin loads a native source
    // itself first, unchanged, as Bun loads the package's own entry.
    const claimed = new Set()
    function claim(file) {
      discover(file)
      if (!/\.[cm]?[jt]sx?$/.test(file)) return
      let physical
      try { physical = realpathSync(file) } catch { return }
      if (claimed.has(physical) || rewrittenFiles.has(physical) || inDependency(physical)) return
      claimed.add(physical)
      let code
      try { code = readFileSync(file, "utf8") } catch { return }
      if (commonJS(file, code)) return
      build.onLoad({ filter: exactly(file, physical) }, ({ path }) => ({ contents: readFileSync(path, "utf8"), loader: loaderOf(path) }))
    }
    // Discovery follows a module Bun resolves by path: the entry, a dynamic
    // import of a computed path. A bare specifier is left to Bun: its module,
    // if it is the repository's, is one a discovered file imports, and
    // opencode's TUI test resolved effect/package.json about four million
    // times, each a JavaScript callback (opencode-35).
    const debug = process.env.VIBELANG_BUN_DEBUG
    let resolutions = 0
    if (debug) process.once("exit", () => console.error(`vibelang/bun: ${resolutions} resolution${resolutions === 1 ? "" : "s"} reached discovery`))
    build.onResolve({ filter: pathSpecifier }, ({ path, importer }) => {
      if (debug) resolutions++
      // A module declaration's output named by its absolute path: bun test
      // --isolate resolves an import again by the path an earlier load
      // resolved it to, and the output is not on disk.
      if (isAbsolute(path) && isModuleOutput(path)) return { path, namespace: moduleNamespace }
      if (discovering || inDependency(importer ?? "")) return undefined
      discovering = true
      try {
        // Bun.resolveSync(path, directory) names that directory as the importer (Bun 1.4.4).
        const from = pathOf(importer)
        const origin = !from || !isAbsolute(from) ? process.cwd() : isDirectory(from) ? from : dirname(from)
        const migrated = migratedTypeScriptImport(origin, path)
        if (migrated !== undefined) return { path: migrated }
        discover(Bun.resolveSync(path, origin))
      } catch { /* The specific resolver and Bun report resolution errors. */ } finally { discovering = false }
      return undefined
    })

    // vibelang rewrites a .vibe module's relative imports to the emitted .js
    // names, and a TypeScript module imports a .vibe module that replaced its
    // .ts file by the same .js name. From source, a missing ./x.js is the .vibe
    // file beside it, or a module declaration's output. Bun maps a missing .js
    // to its .ts or .tsx file itself, except from a module declaration's output.
    build.onResolve({ filter: relativeJs }, ({ path, importer }) => {
      if (discovering) return undefined
      const fromModule = importer?.startsWith(`${moduleNamespace}:`)
      importer = pathOf(importer)
      if (importer === undefined || /[\\/]node_modules[\\/]/.test(importer)) return undefined
      const target = resolve(dirname(importer), sourceImportPath(importer, path))
      if (existsSync(target)) return fromModule ? { path: target } : undefined
      if (isModuleOutput(target)) return { path: target, namespace: moduleNamespace }
      // A TypeScript module's own .ts or .tsx file still wins, as without vibelang.
      if (!/\.vibex?$/.test(importer) && !fromModule && [".ts", ".tsx"].some((extension) => existsSync(target.replace(/\.jsx?$/, "") + extension))) return undefined
      for (const extension of path.endsWith(".jsx") ? [".tsx", ".ts", ".vibex", ".vibe"] : [".ts", ".tsx", ".vibe", ".vibex"]) {
        const source = target.replace(/\.jsx?$/, "") + extension
        if (existsSync(source)) return { path: source }
      }
      return undefined
    })
    // A migrated package's emitted JavaScript, which its `default` export names
    // for consumers without a loader, runs from its .vibe source (emitted-js.mjs).
    build.onLoad({ filter: /[\\/]\.vibelang[\\/]js[\\/].*\.(?:[cm]?js|jsx)$/ }, ({ path }) => {
      const source = sourceOfEmitted(path)
      // No single source (ambiguous siblings, or a receipt naming a deleted
      // .vibe): the emitted module loads in place. Bun 1.4 rejects an
      // onLoad that returns undefined ("onLoad() expects an object returned").
      if (source === undefined) return { contents: readFileSync(path, "utf8"), loader: path.endsWith(".jsx") ? "jsx" : "js" }
      claim(source)
      return { contents: reexportOf(source, exportsDefault(source, emitted, loaderOf)), loader: "js" }
    })
    build.onLoad({ filter: /\.vibex?$/ }, ({ path, loader: requestedLoader }) => {
      if (requestedLoader === "file" || requestedLoader === "text") return undefined
      const { code, map } = emitted(path), loader = path.endsWith(".vibex") ? "jsx" : "js"
      discover(path, code, loader)
      return withSourceMap(resolveImports(path, code, loader), map, path)
    })
    build.onLoad({ filter: /\.jsx?$/, namespace: moduleNamespace }, ({ path }) => { const { code, map } = emitted(path), loader = moduleDeclarationSource(path)?.endsWith(".vibex") ? "jsx" : "js"; discover(path, code, loader); return withSourceMap(resolveImports(path, code, loader, true), map, moduleDeclarationSource(path)) })
  }
})
