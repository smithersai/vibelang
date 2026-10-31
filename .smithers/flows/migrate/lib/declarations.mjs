// Declaration identity preserves the emitted public API. Canonical text drops
// comments, sorts union/property/import members and removes redundant type
// parentheses. D298 makes relative .ts and .js names equivalent. An
// extensionless relative name becomes its emitted .js spelling only when
// stock TypeScript proves both select the same present emitted declaration.
// Explicit names, unresolved modules and literal type values stay as written.
// A published declaration (public-surface.json) is compared byte for byte.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, posix, resolve, sep } from "node:path"
import { assertFinished, parseDiagnostics } from "./diagnostics.mjs"
import { quote, rel, run } from "./util.mjs"

/** The TypeScript compiler API (5.x or 6.x; TypeScript 7's package has no such API), from the first directory that has it. */
export function loadTypeScript(directories) {
  const tried = []
  for (const dir of directories) {
    try {
      const ts = createRequire(join(dir, "package.json"))("typescript")
      if (typeof ts.createSourceFile === "function" && typeof ts.createPrinter === "function") return ts
      tried.push(`${dir}: typescript ${ts.version} has no compiler API`)
    } catch (error) {
      tried.push(`${dir}: ${error.code ?? error.message}`)
    }
  }
  throw new Error(`no TypeScript compiler API to read declarations:\n${tried.join("\n")}`)
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** Whether a string literal is the module name of an import, export, `import()` type, `require` or augmentation, not a string in a type. */
const isModuleName = (ts, node) => {
  const parent = node.parent
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return parent.moduleSpecifier === node
  if (ts.isModuleDeclaration(parent)) return parent.name === node
  if (ts.isLiteralTypeNode(parent)) return ts.isImportTypeNode(parent.parent) && parent.parent.argument === parent
  return ts.isExternalModuleReference(parent)
}

/** A declaration file's canonical text. */
export function canonicalize(ts, text, fileName = "file.d.ts", modulePath = (text) => text) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
  // Reprint from the tree, never from the source's own spelling of a literal.
  const detach = (ctx) => {
    const visit = (node) => {
      const clone = ts.factory.cloneNode(node)
      ts.setTextRange(clone, { pos: -1, end: -1 })
      return ts.visitEachChild(clone, visit, ctx)
    }
    return (node) => ts.visitNode(node, visit)
  }
  const print = (node) => {
    const out = ts.transform(node, [detach])
    try {
      return printer.printNode(ts.EmitHint.Unspecified, out.transformed[0], source)
    } finally {
      out.dispose()
    }
  }
  const sortMembers = (members) => {
    const name = (m) => (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) || ts.isNumericLiteral(m.name)) ? m.name.text : undefined)
    const counts = new Map()
    for (const m of members) if (name(m) !== undefined) counts.set(name(m), (counts.get(name(m)) ?? 0) + 1)
    const eligible = (m) => (ts.isPropertySignature(m) || (ts.isPropertyDeclaration(m) && !m.initializer)) && name(m) !== undefined && counts.get(name(m)) === 1
    const sorted = members.filter(eligible).sort((a, b) => compare(print(a), print(b)))
    let i = 0
    return ts.factory.createNodeArray(members.map((m) => (eligible(m) ? sorted[i++] : m)))
  }
  // The parenthesizer wraps a union inside a union, so unwrap it before flattening.
  const unionMembers = (t) => {
    const inner = ts.isParenthesizedTypeNode(t) ? t.type : t
    return ts.isUnionTypeNode(inner) ? inner.types.flatMap(unionMembers) : [t]
  }
  const normalize = (ctx) => {
    const f = ctx.factory
    const visit = (node) => {
      let x = ts.visitEachChild(node, visit, ctx)
      // A redundant type parenthesis is spelling; the printer restores each one precedence needs.
      if (ts.isParenthesizedTypeNode(x)) return x.type
      if (ts.isStringLiteral(x) && isModuleName(ts, node)) {
        const name = modulePath(x.text)
        if (name !== x.text) return f.createStringLiteral(name)
      }
      if (ts.isStringLiteral(x) && /^\.\.?\/.*(?<!\.d)\.ts$/.test(x.text) && isModuleName(ts, node)) return f.createStringLiteral(x.text.replace(/\.ts$/, ".js"))
      if (ts.isTypeReferenceNode(x) && x.typeArguments) {
        x = f.updateTypeReferenceNode(x, x.typeName, f.createNodeArray(x.typeArguments.map((t) => (ts.isParenthesizedTypeNode(t) ? t.type : t))))
      }
      const sorted = (elements) => f.createNodeArray([...elements].sort((a, b) => compare(print(a), print(b))))
      if (ts.isNamedImports(x)) x = f.updateNamedImports(x, sorted(x.elements))
      else if (ts.isNamedExports(x)) x = f.updateNamedExports(x, sorted(x.elements))
      if (ts.isUnionTypeNode(x)) x = f.updateUnionTypeNode(x, f.createNodeArray(x.types.flatMap(unionMembers).sort((a, b) => compare(print(a), print(b)))))
      else if (ts.isTypeLiteralNode(x)) x = f.updateTypeLiteralNode(x, sortMembers(x.members))
      else if (ts.isInterfaceDeclaration(x)) x = f.updateInterfaceDeclaration(x, x.modifiers, x.name, x.typeParameters, x.heritageClauses, sortMembers(x.members))
      else if (ts.isClassDeclaration(x)) x = f.updateClassDeclaration(x, x.modifiers, x.name, x.typeParameters, x.heritageClauses, sortMembers(x.members))
      return x
    }
    return (node) => ts.visitNode(node, visit)
  }
  const out = ts.transform(source, [normalize])
  try {
    return out.transformed[0].statements.map((statement) => print(statement)).join("\n") + "\n"
  } finally {
    out.dispose()
  }
}

