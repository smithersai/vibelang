import { diagnosticsForFile } from "./diagnostics.mjs"
// Whole-project compilation for the bundler plugins (vibelang-vite,
// vibelang-unplugin) and the Node and Bun loaders (vibelang/register,
// vibelang/bun).
//
// VibeLang's emit is type-directed: a module's JavaScript depends on the
// contracts of the modules it imports, so no module compiles alone. Each
// compile is one vibelang process over a whole tsconfig project, and its
// result is kept in a persistent cache (cache.mjs) that later processes reuse
// while the project's inputs are unchanged.
import { spawn, spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { performance } from "node:perf_hooks"
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { launcherBinary, projectCache } from "./cache.mjs"

const slash = (path) => path.replaceAll("\\", "/")
const located = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(\w+\d+):\s?(.*)$/
const global = /^(error|warning)\s+(\w+\d+):\s?(.*)$/

/**
 * Returns the compiler command: the `compiler` option, else VIBELANG_BINARY,
 * else the launcher of the vibelang package installed for `root`.
 */
export function findCompiler(root, compiler) {
  if (compiler) return resolve(root, compiler)
  if (process.env.VIBELANG_BINARY) return resolve(root, process.env.VIBELANG_BINARY)
  const require = createRequire(join(root, "package.json"))
  return join(dirname(require.resolve("vibelang/package.json")), "bin/vibelang")
}

// The npm launcher and the native platform packages both install bin/vibelang,
// so read the shebang instead of trusting the filename.
function isNodeLauncher(path) {
  if (/\.(?:[cm]?js)$/.test(path)) return true
  let file
  try {
    file = openSync(path, "r")
    const header = Buffer.alloc(256)
    const bytes = readSync(file, header, 0, header.length, 0)
    return /^#![^\r\n]*\bnode(?:\s|$)/.test(header.subarray(0, bytes).toString("utf8"))
  } catch {
    return false
  } finally {
    if (file !== undefined) closeSync(file)
  }
}

// The vibelang launcher only finds the native compiler and runs it, so a
// compile runs that binary itself and skips starting Node for the launcher.
function command(compiler, args) {
  const binary = launcherBinary(compiler)
  if (binary !== undefined && existsSync(binary)) return [binary, args]
  return isNodeLauncher(compiler) ? [process.execPath, [compiler, ...args]] : [compiler, args]
}

/**
 * Parses `vibelang --pretty false --listFiles` output into the files the
 * program read and the diagnostics it reported. A diagnostic's position is
 * 1-based, as the compiler prints it.
 */
export function parseOutput(output, root) {
  const files = []
  const diagnostics = []
  for (const line of output.split(/\r?\n/)) {
    let match
    if ((match = line.match(located))) {
      diagnostics.push({
        file: resolve(root, match[1]), line: Number(match[2]), column: Number(match[3]),
        category: match[4], code: match[5], text: match[6]
      })
    } else if ((match = line.match(global))) {
      diagnostics.push({ category: match[1], code: match[2], text: match[3] })
    } else if (/^\s/.test(line) && diagnostics.length) {
      diagnostics.at(-1).text += "\n" + line
    } else if (isAbsolute(line.trim())) {
      files.push(line.trim())
    }
  }
  return { files, diagnostics }
}

const imported = /^\s+Imported via (".*"|'.*') from file '(.+?)'(?: with packageId '[^']*')?( to import .+)?$/
const supplemental = /^\s+Supplemental virtual file produced by the content mapper for file '(.+)'\.$/

/**
 * Parses `vibelang --pretty false --explainFiles --listFilesOnly` output into
 * the program's files, the imports its sources write, and the diagnostics the
 * compiler reported. Each import is { importer, specifier, file }: the file
 * the compiler resolved `specifier` to. Imports the compiler adds itself, such
 * as JSX factories and import helpers, and its bundled libraries are left out.
 * A virtual file the compiler derives from a source, such as the body of a
 * .vibe file's module declaration (D283), is part of that source: it is not a
 * file, and its imports are the source's. The output's paths are relative to
 * root; the result's are absolute.
 */
export function parseExplainFiles(output, root) {
  const files = []
  const imports = []
  const diagnostics = []
  const sources = new Map() // each virtual file, to the source it is part of
  // An indented line belongs to the last unindented one: a file's reasons or a diagnostic's detail.
  let file
  let diagnostic
  let match
  for (const line of output.split(/\r?\n/)) {
    if (/^\s/.test(line)) {
      if (diagnostic) diagnostic.text += "\n" + line
      else if (file && (match = line.match(imported)) && !match[3]) {
        imports.push({ importer: resolve(root, match[2]), specifier: match[1].slice(1, -1), file })
      } else if (file && (match = line.match(supplemental))) {
        sources.set(file, resolve(root, match[1]))
      }
      continue
    }
    file = diagnostic = undefined
    if ((match = line.match(located))) {
      diagnostic = {
        file: resolve(root, match[1]), line: Number(match[2]), column: Number(match[3]),
        category: match[4], code: match[5], text: match[6]
      }
      diagnostics.push(diagnostic)
    } else if ((match = line.match(global))) {
      diagnostic = { category: match[1], code: match[2], text: match[3] }
      diagnostics.push(diagnostic)
    } else if (line.trim() && !line.startsWith("bundled:")) {
      file = resolve(root, line.trim())
      files.push(file)
    }
  }
  return {
    files: files.filter((file) => !sources.has(file)),
    imports: imports.map((entry) => sources.has(entry.importer) ? { ...entry, importer: sources.get(entry.importer) } : entry),
    diagnostics
  }
}

/**
 * projectImports lists a tsconfig project's files and the imports its `.ts`
 * and `.vibe` sources write, each with the file the compiler resolved it to,
 * without type-checking the project. A tool that needs a module graph, such as
 * a circular-dependency check, reads it here instead of resolving `.vibe`
 * specifiers itself. It returns { files, imports, errors }; errors holds the
 * diagnostics that stopped the compiler from reading the project.
 */
export function projectImports({ project, root, compiler }) {
  project = resolve(project)
  root = resolve(root ?? dirname(project))
  compiler ??= findCompiler(root)
  const [file, argv] = command(compiler, ["--project", project, "--pretty", "false", "--explainFiles", "--listFilesOnly"])
  const run = spawnSync(file, argv, { cwd: root, encoding: "utf8", maxBuffer: 1 << 30 })
  if (run.error) throw new Error(`vibelang: ${run.error.message}\nCompiler: ${compiler}`)
  const output = run.stdout + run.stderr
  const { files, imports, diagnostics } = parseExplainFiles(output, root)
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === "error")
  if (run.status !== 0 && !errors.length) {
    errors.push({ category: "error", code: "vibelang", text: output.trim() || `exited with ${run.signal || run.status}` })
  }
  return { files, imports, errors }
}

