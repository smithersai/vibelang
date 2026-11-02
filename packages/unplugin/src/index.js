import { extensionlessImport } from "./relative-imports.js"
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { createUnplugin } from "unplugin"

const sourceConditions = (conditions = []) => conditions.includes("vibelang-source") ? conditions : ["vibelang-source", ...conditions]

// Preserve the host's native defaults when the user supplied no conditions.
// Vite concatenates arrays returned by config hooks with the user's arrays.
// Vitest's defaults leave out `module` (its getDefaultServerConditions): it
// passes its server conditions to the Node processes that run tests as
// --conditions, and a package's `module` export is often bundler-only ESM.
// Vite's own, `module` included, made Node load @opentelemetry/api's build/esm
// in Smithers' tests. Vitest sets VITEST before it loads the config.
function sourceConditionConfig(config) {
  const condition = "vibelang-source"
  const conditions = (current, defaults) => current?.includes(condition) ? {} : { conditions: [...(current ? [] : defaults), condition] }
  const vitest = process.env.VITEST === "true" && !config.test?.browser?.enabled
  return {
    resolve: conditions(config.resolve?.conditions, vitest ? ["node", "development|production"] : ["module", "browser", "development|production"]),
    ssr: { resolve: conditions(config.ssr?.resolve?.conditions, vitest ? ["node", "development|production"] : ["module", "node", "development|production"]) }
  }
}

const cleanId = (id) => id.split("?")[0]

// A module declaration of main.vibe compiles to main.vibe.text.js beside it
// (D403), which is not on disk: the project's compile serves it. The pattern
// is vibelang/project's moduleDeclarationSource.
function isModuleOutput(path) {
  const source = /^(.+\.vibe)\.[^./\\]+\.js$/.exec(path)?.[1]
  return source !== undefined && !existsSync(path) && existsSync(source)
}
// A module whose JavaScript the plugin compiles: a .vibe module or one of its module declarations.
const isCompiled = (id) => cleanId(id).endsWith(".vibe") || isModuleOutput(cleanId(id))

// Keep TypeScript's source priority when the bundler cannot find .vibe.
function extensionlessVibe(directory, specifier) {
  const source = extensionlessImport(directory, specifier)
  return source?.endsWith(".vibe") ? source : undefined
}

// The directory whose .vibe modules a build can reach: the nearest ancestor of
// root with .git or .jj, else the outermost one that declares workspaces, else root.
export function repositoryOf(root) {
  let workspace
  for (let directory = root; ; directory = dirname(directory)) {
    if (existsSync(join(directory, ".git")) || existsSync(join(directory, ".jj"))) return directory
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) workspace = directory
    else if (existsSync(join(directory, "package.json"))) {
      try {
        if (JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).workspaces) workspace = directory
      } catch {}
    }
    if (dirname(directory) === directory) return workspace ?? root
  }
}

// The files nearestProject reads a project from.
const projectFiles = ["vibe.config.json", "tsconfig.json", "jsconfig.json"]

/**
 * The names, without .vibe, of the .vibe files under directory, under each
 * package a node_modules there links to (a workspace or file: dependency), and
 * under each installed package with its own project file, the only place an
 * installed .vibe module compiles (workspaceProject). Dot directories and
 * other installed packages, which ship JavaScript, are skipped.
 */
export function vibeBasenames(directory) {
  const names = new Set()
  const visited = new Set()
  const isDirectory = (path) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  }
  const list = (path) => {
    try {
      return readdirSync(path, { withFileTypes: true })
    } catch {
      return []
    }
  }
  const walk = (path) => {
    let real
    try {
      real = realpathSync(path)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)
    for (const entry of list(path)) {
      if (entry.name.startsWith(".")) continue
      const child = join(path, entry.name)
      if (entry.name === "node_modules" && entry.isDirectory()) links(child)
      else if (entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(child))) walk(child)
      else if (entry.name.endsWith(".vibe")) names.add(entry.name.slice(0, -".vibe".length))
    }
  }
  const links = (path) => {
    for (const entry of list(path)) {
      if (entry.name.startsWith(".")) continue
      const child = join(path, entry.name)
      if (entry.name.startsWith("@") && entry.isDirectory()) links(child)
      else if (entry.isSymbolicLink() && isDirectory(child)) walk(child)
      else if (entry.isDirectory() && projectFiles.some((name) => existsSync(join(child, name)))) walk(child)
    }
  }
  walk(directory)
  return names
}

