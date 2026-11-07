import { existsSync, realpathSync, rmSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { assertFinished } from "./diagnostics.mjs"
import { quote, run, writeJson } from "./util.mjs"

const inside = (parent, child) => {
  const path = relative(parent, child)
  return path === "" || path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path)
}
// Match the native path implementation's case rules and separator boundaries.
const pathKey = path => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path)

function descendantIndex(paths) {
  const keys = new Set(paths.map(pathKey)), sorted = [...keys].sort()
  return parent => {
    const key = pathKey(parent)
    if (keys.has(key)) return true
    const prefix = key.endsWith(sep) ? key : key + sep
    let low = 0, high = sorted.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (sorted[middle] < prefix) low = middle + 1
      else high = middle
    }
    return sorted[low]?.startsWith(prefix) ?? false
  }
}

function outermostOutputs(paths) {
  const counts = new Map()
  for (const path of paths) counts.set(pathKey(path), (counts.get(pathKey(path)) ?? 0) + 1)
  return paths.filter(path => {
    // Distinct spellings of the same native path covered one another before.
    if (counts.get(pathKey(path)) > 1) return false
    for (let child = path, parent = dirname(child); parent !== child; child = parent, parent = dirname(child)) {
      if (counts.has(pathKey(parent))) return false
    }
    return true
  })
}

const extra = ts => [{ extension: ".vibe", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred },
  { extension: ".vibex", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred }]

