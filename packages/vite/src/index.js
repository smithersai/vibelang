import { aliasImport } from "./paths-imports.js"
import { extensionlessImport } from "./relative-imports.js"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Vite's default resolve.extensions, which a config that sets none uses.
const viteExtensions = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"]

const cleanId = (id) => id.split("?")[0]

// Vite's own module queries: ?import on a JavaScript import of a non-JS
// extension, ?v= and ?t= for versioning and hot updates, and the worker
// entry's ?worker_file&type=. An id that carries only these is the module
// itself. Any other query, such as x.vibe?highlighted or ?raw, names a
// resource another plugin (or Vite) loads from the same source. Vite's
// TypeScript transform rewrites the code that loader supplied, so such a
// resource keeps its content; this plugin compiles the .vibe source itself,
// so it leaves those ids alone instead of replacing the loaded module.
const viteQueries = new Set(["import", "v", "t", "worker_file", "type"])
function isModuleId(id) {
  const query = id.indexOf("?")
  if (query < 0) return true
  for (const key of new URLSearchParams(id.slice(query + 1)).keys()) {
    if (!viteQueries.has(key)) return false
  }
  return true
}
const slash = (path) => path.replaceAll("\\", "/")

// A module declaration of main.vibe compiles to main.vibe.text.js beside it
// (D403), which is not on disk: the project's compile serves it. The pattern
// is vibelang/project's moduleDeclarationSource.
function isModuleOutput(path) {
  const source = /^(.+\.vibe)\.[^./\\]+\.js$/.exec(path)?.[1]
  return source !== undefined && !existsSync(path) && existsSync(source)
}
// A module whose JavaScript the plugin compiles: a .vibe module or one of its module declarations.
const isCompiled = (path) => path.endsWith(".vibe") || isModuleOutput(path)

// The tsconfig.json nearest above directory, whose paths apply to its modules.
const configs = new Map()
function nearestConfig(directory) {
  if (!configs.has(directory)) {
    const own = join(directory, "tsconfig.json")
    const parent = dirname(directory)
    configs.set(directory, existsSync(own) ? own : parent === directory ? undefined : nearestConfig(parent))
  }
  return configs.get(directory)
}

// Keep TypeScript's source priority when the bundler cannot find .vibe.
function extensionlessVibe(directory, specifier) {
  const source = extensionlessImport(directory, specifier)
  return source?.endsWith(".vibe") ? source : undefined
}

// The compile backend is the vibelang package's own: the project's install
// first, so it matches the compiler that runs, else the one beside this plugin.
async function loadBackend(root) {
  for (const base of [join(root, "package.json"), fileURLToPath(import.meta.url)]) {
    let path
    try {
      path = createRequire(base).resolve("vibelang/project")
    } catch {
      continue
    }
    return import(pathToFileURL(path).href)
  }
  throw new Error("vibelang-vite needs the vibelang package: npm install --save-dev vibelang")
}

// The absolute path of a vibelang module, so a process started in any
// directory finds it.
function vibelangModule(root, name) {
  for (const base of [join(root, "package.json"), fileURLToPath(import.meta.url)]) {
    try {
      return createRequire(base).resolve(name)
    } catch {
      continue
    }
  }
  throw new Error("vibelang-vite's register option needs the vibelang package: npm install --save-dev vibelang")
}

// Adds flag to the variable name of the tests' environment, keeping what the
// config or the environment already sets; undefined when it is already there.
function withOption(env, name, flag) {
  const inherited = env?.[name] ?? process.env[name] ?? ""
  return inherited.includes(flag) ? undefined : [inherited, flag].filter(Boolean).join(" ")
}

// VIBELANG_VITE_DEBUG=1 traces whole-project compiles and invalidations.
const debug = process.env.VIBELANG_VITE_DEBUG ? (text) => console.error(`vibelang-vite: ${text}`) : () => {}

