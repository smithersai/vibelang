import { diagnosticsForFile } from "./diagnostics.mjs"
// node --import vibelang/register: Node loads .vibe modules from source.
//
// A .vibe module keeps its source URL as its identity, so a program that also
// imports .ts files sees one copy of each module. Its JavaScript comes from one
// whole-project compile per tsconfig: emit is type-directed, so no module
// compiles alone. The project is the nearest tsconfig.json above the module, or
// VIBELANG_PROJECT for the modules in its directory; a module of another
// workspace package, such as a dependency linked to its source, compiles with
// its own package's tsconfig.json. A compile's result is cached on disk (vibelang/project), so
// a later process reuses it while the project's inputs are unchanged. A failed
// compile throws an Error with code ERR_VIBELANG_COMPILE and the diagnostics;
// a module the project does not include, ERR_VIBELANG_PROJECT. Source maps are
// turned on, so a stack frame names the .vibe line. A module declaration of a
// .vibe module is a module of its own, main.vibe.text.js beside main.vibe for
// module text (D403); its URL names that file, which is not on disk, and its
// JavaScript comes from the same compile.
// VIBELANG_REGISTER_DEBUG=1 reports each project's compile, with the time of
// each stage, or its cache hit, and at exit the time the hook took in all.
import { existsSync, realpathSync, statSync } from "node:fs"
import * as Module from "node:module"
import { registerHooks } from "node:module"
import { dirname, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath, pathToFileURL } from "node:url"
import { compileProjectSync, formatDiagnostic, moduleDeclarationSource, nearestProject, workspaceProject } from "./project.mjs"

if (typeof registerHooks !== "function") {
  throw new Error(`vibelang/register needs module.registerHooks, in Node 22.15 or later; this is Node ${process.version}`)
}

// A .vibe module's frames name its .vibe path; without source maps they would
// carry the emitted JavaScript's line numbers. Node 22.14+ (every Node with
// registerHooks) has setSourceMapsSupport.
Module.setSourceMapsSupport?.(true)

const results = new Map()
const debug = process.env.VIBELANG_REGISTER_DEBUG
  ? (text) => process.stderr.write(`vibelang/register: ${text}\n`)
  : undefined