/** Every .d.ts file under dir, relative to it. */
export function listDeclarations(dir) {
  const out = []
  const walk = (absolute) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = join(absolute, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.d\.[cm]?ts$/.test(entry.name)) out.push(rel(dir, path))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out.sort()
}

/** The first lines where two texts differ, as a short unified-style excerpt. */
export function lineDiff(before, after, limit = 12) {
  const a = before.split("\n")
  const b = after.split("\n")
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i++) {
    if (a[i] === b[i]) continue
    if (a[i] !== undefined) out.push(`-${i + 1}: ${a[i]}`)
    if (b[i] !== undefined) out.push(`+${i + 1}: ${b[i]}`)
  }
  return out
}

/** Published declaration roots, resolved through the aliases recorded by the emit. Unknown paths fail closed. */
export function declarationSurface(ts, dir, manifest, aliases = {}) {
  const files = listDeclarations(dir)
  const known = new Set(files)
  const resolveName = (name, from = ".") => {
    const path = posix.normalize(posix.join(from, name))
    if (aliases[path]) return aliases[path]
    if (known.has(path)) return path
    const stem = path.replace(/(?:\.d\.vibe\.ts|\.[cm]?[jt]s|\.vibe)$/, "")
    return [stem + ".d.ts", stem + ".d.mts", stem + ".d.cts", path + ".d.ts", path + "/index.d.ts"].find(f => known.has(f))
  }
  const targets = []
  const strings = value => {
    if (typeof value === "string") targets.push(value)
    else if (Array.isArray(value)) value.forEach(strings)
    else if (value && typeof value === "object") Object.values(value).forEach(strings)
  }
  if (manifest.exports !== undefined) strings(manifest.exports)
  strings(manifest.types ?? manifest.typings)
  if (!targets.length) strings(manifest.main ?? manifest.module)
  if (!targets.length) return { roots: files, unresolved: ["no published entry points"] }
  const roots = new Set()
  const unresolved = []
  for (const target of targets) {
    if (target.includes("*")) {
      const [head, tail] = posix.normalize(target).split("*")
      const names = new Set([...files, ...Object.keys(aliases)])
      // Also expose declaration equivalents of runtime wildcard targets.
      const patternTail = tail.replace(/\.[cm]?[jt]s$/, ".d.ts")
      const matches = [...names].filter(name => name.startsWith(head) && (name.endsWith(tail) || name.endsWith(patternTail)))
      for (const name of matches) {
        const file = resolveName(name)
        if (file) roots.add(file)
      }
      if (!matches.length) unresolved.push(target)
    } else {
      const file = resolveName(target)
      if (file) roots.add(file)
      else unresolved.push(target)
    }
  }
  // Every referenced declaration is public, including imports used only in types.
  const reachable = new Set()
  const visit = file => {
    if (reachable.has(file)) return
    reachable.add(file)
    const text = readFileSync(join(dir, file), "utf8")
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const follow = (name, base = posix.dirname(file), seen = new Set()) => {
      const self = manifest.name && (name === manifest.name || name.startsWith(manifest.name + "/"))
      if (name.startsWith("#") || self) {
        if (seen.has(name)) { unresolved.push(file + ": cyclic package alias " + name); return }
        const map = self ? manifest.exports : manifest.imports
        const key = self ? "." + name.slice(manifest.name.length) : name
        let value = map?.[key] ?? (self && key === "." && (typeof map === "string" || !Object.keys(map ?? {}).some(k => k.startsWith("."))) ? map : undefined)
        if (value === undefined) {
          const pattern = Object.keys(map ?? {}).filter(k => k.includes("*")).sort((a, b) => b.length - a.length).find(k => {
            const [head, tail] = k.split("*")
            return key.startsWith(head) && key.endsWith(tail)
          })
          if (pattern) {
            const [head, tail] = pattern.split("*")
            const star = key.slice(head.length, tail.length ? -tail.length : undefined)
            const substitute = v => typeof v === "string" ? v.replaceAll("*", star) : Array.isArray(v) ? v.map(substitute) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x)])) : v
            value = substitute(map[pattern])
          }
        }
        const names = []
        const collect = v => {
          if (typeof v === "string") names.push(v)
          else if (Array.isArray(v)) v.forEach(collect)
          else if (v && typeof v === "object") Object.values(v).forEach(collect)
        }
        collect(value)
        if (!names.length) unresolved.push(file + ": unresolved package alias " + name)
        else for (const target of names) follow(target, ".", new Set([...seen, name]))
        return
      }
      if (!name.startsWith(".")) return // external dependency
      const dependency = resolveName(name, base)
      if (dependency) visit(dependency)
      else unresolved.push(file + ": " + name)
    }
    const walk = node => {
      if (ts.isStringLiteral(node) && isModuleName(ts, node)) follow(node.text)
      ts.forEachChild(node, walk)
    }
    walk(source)
    for (const ref of source.typeReferenceDirectives.filter(ref => ref.fileName.startsWith("."))) follow(ref.fileName)
    for (const ref of source.referencedFiles) follow(ref.fileName.startsWith(".") ? ref.fileName : "./" + ref.fileName)
  }
  for (const file of roots) visit(file)
  return { roots: [...roots].sort(), reachable: [...reachable].sort(), unresolved }
}