/**
 * The onResolve filter of the plugin's Bun hook: every specifier resolveId can
 * serve there. That is a .vibe name, a relative name with no extension
 * TypeScript removes (extensionlessImport), a module declaration's
 * ./x.vibe.text.js, and a relative ./x.js where names holds x. Bun 1.4.4
 * miscompiles a CommonJS dependency (opencode's ws under
 * @effect/platform-node's NodeWS: "c is not defined") once a plugin's
 * onResolve matches the .js imports inside the packages it bundles, even when
 * the hook returns nothing. A .js import names a .vibe module only where a
 * .vibe file of that name exists, so only those names match. Bun maps a
 * compiled module's ./x.js to x.ts or x.tsx itself.
 */
export function bunResolveFilter(names) {
  const escape = (name) => name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
  const relative = String.raw`^\.\.?(?:\/|$)`
  const unnamed = relative + String.raw`(?!.*\.(?:d\.[cm]?ts|[cm]?[jt]s|[jt]sx|json|vibe)(?:\?.*)?$)`
  const declaration = relative + String.raw`.*\.vibe\.[^./\\]+\.js(?:\?.*)?$`
  const sources = names.size
    ? [relative + String.raw`(?:.*\/)?(?:` + [...names].sort().map(escape).join("|") + String.raw`)\.js(?:\?.*)?$`]
    : []
  return new RegExp([unnamed, String.raw`\.vibe(?:\?.*)?$`, declaration, ...sources].join("|"))
}

// VIBELANG_UNPLUGIN_DEBUG=1 traces each compile and module load on stderr.
const debug = process.env.VIBELANG_UNPLUGIN_DEBUG ? (text) => console.error(`vibelang-unplugin: ${text}`) : () => {}

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
    // Node 22.22.3 can require this synchronous ESM graph. A computed import()
    // makes webpack's filesystem-cache dependency scanner warn and skip it.
    return { ...createRequire(base)(path), backendPath: path }
  }
  throw new Error("vibelang-unplugin needs the vibelang package: npm install --save-dev vibelang")
}

// A glob from package.json `sideEffects`, as esbuild reads it: a pattern without
// a slash matches a file of that name in any directory.
function globMatches(pattern, path) {
  const glob = pattern.replace(/^\.\//, "")
  const source = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/|\*\*|\*|\?/g, (token) =>
    token === "**/" ? "(?:.*/)?" : token === "**" ? ".*" : token === "*" ? "[^/]*" : "[^/]")
  return new RegExp(`^${glob.includes("/") ? "" : "(?:.*/)?"}${source}$`).test(path)
}

// What the nearest package.json's `sideEffects` says of file: false when it marks
// the file free of side effects, undefined when it says nothing. esbuild reads the
// field only for paths it resolves itself, so the plugin passes it on.
function sideEffectsOf(file) {
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    const manifest = join(directory, "package.json")
    if (existsSync(manifest)) {
      let declared
      try {
        declared = JSON.parse(readFileSync(manifest, "utf8")).sideEffects
      } catch {
        return undefined
      }
      if (declared === false) return false
      if (!Array.isArray(declared)) return undefined
      const path = relative(directory, file).split(sep).join("/")
      return declared.some((pattern) => typeof pattern === "string" && globMatches(pattern, path)) ? undefined : false
    }
    if (dirname(directory) === directory) return undefined
  }
}

async function esbuildMessage(formatDiagnostic, diagnostic) {
  return {
    text: formatDiagnostic(diagnostic),
    location: diagnostic.file && {
      file: diagnostic.file, line: diagnostic.line, column: diagnostic.column - 1,
      lineText: (await readFile(diagnostic.file, "utf8")).split(/\r?\n/)[diagnostic.line - 1]
    }
  }
}