/** Effective project outputs and the reverse reference closure of changed sources. */
export function referenceRefreshPlan({ root, ts, configs, changed, tracked }) {
  root = resolve(root)
  const projects = new Map()
  const configPath = path => {
    path = resolve(root, path)
    return /\.json$/i.test(path) ? path : join(path, "tsconfig.json")
  }
  const configError = (path, errors) => new Error("Cannot plan project references for " +
    relative(root, path).split(sep).join("/") + ":\n" + errors.map(error =>
      "TS" + error.code + ": " + ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"))
  const visit = path => {
    path = configPath(path)
    if (projects.has(path)) return
    const input = ts.readConfigFile(path, ts.sys.readFile)
    if (input.error && input.error.code !== 5083) throw configError(path, [input.error])
    // Missing configs have no readable edges; retain their diagnostic for closure validation.
    const parsed = input.error ? { options: {}, fileNames: [], errors: [input.error] } :
      ts.parseJsonConfigFileContent(input.config, ts.sys, dirname(path), {}, path, undefined, extra(ts))
    const errors = parsed.errors.filter(error => ![18002, 18003].includes(error.code))
    const item = { path, parsed, errors, references: (parsed.projectReferences ?? []).map(ref => configPath(ref.path)) }
    projects.set(path, item)
    for (const ref of item.references) visit(ref)
  }
  for (const path of configs) visit(path)
  const changedPaths = new Set(changed.map(path => resolve(root, path)))
  // A shared source can also belong to independent checking configurations.
  // Only members of a reference graph own work in this refresh.
  const referencedProjects = new Set([...projects.values()].flatMap(project => project.references))
  const connected = new Set([...projects].filter(([path, project]) =>
    project.references.length || referencedProjects.has(path)).map(([path]) => path))
  const affected = new Set([...projects].filter(([, project]) =>
    project.parsed.fileNames.some(file => changedPaths.has(resolve(file))) ||
    project.errors.length && [...changedPaths].some(file => inside(dirname(project.path), file))).map(([path]) => path))
  for (let previous = -1; previous !== affected.size;) {
    previous = affected.size
    for (const [path, project] of projects) if (project.references.some(ref => affected.has(ref))) affected.add(path)
  }
  // Configurations from unrelated tooling can extend generated framework files.
  // Validate the reverse closure and its build dependencies before deleting any
  // output. Malformed JSON still fails above because its edges cannot be read.
  const validated = new Set()
  const validate = path => {
    if (validated.has(path)) return
    validated.add(path)
    const project = projects.get(path)
    if (project.errors.length) throw configError(path, project.errors)
    for (const ref of project.references) validate(ref)
  }
  for (const path of affected) validate(path)
  for (const path of affected) if (!connected.has(path)) affected.delete(path)
  // Projects without reference edges need no reference-output refresh.
  if (!affected.size) return { projects: [], roots: [], outputs: [] }
  const referenced = new Set([...affected].flatMap(path => projects.get(path).references))
  const roots = [...affected].filter(path => !referenced.has(path)).sort()
  if (!roots.length) throw new Error("project reference cycle has no build root")
  const outputs = new Set()
  for (const path of affected) {
    const parsed = projects.get(path).parsed, options = parsed.options
    for (const directory of [options.outDir, options.declarationDir]) if (directory) outputs.add(resolve(directory))
    const info = ts.getTsBuildInfoEmitOutputFilePath(options)
    if (info) outputs.add(resolve(info))
    // Projects without output directories emit beside their source files.
    if (!options.outDir || options.declaration && !options.declarationDir) {
      for (const file of parsed.fileNames) {
        const twin = file.replace(/\.vibex$/, ".tsx").replace(/\.vibe$/, ".ts")
        const command = { ...parsed, fileNames: parsed.fileNames.map(name => name === file ? twin : name) }
        for (const output of ts.getOutputFileNames(command, twin, false)) {
          if (resolve(output) !== resolve(file)) outputs.add(resolve(output))
        }
      }
    }
  }
  // Every config and tracked file protects an output directory, and so does a
  // file a project lists, with one exception once the tracked files are known:
  // untracked JavaScript or declarations that only projects outside this
  // refresh's graph list. A root config that shares options, with allowJs and
  // no include, lists every emitted output through TypeScript's default include.
  const graph = new Set()
  const reach = path => {
    if (graph.has(path)) return
    graph.add(path)
    for (const ref of projects.get(path).references) reach(ref)
  }
  for (const path of affected) reach(path)
  const trackedPaths = tracked && new Set(tracked.map(file => resolve(root, file)))
  const emitted = /\.(?:[cm]?jsx?|d\.(?:[^/\\]+\.)?[cm]?ts)$/
  const sources = [...projects].flatMap(([path, project]) => project.parsed.fileNames.filter(file =>
    graph.has(path) || !trackedPaths || trackedPaths.has(resolve(file)) || !emitted.test(file))).concat(
    [...(trackedPaths ?? [])], [...projects.keys()])
  const containsSource = descendantIndex(sources)
  // Validate the entire deletion plan before removing any artifact.
  for (const path of outputs) {
    let parent = path
    while (!existsSync(parent) && parent !== dirname(parent)) parent = dirname(parent)
    if (path === root || !inside(root, path) || !inside(realpathSync(root), realpathSync(parent)) ||
      [".jj", ".git", "node_modules"].some(name => inside(join(root, name), path)) ||
      containsSource(path)) {
      const error = new Error("unsafe project output: " + relative(root, path))
      error.details = { output: relative(root, path).split(sep).join("/"),
        protectedSources: sources.filter(source => inside(path, resolve(source)))
          .slice(0, 8).map(source => relative(root, resolve(source)).split(sep).join("/")),
        repositoryRoot: path === root, outsideRepository: !inside(root, path),
        outsideRealRepository: !inside(realpathSync(root), realpathSync(parent)),
        protectedDirectory: [".jj", ".git", "node_modules"].find(name => inside(join(root, name), path)) ?? null }
      throw error
    }
  }
  const names = paths => paths.map(path => relative(root, path).split(sep).join("/"))
  return { projects: names([...affected].sort()), roots: names(roots),
    outputs: names(outermostOutputs([...outputs]).sort()) }
}

/** Persist each stage so failed or interrupted rebuilds cannot look complete. */
export async function refreshProjectReferences({ root, ts, configs, changed, tracked, compiler, log, execute = run, diagnosticsAllowed = false }) {
  const startedAt = new Date().toISOString(), planningStarted = performance.now()
  const planningMs = () => Math.round(performance.now() - planningStarted)
  writeJson(log + ".json", { startedAt, state: "planning", stage: "reference-planning" })
  let plan
  try { plan = referenceRefreshPlan({ root, ts, configs, changed, tracked }) }
  catch (error) {
    writeJson(log + ".json", { startedAt, finishedAt: new Date().toISOString(), state: "planning-failed", planningMs: planningMs(),
      stage: "reference-planning", error: String(error?.message ?? error), ...(error.details ? { details: error.details } : {}) })
    throw error
  }
  const receipt = { ...plan, startedAt, planningMs: planningMs(), state: plan.projects.length ? "planned" : "not-needed" }
  writeJson(log + ".json", receipt)
  if (!plan.projects.length) return receipt
  const executable = typeof compiler === "function" ? compiler() : compiler
  for (const path of plan.outputs) rmSync(resolve(root, path), { recursive: true, force: true })
  receipt.state = "outputs-cleared"
  writeJson(log + ".json", receipt)
  const result = await execute(quote(executable) + " --build --force --pretty false " + plan.roots.map(quote).join(" "), { cwd: root, log })
  // Exit 1 and 2 mean the compiler finished and reported diagnostics; any other
  // status, or a signal, means the rebuild itself did not finish.
  const diagnostics = diagnosticsAllowed && !result.signal && (result.code === 1 || result.code === 2)
  Object.assign(receipt, { state: result.code === 0 ? "complete" : diagnostics ? "diagnostics" : "failed", finishedAt: new Date().toISOString(), code: result.code, signal: result.signal ?? null })
  writeJson(log + ".json", receipt)
  assertFinished(result, log)
  if (result.code !== 0 && !diagnostics) throw new Error("project reference rebuild failed; see " + log)
  return receipt
}
