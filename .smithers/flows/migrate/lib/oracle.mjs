// The stock compiler's declarations: the oracle a migration's declaration gate
// answers to. The batch gate compares each batch's declarations with the
// native baseline, which vibelang emits from the unchanged sources; where that
// emit differs from what the repository's own compiler publishes, or skips a
// file (alchemy-23: TS5088, and no declaration for Pipes/builders.ts), equal
// declarations prove nothing about the original API. Setup emits the
// package's declarations with the repository's compiler (tsc, tsgo or tsrs)
// before it wires VibeLang, records every declaration file where the native
// baseline differs from them, and verify fails a batch that migrates the
// module of such a file.
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, posix, resolve } from "node:path"
import { compareDeclarations } from "./declarations.mjs"
import { rel } from "./util.mjs"

/** The compilers setup replaces with vibelang (wire.mjs), in the order one is chosen when no script names one. */
export const stockCompilers = ["tsc", "tsgo", "tsrs"]

/**
 * The declaration build's compiler, before any check-only script's compiler.
 * Package scripts take priority over root scripts. A named compiler that is
 * absent is unavailable: substituting another version cannot prove the API
 * this repository publishes. Only repositories with no named compiler use
 * stockCompilers as a discovery order.
 */
export function findStockCompiler(root, packageDir) {
  const names = command => [...String(command).matchAll(/(?:^|[\s;&|(])(tsc|tsgo|tsrs)(?=\s|$)/g)].map(match => match[1])
  const rank = ([name, command]) =>
    /(?:^|\s)--(?:emitDeclarationOnly|declaration)(?:\s|$)/.test(command) || /^(?:build:)?(?:declarations?|dts|types)$/.test(name) ? 0 :
    name === "build:package" ? 1 : name === "build" ? 2 : /^build[:_-]/.test(name) ? 3 : 4
  const named = []
  for (const dir of [...new Set([packageDir, root])]) {
    let scripts = {}
    try { scripts = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts ?? {} } catch {}
    for (const [, command] of Object.entries(scripts).sort((a, b) => rank(a) - rank(b))) {
      for (const name of names(command)) if (!named.includes(name)) named.push(name)
    }
  }
  const top = resolve(root)
  for (const name of named.length ? [named[0]] : stockCompilers) {
    for (let dir = resolve(packageDir); ; dir = dirname(dir)) {
      const path = join(dir, "node_modules", ".bin", name)
      if (existsSync(path)) return { name, path }
      if (dir === top || dirname(dir) === dir || !dirname(dir).startsWith(top)) break
    }
  }
  return null
}

/**
 * The declaration file each source of the projects emits, relative to the
 * emit's outDir (each project under its prefix, as setup lays them out), by
 * the source's path relative to packageDir and its .ts, .vibe and
 * .d.vibe.ts spellings. Unlike the surface snapshot, it names a file the
 * compiler did not write, which is what a skipped declaration is.
 */
export function declarationNames(ts, packageDir, projects) {
  const out = "/__declarations"
  const names = {}
  for (const { tsconfig, prefix } of projects) {
    const path = resolve(packageDir, tsconfig)
    const config = ts.readConfigFile(path, ts.sys.readFile)
    if (config.error) throw new Error("cannot read declaration project " + tsconfig)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, posix.dirname(path), { allowNonTsExtensions: true }, path,
      undefined, [{ extension: ".vibe", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred }])
    const options = { ...parsed.options, outDir: posix.join(out, prefix), declarationDir: undefined, composite: false, declaration: true, emitDeclarationOnly: true }
    const asTs = { ...parsed, fileNames: parsed.fileNames.map((f) => f.replace(/\.vibe$/, ".ts")), options }
    for (const source of parsed.fileNames.filter((f) => !/\.d\.(?:vibe\.)?[cm]?ts$/.test(f))) {
      const output = ts.getOutputFileNames(asTs, source.replace(/\.vibe$/, ".ts"), false).find((f) => /\.d\.[cm]?ts$/.test(f))
      if (!output) continue
      const declaration = posix.relative(out, output.split("\\").join("/"))
      const name = rel(packageDir, source)
      names[name] = declaration
      if (/\.(?:ts|vibe)$/.test(name)) for (const ext of [".ts", ".vibe", ".d.vibe.ts"]) names[name.replace(/\.(?:ts|vibe)$/, ext)] = declaration
    }
  }
  return names
}

/**
 * Where the native baseline's declarations (nativeDir) differ from the stock
 * compiler's (stockDir), each compared by exported names, tsc type identity and JSDoc, since two compilers
 * may spell one type differently: a file whose types differ, one the stock
 * compiler wrote and vibelang did not, and one only vibelang wrote.
 */
export function unprovenDeclarations(ts, stockDir, nativeDir) {
  const surface = join(nativeDir, "public-surface.json")
  const includePrivate = existsSync(surface) &&
    JSON.parse(readFileSync(surface, "utf8")).apiMetadata?.manifest.private === true
  const c = compareDeclarations(ts, stockDir, nativeDir, { canonical: true, includePrivate })
  if (c.comparisonComplete === false) return {
    identical: false, files: [], changed: [], missing: [], extra: [],
    unavailable: "Declaration API comparison unavailable: " + c.environmentDiagnostics.map(d => d.diagnostic).join("; "),
    comparisonComplete: false, environmentDiagnostics: c.environmentDiagnostics,
  }
  if (c.identical) return { identical: true, files: [], changed: [], missing: [], extra: [] }
  // A changed public root can depend on a declaration whose filename is not
  // itself an entrypoint. None of that root's stored dependency closure is a
  // proven stock/native counterpart while its exported API differs.
  const affected = new Set([...c.changed.map(x => x.file),
    ...(c.comparedFiles?.before ?? []), ...(c.comparedFiles?.after ?? [])])
  const missing = c.removed.filter(file => affected.has(file))
  const extra = c.added.filter(file => affected.has(file))
  return { identical: false, files: [...affected].sort(), changed: c.changed, missing, extra }
}

/**
 * The migrated files, repository-relative, of the package at pkgDir whose
 * declaration the native baseline does not prove: each with the declaration
 * file and how the baseline differed from the stock compiler's.
 */
export function unprovenMigrations({ migrated, pkgDir, names, oracle }) {
  const prefix = posix.normalize(pkgDir) === "." ? "" : posix.normalize(pkgDir) + "/"
  const unproven = new Set(oracle?.files ?? [])
  const out = []
  for (const file of migrated) {
    if (!file.startsWith(prefix)) continue
    const declaration = names[file.slice(prefix.length)]
    if (declaration === undefined) continue // not part of a declaration project
    if (!oracle || oracle.unavailable) {
      out.push({ file, declaration, reason: oracle?.unavailable ?? "setup recorded no stock compiler oracle; start a fresh setup before migrating this module", diff: [] })
      continue
    }
    if (!unproven.has(declaration)) continue
    const reason = oracle.missing.includes(declaration) ? "the native baseline has no declaration for it; the stock compiler's has one"
      : oracle.extra.includes(declaration) ? "only the native baseline has a declaration for it"
      : "the native baseline's declaration differs from the stock compiler's"
    out.push({ file, declaration, reason, diff: oracle.changed.find((x) => x.file === declaration)?.diff ?? [] })
  }
  return out
}
