import { declarationEmitter } from "./declarations.js"
import { relativeOutput } from "./relative-output.js"
import { missingSourceWatcher } from "./missing-watcher.js"
import { jsxConfigReader } from "./jsx-config.js"
import { extensionlessImport, missingRelativeInputs } from "./relative-imports.js"
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createUnplugin } from "unplugin"
import { isVibeLangFile } from "./vibe-directive.js"

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

// Emitted relative imports are URLs; bundler hooks resolve filesystem names.
// Decode once so a literal percent sequence retains its filename spelling.
function outputPath(source, importer, written) {
  if (!importer || !isCompiled(cleanId(importer)) || !source.startsWith(".") || !/\.jsx?$/.test(source)) return source
  let decoded
  try { decoded = decodeURIComponent(source) } catch { return source }
  if (decoded === source) return source
  // Authored .js imports retain TypeScript's literal filename spelling,
  // including when only a declaration file exists for the runtime module.
  if (written(source, importer)) return source
  return decoded
}


// Declaration sidecars are for type checkers. A *.ts entry glob can include
// them beside the .vibe sources already selected for this build.
function withoutSidecarEntries(input) {
  const source = id => typeof id !== "string" || !/\.d\.vibex?\.ts$/.test(cleanId(id))
  if (Array.isArray(input)) return input.filter(source)
  if (typeof input === "string") return source(input) ? input : []
  if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).filter(([, id]) => source(id)))
  return input
}

// A module declaration of main.vibe compiles to main.vibe.text.js beside it
// (D403), which is not on disk: the project's compile serves it. The pattern
// is vibelang/project's moduleDeclarationSource.
function isModuleOutput(path) {
  const source = /^(.+\.vibe)\.[^./\\]+\.js$/.exec(path)?.[1]
  return source !== undefined && !existsSync(path) && existsSync(source)
}
// A module whose JavaScript the plugin compiles: a VibeLang source or module declaration.
const isCompiled = (id) => isVibeLangFile(cleanId(id)) || isModuleOutput(cleanId(id))

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
 * The names, without .vibe, of the .vibe files under each directory, under each
 * package a node_modules there links to (a workspace or file: dependency), and
 * under each installed package with its own project file, the only place an
 * installed .vibe module compiles (workspaceProject). Dot directories and
 * other installed packages, which ship JavaScript, are skipped, except a
 * directory named here: a project inside a dot directory keeps its own names.
 */
