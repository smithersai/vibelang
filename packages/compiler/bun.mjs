import Module, { createRequire } from "node:module"
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
import { compileProjectSync, formatDiagnostic, moduleDeclarationSource, nearestProject, workspaceProject } from "./project.mjs"

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
let looking = false
function vibeImport(directory, specifier) {
  if (looking) return undefined
  looking = true
  try {
    const source = isRelative(specifier) ? extensionlessImport(directory, specifier) : aliasImport(configOf(directory), specifier)
    return source?.endsWith(".vibe") ? source : undefined
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

function projectOf(file) {
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
    result = compileProjectSync({ project })
    results.set(project, result)
  }
  const errors = diagnosticsForFile(result.errors, file, result.files)
  if (errors.length) {
    throw new Error(`vibelang: ${project} did not compile\n${errors.map(formatDiagnostic).join("\n")}`)
  }
  const output = result.outputs.get(file)
  if (output === undefined) {
    throw new Error(`vibelang/bun: ${project} does not include ${file}; set VIBELANG_PROJECT to a tsconfig that does`)
  }
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
const escapeRegExp = (value) => value.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&")
function resolveImports(path, contents, loader) {
  const replacements = new Map()
  for (const entry of esImports(contents, loader)) {
    const source = vibeImport(dirname(path), entry.path)
    if (source !== undefined) replacements.set(entry.path, source)
  }
  if (replacements.size === 0) return { contents, loader }
  const quoted = new RegExp("([\"'`])(" + [...replacements.keys()].map(escapeRegExp).join("|") + ")\\1", "g")
  // A mark keeps the copy's quote and needs no escape, so the source still parses.
  const mark = (specifier, copy) => specifier + "#vibelang-copy-" + copy
  let copies = 0
  const marked = contents.replace(quoted, (_, quote, specifier) => quote + mark(specifier, copies++) + quote)
  const imports = new Set(esImports(marked, loader).map((entry) => entry.path))
  let copy = 0
  const rewritten = contents.replace(quoted, (match, quote, specifier) =>
    imports.has(mark(specifier, copy++)) ? JSON.stringify(replacements.get(specifier)) : match)
  return { contents: rewritten, loader }
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
    // Whether a module exports `default` itself, as Bun's namespace of it
    // has: a .vibe module by its JavaScript, a CommonJS one always (Bun's
    // interop default is module.exports). Code that does not read, compile or
    // scan keeps the default; loading the source then reports the error.
    function exportsDefault(file) {
      try {
        if (file.endsWith(".vibe")) return new Bun.Transpiler({ loader: "js" }).scan(emitted(file).code).exports.includes("default")
        const code = readFileSync(file, "utf8")
        return commonJS(file, code) || new Bun.Transpiler({ loader: loaderOf(file) }).scan(code).exports.includes("default")
      } catch {
        return true
      }
    }
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
      const needsRewrite = rewritten.some((entry) => vibeImport(dirname(file), entry.path) !== undefined)
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
      if (discovering || inDependency(importer ?? "")) return undefined
      discovering = true
      try {
        // Bun.resolveSync(path, directory) names that directory as the importer (Bun 1.4.4).
        const from = pathOf(importer)
        const origin = !from || !isAbsolute(from) ? process.cwd() : isDirectory(from) ? from : dirname(from)
        discover(Bun.resolveSync(path, origin))
      } catch { /* The specific resolver and Bun report resolution errors. */ } finally { discovering = false }
      return undefined
    })

    // vibelang rewrites a .vibe module's relative imports to the emitted .js
    // names, and a TypeScript module imports a .vibe module that replaced its
    // .ts file by the same .js name. From source, a missing ./x.js is the .vibe
    // file beside it, or a module declaration's output. Bun maps a missing .js
    // to its .ts or .tsx file itself, except from a module declaration's output.
    build.onResolve({ filter: /^\.\.?\/.*\.js$/ }, ({ path, importer }) => {
      if (discovering) return undefined
      const fromModule = importer?.startsWith(`${moduleNamespace}:`)
      importer = pathOf(importer)
      if (importer === undefined || /[\\/]node_modules[\\/]/.test(importer)) return undefined
      const target = resolve(dirname(importer), path)
      if (existsSync(target)) return fromModule ? { path: target } : undefined
      if (isModuleOutput(target)) return { path: target, namespace: moduleNamespace }
      // A TypeScript module's own .ts or .tsx file still wins, as without vibelang.
      if (!importer.endsWith(".vibe") && !fromModule && [".ts", ".tsx"].some((extension) => existsSync(target.slice(0, -".js".length) + extension))) return undefined
      for (const extension of fromModule ? [".vibe", ".ts", ".tsx"] : [".vibe"]) {
        const source = target.slice(0, -".js".length) + extension
        if (existsSync(source)) return { path: source }
      }
      return undefined
    })
    // A migrated package's emitted JavaScript, which its `default` export names
    // for consumers without a loader, runs from its .vibe source (emitted-js.mjs).
    build.onLoad({ filter: /[\\/]\.vibelang[\\/]js[\\/].*\.(?:[cm]?js|jsx)$/ }, ({ path }) => {
      const source = sourceOfEmitted(path)
      if (source === undefined) return undefined
      claim(source)
      return { contents: reexportOf(source, exportsDefault(source)), loader: "js" }
    })
    // Bun 1.4.2 ignores a plugin's source maps, so the module is its JavaScript alone.
    build.onLoad({ filter: /\.vibe$/ }, ({ path }) => { const code = emitted(path).code; discover(path, code, "js"); return resolveImports(path, code, "js") })
    build.onLoad({ filter: /\.js$/, namespace: moduleNamespace }, ({ path }) => { const code = emitted(path).code; discover(path, code, "js"); return resolveImports(path, code, "js") })
  }
})