/** @type {import('./index.d.ts').unplugin} */
export const unplugin = createUnplugin((options = {}, meta) => {
  let root, project, backend, modules, current, closing

  function configure(base) {
    if (root) return
    root = resolve(options.root || base || process.cwd())
    project = resolve(root, options.project || "tsconfig.json")
  }

  // One compile per tsconfig: the project for root's modules, and each
  // workspace package's own for modules outside root.
  function loaded() {
    configure()
    modules ??= Promise.resolve(closing).then(() => loadBackend(root)).then((value) => {
      backend = value
      current = backend.projects({ root, project, compiler: compilerPath(), debug })
      return current
    })
    return modules
  }

  // The compiler: the compiler option, VIBELANG_BINARY, or root's vibelang
  // install; else the vibelang package whose backend loaded, beside this
  // plugin. A build that runs from a directory without its own install, such
  // as a test under a monorepo's root, still compiles.
  function compilerPath() {
    try {
      return backend.findCompiler(root, options.compiler)
    } catch {
      return join(dirname(backend.backendPath), "bin/vibelang")
    }
  }

  function close() {
    const pending = modules
    modules = undefined
    current = undefined
    const work = Promise.resolve(closing).then(async () => {
      // A backend that failed to load failed its build already; it has nothing to close.
      const projects = await pending?.catch(() => undefined)
      await projects?.close()
    })
    closing = work
    return work
  }

  async function loadModule(id) {
    const file = cleanId(id)
    const result = await (await loaded()).load(file)
    debug(`load ${file} from ${result.project}`)
    return result
  }

  // The module the plugin serves for a specifier, or undefined to leave it to
  // the bundler. directory is where a relative specifier resolves from, when
  // the bundler says (esbuild's resolveDir: an entry point's absWorkingDir, or
  // stdin's resolveDir, whose importer is "<stdin>"); else the importer's, or
  // the root for an entry point. unplugin's resolveId hook passes its own
  // options third, so the hook is resolveId and only esbuild passes a directory.
  function resolveId(source, importer) {
    return resolveFrom(source, importer)
  }

  function resolveFrom(source, importer, directory) {
    const path = cleanId(source)
    const query = source.slice(path.length)
    // An absolute id is resolved; webpack sends each result back through this hook.
    if (isAbsolute(path) || (importer && !path.startsWith("."))) return
    const base = directory || (importer ? dirname(cleanId(importer)) : root || process.cwd())
    const target = resolve(base, path)
    // Resolve .vibe here too, so esbuild loads every .vibe module in one namespace.
    if (path.endsWith(".vibe")) return existsSync(target) ? target + query : undefined
    // TypeScript resolves `./x` to `x.vibe` when there is no `x.ts` or `x.tsx`.
    const vibe = importer ? extensionlessVibe(base, path) : undefined
    if (vibe !== undefined) return vibe + query
    // vibelang rewrites `./x.vibe` and `./x.ts` imports to `./x.js`. Map them back to the source.
    if (!importer || !path.endsWith(".js") || existsSync(target)) return
    if (isModuleOutput(target)) return target + query
    const stem = target.slice(0, -3)
    // Only a compiled module has rewritten .ts imports. esbuild maps those itself,
    // and a plugin result would load the .ts file in the vibelang namespace.
    // Bun also maps these itself; its hook serves only .vibe and module outputs.
    const sources = isCompiled(importer) && meta.framework !== "esbuild" && meta.framework !== "bun"
      ? [".vibe", ".ts", ".tsx"] : [".vibe"]
    for (const extension of sources) if (existsSync(stem + extension)) return stem + extension + query
  }

  return {
    name: "vibelang",
    enforce: "pre",
    // Every build, and every watch rebuild, compiles each project once.
    async buildStart() {
      ;(await loaded()).invalidate()
      debug("build start")
    },
    closeBundle: close,
    closeWatcher: close,
    // Bun/esbuild and webpack/Rspack do not forward closeBundle. Every
    // adapter awaits buildEnd, so dispose after each build, including watch
    // rebuilds, and start a fresh backend on the next one.
    buildEnd: close,
    watchChange(id) {
      if (/\.(?:vibe|[cm]?tsx?|json)$/.test(id)) current?.invalidate()
      debug(`watch change ${id}`)
    },
    // Bun 1.4.2 stops resolving Bun.build's in-memory `files` once a plugin's
    // onResolve matches their names, and panics on a `with { type: "file" }`
    // import once a plugin's onLoad matches every file, even when the hooks
    // return nothing. unplugin's Bun adapter registers both for every path, so
    // under Bun the plugin registers its own hooks, filtered to what it serves.
    resolveId: meta.framework === "bun" ? undefined : resolveId,
    loadInclude: meta.framework === "bun" ? undefined : isCompiled,
    load: meta.framework === "bun" ? undefined : async function load(id) {
      const { project, code, map, inputs, errors, warnings, error } = await loadModule(id)
      // Any project source or the tsconfig can change the contracts this module compiles against.
      for (const input of [project, ...inputs]) this.addWatchFile(input)
      // Reject this source's errors even after another clean module was loaded.
      if (errors.length) {
        const first = errors.find((diagnostic) => diagnostic.file) || {}
        this.error({
          message: errors.map(backend.formatDiagnostic).join("\n"),
          id: first.file || cleanId(id),
          loc: first.file && { file: first.file, line: first.line, column: first.column - 1 }
        })
      }
      if (!errors.length) for (const warning of warnings) this.warn(backend.formatDiagnostic(warning))
      if (error) this.error(error)
      return { code, map, moduleType: "js" }
    },
    bun: {
      setup(build) {
        if (build.config) build.config.conditions = sourceConditions(build.config.conditions)
        configure()
        const repository = repositoryOf(root)
        const names = vibeBasenames(repository)
        debug(`bun: .js imports resolve for ${names.size} .vibe names under ${repository}`)
        build.onResolve({ filter: bunResolveFilter(names) }, (args) => {
          const entry = args.kind === "entry-point-build" || args.kind === "entry-point-run"
          const id = resolveId(args.path, entry ? undefined : args.importer)
          return id === undefined ? undefined : { path: id }
        })
        // Bun ignores plugin source maps, so the module is its JavaScript alone.
        build.onLoad({ filter: /\.vibe(?:\.[^./\\]+\.js)?(?:\?.*)?$/ }, async ({ path }) => {
          if (!isCompiled(path)) return undefined
          const { code, errors, warnings, error } = await loadModule(path)
          if (errors.length) throw new Error(errors.map(backend.formatDiagnostic).join("\n"))
          if (!errors.length) for (const warning of warnings) console.warn(backend.formatDiagnostic(warning))
          if (error) throw new Error(error.message)
          return { contents: code, loader: "js" }
        })
      }
    },
    rolldown: {
      options(input) {
        const defaults = ["module", ...(input.platform === "neutral" ? [] : [input.platform ?? "browser"])]
        return { ...input, resolve: { ...input.resolve, conditionNames: sourceConditions(input.resolve?.conditionNames ?? defaults) } }
      }
    },
    vite: { config: sourceConditionConfig, configResolved(config) { configure(config.root) } },
    webpack(compiler) {
      configure(compiler.context)
      compiler.options.resolve ??= {}
      compiler.options.resolve.conditionNames = sourceConditions(compiler.options.resolve.conditionNames ?? ["..."])
      compiler.hooks.shutdown.tapPromise("vibelang-backend", close)
      compiler.hooks.beforeCompile.tapPromise("vibelang-backend", loaded)
      compiler.hooks.thisCompilation.tap("vibelang-backend", (compilation) => {
        // The backend is selected from the app, so record the actual files
        // rather than a static dependency on the plugin's fallback install.
        for (const file of [backend.backendPath, compilerPath(), join(dirname(backend.backendPath), "native/vibelang")]) {
          if (existsSync(file)) compilation.buildDependencies.add(file)
        }
      })
    },
    rspack(compiler) {
      configure(compiler.context)
      compiler.options.resolve ??= {}
      compiler.options.resolve.conditionNames = sourceConditions(compiler.options.resolve.conditionNames ?? ["..."])
      compiler.hooks.shutdown.tapPromise("vibelang-backend", close)
    },
    esbuild: {
      config(initialOptions) {
        configure(initialOptions.absWorkingDir)
        // esbuild enables module automatically only without custom conditions.
        initialOptions.conditions = sourceConditions(initialOptions.conditions ?? ["module"])
      },
      // No path matches /a^/: use the native loader to preserve diagnostic lineText,
      // and resolve below, where the result can carry the module's side effects.
      onLoadFilter: /a^/,
      onResolveFilter: /a^/,
      setup(build) {
        build.onDispose?.(close)
        build.onResolve({ filter: /^\.\.?(?:\/|$)|\.vibe(?:\?.*)?$/ }, (args) => {
          const id = resolveFrom(args.path, args.kind === "entry-point" ? undefined : args.importer, args.resolveDir)
          if (id === undefined) return
          // Without this, esbuild keeps every .vibe module of a package that declares
          // none has side effects, and tree shaking drops nothing it imports.
          const sideEffects = sideEffectsOf(cleanId(id))
          return { path: id, namespace: "vibelang", ...(sideEffects === undefined ? {} : { sideEffects }) }
        })
        build.onLoad({ filter: /\.vibe(?:\.[^./\\]+\.js)?(?:\?.*)?$/ }, async ({ path }) => {
          if (!isCompiled(path)) return undefined
          const { project, code, map, inputs, errors, warnings, error } = await loadModule(path)
          const messages = []
          if (errors.length) {
            messages.push({
              ...await esbuildMessage(backend.formatDiagnostic, errors.find((diagnostic) => diagnostic.file) || errors[0]),
              text: errors.map(backend.formatDiagnostic).join("\n")
            })
          }
          if (error) messages.push({ text: error.message })
          return {
            contents: map
              ? `${code}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}`
              : code,
            loader: "js", resolveDir: dirname(path), watchFiles: [project, ...inputs],
            errors: messages,
            warnings: !errors.length ? await Promise.all(warnings.map((warning) => esbuildMessage(backend.formatDiagnostic, warning))) : []
          }
        })
      }
    }
  }
})

export default unplugin
