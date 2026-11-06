import { existsSync, realpathSync, rmSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { assertFinished } from "./diagnostics.mjs"
import { quote, run, writeJson } from "./util.mjs"

const inside = (parent, child) => {
  const path = relative(parent, child)
  return path === "" || path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path)
}
const extra = ts => [{ extension: ".vibe", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred },
  { extension: ".vibex", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred }]

/** Effective project outputs and the reverse reference closure of changed sources. */
export function referenceRefreshPlan({ root, ts, configs, changed, tracked = [] }) {
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
  const sources = [...projects.values()].flatMap(project => project.parsed.fileNames).concat(
    tracked.map(file => resolve(root, file)), [...projects.keys()])
  // Validate the entire deletion plan before removing any artifact.
  for (const path of outputs) {
    let parent = path
    while (!existsSync(parent) && parent !== dirname(parent)) parent = dirname(parent)
    if (path === root || !inside(root, path) || !inside(realpathSync(root), realpathSync(parent)) ||
      [".jj", ".git", "node_modules"].some(name => inside(join(root, name), path)) ||
      sources.some(source => inside(path, resolve(source)))) {
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
    outputs: names([...outputs].filter(path => ![...outputs].some(parent => parent !== path && inside(parent, path))).sort()) }
}

/** Persist each stage so failed or interrupted rebuilds cannot look complete. */
export async function refreshProjectReferences({ root, ts, configs, changed, tracked, compiler, log, execute = run }) {
  const startedAt = new Date().toISOString()
  let plan
  try { plan = referenceRefreshPlan({ root, ts, configs, changed, tracked }) }
  catch (error) {
    writeJson(log + ".json", { startedAt, finishedAt: new Date().toISOString(), state: "planning-failed",
      stage: "reference-planning", error: String(error?.message ?? error), ...(error.details ? { details: error.details } : {}) })
    throw error
  }
  const receipt = { ...plan, startedAt, state: plan.projects.length ? "planned" : "not-needed" }
  writeJson(log + ".json", receipt)
  if (!plan.projects.length) return receipt
  const executable = typeof compiler === "function" ? compiler() : compiler
  for (const path of plan.outputs) rmSync(resolve(root, path), { recursive: true, force: true })
  receipt.state = "outputs-cleared"
  writeJson(log + ".json", receipt)
  const result = await execute(quote(executable) + " --build --force --pretty false " + plan.roots.map(quote).join(" "), { cwd: root, log })
  Object.assign(receipt, { state: result.code === 0 ? "complete" : "failed", finishedAt: new Date().toISOString(), code: result.code, signal: result.signal ?? null })
  writeJson(log + ".json", receipt)
  assertFinished(result, log)
  if (result.code !== 0) throw new Error("project reference rebuild failed; see " + log)
  return receipt
}
