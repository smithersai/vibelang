import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import MagicString from "magic-string"
import remapping from "@jridgewell/remapping"

// VIP-57. The compiler lowers `import w from "./stats.vibe" with { type: "worker" }` to
//   const w = runtime.$worker(new URL("./stats.js", import.meta.url), [w$Stats])
// on its namespace import of vibelang-runtime/internal. Unbundled, the runtime
// starts its own worker entry on that module. A bundle has no ./stats.js, so the
// plugin emits a worker entry for the module and passes its URL instead, with
// the third argument true: `url` is then a self-contained worker entry script.

const runtimeModule = "vibelang-runtime/internal"

// The host module that serves a worker module's default Layer, per platform.
export const workerPlatforms = {
  node: ["ExperimentalNodeRpc", "vibelang-runtime/experimental/platform-node"],
  bun: ["ExperimentalBunRpc", "vibelang-runtime/experimental/platform-bun"],
  browser: ["ExperimentalBrowserRpc", "vibelang-runtime/experimental/platform-browser"]
}

export function checkPlatform(platform, plugin) {
  if (platform !== undefined && !Object.hasOwn(workerPlatforms, platform)) {
    throw new Error(`${plugin}: workerPlatform must be "node", "bun" or "browser", not ${JSON.stringify(platform)}`)
  }
}

// A worker entry is its worker module's id with this query. The module's own
// directory resolves the entry's import of it, and every bundler keeps the
// query apart from the module itself.
const entryKey = "vibelang-worker"
export function workerEntryPlatform(id) {
  const query = id.indexOf("?")
  if (query < 0) return
  const platform = new URLSearchParams(id.slice(query + 1)).get(entryKey)
  return Object.hasOwn(workerPlatforms, platform ?? "") ? platform : undefined
}
export const workerEntryId = (file, platform) => `${file}?${entryKey}=${platform}`

// The entry's code: import the module and serve the schema services of its
// default Layer on the platform's worker runner.
export function workerEntryCode(file, platform) {
  const [name, module] = workerPlatforms[platform]
  return `import layer from ${JSON.stringify("./" + basename(file))}\n` +
    `import { ${name} } from ${JSON.stringify(module)}\n` +
    `${name}.runWorker(layer)\n`
}

// Cheap gate: only output that calls a member named $worker is parsed.
export const hasWorkerImports = (code) => typeof code === "string" && code.includes(".$worker(")

function nodes(ast) {
  const result = [], pending = [ast]
  while (pending.length) {
    const node = pending.pop()
    if (!node || typeof node !== "object") continue
    result.push(node)
    for (const [key, value] of Object.entries(node)) {
      if (["range", "loc", "tokens", "comments"].includes(key)) continue
      if (Array.isArray(value)) for (const child of value) pending.push(child)
      else if (value && typeof value === "object") pending.push(value)
    }
  }
  return result
}

const stringValue = (node) => node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined
const named = (node, name) => node?.type === "Identifier" && node.name === name
const member = (node, object, property) => node?.type === "MemberExpression" && !node.computed && object(node.object) && named(node.property, property)
const isRuntimeRequire = (node) => node?.type === "CallExpression" && named(node.callee, "require") && stringValue(node.arguments[0]) === runtimeModule
// import.meta.url, or CommonJS's require("node:url").pathToFileURL(__filename).
const isModuleUrl = (node) =>
  member(node, (object) => object?.type === "MetaProperty" && object.meta?.name === "import" && object.property?.name === "meta", "url") ||
  (node?.type === "CallExpression" && member(node.callee, (object) => object?.type === "CallExpression" && named(object.callee, "require") && ["url", "node:url"].includes(stringValue(object.arguments[0])), "pathToFileURL") &&
    named(node.arguments[0], "__filename"))

/**
 * The worker imports of compiled module code, given its ESTree: each call
 * `ns.$worker(new URL("<specifier>", <module URL>), [<identifiers>])` whose
 * `ns` binds vibelang-runtime/internal. `url` is the `new URL(...)` node;
 * `specifier` its decoded string, the worker module relative to the module.
 */
