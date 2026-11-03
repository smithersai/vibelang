// Detail 271: scalar config entries keep their declaring-file base and use
// the selected project's configDir for the leading placeholder.
import { existsSync, lstatSync, rmSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

export function sidecarConfigIn(directory) {
  return ["vibe.config.json", "tsconfig.json", "jsconfig.json"].map(name => join(directory, name)).find(existsSync)
}
export function sidecarSettings(file, ts, text) {
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
  return settings && { ...settings, ...sidecarProjectLayout(file, ts, text) }
}
const within = (home, file) => {
  const path = relative(home, file).replaceAll("\\", "/")
  return path !== ".." && !path.startsWith("../") && !isAbsolute(path)
}
// Read the compiling graph, rather than the nearest config of each imported
// source. TypeScript 5.9 declarationDir uses this graph's common source root.
export function sidecarProjectLayout(file, ts, text) {
  file = resolve(file)
  const home = dirname(file)
  const read = text === undefined ? ts.readConfigFile(file, ts.sys.readFile) : ts.parseConfigFileTextToJson(file, text)
  if (read.error) throw new Error("Cannot read sidecar configuration " + file)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, home, undefined, file, undefined, [
    { extension: ".vibe", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred },
    { extension: ".vibex", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred }
  ])
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
      const candidates = /\.vibex?$/.test(target) ? [target] : [stem + ".vibe", stem + ".vibex", join(target, "index.vibe")]
      const source = candidates.find(existsSync)
      if (source) return { resolvedFileName: source, extension: ts.Extension.Ts, isExternalLibraryImport: false }
    }
    return resolved
  })
  const referenceRoots = (parsed.projectReferences ?? []).map(ref => {
    const path = ts.resolveProjectReferencePath(ref)
    const config = ts.readConfigFile(path, ts.sys.readFile)
    const project = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, dirname(path), undefined, path)
    return project.options.rootDir ?? dirname(path)
  })
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
  const beside = source.replace(/\.vibe$/, ".d.vibe.ts")
  return settings && within(settings.sourceRoot ?? settings.home, source) ? resolve(settings.directory, relative(settings.sourceRoot ?? settings.home, beside)) : beside
}
// Like emit, setup protects the complete selected output set before cleanup.
export function removeSupersededSidecars(root, tracked, configs, ts) {
  const key = path => ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase()
  const plans = [], selected = new Set()
  const trackedSources = new Set(tracked.filter(file => file.endsWith(".vibe")).map(file => resolve(root, file)))
  for (const config of configs) {
    const settings = sidecarSettings(resolve(root, config), ts)
    if (!settings) continue
    for (const source of settings.sources.filter(path => path.endsWith(".vibe"))) {
      if (!within(settings.sourceRoot, source)) continue
      const output = sidecarPath(source, settings)
      selected.add(key(output))
      if (!trackedSources.has(source)) continue
      plans.push({ stale: source.replace(/\.vibe$/, ".d.vibe.ts"), output })
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
