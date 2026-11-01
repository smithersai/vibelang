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
  return visit(file, new Set())
}
const within = (home, file) => {
  const path = relative(home, file).replaceAll("\\", "/")
  return path !== ".." && !path.startsWith("../") && !isAbsolute(path)
}
export function sidecarPath(source, settings) {
  const beside = source.replace(/\.vibe$/, ".d.vibe.ts")
  return settings && within(settings.home, source) ? resolve(settings.directory, relative(settings.home, beside)) : beside
}
// Like emit, setup protects the complete selected output set before cleanup.
export function removeSupersededSidecars(root, tracked, configs, ts) {
  const key = path => ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase()
  const plans = [], selected = new Set()
  for (const config of configs) {
    const settings = sidecarSettings(resolve(root, config), ts)
    if (!settings) continue
    for (const file of tracked.filter(path => path.endsWith(".vibe"))) {
      const source = resolve(root, file)
      if (!within(settings.home, source)) continue
      const output = sidecarPath(source, settings)
      selected.add(key(output))
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