export function workerCalls(ast) {
  const all = nodes(ast)
  const runtimes = new Set()
  for (const node of all) {
    if (node.type === "ImportDeclaration" && stringValue(node.source) === runtimeModule) {
      for (const specifier of node.specifiers) if (specifier.type === "ImportNamespaceSpecifier") runtimes.add(specifier.local.name)
    }
    // CommonJS: const runtime_1 = __importStar(require("vibelang-runtime/internal")).
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.init &&
        (isRuntimeRequire(node.init) || (node.init.type === "CallExpression" && node.init.arguments.some(isRuntimeRequire)))) runtimes.add(node.id.name)
  }
  const calls = []
  if (!runtimes.size) return calls
  for (const node of all) {
    if (node.type !== "CallExpression" || node.arguments.length !== 2) continue
    if (!member(node.callee, (object) => object?.type === "Identifier" && runtimes.has(object.name), "$worker")) continue
    const [url, services] = node.arguments
    if (url?.type !== "NewExpression" || !named(url.callee, "URL") || url.arguments.length !== 2 || !isModuleUrl(url.arguments[1])) continue
    const written = stringValue(url.arguments[0])
    if (written === undefined || services?.type !== "ArrayExpression" || !services.elements.every((element) => element?.type === "Identifier")) continue
    let specifier
    try { specifier = written.split("/").map(decodeURIComponent).join("/") } catch { continue }
    calls.push({ call: node, url, specifier })
  }
  return calls.sort((a, b) => a.call.range[0] - b.call.range[0])
}

// The worker module's source for the specifier the compiler wrote: the
// project may rewrite ./stats.vibe to ./stats.js.
export function workerModule(importer, specifier) {
  const target = resolve(dirname(importer), specifier)
  if (/\.vibex?$/.test(target)) return existsSync(target) ? target : undefined
  const stem = target.replace(/\.[cm]?jsx?$/, "")
  if (stem === target) return existsSync(target) ? target : undefined
  for (const extension of target.endsWith(".jsx") ? [".vibex", ".tsx"] : [".vibe", ".vibex", ".ts", ".tsx"]) {
    if (existsSync(stem + extension)) return stem + extension
  }
  return existsSync(target) ? target : undefined
}

/**
 * Rewrites each worker import of a compiled module to the entry form.
 * `replace({ module, specifier })` returns `{ code }`, the JavaScript of the
 * call's new first argument, and the call gains `true` as its third, unless
 * it also returns `entry: false`. A `prepend` statement, such as the import
 * of a Worker class, is added once at the top. The edits compose with
 * `map`, the compiler's map, so positions keep pointing at the source.
 */
export function workerOutput({ code, map }, file, { parse, replace }) {
  const calls = workerCalls(parse(code, file))
  if (!calls.length) return { code, map }
  const edits = new MagicString(code)
  const prepended = new Set()
  for (const { call, url, specifier } of calls) {
    const module = workerModule(file, specifier)
    if (module === undefined) throw new Error(`VibeLang: ${file} imports ${JSON.stringify(specifier)} with { type: "worker" }, which is not a file`)
    const replacement = replace({ module, specifier })
    edits.overwrite(url.range[0], url.range[1], replacement.code)
    if (replacement.entry !== false) edits.appendLeft(call.arguments[1].range[1], ", true")
    if (replacement.prepend && !prepended.has(replacement.prepend)) {
      prepended.add(replacement.prepend)
      edits.prepend(replacement.prepend + "\n")
    }
  }
  const edited = edits.generateMap({ file, source: file, includeContent: true, hires: true })
  return { code: edits.toString(), map: map ? remapping([edited, map], () => null) : edited }
}

// The compiler's ESTree of module code, as relative-output.js reads it.
export function compilerParser(backend, compiler, debug) {
  return (text, file) => {
    const [executable, args] = backend.compilerCommand(compiler(), ["--estree", file + ".vibex"])
    debug(`worker imports parse: ${file}`)
    const run = spawnSync(executable, args, { input: text, encoding: "utf8", maxBuffer: 1 << 30 })
    if (run.error || run.status !== 0) throw new Error(`VibeLang could not read worker imports in ${file} (status ${run.status ?? run.error?.code})`)
    let parsed
    try { parsed = JSON.parse(run.stdout) } catch {
      throw new Error(`VibeLang returned invalid worker-import syntax data for ${file}`)
    }
    if (!parsed.ast) throw new Error(`VibeLang returned no worker-import syntax data for ${file}`)
    return parsed.ast
  }
}
