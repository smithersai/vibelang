// Test support: one stock host and the published shared API-identity checker.
// No declaration text canonicalizer and no second TypeScript compiler host.
import { forms, probe } from "./resolution-matrix.mjs"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../", import.meta.url))
export const declarationApiTypeScript = loadTypeScript([join(repo, "docs/tools")])
export const declarationApiForms = forms
export const declarationApiModes = ["node10", "node16", "nodenext", "bundler"]
const ts = declarationApiTypeScript
const nativeDeclarations = new Map()
function put(root, name, text) {
  const path = join(root, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
function source(specifier, syntax, quote) {
  const written = quote + specifier + quote
  const body = {
    named: "export { value } from " + written,
    star: "export * from " + written,
    alias: "export { value as publicValue } from " + written,
    type: "export type Value = typeof import(" + written + ").value",
  }[syntax]
  if (!body) throw new Error("Unknown export syntax: " + syntax)
  return "/** Public entry documentation. */\n" + body + ";\n"
}
export async function emitDeclarationApiPair(root, id, options) {
  const { resolution, allow, rewrite, packageType, form, style = null,
    syntax = "named", quote = '"', shape = "number", doc = "Public value documentation." } = options
  const initializer = { number: "1", string: '"ok"', "{ readonly id: number }": "{ id: 1 }" }[shape]
  if (!initializer) throw new Error("Unknown fixture shape: " + shape)
  const targetSource = "/** " + doc + " */\nexport const value: " + shape + " = " + initializer + ";\n"
  // Legacy Vibe settings cannot affect the all-TypeScript twin. Reuse each
  // real native emit across those four settings, while bounding the cache.
  const nativeKey = JSON.stringify([resolution, allow, rewrite, packageType, form, syntax, quote, shape, doc])
  let native = nativeDeclarations.get(nativeKey)
  if (!native) {
    native = probe(resolution, allow, rewrite, form, packageType, true,
      { captureDeclarations: true, source: source(form[1], syntax, quote), targetSource, lib: ["es2022"] })
    nativeDeclarations.set(nativeKey, native)
    if (nativeDeclarations.size > 512) nativeDeclarations.delete(nativeDeclarations.keys().next().value)
  }
  const before = join(root, "native", String(id)), afterProject = join(root, "vibe", String(id))
  put(before, "package.json", JSON.stringify({ type: packageType }))
  for (const [name, text] of Object.entries(native.declarations)) put(before, name, text)
  put(afterProject, "package.json", JSON.stringify({ type: packageType }))
  put(afterProject, "main.vibe", source(form[3], syntax, quote))
  put(afterProject, form[4], targetSource)
  const config = {
    compilerOptions: {
      target: "es2022", lib: ["es2022"], module: ["node16", "nodenext"].includes(resolution) ? resolution : "esnext",
      moduleResolution: resolution, allowImportingTsExtensions: allow, rewriteRelativeImportExtensions: rewrite,
      jsx: "preserve", declaration: true, emitDeclarationOnly: true, rootDir: ".", outDir: "out",
      types: [], skipLibCheck: true,
    },
    vibe: { effectGlobals: false, effectModules: false }, files: ["main.vibe", form[4]],
  }
  if (style !== null) config.vibelang = { declarationImportStyle: style }
  put(afterProject, "tsconfig.json", JSON.stringify(config))
  const binary = process.env.VIBELANG_BINARY ?? join(repo, "packages/compiler/native", process.platform === "win32" ? "vibelang.exe" : "vibelang")
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, ["-p", afterProject, "--singleThreaded", "--pretty", "false"],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, signal: options.signal })
    let stdout = "", stderr = ""
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8")
    child.stdout.on("data", chunk => { stdout += chunk })
    child.stderr.on("data", chunk => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }))
  })
  if (result.error || result.signal || ![0, 1, 2].includes(result.status))
    throw new Error("Declaration compiler failed: " + (result.error?.message ?? result.signal ?? result.status))
  // Native stale-name controls have no exported API to compare. Do not turn
  // unresolved declarations into any or fabricate a companion declaration.
  const resolved = ts.resolveModuleName(form[1], join(before, "main.d.ts"),
    { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true, noEmit: true }, ts.sys).resolvedModule
  const after = join(afterProject, "out")
  if (resolved && !existsSync(join(after, "main.d.ts")))
    throw new Error("Missing Vibe declaration for " + native.key + "/" + style)
  return { id: String(id), key: native.key, style, form: form[0], before, after,
    nativeGraphValid: Boolean(resolved), nativeDiagnostics: native.diagnostics,
    vibeStatus: result.status, vibeDiagnostics: result.stdout + result.stderr }
}
export function compareDeclarationApiPairs(root, rows) {
  const valid = rows.filter(row => row.nativeGraphValid)
  if (!valid.length) throw new Error("No valid native declaration graph")
  const beforeEntrypoints = Object.fromEntries(valid.map(row => [row.id, join(row.before, "main.d.ts")]))
  const afterEntrypoints = Object.fromEntries(valid.map(row => [row.id, join(row.after, "main.d.ts")]))
  // Fixtures use only ES2022 types, so both producers and this consumer use
  // that library instead of unrelated DOM declarations.
  // This is the shared checker's bare-tree consumer contract. The producer's
  // tsconfig and diagnostics are retained independently in each matrix row.
  const result = compareApiIdentity(ts, join(root, "native"), join(root, "vibe"),
    { beforeEntrypoints, afterEntrypoints, compilerOptions: {
      target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts"], module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve,
    }, moduleRoots: [process.env.EFFECT_NODE_MODULES, join(repo, "experiments/node_modules")].filter(Boolean) })
  return { ...result, comparisons: valid.length, nativeInvalidGraphs: rows.filter(row => !row.nativeGraphValid),
    rows }
}

// Bound independent compiler processes to the lane's eight-job budget.
// Drain in-flight work on failure before the caller removes its private tree.
export async function emitDeclarationApiPairs(root, requests, signal) {
  const rows = new Array(requests.length)
  let next = 0, failure
  const settled = await Promise.allSettled(Array.from({ length: Math.min(8, requests.length) }, async () => {
    while (!failure) {
      const index = next++
      if (index >= requests.length) return
      try { rows[index] = await emitDeclarationApiPair(root, index, { ...requests[index], signal }) }
      catch (error) { failure ??= error }
    }
  }))
  for (const result of settled) if (result.status === "rejected") failure ??= result.reason
  if (failure) throw failure
  return rows
}