/** Snapshot entry-point aliases while the original package manifest and tsconfigs still exist. */
export function recordDeclarationSurface(ts, dir, packageDir, projects, manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))) {
  const aliases = {}
  for (const { tsconfig, prefix } of projects) {
    const path = resolve(packageDir, tsconfig)
    const config = ts.readConfigFile(path, ts.sys.readFile)
    if (config.error) throw new Error("cannot read declaration project " + tsconfig)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, posix.dirname(path), { allowNonTsExtensions: true }, path,
      undefined, [{ extension: ".vibe", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred }])
    const emitted = { ...parsed, options: { ...parsed.options, outDir: resolve(dir, prefix), declarationDir: undefined, composite: false, declaration: true, emitDeclarationOnly: true } }
    for (const source of parsed.fileNames.filter(f => !/\.d\.(?:vibe\.)?[cm]?ts$/.test(f))) {
      // Stock TypeScript does not know .vibe; its output layout is that of .ts.
      const outputNames = options => ts.getOutputFileNames({ ...parsed, fileNames: parsed.fileNames.map(f => f.replace(/\.vibe$/, ".ts")), options }, source.replace(/\.vibe$/, ".ts"), false)
      const output = outputNames(emitted.options).find(f => /\.d\.[cm]?ts$/.test(f))
      if (!output) continue
      const declaration = rel(dir, output)
      if (!existsSync(join(dir, declaration))) continue
      aliases[rel(packageDir, source)] = declaration
      if (/\.(ts|vibe)$/.test(source)) {
        for (const ext of [".ts", ".vibe", ".d.vibe.ts"]) aliases[rel(packageDir, source).replace(/\.(ts|vibe)$/, ext)] = declaration
      }
      for (const original of outputNames({ ...parsed.options, declaration: true, emitDeclarationOnly: true })) {
        aliases[rel(packageDir, original)] = declaration
        aliases[rel(packageDir, original).replace(/\.d\.ts$/, ".js").replace(/\.d\.mts$/, ".mjs").replace(/\.d\.cts$/, ".cjs")] = declaration
      }
    }
  }
  const surface = declarationSurface(ts, dir, manifest, aliases)
  writeFileSync(join(dir, "public-surface.json"), JSON.stringify(surface, null, 2) + "\n")
  return surface
}

