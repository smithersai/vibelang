// Keep every public runtime entry in a mixed package on the same emitted graph.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"

const native = /(?<!\.d)\.(?:[cm]?tsx?|[cm]?jsx?)$/
const metadata = new Set(["types", "typings", "vibelang-source"])
const skipped = (name) => name.startsWith(".") || ["node_modules", "dist", "coverage", "test", "tests", "__tests__", "fixtures"].includes(name)

/** An untouched TypeScript runtime export can be an entry into a private .vibe module. */
export function hasNativeRuntimeExport(value, condition) {
  if (metadata.has(condition)) return false
  if (typeof value === "string") return /(?<!\.d)\.[cm]?tsx?$/.test(value)
  if (Array.isArray(value)) return value.some(item => hasNativeRuntimeExport(item, condition))
  return !!value && typeof value === "object" && Object.entries(value).some(([key, item]) => hasNativeRuntimeExport(item, key))
}

export function hasVibeSource(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.isDirectory()) {
      if (!skipped(item.name) && !existsSync(join(directory, item.name, "package.json")) && hasVibeSource(join(directory, item.name))) return true
    } else if (item.name.endsWith(".vibe") && !/\.(?:test|spec)\.vibe$/.test(item.name)) return true
  }
  return false
}

// A wrapper this pass owns can be recovered without a side receipt: its types
// and source both name the original native module, and default is in our emit.
function original(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const source = value["vibelang-source"]
  if (Object.keys(value).sort().join(",") !== "default,types,vibelang-source" ||
      typeof source !== "string" || !native.test(source) || value.types !== source ||
      typeof value.default !== "string" || !value.default.startsWith("./.vibelang/js/")) return undefined
  return source
}

function emittedTarget(source, outputs) {
  if (!source.startsWith("./") || !native.test(source)) return undefined
  source = "./" + posix.normalize(source.slice(2))
  if (source.startsWith("./../")) return undefined
  if (!source.includes("*")) return outputs[source]
  if (source.split("*").length !== 2) return undefined
  const [head, tail] = source.split("*")
  const prefix = "./.vibelang/js/" + head.slice(2)
  let suffix
  let matched = false
  for (const [input, output] of Object.entries(outputs)) {
    if (!input.startsWith(head) || !input.endsWith(tail)) continue
    const star = input.slice(head.length, tail ? -tail.length : undefined)
    if (!star || !output.startsWith(prefix + star)) return undefined
    const end = output.slice((prefix + star).length)
    if (suffix !== undefined && suffix !== end) return undefined
    suffix = end
    matched = true
  }
  return matched ? prefix + "*" + suffix : undefined
}

/** Route native entries only to files the package's actual compile produced. */
export function routeEmittedExports(packageDir, outputs, { restore = false } = {}) {
  const path = join(packageDir, "package.json")
  if (!existsSync(path)) return false
  const before = readFileSync(path, "utf8")
  const pkg = JSON.parse(before)
  const walk = (value, condition) => {
    const prior = original(value)
    if (prior !== undefined) value = prior
    if (typeof value === "string") {
      if (restore || metadata.has(condition)) return value
      const target = emittedTarget(value, outputs)
      return target === undefined ? value : { types: value, "vibelang-source": value, default: target }
    }
    if (Array.isArray(value)) return value.map(item => walk(item, condition))
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, metadata.has(key) ? item : walk(item, key)]))
    return value
  }
  for (const field of ["exports", "imports"]) if (field in pkg) pkg[field] = walk(pkg[field])
  if (JSON.stringify(JSON.parse(before)) === JSON.stringify(pkg)) return false
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
  return true
}
