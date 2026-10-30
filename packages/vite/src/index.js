import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Vite's default resolve.extensions, which a config that sets none uses.
const viteExtensions = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"]

const cleanId = (id) => id.split("?")[0]
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

// The Node loader's absolute URL, so a process started in any directory finds it.
function registerUrl(root) {
  for (const base of [join(root, "package.json"), fileURLToPath(import.meta.url)]) {
    try {
      return pathToFileURL(createRequire(base).resolve("vibelang/register")).href
    } catch {
      continue
    }
  }
  throw new Error("vibelang-vite's register option needs the vibelang package: npm install --save-dev vibelang")
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
      // Vitest copies test.env into process.env, which the processes a test starts inherit.
      const flag = `--import=${registerUrl(resolve(config.root || process.cwd()))}`
      const inherited = config.test?.env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? ""
      if (inherited.includes(flag)) return added
      return { ...added, test: { env: { NODE_OPTIONS: [inherited, flag].filter(Boolean).join(" ") } } }
    },
    // Vitest's fsModuleCache keys a transform by the module's own text, but a
    // .vibe module's JavaScript also depends on the compiler and on the
    // contracts of the modules it imports, so a rerun would serve JavaScript
    // compiled against an earlier contract. The project compile has its own
    // cache (vibelang/cache), keyed by every input.
    configureVitest(context) {
      const define = context.defineCacheKeyGenerator ?? context.experimental_defineCacheKeyGenerator
      define?.(({ id }) => isCompiled(cleanId(id)) ? false : undefined)
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
      // vibelang rewrites .vibe imports to .js. Keep the original source in Vite's graph.
      if (!importer || !source.startsWith(".") || !cleanId(source).endsWith(".js")) return
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
      if (!isModuleOutput(file) || /[?&](?:raw|url)(?:&|=|$)/.test(id)) return
      const { project, code, map, errors, error } = await (await loaded()).load(file)
      this.addWatchFile(project)
      if (errors.length) this.error(diagnostics(errors, file))
      if (error) this.error(error)
      return { code, map }
    },
    async transform(_source, id) {
      const file = cleanId(id)
      if (!file.endsWith(".vibe") || /[?&](?:raw|url)(?:&|=|$)/.test(id)) return
      const { project, code, map, errors, warnings, error } = await (await loaded()).load(file)
      this.addWatchFile(project)
      // Reject diagnostics for this source, including on repeated requests.
      if (errors.length) this.error(diagnostics(errors, file))
      for (const warning of warnings) logger.warn(backend.formatDiagnostic(warning))
      if (error) this.error(error)
      return { code, map }
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
