// Generates docs/design/inventory/platform-globals.json: what EK4402 bans.
// A symbol reaches the platform when it does I/O, starts a timer, or reads or
// changes host state (VIP-33). Run: node docs/tools/platform-globals.mjs --write
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
export const artifactPath = "docs/design/inventory/platform-globals.json"
const libs = join(root, "typescript/tsc/internal/bundled/libs")
const nodeTypes = join(root, "docs/tools/node_modules/@types/node")
const hash = (text) => createHash("sha256").update(text).digest("hex")
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0

// The closed allowlist of pure data utilities. A name can be added, never removed.
export const allowlist = ["AbortController", "AbortSignal", "TextDecoder", "TextEncoder", "URL", "URLSearchParams", "atob", "btoa", "structuredClone"]

// Every member of an allowlisted global, classified. A TypeScript bump that adds
// one fails generation until it is listed here: pure, or reaching the host.
export const reachesHost = {
  "AbortSignal.timeout": "starts a timer",
  "URL.createObjectURL": "stores a Blob in the host's blob URL store",
  "URL.revokeObjectURL": "changes the host's blob URL store",
}
const pure = new Set([
  "AbortController.abort", "AbortController.signal",
  "AbortSignal.abort", "AbortSignal.aborted", "AbortSignal.addEventListener", "AbortSignal.any", "AbortSignal.dispatchEvent",
  "AbortSignal.onabort", "AbortSignal.reason", "AbortSignal.removeEventListener", "AbortSignal.throwIfAborted",
  "TextDecoder.decode", "TextDecoder.encoding", "TextDecoder.fatal", "TextDecoder.ignoreBOM",
  "TextEncoder.encode", "TextEncoder.encodeInto", "TextEncoder.encoding",
  "URL.canParse", "URL.hash", "URL.host", "URL.hostname", "URL.href", "URL.origin", "URL.parse", "URL.password", "URL.pathname",
  "URL.port", "URL.protocol", "URL.search", "URL.searchParams", "URL.toJSON", "URL.toString", "URL.username",
  "URLSearchParams.append", "URLSearchParams.delete", "URLSearchParams.entries", "URLSearchParams.forEach", "URLSearchParams.get",
  "URLSearchParams.getAll", "URLSearchParams.has", "URLSearchParams.keys", "URLSearchParams.set", "URLSearchParams.size",
  "URLSearchParams.sort", "URLSearchParams.toString", "URLSearchParams.values",
])

const hostFile = (file) => /(^|\/)lib\.(dom|webworker|scripthost)[^/]*\.d\.ts$/.test(file) || file.includes("/@types/node/")
const esFile = (file) => /(^|\/)lib\.(es|decorators)[^/]*\.d\.ts$/.test(file)

function dts(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name)).flatMap(entry =>
    entry.isDirectory() ? dts(join(directory, entry.name)) : entry.name.endsWith(".d.ts") ? [join(directory, entry.name)] : [])
}

export function generate() {
  const ts = createRequire(join(root, "docs/tools/package.json"))(existsSync(join(root, "docs/tools/node_modules/typescript")) ? "typescript" : join(root, "experiments/node_modules/typescript"))
  const version = JSON.parse(readFileSync(join(nodeTypes, "package.json"), "utf8")).version
  const libFiles = readdirSync(libs).filter(name => /^lib\..*\.d\.ts$/.test(name)).sort(compare).map(name => join(libs, name))
  const nodeFiles = dts(nodeTypes)
  const probe = join(root, "docs/tools/.platform-globals-probe.ts")
  const options = { noLib: true, types: [], noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host), fileExists = host.fileExists.bind(host), getSourceFile = host.getSourceFile.bind(host)
  host.fileExists = (file) => file === probe || fileExists(file)
  host.readFile = (file) => file === probe ? "" : readFile(file)
  host.getSourceFile = (file, ...rest) => file === probe ? ts.createSourceFile(file, "", ts.ScriptTarget.ESNext) : getSourceFile(file, ...rest)
  const program = ts.createProgram({ rootNames: [...libFiles, ...nodeFiles, probe], options, host })
  const checker = program.getTypeChecker()
  const scope = checker.getSymbolsInScope(program.getSourceFile(probe), ts.SymbolFlags.Value)

  const banned = []
  const seen = new Set()
  for (const symbol of scope) {
    const name = symbol.getName()
    if (seen.has(name) || name === "undefined" || name === "globalThis") continue
    seen.add(name)
    const files = (symbol.getDeclarations() ?? []).map(d => d.getSourceFile().fileName)
    if (files.length && files.some(hostFile) && !files.some(esFile) && !allowlist.includes(name)) banned.push(name)
  }

  const members = []
  for (const name of allowlist) {
    const symbol = scope.find(s => s.getName() === name)
    if (!symbol) throw new Error(`${name} is not a global`)
    const location = program.getSourceFile(probe)
    const type = checker.getTypeOfSymbolAtLocation(symbol, location)
    if (type.getCallSignatures().length && !type.getConstructSignatures().length) continue
    const instance = type.getConstructSignatures().map(s => s.getReturnType())[0]
    const properties = new Set([...type.getProperties(), ...(instance?.getProperties() ?? [])].map(p => p.getName()))
    for (const member of [...properties].filter(m => m !== "prototype" && !m.startsWith("__@")).sort(compare)) {
      const key = `${name}.${member}`
      if (reachesHost[key]) members.push({ member: key, status: "banned", reason: reachesHost[key] })
      else if (pure.has(key)) members.push({ member: key, status: "allowed" })
      else throw new Error(`classify ${key}: add it to pure or reachesHost in docs/tools/platform-globals.mjs`)
    }
  }
  const missing = Object.keys(reachesHost).filter(key => !members.some(m => m.member === key))
  if (missing.length) throw new Error(`no longer declared: ${missing.join(", ")}`)

  return {
    schemaVersion: 1,
    generatedBy: "node docs/tools/platform-globals.mjs --write",
    rule: "VIP-33. A statically named value is EK4402 when the symbol it resolves to reaches the platform: a global binding declared only by a host library and not on the allowlist, or a banned member of an allowlisted global. The compiler checks declaration sources directly; this file documents the rule.",
    inputs: {
      typescript: { files: libFiles.map(file => ({ file: relative(root, file), sha256: hash(readFileSync(file, "utf8")) })) },
      "@types/node": { version, sha256: hash(nodeFiles.map(file => hash(readFileSync(file, "utf8"))).join("\n")) },
    },
    allowlist,
    members,
    banned: banned.sort(compare),
  }
}

export const serialize = (inventory) => JSON.stringify(inventory, null, 2) + "\n"

if (process.argv.includes("--write")) {
  mkdirSync(dirname(join(root, artifactPath)), { recursive: true })
  writeFileSync(join(root, artifactPath), serialize(generate()))
}
