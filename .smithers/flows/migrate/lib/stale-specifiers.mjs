// Preserving migration for decided detail 296. It runs before the compiler
// retires .ts -> .vibe fallback, and also repairs an already-migrated corpus.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join, resolve } from "node:path"
import { applyEdits, parseImports } from "./imports.mjs"

export function staleSpecifier(ts, root, file, written, options) {
  if (!/^\.{1,2}\/.*\.tsx?$/.test(written)) return written
  const nativeExt = extname(written)
  const sourceExt = nativeExt === ".tsx" ? ".vibex" : ".vibe"
  const name = basename(written, nativeExt)
  const suffixes = options.moduleSuffixes ?? [""]
  const migrated = new Map()
  // Let tsc perform rootDirs, suffix and mode lookup. At each candidate
  // location, expose the migrated twin only after all native implementations.
  // This models the shipped source priority without treating JS/declarations
  // as native implementations or losing an alternate root.
  const pairedSidecar = (base, suffix, index) => [".vibe", ".vibex"].some(ext => {
    const declaration = ".d" + ext
    if (!suffix.endsWith(declaration)) return false
    const source = suffix.slice(0, -declaration.length)
    const sourceIndex = suffixes.indexOf(source)
    return sourceIndex >= 0 && sourceIndex < index && existsSync(base + source + ext)
  })
  const host = {...ts.sys, fileExists(candidate) {
    if (ts.sys.fileExists(candidate)) return true
    if (extname(candidate) !== nativeExt || candidate.endsWith(".d.ts")) return false
    const stem = candidate.slice(0, -nativeExt.length)
    const index = suffixes.findIndex(suffix => stem.endsWith("/" + name + suffix))
    if (index < 0) return false
    const suffix = suffixes[index]
    const base = suffix ? stem.slice(0, -suffix.length) : stem
    const native = suffixes.some((suffix, i) =>
      existsSync(base + suffix + ".tsx") ||
      existsSync(base + suffix + ".ts") && !pairedSidecar(base, suffix, i))
    const target = stem + sourceExt
    if (native || !existsSync(target)) return false
    migrated.set(candidate, target)
    return true
  }}
  const target = ts.resolveModuleName(written, resolve(root, file), options, host).resolvedModule
  if (!target || !migrated.has(target.resolvedFileName)) return written
  const sourceNames = options.rewriteRelativeImportExtensions ||
    options.allowImportingTsExtensions && (options.noEmit || options.emitDeclarationOnly)
  const outputExt = sourceNames ? sourceExt : sourceExt === ".vibex" && options.jsx === ts.JsxEmit.Preserve ? ".jsx" : ".js"
  return written.slice(0, -nativeExt.length) + outputExt
}

export function migrateStaleSpecifiers(ts, root, files, { write = true } = {}) {
  const configs = new Map()
  const edits = []
  for (const file of files) {
    if (!/\.(?:[cm]?[jt]sx?|vibex?)$/.test(file) || /\.d\.(?:[cm]?ts|vibex?\.ts)$/.test(file) || file.split("/").includes("node_modules")) continue
    const text = readFileSync(join(root, file), "utf8")
    const imports = parseImports(text).filter(item => item.kind !== "mock" && item.kind !== "test-mock")
    if (!imports.some(item => /^\.{1,2}\/.*\.tsx?$/.test(item.specifier))) continue
    const config = ts.findConfigFile(dirname(resolve(root, file)), ts.sys.fileExists)
    if (!config) continue // no project rules to infer
    if (!configs.has(config)) {
      const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic(d) { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")) } })
      if (!parsed) throw new Error("Cannot read project configuration " + config)
      configs.set(config, parsed)
    }
    const changes = []
    for (const item of imports) {
      if (item.kind === "mock" || item.kind === "test-mock") continue
      const project = configs.get(config)
      const next = staleSpecifier(ts, root, file, item.specifier, project.options)
      if (next !== item.specifier) {
        if (project.errors.some(d => ![18002,18003].includes(d.code))) throw new Error("Cannot read project configuration " + config)
        changes.push({ start: item.start, end: item.end, text: next })
        edits.push({ file, from: item.specifier, to: next })
      }
    }
    if (changes.length && write) writeFileSync(join(root, file), applyEdits(text, changes))
  }
  return edits
}
