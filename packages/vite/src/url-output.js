import { spawnSync } from "node:child_process"
import MagicString from "magic-string"

const pathname = url => url.split(/[?#]/)[0]
const withoutBase = (url, base) => base !== "/" && url.startsWith(base) ? "/" + url.slice(base.length) : url

function mapped(edits, id) {
  return { code: edits.toString(), map: edits.generateMap({ hires: true, includeContent: true, source: id }) }
}

// Vite's HMR protocol uses filesystem module URLs as callback keys. Only the
// browser import needs escaping; changing the keys would lose accept handlers.
// Feature-detect the unescaped renderer in the supported Vite clients.
export function clientUrls(code, id) {
  if (!id.endsWith("/dist/client/client.mjs")) return
  if (!code.includes('moduleUrlToBrowserUrl(`${acceptedPathWithoutQuery}?') &&
      !code.includes('base + acceptedPathWithoutQuery.slice(1) +')) return
  const binding = 'const [acceptedPathWithoutQuery, query] = acceptedPath.split(`?`);'
  const index = code.indexOf(binding)
  if (index < 0) return
  const edits = new MagicString(code)
  edits.overwrite(index, index + binding.length,
    'const [vibelangAcceptedPathname, query] = acceptedPath.split(`?`); const acceptedPathWithoutQuery = vibelangAcceptedPathname.replaceAll("%", "%25");')
  return mapped(edits, id)
}

function nodes(ast) {
  const result = [], pending = [ast]
  while (pending.length) {
    const node = pending.pop()
    if (!node || typeof node !== "object") continue
    result.push(node)
    for (const [key, value] of Object.entries(node)) {
      if (["range", "tokens", "comments", "loc"].includes(key)) continue
      if (Array.isArray(value)) for (const child of value) pending.push(child)
      else if (value && typeof value === "object") pending.push(value)
    }
  }
  return result
}

function value(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value
  if (node?.type === "TemplateLiteral" && !node.expressions.length) return node.quasis[0]?.value.cooked
}

function timestamped(url, timestamp) {
  if (!timestamp) return url
  const index = url.indexOf("#"), hash = index < 0 ? "" : url.slice(index)
  const request = index < 0 ? url : url.slice(0, index)
  if (/[?&]t=/.test(request)) return request.replace(/([?&])t=[^&]*/, "$1t=" + timestamp) + hash
  return request + (request.includes("?") ? "&" : "?") + "t=" + timestamp + hash
}

// Run after Vite's import analysis. Its resolved module URLs name files, so a
// literal percent must be escaped once more when rendered as an HTTP request.
// The graph identifies the resolved file and avoids guessing from URL text.
export function moduleUrls(code, id, { base, graph, backend, compiler, debug, versions, rewritten }) {
  if (!code.includes("%")) return
  const owner = graph?.getModuleById(id)
  const dependencies = [...(owner?.importedModules ?? [])].filter(module => module.file?.includes("%"))
  if (!dependencies.length) return
  const [binary, args] = backend.compilerCommand(compiler(), ["--estree", pathname(id) + ".vibex"])
  const started = Date.now()
  debug(`served URL parse start: ${id}`)
  const run = spawnSync(binary, args, { input: code, encoding: "utf8", maxBuffer: 1 << 30 })
  debug(`served URL parse finish: ${id}; status=${run.status}, ms=${Date.now() - started}`)
  if (run.error || run.status !== 0) throw new Error(`VibeLang could not read served module URLs in ${id} (status ${run.status ?? run.error?.code})`)
  let parsed
  try { parsed = JSON.parse(run.stdout) } catch {
    throw new Error(`VibeLang returned invalid served module syntax data for ${id}`)
  }
  if (!parsed.ast) throw new Error(`VibeLang returned no served module syntax data for ${id}`)
  const edits = new MagicString(code)
  let count = 0
  for (const node of nodes(parsed.ast)) {
    const source = ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(node.type) ? node.source : undefined
    const specifier = value(source)
    if (typeof specifier !== "string" || !specifier.startsWith("/") || specifier.startsWith("//")) continue
    const path = pathname(specifier)
    if (!path.includes("%")) continue
    const dependency = dependencies.find(module => pathname(module.url) === withoutBase(path, base))
    if (!dependency) continue
    const suffix = specifier.slice(path.length)
    const url = timestamped(path.replaceAll("%", "%25") + suffix, versions.get(dependency.file) || dependency.lastHMRTimestamp)
    edits.overwrite(source.range[0], source.range[1], JSON.stringify(url))
    count++
  }
  debug(`served module URL escapes: ${id}; count=${count}`)
  if (!count) return
  rewritten.add(owner)
  return mapped(edits, id)
}