/** Formats a diagnostic as `file:line:column - error TS2322: text`. */
export function formatDiagnostic(diagnostic) {
  const where = diagnostic.file ? `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} - ` : ""
  return `${where}${diagnostic.category} ${diagnostic.code}: ${diagnostic.text}`
}

// The compile emits from the filesystem root, not from root: a project may
// hold sources above its directory, as a test project whose tsconfig sets
// rootDir to the repository does, and a narrower --rootDir than the project's
// own fails it with TS6059. Only root's .vibe outputs are collected, so
// --loader-root checks and emits only the files under root: the sources of
// another workspace package the project imports only supply types, and are
// checked by that package's own compile.
const emitRoot = (root) => parse(resolve(root)).root

const emitArgs = (project, root, out) => [
  "--project", project, "--loader-root", resolve(root),
  "--pretty", "false", "--listFiles", "true", "--rootDir", emitRoot(root),
  "--outDir", out, "--sourceMap", "true", "--inlineSources", "true",
  "--inlineSourceMap", "false", "--sourceRoot", slash(emitRoot(root)).replace(/\/?$/, "/"), "--declaration", "false", "--declarationMap", "false",
  "--noEmit", "false", "--emitDeclarationOnly", "false", "--noEmitOnError", "false",
  // A project checked with --noEmit may import .ts files without a rewrite of its
  // own; emitting it then needs one (TS5096), and the output imports .js anyway.
  "--rewriteRelativeImportExtensions", "true",
  // The loaders emit JavaScript alone, which a composite project refuses
  // (TS6304, TS6379); its references are not built here either.
  "--composite", "false", "--incremental", "false"
]

