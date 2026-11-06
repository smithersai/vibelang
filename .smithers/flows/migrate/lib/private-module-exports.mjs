// A named module's emitted companion is an implementation file. Broad package
// patterns must not turn it into an additional public entry.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const receiptFile = ".vibelang/private-module-exports.json"
const sourceExtension = /\.(?:vibex?|[cm]?tsx?|[cm]?jsx?)$/
const maps = pkg => [["exports", pkg.exports], ["publishConfig.exports", pkg.publishConfig?.exports]]
const leaves = value => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(leaves) : value && typeof value === "object" ? Object.values(value).flatMap(leaves) : []
function match(pattern, value) {
  const parts = pattern.split("*")
  if (parts.length !== 2 || !value.startsWith(parts[0]) || !value.endsWith(parts[1]) || value.length < parts[0].length + parts[1].length) return undefined
  return value.slice(parts[0].length, parts[1].length ? -parts[1].length : undefined)
}
function selected(map, key) {
  if (Object.hasOwn(map, key)) return key
  return Object.keys(map).filter(pattern => pattern.startsWith("./") && match(pattern, key) !== undefined)
    .sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length)[0]
}

/** Only compiler-proven companion outputs create exclusions; authored names are untouched. */
export function excludePrivateModules(root, pkg, moduleOutputs, { restore = false } = {}) {
  const path = join(root, receiptFile)
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { version: 1, entries: [] }
  if (moduleOutputs === undefined && !restore) return { changed: false, files: [] }
  const publicMaps = maps(pkg)
  for (const entry of previous.entries) {
    const map = publicMaps.find(([field]) => field === entry.field)?.[1]
    if (map && Object.hasOwn(map, entry.key) && map[entry.key] === null) delete map[entry.key]
  }
  const keys = new Map()
  if (!restore) for (const { source, output } of moduleOutputs ?? []) {
    // emitPackageJs supplies the owner, not a guessed filename prefix.
    if (!/^\.\/.*\.vibex?$/.test(source) || !output.startsWith("./.vibelang/js/")) continue
    const virtualStem = "./" + output.slice("./.vibelang/js/".length).replace(/\.jsx?$/, "")
    if (!virtualStem.startsWith(source + ".") || virtualStem.includes("/../")) continue
    if ([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".vibe", ".vibex"].some(ext => existsSync(join(root, virtualStem + ext)))) continue
    for (const [, map] of publicMaps) {
      if (!map || typeof map !== "object" || Array.isArray(map)) continue
      for (const [pattern, value] of Object.entries(map)) {
        if (!pattern.startsWith("./") || !pattern.includes("*")) continue
        for (const target of leaves(value)) {
          const normalized = target.replace(/^\.\/\.vibelang\/js\//, "./").replace(sourceExtension, "")
          const star = match(normalized, virtualStem)
          if (star === undefined || !star) continue
          const key = pattern.replaceAll("*", star)
          if (!keys.has(key)) keys.set(key, new Set())
          keys.get(key).add(pattern)
        }
      }
    }
  }
  const entries = []
  for (const [field, map] of publicMaps) {
    if (!map || typeof map !== "object" || Array.isArray(map)) continue
    for (const key of [...keys.keys()].sort()) {
      if (Object.hasOwn(map, key)) continue
      const pattern = selected(map, key)
      if (!pattern || !keys.get(key).has(pattern) || !leaves(map[pattern]).length) continue
      map[key] = null
      entries.push({ field, key })
    }
  }
  const next = { version: 1, entries }
  if (!entries.length) {
    if (!existsSync(path)) return { changed: false, files: [] }
    unlinkSync(path)
    return { changed: true, files: [receiptFile] }
  }
  const text = JSON.stringify(next, null, 2) + "\n"
  if (existsSync(path) && readFileSync(path, "utf8") === text) return { changed: false, files: [receiptFile] }
  mkdirSync(join(root, ".vibelang"), { recursive: true })
  writeFileSync(path, text)
  return { changed: true, files: [receiptFile] }
}