/** Public files are compared byte for byte. Legacy trees without entry-point metadata keep the conservative canonical gate. */
// The relative module specifiers a declaration file names: import and export
// declarations, import types, and import-equals requires, each as
// { text, start, end, line } with start and end inside the quotes.
function moduleSpecifiers(ts, text) {
  const source = ts.createSourceFile("x.d.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found = []
  const visit = (node) => {
    const parent = node.parent
    if (ts.isStringLiteral(node) && parent && (
      ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) ||
      ts.isExternalModuleReference(parent) ||
      (ts.isLiteralTypeNode(parent) && parent.parent && ts.isImportTypeNode(parent.parent)))) {
      const start = node.getStart(source) + 1
      found.push({ text: node.text, start, end: node.end - 1, line: source.getLineAndCharacterOfPosition(start).line + 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/**
 * Compares a published declaration file byte for byte, except a relative
 * module specifier whose two spellings stock TypeScript resolves to the same
 * listed declaration file in both trees, under Bundler and Node10 resolution:
 * `./runtime` and `./runtime.js`, which a migrated module's importer declares
 * once the codemod names it `./runtime.vibe` (VIP-27, D298). Returns the
 * excused pairs, { line, before, after, declaration }, or null when anything
 * else differs.
 */
function publishedEquivalent(ts, a, b, sides) {
  if (a === b) return []
  const left = moduleSpecifiers(ts, a)
  const right = moduleSpecifiers(ts, b)
  if (left.length !== right.length) return null
  const masked = (text, specifiers) => {
    let out = text
    for (const { start, end } of [...specifiers].reverse()) out = out.slice(0, start) + out.slice(end)
    return out
  }
  if (masked(a, left) !== masked(b, right)) return null
  const excused = []
  for (let i = 0; i < left.length; i++) {
    const before = left[i].text, after = right[i].text
    if (before === after) continue
    if (!/^\.\.?\//.test(before) || !/^\.\.?\//.test(after)) return null
    const targets = sides.flatMap((side) => [before, after].flatMap((name) => side.targets(name)))
    if (targets.some((target) => target === undefined) || new Set(targets).size !== 1) return null
    excused.push({ line: right[i].line, before, after, declaration: targets[0] })
  }
  return excused
}

export function compareDeclarations(ts, baselineDir, currentDir) {
  const before = listDeclarations(baselineDir)
  const after = listDeclarations(currentDir)
  const surface = dir => {
    if (existsSync(join(dir, "public-surface.json"))) return JSON.parse(readFileSync(join(dir, "public-surface.json"), "utf8"))
    if (existsSync(join(dir, "package.json"))) return declarationSurface(ts, dir, JSON.parse(readFileSync(join(dir, "package.json"), "utf8")))
    return null
  }
  const aSurface = surface(baselineDir)
  const bSurface = surface(currentDir)
  const resolved = aSurface && bSurface && !aSurface.unresolved.length && !bSurface.unresolved.length
  const publicFiles = new Set([...(aSurface?.reachable ?? []), ...(bSurface?.reachable ?? [])])
  const afterSet = new Set(after)
  const beforeSet = new Set(before)
  // An .mts module emits .d.mts; its native .vibe replacement emits .d.ts.
  // Pair only a missing source and a new destination, never a collision.
  const moved = new Map(before.filter(file => file.endsWith(".d.mts") && !afterSet.has(file))
    .map(file => [file, file.replace(/\.d\.mts$/, ".d.ts")])
    .filter(([source, destination]) => afterSet.has(destination) && !beforeSet.has(destination) &&
      (!aSurface || !bSurface || Boolean(aSurface.reachable?.includes(source)) === Boolean(bSurface.reachable?.includes(destination)))))
  for (const [source, destination] of moved) {
    afterSet.add(source)
    beforeSet.add(destination)
    if (publicFiles.has(destination)) publicFiles.add(source)
  }
  const originalName = new Map([...moved].map(([source, destination]) => [destination, source]))
  // D298's extensionless source import and emitted .js name select one
  // module only when stock TypeScript proves the same present declaration.
  // Explicit extensions, unresolved paths and external names stay as written.
  const modulePath = (directory, file, declarations) => (text) => {
    if (!/^\.\.?\//.test(text) || /\.(?:d\.[cm]?ts|[cm]?[jt]s|[jt]sx|json|vibe)$/.test(text)) return text
    const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
    const select = (name) => ts.resolveModuleName(name, join(directory, file), options, ts.sys).resolvedModule?.resolvedFileName
    const selected = select(text)
    if (!selected) return text
    const target = rel(directory, selected)
    if (!declarations.has(target) || !target.endsWith(".d.ts")) return text
    const relative = posix.relative(posix.dirname(file), target.slice(0, -5) + ".js")
    const output = relative.startsWith("./") || relative.startsWith("../") ? relative : "./" + relative
    return select(output) === selected ? output : text
  }
  // The listed declaration file a relative specifier in file selects, under each resolution mode.
  const modes = [ts.ModuleResolutionKind.Bundler, ts.ModuleResolutionKind.Node10]
  const side = (directory, file, declarations) => ({
    targets: (name) => modes.map((moduleResolution) => {
      const selected = ts.resolveModuleName(name, join(directory, file), { module: ts.ModuleKind.ESNext, moduleResolution }, ts.sys).resolvedModule?.resolvedFileName
      const target = selected && rel(directory, selected)
      return target && declarations.has(target) ? target : undefined
    })
  })
  const changed = []
  const excused = []
  for (const file of before.filter(f => afterSet.has(f))) {
    const current = moved.get(file) ?? file
    const text = dir => readFileSync(join(dir, dir === currentDir ? current : file), "utf8")
    if (publicFiles.has(file)) {
      const pairs = publishedEquivalent(ts, text(baselineDir), text(currentDir), [side(baselineDir, file, beforeSet), side(currentDir, current, afterSet)])
      if (pairs === null) changed.push({ file, diff: lineDiff(text(baselineDir), text(currentDir)) })
      else for (const pair of pairs) excused.push({ file, ...pair })
      continue
    }
    const a = canonicalize(ts, text(baselineDir), file, modulePath(baselineDir, file, beforeSet))
    const b = canonicalize(ts, text(currentDir), file, modulePath(currentDir, current, afterSet))
    if (a !== b) changed.push({ file, diff: lineDiff(a, b) })
  }
  const removed = before.filter(f => !afterSet.has(f))
  const additions = after.filter(f => !beforeSet.has(f))
  const addedPrivate = resolved ? additions.filter(f => !publicFiles.has(f)) : []
  const added = additions.filter(f => !addedPrivate.includes(f))
  const rootsChanged = resolved && JSON.stringify(aSurface.roots) !== JSON.stringify(bSurface.roots.map(file => originalName.get(file) ?? file).sort())
  return { identical: !changed.length && !removed.length && !added.length && !rootsChanged, files: before.length, added, addedPrivate, renamed: [...moved].map(([from, to]) => ({ from, to })), removed, changed, excused,
    ...(aSurface || bSurface ? { publicSurface: { before: aSurface, after: bSurface, rootsChanged: Boolean(rootsChanged) } } : {}) }
}

// The files a declaration emit can write outside outDir: x.d.ts, x.d.mts,
// x.d.cts beside a source outside the project's rootDir, and the x.d.vibe.ts
// sidecar every compile writes beside x.vibe.
const declarationOutput = /\.d\.(?:vibe\.)?[cm]?ts$/

// The contents of each declaration file under directory, outside node_modules,
// dot directories and skip, by absolute path.
function declarationFiles(directory, skip) {
  const files = new Map()
  const walk = (path) => {
    let entries
    try {
      entries = readdirSync(path, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".") && child !== skip) walk(child)
      } else if (entry.isFile() && declarationOutput.test(entry.name)) files.set(child, readFileSync(child))
    }
  }
  walk(directory)
  return files
}

/**
 * Emits a project's declarations, and only them, into outDir with vibelang.
 * Returns the exit code, the number of files and the diagnostics, each file
 * repository-relative when root is given. A file the emit writes outside
 * outDir, beside a source outside the project's rootDir, is removed again when
 * the emit created it, and put back as it was when it existed: opencode tracks
 * packages/stories/playwright/config.d.ts, which packages/app's emit rewrites.
 */
export async function emitDeclarations({ compiler, tsconfig, cwd, outDir, log, root }) {
  rmSync(outDir, { recursive: true, force: true })
  const existing = declarationFiles(resolve(root ?? cwd), resolve(outDir))
  mkdirSync(outDir, { recursive: true })
  const flags = "--noEmit false --declaration --emitDeclarationOnly --declarationMap false --sourceMap false --composite false --incremental false --noEmitOnError false --pretty false --listEmittedFiles"
  const result = await run(`${quote(compiler)} -p ${quote(tsconfig)} ${flags} --outDir ${quote(outDir)}`, { cwd, log })
  assertFinished(result, log)
  // A file outside the project's rootDir emits beside its source, where a batch's commit would pick it up.
  const inside = `${resolve(outDir)}${sep}`
  for (const [, file] of result.stdout.matchAll(/^TSFILE: (.+)$/gm)) {
    if (file.startsWith(inside)) continue
    const before = existing.get(resolve(file))
    if (before === undefined) rmSync(file, { force: true })
    else writeFileSync(file, before)
  }
  const files = listDeclarations(outDir)
  if (!files.length) throw new Error(`vibelang emitted no declarations for ${tsconfig} (exit ${result.code}${log ? `, log ${log}` : ""})`)
  return { code: result.code, files: files.length, diagnostics: parseDiagnostics(result.stdout + result.stderr, { cwd, root }) }
}

/**
 * The errors a declaration emit reported in files, repository-relative. Where
 * the compiler cannot print a module's declarations, as for TS7056's any
 * fallback, the baseline's emit may fail the same way, so equal declarations
 * prove nothing about that module: such a migrated file fails verify.
 */
export function emitErrorsIn(diagnostics, files) {
  return diagnostics.filter((d) => d.category === "error" && files.includes(d.file))
}