const realpath = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * Returns the .vibe file whose module declaration compiles to `path`, as
 * main.vibe's `module text` compiles to main.vibe.text.js beside main.js
 * (D403), or undefined when `path` names no such output. The output is not
 * on disk: a loader serves it from the project's compile.
 */
export function moduleDeclarationSource(path) {
  return /^(.+\.vibe)\.[^./\\]+\.js$/.exec(path)?.[1]
}

// Turns one compiler run into its result:
//   outputs      Map from each .vibe source, by listed and real path, to its
//                { code, map }, and from each output of its module
//                declarations, such as main.vibe.text.js beside it, to that
//   inputs       project source files the result depends on
//   errors       all project error diagnostics; loaders select by source
//   warnings     all project warning diagnostics
// and every file the compiler read, dependencies included, for the cache.
function collect({ status, signal, output }, root, out) {
  const { files, diagnostics } = parseOutput(output, root)
  // Dependencies are contracts too; their sources change only on install.
  const inputs = files.filter((path) => !slash(path).includes("/node_modules/"))
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === "error")
  const warnings = diagnostics.filter((diagnostic) => diagnostic.category === "warning")
  if (status !== 0 && !errors.length) {
    // A crash or an unknown flag prints no diagnostic; report the raw output.
    errors.push({ category: "error", code: "vibelang", text: output.trim() || `exited with ${signal || status}` })
  }
  const outputs = new Map()
  // Bundlers ask by the listed path; Node asks by the real path.
  const record = (source, emitted, name = basename(source)) => {
    const map = JSON.parse(readFileSync(emitted + ".map", "utf8"))
    map.sources = map.sources.map((entry) => pathToFileURL(resolve(dirname(emitted), map.sourceRoot || "", entry)).href)
    map.sourceRoot = ""
    const result = { code: readFileSync(emitted, "utf8").replace(/\/\/# sourceMappingURL=.*$/m, ""), map }
    outputs.set(join(dirname(source), name), result)
    outputs.set(join(dirname(realpath(source)), name), result)
  }
  const listings = new Map() // each output directory's file names
  for (const source of inputs) {
    if (!source.endsWith(".vibe")) continue
    const path = relative(root, source)
    if (path.startsWith("..") || isAbsolute(path)) continue
    const emitted = join(out, relative(emitRoot(root), source).replace(/\.vibe$/, ".js"))
    // The compile emits nothing for a module it reached through node_modules,
    // such as a nested workspace package's: that one compiles with its own project.
    if (!existsSync(emitted)) continue
    record(source, emitted)
    // Each module declaration the file imports is a JavaScript module beside
    // the file's, main.vibe.text.js for module text (D403).
    const directory = dirname(emitted)
    if (!listings.has(directory)) listings.set(directory, readdirSync(directory))
    for (const name of listings.get(directory)) {
      if (moduleDeclarationSource(name) === basename(source)) record(source, join(directory, name), name)
    }
  }
  return { result: { outputs, inputs, files, errors, warnings }, files }
}

const elapsed = (started) => `${Math.round(performance.now() - started)}ms`

// Times a compile's stages, in order, for the debug report.
function stopwatch() {
  const stages = []
  return {
    time(name, work) {
      const started = performance.now()
      const done = () => stages.push(`${name} ${elapsed(started)}`)
      const value = work()
      if (value instanceof Promise) return value.finally(done)
      done()
      return value
    },
    toString: () => stages.join(", ")
  }
}

// Serves a compile from the cache, or runs it and caches its result. The
// debug report names the time of each stage: the cache lookup, the snapshot of
// the inputs, the compiler process, reading its outputs, and the cache write.
function cached({ project, root, compiler, cache, debug }, run) {
  const started = performance.now()
  const stages = stopwatch()
  const store = projectCache({ project, root, compiler, cache, debug })
  const hit = stages.time("lookup", () => store?.lookup())
  if (hit?.result) {
    debug(`${project} from the cache in ${elapsed(started)}`)
    return hit.result
  }
  const snapshot = stages.time("snapshot", () => store?.begin())
  const finish = ({ result, files }) => {
    stages.time("store", () => store?.store(snapshot, result, files))
    const modules = new Set(result.outputs.values()).size
    debug(`compiled ${project} in ${elapsed(started)} (${hit?.miss ?? "cache off"}): ${stages}; ` +
      `${modules} ${modules === 1 ? "module" : "modules"}, ${files.length} files read`)
    return result
  }
  const compiled = run(stages)
  return compiled instanceof Promise ? compiled.then(finish) : finish(compiled)
}

/**
 * projectBackend compiles a whole tsconfig project with one vibelang process,
 * in a fresh output directory each time, or serves the result from the cache.
 * compile(project) resolves to the result described above. `cache` is false to
 * turn the cache off, or { directory } to move it.
 */
export function projectBackend({ root, compiler, cache, debug = () => {} }) {
  function run(args) {
    const [file, argv] = command(compiler, args)
    return new Promise((accept, reject) => {
      let output = ""
      const child = spawn(file, argv, { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
      child.stdout.on("data", (data) => { output += data })
      child.stderr.on("data", (data) => { output += data })
      child.on("error", (error) => reject(new Error(`vibelang: ${error.message}\nCompiler: ${compiler}`)))
      child.on("close", (status, signal) => accept({ status, signal, output }))
    })
  }

  async function compile(project) {
    return cached({ project, root, compiler, cache, debug }, async (stages) => {
      // Outside the project: webpack and esbuild rebuild when a directory they resolved through changes.
      const out = mkdtempSync(join(tmpdir(), "vibelang-project-"))
      try {
        const output = await stages.time("compiler", () => run(emitArgs(project, root, out)))
        return stages.time("collect", () => collect(output, root, out))
      } finally {
        // Outputs are in memory now. The next compile starts from an empty directory.
        rmSync(out, { recursive: true, force: true })
      }
    })
  }

  return { compile }
}

/**
 * compileProjectSync is projectBackend's compile for callers that cannot wait,
 * such as Node's synchronous module hooks.
 */
export function compileProjectSync({ project, root = dirname(project), compiler = findCompiler(root), cache, debug = () => {} }) {
  return cached({ project, root, compiler, cache, debug }, (stages) => {
    const out = mkdtempSync(join(tmpdir(), "vibelang-project-"))
    try {
      const [file, argv] = command(compiler, emitArgs(project, root, out))
      const run = stages.time("compiler", () => spawnSync(file, argv, { cwd: root, encoding: "utf8", maxBuffer: 1 << 30 }))
      if (run.error) throw new Error(`vibelang: ${run.error.message}\nCompiler: ${compiler}`)
      return stages.time("collect", () => collect({ status: run.status, signal: run.signal, output: run.stdout + run.stderr }, root, out))
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
}

/** Returns the preferred config in the nearest directory above file, or undefined. */
export function nearestProject(file) {
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    for (const name of ["vibe.config.json", "tsconfig.json", "jsconfig.json"]) {
      const candidate = join(directory, name)
      if (existsSync(candidate)) return candidate
    }
    if (dirname(directory) === directory) return undefined
  }
}

/**
 * workspaceProject names the project that compiles a module when `project`
 * (whose directory is `root`) is the one asked for: `project` for a module
 * inside root; for one of another workspace package, outside root or nested
 * inside it with its own package.json and tsconfig.json, the nearest
 * tsconfig.json above it, its own package's project.
 */
export function workspaceProject(file, root, project) {
  const path = relative(root, file)
  if (path.startsWith("..") || isAbsolute(path)) return nearestProject(file) ?? project
  // A workspace package nested inside root, such as packages/a/b inside
  // packages/a, compiles with its own tsconfig.json: the innermost package.json
  // below root, with a tsconfig.json between it and the module.
  for (let directory = dirname(file); directory !== root && dirname(directory) !== directory; directory = dirname(directory)) {
    if (!existsSync(join(directory, "package.json"))) continue
    const own = nearestProject(file)
    return own !== undefined && !relative(directory, own).startsWith("..") ? own : project
  }
  return project
}

// Compare the config across the compile, including persistent stat failures.
function fileState(file) {
  try {
    const { mtimeMs, ctimeMs, size, ino } = statSync(file)
    return JSON.stringify([mtimeMs, ctimeMs, size, ino])
  } catch (error) {
    return error.code
  }
}

// Returns a source modified after time, or one that is gone.
function changedSince(files, time) {
  for (const file of files) {
    try {
      const mtime = statSync(file).mtimeMs
      if (mtime > time) return { file, mtime }
    } catch (error) {
      return { file, error: error.code }
    }
  }
}

// Module code for a failed compile. The bundler reports the real error.
const failed = "throw new Error(\"vibelang: this module did not compile; see the build errors\")\n"

/**
 * projects compiles .vibe modules for a bundler, one whole-project compile per
 * tsconfig. A module inside root belongs to `project`; one of another
 * workspace package, outside root or nested inside it with its own package.json
 * and tsconfig.json, belongs to the nearest tsconfig.json above it, its own
 * package's project. Each project
 * compiles once per revision; invalidate() starts a new revision.
 *
 * load(file) resolves to { project, code, map, inputs, errors, warnings, first, error }.
 * errors and warnings belong to the loaded source or are project-wide.
 * first is true for the first module loaded from that compile. `error`
 * says that the project does not include the module. `cache` is as for
 * projectBackend: a compile a revision needs may come from the cache.
 */
export function projects({ root, project, compiler, cache, debug = () => {} }) {
  const states = new Map()
  let revision = 0

  const projectOf = (file) => workspaceProject(resolve(file), root, project)

  function stateOf(tsconfig) {
    let state = states.get(tsconfig)
    if (state === undefined) {
      const projectRoot = tsconfig === project ? root : dirname(tsconfig)
      state = { tsconfig, backend: projectBackend({ root: projectRoot, compiler, cache, debug }), result: undefined, pending: undefined, compiled: -1, reported: -1 }
      states.set(tsconfig, state)
    }
    return state
  }

  async function compiled(state) {
    while (state.compiled !== revision) {
      if (!state.pending) {
        const started = revision
        // File mtimes retain fractional milliseconds. An integer Date.now()
        // can precede a save that already happened in this same millisecond.
        const time = performance.timeOrigin + performance.now()
        const configBefore = fileState(state.tsconfig)
        debug(`compile ${state.tsconfig} ${started} started`)
        state.pending = state.backend.compile(state.tsconfig)
          .then((value) => {
            state.result = value
            state.compiled = started
            debug(`compile ${state.tsconfig} ${started} finished in ${Math.round(performance.timeOrigin + performance.now() - time)}ms: ${value.outputs.size} outputs, ${value.errors.length} errors`)
            // A file saved during the compile may be missing from its output. esbuild records
            // watch files when a load returns, so it would not rebuild for that save. Compile again.
            const changed = fileState(state.tsconfig) !== configBefore
              ? { file: state.tsconfig, error: "config state changed" }
              : changedSince(value.inputs.filter((file) => file !== state.tsconfig), time)
            if (changed) {
              revision++
              debug(`${changed.file} changed during compile ${started}: revision ${revision}; mtime=${changed.mtime ?? changed.error}, started=${time}`)
            }
          })
          .finally(() => { state.pending = undefined })
      }
      await state.pending
    }
    return state.result
  }

  return {
    projectOf,
    /** Starts a new revision: every project compiles again on its next load. */
    invalidate() {
      revision++
    },
    async load(file) {
      // Vite uses forward slashes on Windows; compiler output keys use native paths.
      file = resolve(file)
      const state = stateOf(projectOf(file))
      const result = await compiled(state)
      const { outputs, inputs } = result
      const errors = diagnosticsForFile(result.errors, file, result.files)
      const warnings = diagnosticsForFile(result.warnings, file, result.files)
      // Keep the public first-module flag independent of source diagnostics.
      const first = state.reported !== state.compiled
      state.reported = state.compiled
      if (errors.length) return { project: state.tsconfig, code: failed, inputs, errors, warnings, first }
      const output = outputs.get(file)
      return {
        project: state.tsconfig, code: output?.code ?? failed, map: output?.map, inputs, errors, warnings, first,
        error: !output && {
          message: `vibelang: ${file} is not part of ${state.tsconfig}. Add it to the tsconfig's include.`, id: file
        }
      }
    }
  }
}