export function vibeBasenames(...directories) {
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
  for (const directory of directories) walk(directory)
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
  let root, project, backend, modules, current, closing, entryDirectory

  function configure(base) {
    if (root) return
    root = resolve(options.root || base || process.cwd())
    project = resolve(root, options.project || "tsconfig.json")
    debug(`configure ${meta.framework}: root=${root}, project=${project}`)
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

  const writtenImports = new Map()
  function writtenOutput(source, importer) {
    const file = backend.moduleDeclarationSource?.(cleanId(importer)) ?? cleanId(importer)
    const selected = current?.projectOf?.(file) ?? backend.nearestProject(file) ?? project
    const canonical = path => { try { return realpathSync(path) } catch { return resolve(path) } }
    const from = canonical(file)
    const text = readFileSync(file, "utf8")
    let entry = writtenImports.get(from)
    if (entry?.project !== selected || entry.text !== text) {
      const result = backend.projectImports({ root: backend.packageRoot(selected), project: selected, compiler: compilerPath() })
      entry = { project: selected, text, imports: new Set(result.imports.filter(item => canonical(item.importer) === from).map(item => cleanId(item.specifier))) }
      writtenImports.set(from, entry)
    }
    const written = entry.imports.has(source)
    debug(`relative output name from ${file}: ${written ? "written import" : "rewritten import"}`)
    return written
  }

  let jsxReader
  const sourceImports = new Map()
  function resolvedSourceImport(path, importer) {
    const file = cleanId(importer)
    const selected = current?.projectOf?.(file) ?? backend.nearestProject(file) ?? project
    const text = readFileSync(file, "utf8")
    let entry = sourceImports.get(file)
    if (entry?.project !== selected || entry.text !== text) {
      const result = backend.projectImports({ project: selected, compiler: compilerPath() })
      const canonical = path => { try { return realpathSync(path) } catch { return resolve(path) } }
      entry = { project: selected, text, imports: result.imports.filter(item => canonical(item.importer) === canonical(file)) }
      sourceImports.set(file, entry)
    }
    // A written JavaScript import keeps the compiler's source priority.
    // An explicit source import instead names its rewritten output.
    const exact = entry.imports.find(item => cleanId(item.specifier) === path)
    const rewritten = entry.imports.find(item => {
      const specifier = cleanId(item.specifier)
      return /\.(?:vibex?|tsx?)$/.test(specifier) &&
        resolve(dirname(file), specifier.replace(/\.(?:vibex?|tsx?)$/, "")) === resolve(dirname(file), path.replace(/\.[cm]?[jt]sx?$/, ""))
    })
    return (exact ?? rewritten)?.file
  }
  let declarations
  function close() {
    const declarationClosing = declarations?.close()
    declarations = undefined
    writtenImports.clear()
    sourceImports.clear()
    const jsxClosing = jsxReader?.close()
    const pending = modules
    modules = undefined
    current = undefined
    const work = Promise.resolve(closing).then(async () => {
      // A backend that failed to load failed its build already; it has nothing to close.
      const projects = await pending?.catch(() => undefined)
      await Promise.all([projects?.close(), jsxClosing, declarationClosing])
    })
    closing = work
    return work
  }

  async function loadModule(id) {
    const file = cleanId(id)
    const compiled = await (await loaded()).load(file)
    const result = relativeOutput(compiled, file, backend, compilerPath, debug)
    debug(`load ${file} from ${result.project}`)
    const missing = missingRelativeInputs(result.errors)
    if (missing.length) debug(`watch missing relative inputs: ${missing.join(", ")}`)
    // Keep missing candidates in the bundler's watch set, outside the backend's
    // existing-input snapshot and its check for saves made during a compile.
    return missing.length ? { ...result, inputs: [...new Set([...result.inputs, ...missing])] } : result
  }

  // The module the plugin serves for a specifier, or undefined to leave it to
  // the bundler. directory is where a relative specifier resolves from, when
  // the bundler says (esbuild's resolveDir: an entry point's absWorkingDir, or
  // stdin's resolveDir, whose importer is "<stdin>"); else the importer's, or
  // Bun's working directory or Rolldown's cwd for entry points, or the compiler root otherwise.
  // unplugin passes hook options third, so resolveId supplies the directory.
  function resolveId(source, importer) {
    if (meta.framework === "rolldown" && importer && /\.d\.[cm]?ts$/.test(cleanId(importer))) {
      return resolveDeclaration(source, importer)
    }
    return resolveFrom(source, importer, importer ? undefined : entryDirectory)
  }

  async function resolveDeclaration(source, importer) {
    await loaded()
    const resolved = resolveFrom(source, importer)
    let sourceFile = resolved ?? (isAbsolute(cleanId(source)) ? source : undefined)
    if (!sourceFile || !/\.vibex?$/.test(cleanId(sourceFile))) {
      const original = declarations?.sourceOf(cleanId(importer)) ??
        [importer.replace(/\.d\.([cm]?)ts$/, ".$1ts"), importer.replace(/\.d\.ts$/, ".tsx")].find(existsSync)
      if (original) sourceFile = resolvedSourceImport(source, original)
    }
    if (!sourceFile || !/\.vibex?$/.test(cleanId(sourceFile))) return resolved
    const result = await loadModule(sourceFile)
    if (result.errors.length) throw new Error(result.errors.map(backend.formatDiagnostic).join("\n"))
    if (result.error) throw result.error
    declarations ??= declarationEmitter({ backend: () => backend, compiler: compilerPath, debug })
    return declarations.resolve(cleanId(sourceFile), result.project, result.inputs)
  }

  function resolveFrom(source, importer, directory) {
    const original = cleanId(source)
    const query = source.slice(original.length)
    const path = outputPath(original, importer, writtenOutput)
    // An absolute id is resolved; webpack sends each result back through this hook.
    if (isAbsolute(path) || (importer && !path.startsWith("."))) return
    const base = directory || (importer ? dirname(cleanId(importer)) : root || process.cwd())
    const target = resolve(base, path)
    if (path !== original && existsSync(target)) return target + query
    // Resolve .vibe here too, so esbuild loads every .vibe module in one namespace.
    if (/\.vibex?$/.test(path)) return existsSync(target) ? target + query : undefined
    // TypeScript resolves `./x` to `x.vibe` when there is no `x.ts` or `x.tsx`.
    const vibe = importer ? extensionlessVibe(base, path) : undefined
    if (vibe !== undefined) return vibe + query
    // vibelang rewrites `./x.vibe` and `./x.ts` imports to `./x.js`. Map them back to the source.
    if (!importer || !/\.jsx?$/.test(path) || existsSync(target)) return
    if (isModuleOutput(target)) return target + query
    const stem = target.replace(/\.jsx?$/, "")
    if (existsSync(stem + ".vibex") && [".ts", ".tsx", ".vibe"].some(extension => existsSync(stem + extension))) {
      const selected = isCompiled(importer) ? resolvedSourceImport(path, importer) : undefined
      if (selected && /\.vibex?$/.test(selected)) return selected + query
      // Keep ordinary TypeScript in the host's native namespace.
      if (meta.framework === "esbuild" || meta.framework === "bun") return
      if (selected) return selected + query
      return
    }
    // Only a compiled module has rewritten .ts imports. esbuild maps those itself,
    // and a plugin result would load the .ts file in the vibelang namespace.
    // Bun also maps these itself; its hook serves only .vibe and module outputs.
    const sources = path.endsWith(".jsx") ? [".vibex"] : isCompiled(importer) && meta.framework !== "esbuild" && meta.framework !== "bun"
      ? [".vibe", ".vibex", ".ts", ".tsx"] : [".vibe", ".vibex"]
    for (const extension of sources) if (existsSync(stem + extension)) return stem + extension + query
  }

  let missingWatcher, watchClosed = false, buildNumber = 0
  return {
    name: "vibelang",
    enforce: "pre",
    // Every build, and every watch rebuild, compiles each project once.
    async buildStart() {
      watchClosed = false
      missingWatcher?.begin()
      ;(await loaded()).invalidate()
      if (meta.framework === "esbuild") jsxReader = jsxConfigReader({ compiler: compilerPath(), compilerCommand: backend.compilerCommand, debug })
      debug(`build ${++buildNumber} start`)
    },
    closeBundle: close,
    async closeWatcher() {
      watchClosed = true
      try { await close() }
      finally {
        missingWatcher?.close()
        missingWatcher = undefined
      }
    },
    // Bun/esbuild and webpack/Rspack do not forward closeBundle. Every
    // adapter awaits buildEnd, so dispose after each build, including watch
    // rebuilds, and start a fresh backend on the next one.
    async buildEnd(error) {
      await close()
      missingWatcher?.finish(error)
    },
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
    loadInclude: meta.framework === "bun" ? undefined : id => declarations?.has(cleanId(id)) || isCompiled(id),
    load: meta.framework === "bun" ? undefined : async function load(id) {
      if (declarations?.has(cleanId(id))) {
        const declaration = await declarations.load(cleanId(id))
        for (const file of declaration.inputs) {
          let watched = file
          while (!existsSync(watched) && dirname(watched) !== watched) watched = dirname(watched)
          this.addWatchFile(watched)
        }
        return { code: declaration.code, map: null }
      }
      const { project, code, map, inputs, errors, warnings, error } = await loadModule(id)
      // Any project source or the tsconfig can change the contracts this module compiles against.
      const rollupWatch = meta.framework === "rollup" && this.meta?.watchMode && !watchClosed
      const nativeWatch = ["rolldown", "vite"].includes(meta.framework)
      const watch = new Set()
      for (const input of [project, ...inputs]) {
        if (rollupWatch && !existsSync(input)) continue
        if (!nativeWatch || existsSync(input)) watch.add(input)
        else {
          // Native watchers can ignore absent paths. Register their existing
          // parent instead: multiple absent alternatives in one directory can
          // otherwise narrow its watcher to just one of those file names.
          let directory = dirname(input)
          while (!existsSync(directory) && dirname(directory) !== directory) directory = dirname(directory)
          watch.add(directory)
          debug(`watch missing relative source directory: ${directory}`)
        }
      }
      for (const input of watch) this.addWatchFile(input)
      if (rollupWatch) {
        const missing = missingRelativeInputs(errors)
        if (missing.length) {
          missingWatcher ??= missingSourceWatcher(debug)
          this.addWatchFile(missingWatcher.file)
          missingWatcher.add(missing)
        }
      }
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
        // The compiler project can be elsewhere; Bun entries belong to the caller.
        entryDirectory = process.cwd()
        configure(entryDirectory)
        const repository = repositoryOf(root)
        const names = vibeBasenames(repository, root)
        debug(`bun: entry directory=${entryDirectory}; .js imports resolve for ${names.size} .vibe names under ${repository}`)
        build.onResolve({ filter: bunResolveFilter(names) }, (args) => {
          const entry = args.kind === "entry-point-build" || args.kind === "entry-point-run"
          const id = resolveId(args.path, entry ? undefined : args.importer)
          return id === undefined ? undefined : { path: id }
        })
        // Bun.build ignores a plugin's source map, so the module is its JavaScript alone.
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
        // The compiler root can be explicit; relative entries still belong to cwd.
        entryDirectory = resolve(input.cwd || process.cwd())
        configure(entryDirectory)
        const defaults = ["module", ...(input.platform === "neutral" ? [] : [input.platform ?? "browser"])]
        return { ...input, input: withoutSidecarEntries(input.input), resolve: { ...input.resolve, conditionNames: sourceConditions(input.resolve?.conditionNames ?? defaults) } }
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
        build.onResolve({ filter: /^\.\.?(?:\/|$)|\.vibex?(?:\?.*)?$/ }, (args) => {
          // Generated module maps can import a source by absolute path.
          // Give it the same namespace as relative imports so it runs once.
          const absolute = cleanId(args.path)
          const id = isAbsolute(absolute) && isCompiled(absolute) && existsSync(absolute)
            ? resolve(absolute) + args.path.slice(absolute.length)
            : resolveFrom(args.path, args.kind === "entry-point" ? undefined : args.importer, args.resolveDir)
          if (id === undefined) {
            const path = outputPath(args.path, args.importer, writtenOutput)
            if (path !== args.path) return build.resolve(path, {
              importer: args.importer, resolveDir: args.resolveDir, kind: args.kind, namespace: "file"
            })
            return
          }
          // Without this, esbuild keeps every .vibe module of a package that declares
          // none has side effects, and tree shaking drops nothing it imports.
          const sideEffects = sideEffectsOf(cleanId(id))
          return { path: id, namespace: "vibelang", ...(sideEffects === undefined ? {} : { sideEffects }) }
        })
        build.onLoad({ filter: /\.(?:vibex?(?:\.[^./\\]+\.js)?|tsx?|[cm]ts)(?:\?.*)?$/ }, async ({ path }) => {
          if (!isCompiled(path)) return undefined
          const { project, code, map: compilerMap, inputs, errors, warnings, error } = await loadModule(path)
          // Inline maps carry URLs. Preserve filesystem spelling when the
          // native esbuild loader reads percent escapes and Unicode names.
          const map = compilerMap && { ...compilerMap, sources: compilerMap.sources.map(source => isAbsolute(source) ? pathToFileURL(source).href : source) }
          const messages = []
          if (errors.length) {
            messages.push({
              ...await esbuildMessage(backend.formatDiagnostic, errors.find((diagnostic) => diagnostic.file) || errors[0]),
              text: errors.map(backend.formatDiagnostic).join("\n")
            })
          }
          if (error) messages.push({ text: error.message })
          // Inline source-map sources are URLs. Keep percent signs literal
          // when esbuild resolves and combines this map with its JSX output.
          const outputMap = map && cleanId(path).endsWith(".vibex")
            ? { ...map, sources: map.sources.map(source => isAbsolute(source) ? pathToFileURL(source).href : source) }
            : map
          let contents = outputMap
            ? `${code}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(outputMap)).toString("base64")}`
            : code
          let jsxWarnings = []
          if (cleanId(path).endsWith(".vibex") && !messages.length) {
            const transformed = await build.esbuild.transform(contents, {
              loader: "jsx", sourcefile: cleanId(path), sourcemap: "inline",
              tsconfigRaw: await jsxReader.read(project),
              ...Object.fromEntries(["jsx", "jsxFactory", "jsxFragment", "jsxImportSource", "jsxDev", "jsxSideEffects"].filter(key => build.initialOptions[key] !== undefined).map(key => [key, build.initialOptions[key]]))
            })
            contents = transformed.code
            jsxWarnings = transformed.warnings
          }
          return {
            contents,
            loader: cleanId(path).endsWith(".vibex") ? "jsx" : "js", resolveDir: dirname(path), watchFiles: [project, ...inputs],
            errors: messages,
            warnings: !errors.length ? [...await Promise.all(warnings.map((warning) => esbuildMessage(backend.formatDiagnostic, warning))), ...jsxWarnings] : []
          }
        })
      }
    }
  }
})

export default unplugin
