import Module from "node:module"
import { extensionlessImport } from "./relative-imports.mjs"
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
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve, isAbsolute } from "node:path"
import { compileProjectSync, formatDiagnostic, moduleDeclarationSource, nearestProject, workspaceProject } from "./project.mjs"

if (typeof Bun === "undefined") {
  throw new Error("vibelang/bun is a Bun preload; under Node, use node --import vibelang/register")
}

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
function vibeImport(directory, specifier) {
  const source = isRelative(specifier) ? extensionlessImport(directory, specifier) : aliasImport(configOf(directory), specifier)
  return source?.endsWith(".vibe") ? source : undefined
}

// Bun honors Node's CommonJS hook for extensionless require requests.
const resolveFilename = Module._resolveFilename
Module._resolveFilename = function (specifier, parent, ...args) {
  if (typeof specifier === "string" && parent?.filename && !inDependency(parent.filename)) {
    const source = vibeImport(dirname(parent.filename), specifier)
    if (source !== undefined) return source
  }
  return resolveFilename.call(this, specifier, parent, ...args)
}

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
// import. Let Bun parse the importing source, externalizing every import
// and replacing only the relative names and paths aliases that TypeScript
// resolves to .vibe.
// The common path needs only a scan; dependencies keep Bun's own loader.
async function resolveImports(path, contents, loader) {
  const replacements = new Map()
  for (const entry of new Bun.Transpiler({ loader }).scanImports(contents)) {
    const source = vibeImport(dirname(path), entry.path)
    if (source !== undefined) replacements.set(entry.path, source)
  }
  if (replacements.size === 0) return { contents, loader }
  const result = await Bun.build({
    entrypoints: [path], target: "bun", write: false, sourcemap: "inline",
    plugins: [{ name: "vibelang-imports", setup(build) {
      build.onLoad({ filter: /.*/ }, () => ({ contents, loader }))
      build.onResolve({ filter: /.*/ }, (args) => args.importer
        ? { path: replacements.get(args.path) ?? args.path, external: true }
        : undefined)
    } }]
  })
  if (!result.success) throw new AggregateError(result.logs, `vibelang/bun: cannot load ${path}`)
  return { contents: await result.outputs[0].text(), loader: "js" }
}

Bun.plugin({
  name: "vibelang",
  setup(build) {
    const discovered = new Set()
    let discovering = false
    const loaderOf = (file) => file.endsWith("tsx") ? "tsx" : file.endsWith("jsx") ? "jsx" : /\.[cm]?ts$/.test(file) ? "ts" : "js"
    // Register only importers that actually need rewriting. A broad onLoad
    // changes Bun's native CommonJS export interop, even for dependencies
    // that never import a .vibe module.
    function discover(file, code, loader = loaderOf(file)) {
      file = resolve(file)
      const emittedSource = code !== undefined
      if (!emittedSource && !/\.[cm]?[jt]sx?$/.test(file)) return
      let physical = file
      try { physical = realpathSync(file) } catch { if (!emittedSource) return }
      if (discovered.has(physical)) return
      discovered.add(physical)
      if (inDependency(physical)) return
      let imports
      try {
        code ??= readFileSync(file, "utf8")
        imports = new Bun.Transpiler({ loader }).scanImports(code)
      } catch { return }
      const needsRewrite = imports.some((entry) =>
        entry.kind !== "require-call" && vibeImport(dirname(file), entry.path) !== undefined)
      if (needsRewrite && !emittedSource && !/\.(?:cjs|cts)$/.test(file) &&
          !/\bmodule\s*(?:\.\s*exports|\[\s*["']exports["']\s*\])|\bexports\s*[.[]/.test(code)) {
        const escape = (value) => value.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&")
        build.onLoad({ filter: new RegExp("^(?:" + [file, physical].map(escape).join("|") + ")$") },
          ({ path }) => resolveImports(path, readFileSync(path, "utf8"), loaderOf(path)))
      }
      for (const entry of imports) {
        try {
          const target = isRelative(entry.path) ? extensionlessImport(dirname(file), entry.path) : vibeImport(dirname(file), entry.path)
          discover(target ?? Bun.resolveSync(entry.path, dirname(file)))
        } catch { /* Builtins, assets and unresolved imports keep native handling. */ }
      }
    }
    build.onResolve({ filter: /.*/ }, ({ path, importer }) => {
      if (discovering || inDependency(importer ?? "")) return undefined
      discovering = true
      try {
        const from = pathOf(importer)
        discover(Bun.resolveSync(path, from && isAbsolute(from) ? dirname(from) : process.cwd()))
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
    // Bun 1.4.2 ignores a plugin's source maps, so the module is its JavaScript alone.
    build.onLoad({ filter: /\.vibe$/ }, ({ path }) => { const code = emitted(path).code; discover(path, code, "js"); return resolveImports(path, code, "js") })
    build.onLoad({ filter: /\.js$/, namespace: moduleNamespace }, ({ path }) => { const code = emitted(path).code; discover(path, code, "js"); return resolveImports(path, code, "js") })
  }
})
