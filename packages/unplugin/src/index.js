import { extensionlessImport } from "./relative-imports.js"
import { existsSync, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { createUnplugin } from "unplugin"

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

  async function loadModule(id) {
    const file = cleanId(id)
    const result = await (await loaded()).load(file)
    debug(`load ${file} from ${result.project}`)
    return result
  }

  // The module the plugin serves for a specifier, or undefined to leave it to the bundler.
  function resolveId(source, importer) {
    const path = cleanId(source)
    const query = source.slice(path.length)
    // An absolute id is resolved; webpack sends each result back through this hook.
    if (isAbsolute(path) || (importer && !path.startsWith("."))) return
    const target = resolve(importer ? dirname(cleanId(importer)) : root || process.cwd(), path)
    // Resolve .vibe here too, so esbuild loads every .vibe module in one namespace.
    if (path.endsWith(".vibe")) return existsSync(target) ? target + query : undefined
    // TypeScript resolves `./x` to `x.vibe` when there is no `x.ts` or `x.tsx`.
    const vibe = importer ? extensionlessVibe(dirname(cleanId(importer)), path) : undefined
    if (vibe !== undefined) return vibe + query
    // vibelang rewrites `./x.vibe` and `./x.ts` imports to `./x.js`. Map them back to the source.
    if (!importer || !path.endsWith(".js") || existsSync(target)) return
    if (isModuleOutput(target)) return target + query
    const stem = target.slice(0, -3)
    // Only a compiled module has rewritten .ts imports. esbuild maps those itself,
    // and a plugin result would load the .ts file in the vibelang namespace.
    const sources = isCompiled(importer) && meta.framework !== "esbuild"
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
        build.onResolve({ filter: /^\.\.?(?:\/|$)|\.vibe(?:\?.*)?$/ }, (args) => {
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
    vite: { configResolved(config) { configure(config.root) } },
    webpack(compiler) {
      configure(compiler.context)
      compiler.hooks.shutdown.tapPromise("vibelang-backend", close)
      compiler.hooks.beforeCompile.tapPromise("vibelang-backend", loaded)
      compiler.hooks.thisCompilation.tap("vibelang-backend", (compilation) => {
        // The backend is selected from the app, so record the actual files
        // rather than a static dependency on the plugin's fallback install.
        for (const file of [backend.backendPath, backend.findCompiler(root, options.compiler), join(dirname(backend.backendPath), "native/vibelang")]) {
          if (existsSync(file)) compilation.buildDependencies.add(file)
        }
      })
    },
    rspack(compiler) {
      configure(compiler.context)
      compiler.hooks.shutdown.tapPromise("vibelang-backend", close)
    },
    esbuild: {
      config(initialOptions) { configure(initialOptions.absWorkingDir) },
      // No path matches /a^/: use the native loader to preserve diagnostic lineText,
      // and resolve below, where the result can carry the module's side effects.
      onLoadFilter: /a^/,
      onResolveFilter: /a^/,
      setup(build) {
        build.onDispose?.(close)
        build.onResolve({ filter: /^\.\.?(?:\/|$)|\.vibe(?:\?.*)?$/ }, (args) => {
          const id = resolveId(args.path, args.kind === "entry-point" ? undefined : args.importer)
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