// What the hook cost this process, for the debug report at exit: the projects
// it compiled or read from the cache, the modules it loaded, and the
// relative imports it resolved to sources.
const spent = { projects: 0, compile: 0, modules: 0, load: 0, imports: 0, resolve: 0 }
const since = (started) => performance.now() - started
if (debug) {
  process.on("exit", () => {
    const ms = (value) => `${Math.round(value)}ms`
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`
    debug(`${count(spent.projects, "project", "projects")} compiled or read from the cache in ${ms(spent.compile)}, ` +
      `${count(spent.modules, "module", "modules")} loaded in ${ms(spent.load)}, ` +
      `${count(spent.imports, "import resolved to its source", "imports resolved to their sources")} in ${ms(spent.resolve)}`)
  })
}

function projectOf(file) {
  if (process.env.VIBELANG_PROJECT) {
    const named = resolve(process.env.VIBELANG_PROJECT)
    return workspaceProject(file, dirname(named), named)
  }
  const project = nearestProject(file)
  if (project === undefined) throw new Error(`vibelang/register: no tsconfig.json above ${file}`)
  return project
}

// An Error with a code, as Node's own module errors have.
const failure = (code, message) => Object.assign(new Error(message), { code })

// A file saved after a compile started may be missing from its output.
function changedSince(file, time) {
  const stat = statSync(file, { throwIfNoEntry: false })
  return stat !== undefined && Math.max(stat.mtimeMs, stat.ctimeMs) > time
}

// A long-running process compiles a project again when a module it imports
// is newer than the compile, or was not there yet: a watcher's re-import of
// an edited file, or a module written after the program started.
function emitted(file) {
  const project = projectOf(file)
  let compiled = results.get(project)
  // A module declaration's output is as new as its .vibe file.
  if (compiled !== undefined && changedSince(moduleDeclarationSource(file) ?? file, compiled.started)) compiled = undefined
  if (compiled !== undefined && !compiled.result.outputs.has(file) && !compiled.missing.has(file)) {
    compiled = undefined
  }
  if (compiled === undefined) {
    const started = Date.now()
    const clock = performance.now()
    compiled = { started, result: compileProjectSync({ project, debug }), missing: new Set() }
    results.set(project, compiled)
    spent.projects++
    spent.compile += since(clock)
  }
  const { result } = compiled
  const errors = diagnosticsForFile(result.errors, file, result.files)
  if (errors.length) {
    throw failure("ERR_VIBELANG_COMPILE", `vibelang: ${project} did not compile\n${errors.map(formatDiagnostic).join("\n")}`)
  }
  const output = result.outputs.get(file)
  if (output === undefined) {
    compiled.missing.add(file)
    if (result.files.some((source) => source === file || realpathSync(source) === file)) {
      throw failure("ERR_VIBELANG_OUTPUT", `vibelang/register: ${project} includes ${file}, but no loader output is available; dependencies in node_modules must publish compiled JavaScript or compile with their own workspace project`)
    }
    throw failure("ERR_VIBELANG_PROJECT", `vibelang/register: ${project} does not include ${file}; set VIBELANG_PROJECT to a tsconfig that does`)
  }
  return output
}

// vibelang rewrites a .vibe module's relative imports to the emitted .js names.
// From source, those names are the .vibe or TypeScript files beside it.
const sources = { ".js": [".vibe", ".ts", ".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] }
const clean = (url) => url.replace(/[?#].*$/, "")

// A module declaration's output that is not on disk: the compile serves it.
function moduleOutput(url) {
  if (!url.startsWith("file:")) return undefined
  const path = fileURLToPath(clean(url))
  const source = moduleDeclarationSource(path)
  return source !== undefined && !existsSync(path) && existsSync(source) ? path : undefined
}

// A module whose imports vibelang rewrote: a .vibe module or a module declaration's.
const compiled = (url) => url.startsWith("file:") && (clean(url).endsWith(".vibe") || moduleOutput(url) !== undefined)

registerHooks({
  resolve(specifier, context, nextResolve) {
    const started = performance.now()
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const parent = context.parentURL
      if (
        error?.code !== "ERR_MODULE_NOT_FOUND" || !/^\.\.?\//.test(specifier) ||
        parent === undefined || !compiled(parent)
      ) throw error
      const target = new URL(specifier, parent)
      const resolved = (result) => {
        spent.imports++
        spent.resolve += since(started)
        return result
      }
      if (moduleOutput(target.href) !== undefined) return resolved({ url: target.href, format: "module", shortCircuit: true })
      const path = fileURLToPath(clean(target.href))
      const extension = Object.keys(sources).find((name) => path.endsWith(name))
      for (const replacement of extension === undefined ? [] : sources[extension]) {
        const candidate = path.slice(0, -extension.length) + replacement
        if (existsSync(candidate)) return resolved(nextResolve(pathToFileURL(candidate).href + target.search + target.hash, context))
      }
      throw error
    }
  },
  load(url, context, nextLoad) {
    const path = moduleOutput(url) ?? (url.startsWith("file:") && clean(url).endsWith(".vibe") ? fileURLToPath(clean(url)) : undefined)
    if (path === undefined) return nextLoad(url, context)
    const started = performance.now()
    const compile = spent.compile
    const { code, map } = emitted(path)
    // Node resolves a source against the module URL: a path with # or %, or a
    // Windows drive, needs a file URL.
    const sources = map.sources.map((source) => pathToFileURL(source).href)
    const inline = Buffer.from(JSON.stringify({ ...map, sources })).toString("base64")
    spent.modules++
    spent.load += since(started) - (spent.compile - compile)
    return {
      format: "module",
      // Split, so tools that read this file for its own source map skip the template.
      source: `${code}\n//# sourceMapping${"URL"}=data:application/json;base64,${inline}\n`,
      shortCircuit: true
    }
  }
})