/** @param {import('./index.d.ts').VibeLangOptions} options */
export default function vibelang(options = {}) {
  let root, project, logger, backend, modules, current, closing

  // One compile per tsconfig: the project for root's modules, and each
  // workspace package's own for modules outside root.
  function loaded() {
    modules ??= Promise.resolve(closing).then(() => loadBackend(root)).then((value) => {
      backend = value
      current = backend.projects({ root, project, compiler: backend.findCompiler(root, options.compiler), debug })
      return current
    })
    return modules
  }

  function close() {
    const pending = modules
    modules = undefined
    current = undefined
    const work = Promise.resolve(closing).then(async () => {
      const projects = await pending
      await projects?.close()
    })
    closing = work
    return work
  }

  function diagnostics(errors, file) {
    const first = errors.find((diagnostic) => diagnostic.file) || {}
    return {
      message: errors.map(backend.formatDiagnostic).join("\n"),
      id: first.file || file,
      loc: first.file && { file: first.file, line: first.line, column: first.column - 1 }
    }
  }

  return {
    name: "vibelang",
    enforce: "pre",
    config(config) {
      // An extensionless import, or a directory's index (`./mount` for
      // mount/index.vibe), reaches a .vibe module as it reaches a .ts one.
      // Vite concatenates a plugin's arrays with the config's.
      const extensions = config.resolve?.extensions
      const added = extensions?.includes(".vibe") ? {} : { resolve: { extensions: extensions ? [".vibe"] : [...viteExtensions, ".vibe"] } }
      if (!options.register) return added
      // Vitest copies test.env into process.env, which the processes a test
      // starts inherit: node reads NODE_OPTIONS, and bun, such as
      // process.execPath under bun x --bun vitest, reads BUN_OPTIONS, whose
      // --preload takes a path without spaces.
      const base = resolve(config.root || process.cwd())
      const preload = vibelangModule(base, "vibelang/bun")
      const env = {
        NODE_OPTIONS: withOption(config.test?.env, "NODE_OPTIONS", `--import=${pathToFileURL(vibelangModule(base, "vibelang/register")).href}`),
        BUN_OPTIONS: /\s/.test(preload) ? undefined : withOption(config.test?.env, "BUN_OPTIONS", `--preload=${preload}`)
      }
      for (const name of Object.keys(env)) if (env[name] === undefined) delete env[name]
      return Object.keys(env).length ? { ...added, test: { env } } : added
    },
    // Vitest's fsModuleCache keys a transform by the module's own text, but a
    // .vibe module's JavaScript also depends on the compiler and on the
    // contracts of the modules it imports, so a rerun would serve JavaScript
    // compiled against an earlier contract. The project compile has its own
    // cache (vibelang/cache), keyed by every input.
    configureVitest(context) {
      const define = context.defineCacheKeyGenerator ?? context.experimental_defineCacheKeyGenerator
      define?.(({ id }) => isCompiled(cleanId(id)) && isModuleId(id) ? false : undefined)
    },
    configResolved(config) {
      root = config.root
      project = resolve(root, options.project || "tsconfig.json")
      logger = config.logger
    },
    configureServer(server) {
      // Vite otherwise treats an unknown extension as a static asset on HTTP.
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url || "/", "http://localhost")
        if (url.pathname.endsWith(".vibe") && !url.searchParams.has("raw") && !url.searchParams.has("url")) {
          url.searchParams.set("import", "")
          request.url = url.pathname + url.search
        }
        next()
      })
    },
    resolveId(source, importer) {
      if (!importer) return
      // Vite's resolve.tsconfigPaths, like vite-tsconfig-paths, applies a
      // path alias only in a TypeScript or JavaScript importer, so `~/value`
      // in a .vibe module reached nothing. Resolve it as vibelang does: the
      // file the nearest tsconfig's paths give.
      if (!source.startsWith(".")) {
        if (!isCompiled(cleanId(importer))) return
        const target = aliasImport(nearestConfig(dirname(cleanId(importer))), cleanId(source))
        return target === undefined ? undefined : slash(target) + source.slice(cleanId(source).length)
      }
      const vibe = extensionlessVibe(dirname(cleanId(importer)), cleanId(source))
      if (vibe !== undefined) return slash(vibe) + source.slice(cleanId(source).length)
      // vibelang rewrites .vibe imports to .js. Keep the original source in Vite's graph.
      if (!cleanId(source).endsWith(".js")) return
      const target = resolve(dirname(cleanId(importer)), cleanId(source))
      if (existsSync(target)) return
      const query = source.slice(cleanId(source).length)
      if (isModuleOutput(target)) return slash(target) + query
      const es = target.slice(0, -3) + ".vibe"
      if (existsSync(es)) return slash(es) + query
    },
    // A module declaration's JavaScript comes from its .vibe file's compile.
    async load(id) {
      const file = cleanId(id)
      if (!isModuleOutput(file) || !isModuleId(id)) return
      const { project, code, map, errors, error } = await (await loaded()).load(file)
      this.addWatchFile(project)
      if (errors.length) this.error(diagnostics(errors, file))
      if (error) this.error(error)
      // Vite relativizes sources and annotates maps in place. The backend
      // caches these objects across requests, so each caller owns its copy.
      return { code, map: structuredClone(map) }
    },
    async transform(_source, id) {
      const file = cleanId(id)
      if (!file.endsWith(".vibe") || !isModuleId(id)) return
      const { project, code, map, errors, warnings, error } = await (await loaded()).load(file)
      this.addWatchFile(project)
      // Reject diagnostics for this source, including on repeated requests.
      if (errors.length) this.error(diagnostics(errors, file))
      for (const warning of warnings) logger.warn(backend.formatDiagnostic(warning))
      if (error) this.error(error)
      return { code, map: structuredClone(map) }
    },
    watchChange(id) {
      if (/\.(?:vibe|[cm]?tsx?|json)$/.test(id)) current?.invalidate()
    },
    async handleHotUpdate(context) {
      if (!/\.(?:vibe|[cm]?tsx?)$/.test(context.file) && !context.file.endsWith(".json")) return
      const projects = await loaded()
      projects.invalidate()
      // Any source can change the contracts used to compile a .vibe importer.
      const affected = new Set()
      const visit = (module) => {
        if (affected.has(module)) return
        affected.add(module)
        for (const importer of module.importers) visit(importer)
      }
      for (const module of context.modules) visit(module)
      for (const module of context.server.moduleGraph.idToModuleMap.values()) {
        if (module.file && isCompiled(module.file)) visit(module)
      }
      for (const module of affected) context.server.moduleGraph.invalidateModule(module)
      // Recompile the sources Vite has loaded. A watched TypeScript source
      // can change their contracts without making its own errors loader errors.
      const errors = []
      const sources = new Set([...affected].map((module) => module.file).filter((file) => file && isCompiled(file)))
      for (const file of sources) errors.push(...(await projects.load(file)).errors)
      if (errors.length) {
        const { message, id, loc } = diagnostics(errors, context.file)
        context.server.config.logger.error(message)
        context.server.ws.send({ type: "error", err: { message, stack: "", plugin: "vibelang", id, loc } })
        return []
      }
      return [...affected]
    },
    closeBundle: close,
    closeWatcher: close
  }
}
