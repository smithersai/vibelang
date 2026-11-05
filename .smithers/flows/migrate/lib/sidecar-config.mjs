// Detail 271: scalar config entries keep their declaring-file base and use
// the selected project's configDir for the leading placeholder.
import { existsSync, lstatSync, rmSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

export function sidecarConfigIn(directory) {
  return ["vibe.config.json", "tsconfig.json", "jsconfig.json"].map(name => join(directory, name)).find(existsSync)
}
export function sidecarSettings(file, ts, text, { sourceRootOnly = false, directoryOnly = false } = {}) {
  file = resolve(file)
  const home = dirname(file)
  const visit = (path, stack) => {
    path = resolve(path)
    if (stack.has(path)) return undefined
    const next = new Set(stack).add(path)
    const read = path === file && text !== undefined ? ts.parseConfigFileTextToJson(path, text) : ts.readConfigFile(path, ts.sys.readFile)
    if (read.error) throw new Error("Cannot read sidecar configuration " + path)
    const json = read.config
    if (Object.hasOwn(json.vibe ?? {}, "sidecarDir")) {
      const value = json.vibe.sidecarDir
      if (typeof value !== "string") throw new Error("vibe.sidecarDir must be a path string in " + path)
      const expanded = value.startsWith("${configDir}") ? home + value.slice("${configDir}".length) : value
      return { value, declaringFile: path, home, directory: resolve(dirname(path), expanded) }
    }
    const parents = [json.extends ?? []].flat()
    for (const parent of parents.reverse()) {
      if (typeof parent !== "string") continue
      let target
      if (isAbsolute(parent) || parent.startsWith("./") || parent.startsWith("../")) {
        target = resolve(dirname(path), parent)
        if (!existsSync(target) && !target.endsWith(".json")) target += ".json"
      } else target = ts.nodeNextJsonConfigResolver(parent, path, ts.sys).resolvedModule?.resolvedFileName
      if (!target) throw new Error("Cannot resolve sidecar configuration " + parent + " from " + path)
      const found = visit(target, next)
      if (found) return found
    }
    return undefined
  }
  const settings = visit(file, new Set())
  return settings && (directoryOnly ? settings : { ...settings, ...(sourceRootOnly ? sidecarRootLayout(file, ts, text) : sidecarProjectLayout(file, ts, text)) })
}
const within = (home, file) => {
  const path = relative(home, file).replaceAll("\\", "/")
  return path !== ".." && !path.startsWith("../") && !isAbsolute(path)
}
const sidecarProject = (file, ts, text) => {
  file = resolve(file)
  const home = dirname(file)
  const read = text === undefined ? ts.readConfigFile(file, ts.sys.readFile) : ts.parseConfigFileTextToJson(file, text)
  if (read.error) throw new Error("Cannot read sidecar configuration " + file)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, home, undefined, file, undefined, [
    { extension: ".vibe", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred },
    { extension: ".vibex", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred }
  ])
  return { file, home, parsed }
}
const referenceRootsOf = (references, ts) => (references ?? []).map(ref => {
  const path = ts.resolveProjectReferencePath(ref)
  const config = ts.readConfigFile(path, ts.sys.readFile)
  const project = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, dirname(path), undefined, path)
  return project.options.rootDir ?? dirname(path)
})
// Only inferred common roots need a program. Path-only consumers do not need
// to load imports of explicit-root, composite or empty solution projects.
export function sidecarRootLayout(file, ts, text) {
  const project = sidecarProject(file, ts, text), { home, parsed } = project
  const sourceRoot = parsed.options.rootDir ?? (parsed.options.composite || !parsed.fileNames.length ? home : undefined)
  return sourceRoot === undefined ? sidecarProjectLayout(file, ts, text) : {
    sourceRoot, rootFiles: parsed.fileNames, projectReferences: parsed.projectReferences
  }
}
// Read the compiling graph, rather than the nearest config of each imported
// source. TypeScript 5.9 declarationDir uses this graph's common source root.
export function sidecarProjectLayout(file, ts, text) {
  const { home, parsed } = sidecarProject(file, ts, text)
  const options = { ...parsed.options, allowNonTsExtensions: true, noLib: true, types: [] }
  const host = ts.createCompilerHost(options)
  const original = host.getSourceFile
  host.getSourceFile = (name, language, onError, fresh) => {
    if (!/\.vibex?$/.test(name)) return original(name, language, onError, fresh)
    const text = ts.sys.readFile(name)
    return text === undefined ? undefined : ts.createSourceFile(name, text, language, true, name.endsWith(".vibex") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  }
  host.resolveModuleNames = (names, containing) => names.map(name => {
    const resolved = ts.resolveModuleName(name, containing, options, host).resolvedModule
    if (resolved && !/\.d\.vibex?\.ts$/.test(resolved.resolvedFileName)) return resolved
    if (name.startsWith(".")) {
      const target = resolve(dirname(containing), name)
      const stem = target.replace(/\.(?:[cm]?[jt]sx?)$/, "")
      const candidates = /\.vibex?$/.test(target) ? [target] : [stem + ".vibe", stem + ".vibex", join(target, "index.vibe"), join(target, "index.vibex")]
      const source = candidates.find(existsSync)
      if (source) return { resolvedFileName: source, extension: source.endsWith(".vibex") ? ts.Extension.Tsx : ts.Extension.Ts, isExternalLibraryImport: false }
    }
    return resolved
  })
  const referenceRoots = referenceRootsOf(parsed.projectReferences, ts)
  const program = ts.createProgram(parsed.fileNames, options, host)
  const sources = program.getSourceFiles().filter(source => !source.isDeclarationFile &&
    !source.fileName.replaceAll("\\", "/").includes("/node_modules/") &&
    !referenceRoots.some(root => within(root, source.fileName))).map(source => resolve(source.fileName))
  let sourceRoot = parsed.options.rootDir ?? (parsed.options.composite ? home : undefined)
  if (!sourceRoot && sources.length) {
    sourceRoot = dirname(sources[0])
    for (const source of sources) while (!within(sourceRoot, source)) {
      const parent = dirname(sourceRoot)
      if (parent === sourceRoot) break
      sourceRoot = parent
    }
  }
  sourceRoot ??= home
  return { sourceRoot, sources, outside: sources.some(source => !within(home, source)) }
}

export function sidecarPath(source, settings) {
  const beside = source.replace(/\.(vibex?)$/, ".d.$1.ts")
  return settings && within(settings.sourceRoot ?? settings.home, source) ? resolve(settings.directory, relative(settings.sourceRoot ?? settings.home, beside)) : beside
}
// Like emit, setup protects the complete selected output set before cleanup.
function removeSupersededByGraph(root, tracked, configs, ts) {
  const key = path => ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase()
  const plans = [], selected = new Set()
  const trackedSources = new Set(tracked.filter(file => /\.vibex?$/.test(file)).map(file => resolve(root, file)))
  for (const config of configs) {
    const settings = sidecarSettings(resolve(root, config), ts)
    if (!settings) continue
    for (const source of settings.sources.filter(path => /\.vibex?$/.test(path))) {
      if (!within(settings.sourceRoot, source)) continue
      const output = sidecarPath(source, settings)
      selected.add(key(output))
      if (!trackedSources.has(source)) continue
      plans.push({ stale: source.replace(/\.(vibex?)$/, ".d.$1.ts"), output })
    }
  }
  const removed = []
  for (const { stale, output } of plans) {
    if (key(stale) === key(output) || selected.has(key(stale)) || !existsSync(stale) || lstatSync(stale).isDirectory()) continue
    rmSync(stale)
    removed.push(relative(root, stale).replaceAll("\\", "/"))
  }
  return [...new Set(removed)].sort()
}

// Known root files already belong to their compiling project. Load a complete
// graph only for an inferred boundary or a tracked import-only candidate.
// Overlapping output directories keep the complete selected-output oracle.
export function removeSupersededSidecars(root, tracked, configs, ts) {
  const candidates = [...new Map(tracked.filter(file => /\.vibex?$/.test(file)).map(file => [resolve(root, file), {
    source: resolve(root, file), stale: resolve(root, file.replace(/\.(vibex?)$/, ".d.$1.ts"))
  }])).values()].filter(({ stale }) => existsSync(stale) && !lstatSync(stale).isDirectory())
  const projects = [...configs].map(config => {
    const file = resolve(root, config), settings = sidecarSettings(file, ts, undefined, { sourceRootOnly: true })
    return settings && { file, settings }
  }).filter(Boolean)
  const key = path => ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase()
  if (projects.some(({ settings }) => candidates.some(({ stale }) => within(key(settings.directory), key(stale)))))
    return removeSupersededByGraph(root, tracked, configs, ts)
  const eligible = new Set()
  const add = (sources, settings, references = []) => {
    for (const source of sources) if (/\.vibex?$/.test(source) && within(settings.sourceRoot, source) &&
        !references.some(home => within(home, source)) && ts.sys.readFile(source) !== undefined) eligible.add(resolve(source))
  }
  for (const { settings } of projects) {
    if (settings.sources) add(settings.sources, settings)
    else add(settings.rootFiles, settings, referenceRootsOf(settings.projectReferences, ts))
  }
  for (const { file, settings } of projects) {
    if (settings.sources || !candidates.some(({ source }) => !eligible.has(source) && within(settings.sourceRoot, source))) continue
    const complete = sidecarSettings(file, ts)
    add(complete.sources, complete)
  }
  const removed = []
  for (const { source, stale } of candidates) if (eligible.has(source)) {
    rmSync(stale)
    removed.push(relative(root, stale).replaceAll("\\", "/"))
  }
  return [...new Set(removed)].sort()
}
