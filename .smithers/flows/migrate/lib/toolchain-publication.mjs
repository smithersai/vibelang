import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, posix, resolve } from "node:path"
import { tarballFiles } from "./upgrade.mjs"
import { writeJson } from "./util.mjs"

export const toolchainPackageNames = ["vibelang-runtime", "vibelang", "vibelang-vite", "vibelang-unplugin"]
const receiptPath = ".vibelang/toolchain-publication.json"
const publicPackage = pkg => pkg.private !== true && typeof pkg.name === "string" && typeof pkg.version === "string"
const local = spec => typeof spec === "string" && spec.startsWith("file:")
const releasePattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const releaseVersion = value => {
  const match = typeof value === "string" && releasePattern.exec(value)
  return Boolean(match && !match[1]?.split(".").some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0")))
}

/** The exact release this staged package contains, rather than a filename's hash or the compiler's version. */
export function stagedRelease(directory, spec, name) {
  const path = resolve(directory, spec.slice(5))
  let text
  try {
    text = statSync(path).isDirectory() ? readFileSync(join(path, "package.json"), "utf8") : tarballFiles(readFileSync(path))["package.json"]
  } catch {
    throw new Error("Cannot read staged " + name + " package metadata from " + spec)
  }
  if (text === undefined) throw new Error("Staged " + name + " archive has no package.json")
  let pkg
  try { pkg = JSON.parse(text) } catch { throw new Error("Staged " + name + " package.json is not valid JSON") }
  if (pkg?.name !== name || !releaseVersion(pkg?.version)) throw new Error("Staged " + name + " package.json needs its real name and exact release version")
  return pkg.version
}

/** A packed consumer installs the release; development keeps the exact staged build. */
export function publishableDependency(pkg, name, spec, version, manager) {
  const next = structuredClone(pkg)
  if (!toolchainPackageNames.includes(name) || !publicPackage(pkg) || !pkg.dependencies?.[name] || !local(spec)) return next
  if (!releaseVersion(version)) throw new Error("A public " + name + " dependency needs its staged artifact's release version")
  next.dependencies[name] = version
  if (!["npm", "pnpm", "bun", "yarn"].includes(manager)) throw new Error("A staged public dependency needs its local package manager")
  if (manager === "npm") next.devDependencies = { ...next.devDependencies, [name]: spec }
  else if (next.devDependencies) delete next.devDependencies[name]
  return next
}

/** Installer specifiers of the existing staged build, rebased for a newly wired package. */
export function stagedToolchainSpecs(target, packageDir) {
  const file = join(target, receiptPath)
  if (!existsSync(file)) return {}
  const receipt = JSON.parse(readFileSync(file, "utf8"))
  return Object.fromEntries(Object.entries(receipt.localPins ?? {}).map(([name, spec]) => {
    if (!toolchainPackageNames.includes(name) || !local(spec)) throw new Error("Invalid managed staged toolchain pin")
    if (spec.startsWith("file:/")) return [name, spec]
    const relative = posix.relative(packageDir || ".", spec.slice(5))
    return [name, "file:" + (relative.startsWith(".") ? relative : "./" + relative)]
  }))
}

function yamlSlot(text, name) {
  const lines = text.split("\n")
  const start = lines.findIndex(line => /^overrides:\s*(?:#.*)?$/.test(line))
  if (start < 0) return { lines, start, end: -1, index: -1 }
  let end = start + 1
  while (end < lines.length && (!lines[end].trim() || /^\s/.test(lines[end]) || /^#/.test(lines[end]))) end++
  let index = -1, value
  const pattern = new RegExp('^  (["\x27]?)' + name + '\\1:\\s*(.*?)(?:\\s+#.*)?$')
  for (let i = start + 1; i < end; i++) {
    const match = pattern.exec(lines[i])
    if (!match) continue
    index = i
    const raw = match[2]
    value = raw.startsWith('"') ? JSON.parse(raw) : raw.startsWith("'") ? raw.slice(1, -1).replaceAll("''", "'") : raw
    break
  }
  return { lines, start, end, index, value }
}

/**
 * pnpm/Bun/Yarn install staged builds through root pins; npm uses a dev
 * dependency mirror. Duplicating the mirror makes Bun query the registry. Pins cover the staged toolchain,
 * including a compiler that source-child wiring later needs at runtime.
 * Only observed public dependencies appear in releaseRequired. The receipt
 * owns generated overrides, so switching to a published build removes those
 * entries or updates an existing pin without changing unrelated settings.
 */
export function prepareToolchainPublication({ target, manifests, manager, specsFor }) {
  const pending = new Map()
  const original = file => existsSync(join(target, file)) ? readFileSync(join(target, file), "utf8") : ""
  const read = file => pending.get(file) ?? original(file)
  const json = file => JSON.parse(read(file))
  const put = (file, pkg) => pending.set(file, JSON.stringify(pkg, null, 2) + "\n")
  const rootSpecs = specsFor(".")
  const old = existsSync(join(target, receiptPath)) ? json(receiptPath) : null
  if (old && old.manager !== manager) throw new Error("Reconcile the managed toolchain publication pins before changing package managers")
  const files = [...new Set(manifests)].filter(file => posix.basename(file) === "package.json" && existsSync(join(target, file)))
  const packages = files.filter(file => {
    const pkg = json(file)
    return publicPackage(pkg) && toolchainPackageNames.some(name => pkg.dependencies?.[name])
  })
  if (!packages.length && !old) return { changed: [], versions: {}, releaseRequired: [] }
  const pins = Object.fromEntries(Object.entries(rootSpecs).filter(([name, spec]) => toolchainPackageNames.includes(name) && local(spec)))
  const versions = Object.fromEntries(Object.entries(pins).map(([name, spec]) => [name, stagedRelease(target, spec, name)]))
  const required = new Map()
  for (const file of files) {
    let pkg = json(file)
    const specs = specsFor(posix.dirname(file))
    for (const name of toolchainPackageNames) {
      const spec = specs[name]
      // Setup replaces dependencies before reaching this helper; clean up a
      // dev mirror that a previous staged setup added when moving to a published build.
      if (!local(spec) && spec && old?.packages?.includes(file) && local(pkg.devDependencies?.[name])) {
        pkg.devDependencies[name] = spec
      }
      if (!publicPackage(pkg) || !pkg.dependencies?.[name]) continue
      if (local(spec)) {
        pkg = publishableDependency(pkg, name, spec, versions[name], manager)
        required.set(name, { name, version: versions[name] })
      } else if (spec) {
        pkg.dependencies[name] = spec
      }
    }
    if (JSON.stringify(pkg) !== JSON.stringify(json(file))) put(file, pkg)
  }
  const slotFor = (name, value) => ({
    name, value,
    file: manager === "pnpm" && existsSync(join(target, "pnpm-workspace.yaml")) ? "pnpm-workspace.yaml" : "package.json",
    table: manager === "pnpm" ? (existsSync(join(target, "pnpm-workspace.yaml")) ? "overrides" : "pnpm.overrides") : (manager === "yarn" || manager === "bun") ? "resolutions" : "overrides"
  })
  const desired = manager === "npm" ? [] : Object.entries(pins).map(([name, value]) => slotFor(name, value))
  const get = slot => {
    if (slot.file.endsWith(".yaml")) return yamlSlot(read(slot.file), slot.name).value
    let map = json(slot.file)
    for (const key of slot.table.split(".")) map = map?.[key]
    return map?.[slot.name]
  }
  const set = (slot, value) => {
    if (slot.file.endsWith(".yaml")) {
      const text = read(slot.file), info = yamlSlot(text, slot.name)
      if (info.index < 0) {
        if (value !== undefined) {
          const line = "  " + slot.name + ": " + JSON.stringify(value)
          if (info.start < 0) pending.set(slot.file, text.replace(/\n*$/, "\n") + "overrides:\n" + line + "\n")
          else { info.lines.splice(info.end, 0, line); pending.set(slot.file, info.lines.join("\n")) }
        }
        return
      }
      if (value === undefined) {
        info.lines.splice(info.index, 1)
        if (!info.lines.slice(info.start + 1, info.end - 1).some(line => line.trim())) info.lines.splice(info.start, info.end - info.start - 1)
      } else {
        const comment = /\s+#.*$/.exec(info.lines[info.index])?.[0] ?? ""
        info.lines[info.index] = "  " + slot.name + ": " + JSON.stringify(value) + comment
      }
      pending.set(slot.file, info.lines.join("\n"))
    } else {
      const pkg = json(slot.file)
      let map = pkg
      for (const key of slot.table.split(".")) map = map[key] ??= {}
      if (value === undefined) delete map[slot.name]
      else map[slot.name] = value
      put(slot.file, pkg)
    }
  }
  const sameSlot = (a, b) => a.file === b.file && a.table === b.table && a.name === b.name
  for (const slot of old?.overrides ?? []) {
    if (!toolchainPackageNames.includes(slot.name) || get(slot) !== slot.value) throw new Error("The managed " + slot.name + " override changed; reconcile " + receiptPath + " before switching toolchains")
    if (!desired.some(next => sameSlot(slot, next))) set(slot, slot.hadValue ? rootSpecs[slot.name] ?? slot.previous : undefined)
  }
  const overrides = desired.map(slot => {
    const previousSlot = old?.overrides?.find(previous => sameSlot(previous, slot))
    const previous = previousSlot ? previousSlot.previous : get(slot)
    const result = { ...slot, hadValue: previousSlot ? previousSlot.hadValue : previous !== undefined, ...(previous !== undefined ? { previous } : {}) }
    set(slot, slot.value)
    return result
  })
  const receipt = {
    version: 1, manager, versions,
    packages: [...new Set([...(Object.keys(pins).length ? old?.packages ?? [] : []), ...packages])].sort(),
    localPins: pins, releaseRequired: [...required.values()].sort((a, b) => a.name.localeCompare(b.name)), overrides
  }
  put(receiptPath, receipt)
  const changed = [...pending].filter(([file, text]) => original(file) !== text)
  for (const [file, text] of changed) {
    if (file.endsWith(".json")) writeJson(join(target, file), JSON.parse(text))
    else writeFileSync(join(target, file), text)
  }
  return { changed: changed.map(([file]) => file), versions, releaseRequired: receipt.releaseRequired }
}
