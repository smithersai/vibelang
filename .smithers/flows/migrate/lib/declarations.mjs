// Declaration gates share the canonical exported-name/type/JSDoc checker.
// Text canonicalization remains available for syntax/formatting utilities;
// public API decisions never depend on its printed spelling.
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { compareApiIdentityInWorker as compareApiIdentity, publishedEntrypoints } from "./api-identity.mjs"
import { apiProjection } from "./api-projection.mjs"
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
const apiDiffLines = group => [
  ...group.nameDifferences.map(d => `API name ${d.entrypoint}::${d.export} is present ${d.side}`),
  ...group.typeDifferences.map(d => `API type ${d.entrypoint}::${d.export} [${d.aspect}]: ${d.diagnostic}`),
  ...group.docDifferences.map(d => `API documentation ${d.entrypoint}::${d.export} changed`),
]


/** Whether a string literal is the module name of an import, export, `import()` type, `require` or augmentation, not a string in a type. */
const isModuleName = (ts, node) => {
  const parent = node.parent
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return parent.moduleSpecifier === node
  if (ts.isModuleDeclaration(parent)) return parent.name === node
  if (ts.isLiteralTypeNode(parent)) return ts.isImportTypeNode(parent.parent) && parent.parent.argument === parent
  return ts.isExternalModuleReference(parent)
}

/**
 * The indexes of source's statements that are private type aliases nothing
 * else names: in a module, a top-level `type X = …` without `export`, which
 * no type reference, heritage clause, `export { X }` or `export default X` in
 * another statement names, nor one that names it in turn. Such an alias is
 * no part of the module's contract, but TypeScript prints one beside a value
 * of its name: a schema declaration, `schema State { … }`, is a constant and
 * `type State = typeof State.Type`, so a migrated private schema adds the
 * alias where the TypeScript had only `const State = Schema.Struct(…)`
 * (t3code chatAttachment.ts). Interfaces, which merge with other
 * declarations, and every declaration of a global script stay.
 */
export function privateUnusedTypes(ts, source) {
  if (!ts.isExternalModule(source)) return new Set()
  const exported = (node) => (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0
  const leftmost = (name) => (ts.isQualifiedName(name) ? leftmost(name.left) : ts.isPropertyAccessExpression(name) ? leftmost(name.expression) : name)
  const names = (statement) => {
    const found = new Set()
    const visit = (node) => {
      if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
        const id = leftmost(ts.isTypeReferenceNode(node) ? node.typeName : node.expression)
        if (ts.isIdentifier(id)) found.add(id.text)
      } else if (ts.isExportSpecifier(node)) {
        found.add((node.propertyName ?? node.name).text)
      } else if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
        found.add(node.expression.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(statement)
    return found
  }
  const statements = source.statements
  const candidates = new Map()
  statements.forEach((statement, i) => {
    if (ts.isTypeAliasDeclaration(statement) && !exported(statement)) candidates.set(i, statement.name.text)
  })
  const kept = new Set(statements.map((_, i) => i).filter((i) => !candidates.has(i)))
  // An alias another kept statement names is kept, and so is each alias it names.
  for (let grew = true; grew; ) {
    grew = false
    const named = new Set([...kept].flatMap((i) => [...names(statements[i])].filter((name) => !(candidates.get(i) === name))))
    for (const [i, name] of candidates) {
      if (!kept.has(i) && named.has(name)) {
        kept.add(i)
        grew = true
      }
    }
  }
  return new Set([...candidates.keys()].filter((i) => !kept.has(i)))
}

/**
 * printed, the printed statements, with the import declarations that bind
 * names first, then the export declarations that re-export from a module,
 * each sorted by module specifier, then text, and the rest after them in
 * their order: where an import or a re-export stands means nothing to a
 * declaration file's API (t3code's MCP toolkits: the codemod's
 * `import { Tool, Toolkit } from "effect/ai"` moved ahead of unchanged
 * imports). An import for its side effects keeps its place among the rest.
 */
function inModuleOrder(ts, statements, printed) {
  const specifier = (s) => (s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : "")
  const imports = (s) => ts.isImportDeclaration(s) && s.importClause
  const reexports = (s) => ts.isExportDeclaration(s) && s.moduleSpecifier
  const sorted = (kind) => statements.flatMap((s, i) => (kind(s) ? [[specifier(s), printed[i]]] : []))
    .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1])).map(([, text]) => text)
  return [...sorted(imports), ...sorted(reexports), ...printed.filter((_, i) => !imports(statements[i]) && !reexports(statements[i]))]
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
      // Readonly<{ a: T }> is { readonly a: T }: a .vibe data payload writes its
      // fields readonly where the TypeScript wrapped them (foldkit-16).
      if (ts.isTypeReferenceNode(x) && ts.isIdentifier(x.typeName) && x.typeName.text === "Readonly" && x.typeArguments?.length === 1 &&
        ts.isTypeLiteralNode(x.typeArguments[0]) && x.typeArguments[0].members.every((m) => ts.isPropertySignature(m) || ts.isIndexSignatureDeclaration(m))) {
        const readonly = (modifiers) => modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ? modifiers : [f.createModifier(ts.SyntaxKind.ReadonlyKeyword), ...(modifiers ?? [])]
        x = f.createTypeLiteralNode(x.typeArguments[0].members.map((m) => ts.isPropertySignature(m)
          ? f.updatePropertySignature(m, readonly(m.modifiers), m.name, m.questionToken, m.type)
          : f.updateIndexSignature(m, readonly(m.modifiers), m.parameters, m.type)))
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
  const unused = privateUnusedTypes(ts, source)
  const out = ts.transform(source, [normalize])
  try {
    const kept = out.transformed[0].statements.filter((_, i) => !unused.has(i))
    return inModuleOrder(ts, kept, kept.map((statement) => print(statement))).join("\n") + "\n"
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

/**
 * The declarations of modules an earlier run migrated, as that run's compiler
 * committed them in their sidecars (x.d.vibe.ts beside x.vibe), compared with
 * this toolchain's declarations of the same modules in outDir. sidecars maps
 * each sidecar's repository path to its text. A sidecar whose module emits
 * nothing in outDir is missing. Setup's baseline is emitted with the new
 * toolchain, so without this a toolchain change to those declarations becomes
 * the baseline every batch passes against (foldkit-11: mount/index lost its
 * readonly members).
 */
/**
 * A committed sidecar sits beside its source and names a migrated neighbour by
 * its source name, `./b.vibe`, which resolves to `b.d.vibe.ts`. The emitted tree
 * the comparison copies it into holds `b.d.ts`, so stock TypeScript reported
 * TS2307 and the earlier-API comparison gave up for the whole package
 * (foldkit-161). Spell each relative `.vibe` or `.vibex` specifier as VibeLang
 * emits it, `./b.js` (D298); both name the same module.
 */
function emittedSpelling(ts, text) {
  const edits = ts.preProcessFile(text, true, true).importedFiles
    .filter(f => /^\.\.?\//.test(f.fileName) && /\.vibex?$/.test(f.fileName))
  // pos is the opening quote; the specifier follows it.
  for (const f of edits.sort((a, b) => b.pos - a.pos)) {
    const start = f.pos + 1, end = start + f.fileName.length
    if (text.slice(start, end) === f.fileName) text = text.slice(0, start) + f.fileName.replace(/\.vibex?$/, ".js") + text.slice(end)
  }
  return text
}

export function sidecarChanges(ts, sidecars, outDir) {
  const emitted = listDeclarations(outDir), changed = [], missing = []
  const pairs = []
  for (const [sidecar, text] of Object.entries(sidecars)) {
    const declaration = sidecar.replace(/\.d\.vibe\.ts$/, ".d.ts")
    const match = emitted
      .flatMap(file => [file, file.split("/").slice(1).join("/")].filter(f => f && (declaration === f || declaration.endsWith("/" + f))).map(f => ({ file, length: f.length })))
      .sort((a, b) => b.length - a.length)[0]
    if (!match) missing.push(sidecar)
    else pairs.push({ sidecar, text, file: match.file })
  }
  if (!pairs.length) return { files: Object.keys(sidecars).length, changed, missing }
  const before = mkdtempSync(join(tmpdir(), "migrate-earlier-api-"))
  let left, right
  try {
    for (const file of emitted) {
      mkdirSync(join(before, file, ".."), { recursive: true })
      writeFileSync(join(before, file), readFileSync(join(outDir, file)))
    }
    for (const pair of pairs) writeFileSync(join(before, pair.file), emittedSpelling(ts, pair.text))
    const metadata = join(outDir, "public-surface.json")
    const surface = existsSync(metadata) ? JSON.parse(readFileSync(metadata,"utf8")) : null
    left = apiProjection(ts,before,surface,emitted)
    right = apiProjection(ts,outDir,surface,emitted)
    const entries = projection => Object.fromEntries(pairs.map(pair => [pair.sidecar,
      join(projection.directory,projection.destinations.get(pair.file))]))
    const api = compareApiIdentity(ts, left.directory, right.directory, {
      beforeEntrypoints: entries(left), afterEntrypoints: entries(right),
      moduleRoots: [dirname(dirname(dirname(ts.sys.getExecutingFilePath())))],
    })
    if (!api.comparisonComplete) return { files: Object.keys(sidecars).length, changed, missing,
      comparisonComplete: false, environmentDiagnostics: api.environmentDiagnostics }
    for (const pair of pairs) {
      const differences = Object.fromEntries(["nameDifferences", "typeDifferences", "docDifferences"]
        .map(kind => [kind, api[kind].filter(d => d.entrypoint === pair.sidecar)]))
      if (Object.values(differences).some(list => list.length)) changed.push({
        file: pair.sidecar, declaration: pair.file, ...differences,
        diff: [...lineDiff(pair.text, readFileSync(join(outDir, pair.file), "utf8")),
          ...apiDiffLines(differences)],
      })
    }
    return { files: Object.keys(sidecars).length, changed, missing }
  } finally { left?.cleanup(); right?.cleanup(); rmSync(before, { recursive: true, force: true }) }
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

/** What an older flow recorded for a manifest without entry-point fields; verify records such a baseline again. */
export const NO_ENTRY_POINTS = "no published entry points"

/** Published declaration roots, resolved through the aliases recorded by the emit. Unknown paths fail closed. */
export function declarationSurface(ts, dir, manifest, aliases = {}, logicalPaths = {}) {
  const files = listDeclarations(dir)
  const known = new Set(files)
  const resolveName = (name, from = ".") => {
    const path = posix.normalize(posix.join(from, name))
    const lookup = candidate => aliases[candidate] ?? (known.has(candidate) ? candidate : undefined)
    const exact = lookup(path)
    if (exact) return exact
    const stem = path.replace(/(?:\.d\.vibe\.ts|\.[cm]?[jt]s|\.vibe)$/, "")
    return [stem + ".d.ts", stem + ".d.mts", stem + ".d.cts", path + ".d.ts", path + "/index.d.ts", path + "/index.d.mts", path + "/index.d.cts"].map(lookup).find(Boolean)
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
  // Without an entry-point field TypeScript resolves the bare package name to
  // the package root's index and nothing else: a package without one, such as
  // a CLI that publishes only a bundled bin, declares no type surface.
  if (!targets.length && manifest.typesVersions === undefined) {
    const index = ["./index.js", "./index.ts", "./index.d.ts"].find(name => resolveName(name))
    if (!index) return { roots: [], reachable: [], unresolved: [] }
    targets.push(index)
  }
  if (!targets.length) return { roots: files, unresolved: [NO_ENTRY_POINTS] }
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
  const reachable = new Set(), edges = new Map()
  const visit = file => {
    if (reachable.has(file)) return
    reachable.add(file)
    const text = readFileSync(join(dir, file), "utf8")
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const follow = (name, base = posix.dirname(logicalPaths[file] ?? file), seen = new Set(), origin = name) => {
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
        else for (const target of names) follow(target, ".", new Set([...seen, name]), origin)
        return
      }
      if (!name.startsWith(".")) return // external dependency
      const dependency = resolveName(name, base)
      if (dependency) {
        const edge = [file, origin, dependency]
        edges.set(JSON.stringify(edge), edge)
        visit(dependency)
      }
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
  return { roots: [...roots].sort(), reachable: [...reachable].sort(), unresolved, resolutions: [...edges.values()].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }
}

/** Snapshot entry-point aliases while the original package manifest and tsconfigs still exist. */
export function recordDeclarationSurface(ts, dir, packageDir, projects, manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")), { handwritten } = {}) {
  const aliases = {}, logicalPaths = {}, layouts = []
  const shippedDir = ".migrate-shipped"
  rmSync(join(dir, shippedDir), { recursive: true, force: true })
  for (const { tsconfig, prefix } of projects) {
    const path = resolve(packageDir, tsconfig)
    const config = ts.readConfigFile(path, ts.sys.readFile)
    if (config.error) throw new Error("cannot read declaration project " + tsconfig)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, posix.dirname(path), { allowNonTsExtensions: true }, path,
      undefined, [{ extension: ".vibe", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred }])
    const layout = { prefix: posix.normalize(prefix) }
    const configuredOutput = parsed.options.declarationDir ?? parsed.options.outDir ?? parsed.options.rootDir
    if (configuredOutput) layout.directory = rel(packageDir, configuredOutput) || "."
    layouts.push(layout)
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
        logicalPaths[declaration] ??= rel(packageDir, original)
        const tail = posix.relative(prefix, declaration)
        const logical = logicalPaths[declaration]
        if (logical === tail) layout.directory = "."
        else if (logical.endsWith("/" + tail)) layout.directory = logical.slice(0, -tail.length - 1) || "."

        aliases[rel(packageDir, original).replace(/\.d\.ts$/, ".js").replace(/\.d\.mts$/, ".mjs").replace(/\.d\.cts$/, ".cjs")] = declaration
      }
    }
  }
  // Keep package-tree declarations in the run snapshot, never as live paths.
  // Aliases of emitted files win over stale build output from the target.
  const originals = handwritten ?? new Map([...declarationFiles(packageDir, resolve(dir))].map(([file, bytes]) => [rel(packageDir, file), bytes]))
  for (const [file, bytes] of originals) {
    if (!/\.d\.[cm]?ts$/.test(file) || /\.d\.vibe\.ts$/.test(file) || aliases[file]) continue
    const stored = posix.join(shippedDir, file)
    mkdirSync(join(dir, stored, ".."), { recursive: true })
    writeFileSync(join(dir, stored), bytes)
    aliases[file] = stored
    logicalPaths[stored] = file
  }
  const surface = { ...declarationSurface(ts, dir, manifest, aliases, logicalPaths), snapshotVersion: 3, apiMetadata: { manifest, aliases, logicalPaths, layouts, packageDir: resolve(packageDir) } }
  writeFileSync(join(dir, "public-surface.json"), JSON.stringify(surface, null, 2) + "\n")
  return surface
}

// Formatting receipts are retained separately from semantic API decisions.
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
 * Records the former D298 formatting-only specifier replacements. These
 * receipts explain source spelling changes; they never decide API identity.
 * Returns independently proved spelling pairs, or null when non-specifier text differs.
 * An unresolved pair supplies no receipt and cannot erase a proved neighbour.
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
    if (!/^\.\.?\//.test(before) || !/^\.\.?\//.test(after)) continue
    // Only D298's spellings: an extensionless or .ts name declared as its
    // emitted .js. Any other explicit extension stays as written.
    const base = before.replace(/\.ts$/, "").replace(/\/$/, "")
    if (/\.(?:d\.[cm]?ts|[cm]?[jt]s|[jt]sx|json|vibe)$/.test(base)) continue
    if (after !== base + ".js" && after !== base + "/index.js") continue
    const targets = sides.flatMap((side) => [before, after].flatMap((name) => side.targets(name)))
    if (targets.some((target) => target === undefined) || new Set(targets).size !== 1) continue
    excused.push({ line: right[i].line, before, after, declaration: targets[0] })
  }
  return excused
}

export function compareDeclarations(ts, baselineDir, currentDir, { canonical = false, includePrivate = false } = {}) {
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
  // The listed declaration file a relative specifier in file selects, under each resolution mode.
  const modes = [ts.ModuleResolutionKind.Bundler, ts.ModuleResolutionKind.Node10]
  const side = (directory, file, declarations) => ({
    targets: (name) => modes.map((moduleResolution) => {
      const selected = ts.resolveModuleName(name, join(directory, file), { module: ts.ModuleKind.ESNext, moduleResolution }, ts.sys).resolvedModule?.resolvedFileName
      const target = selected && rel(directory, selected)
      return target && declarations.has(target) ? target : undefined
    })
  })
  const excused = []
  // The legacy canonical option suppresses formatting receipts only. Every
  // caller below still uses the same exported-name/type/JSDoc proof.
  if (!canonical) for (const file of before.filter(f => afterSet.has(f))) {
    const current = moved.get(file) ?? file
    const pairs = publishedEquivalent(ts, readFileSync(join(baselineDir, file), "utf8"),
      readFileSync(join(currentDir, current), "utf8"),
      [side(baselineDir, file, beforeSet), side(currentDir, current, afterSet)])
    for (const pair of pairs ?? []) excused.push({ file, ...pair })
  }
  const removed = before.filter(f => !afterSet.has(f))
  const additions = after.filter(f => !beforeSet.has(f))
  let addedPrivate = [], added = additions
  const rootsChanged = resolved && JSON.stringify(aSurface.roots) !== JSON.stringify(bSurface.roots.map(file => originalName.get(file) ?? file).sort())
  const remap = file => originalName.get(file) ?? file
  const reachableChanged = resolved && JSON.stringify(aSurface.reachable) !== JSON.stringify(bSurface.reachable.map(remap).sort())
  // D298 excuses only specifier pairs already proved to select the same
  // present declaration in both trees. Keep every other graph edge exact.
  const edges = (surface, map = file => file, after = false) => surface.resolutions?.map(([from, name, to]) => {
    const origin = map(from), target = map(to)
    const pair = after && excused.find(pair => pair.file === origin && pair.after === name && pair.declaration === target)
    return [origin, pair ? pair.before : name, target]
  }).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const resolutionChanged = resolved && aSurface.resolutions && bSurface.resolutions &&
    JSON.stringify(edges(aSurface)) !== JSON.stringify(edges(bSurface, remap, true))
  // Raw file/graph changes remain receipts. Only exported API differences
  // decide this gate; private layout and spelling are not public contracts.
  let left, right, api
  const semantic = []
  try {
    left = apiProjection(ts, baselineDir, aSurface, before, { published: !includePrivate })
    right = apiProjection(ts, currentDir, bSurface, after, { published: !includePrivate })
    const entries = (projection, saved) => {
      const physical = file => {
        const stored = projection.originals.get(rel(projection.directory, file))
        return stored ? join(projection.directory, projection.destinations.get(stored)) : file
      }
      const published = existsSync(join(projection.directory, "package.json"))
        ? Object.fromEntries(Object.entries(publishedEntrypoints(projection.directory, ts)).map(([key, file]) => [key, physical(file)]))
        : null
      if (includePrivate && published && !Object.keys(published).length) {
        if (!saved?.apiMetadata) throw new Error("Private declaration snapshot lacks its original source entrypoints; refresh setup")
        const modules = [...new Set(Object.values(saved.apiMetadata.aliases))]
        return Object.fromEntries(modules.map(file => [originalName.get(file) ?? file,
          join(projection.directory, projection.destinations.get(file))]))
      }
      if (published) return published
      if (saved && !saved.apiMetadata)
        throw new Error("Legacy declaration snapshot lacks published entrypoint names; refresh setup from its saved commit before comparing APIs")
      return publishedEntrypoints(projection.directory, ts)
    }
    const aEntries = entries(left, aSurface), bEntries = entries(right, bSurface)
    const modules = [left.moduleRoots ?? [], right.moduleRoots ?? [],
      [dirname(dirname(dirname(ts.sys.getExecutingFilePath()))) ]].flat()
    api = compareApiIdentity(ts, left.directory, right.directory, {
      beforeEntrypoints: aEntries, afterEntrypoints: bEntries, moduleRoots: [...new Set(modules)], includeComparedFiles: true,
    })
    const comparedFiles = Object.fromEntries([["before", left], ["after", right]].map(([side, projection]) =>
      [side, [...new Set((api.comparedFiles?.[side] ?? []).map(file =>
        projection.originals.get(rel(projection.directory, file))).filter(Boolean))].sort()]))
    api.comparedFiles = comparedFiles
    if (api.comparisonComplete) {
      const reachable = new Set([...comparedFiles.before, ...comparedFiles.after])
      addedPrivate = additions.filter(file => !reachable.has(file))
      added = additions.filter(file => reachable.has(file))
    }
    const groups = new Map()
    if (api.comparisonComplete) for (const kind of ["nameDifferences", "typeDifferences", "docDifferences"]) for (const difference of api[kind]) {
      const selected = aEntries[difference.entrypoint] ?? bEntries[difference.entrypoint]
      const owner = aEntries[difference.entrypoint] ? left : right
      const logical = selected && rel(owner.directory, selected)
      const file = owner.originals.get(logical) ?? logical ?? difference.entrypoint
      if (!groups.has(file)) groups.set(file, { file, nameDifferences: [], typeDifferences: [], docDifferences: [] })
      groups.get(file)[kind].push(difference)
    }
    for (const group of groups.values()) {
      const aFile = join(baselineDir, group.file), bFile = join(currentDir, moved.get(group.file) ?? group.file)
      const raw = existsSync(aFile) && existsSync(bFile) ? lineDiff(readFileSync(aFile, "utf8"), readFileSync(bFile, "utf8")) : []
      semantic.push({ ...group, diff: [...raw, ...apiDiffLines(group)] })
    }
  } catch (error) {
    api = { identical: false, comparisonComplete: false, nameDifferences: [], typeDifferences: [], docDifferences: [],
      environmentDiagnostics: [{ blocking: true, diagnostic: "Declaration snapshot comparison unavailable: " + error.message }] }
  } finally { left?.cleanup(); right?.cleanup() }
  semantic.sort((a, b) => compare(a.file, b.file))
  return { ...api, comparison: "API identity", files: before.length, added, addedPrivate,
    renamed: [...moved].map(([from, to]) => ({ from, to })), removed, changed: semantic, excused,
    ...(aSurface || bSurface ? { publicSurface: { before: aSurface, after: bSurface, rootsChanged: Boolean(rootsChanged), reachableChanged: Boolean(reachableChanged), resolutionChanged: Boolean(resolutionChanged) } } : {}) }
}

// The files a declaration emit can write outside outDir: x.d.ts, x.d.mts,
// x.d.cts beside a source outside the project's rootDir, and the x.d.vibe.ts
// sidecar every compile writes beside x.vibe.
const declarationOutput = /\.d\.(?:vibe\.)?[cm]?ts$/

// The contents of each declaration file under directory, outside node_modules,
// dot directories and skip, by absolute path.
function declarationFiles(directory, skip, pattern = declarationOutput) {
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
      } else if (entry.isFile() && pattern.test(entry.name)) files.set(child, readFileSync(child))
    }
  }
  walk(directory)
  return files
}

// This emit explicitly requests external maps with a physical sourceRoot.
// Read those maps directly so a standalone staged flow needs no repository
// package files. Never infer attribution from a sibling extension.
function emittedSource(file) {
  let map
  try { map = JSON.parse(readFileSync(file + ".map", "utf8")) } catch { return undefined }
  if (map.sources?.length !== 1) return undefined
  const source = resolve(dirname(file), map.sourceRoot || "", map.sources[0])
  // A module declaration emits its own module, rather than the whole source.
  if (/^(.+\.vibe)\.[^./\\]+\.js$/.exec(basename(file))?.[1] === basename(source)) return undefined
  return existsSync(source) ? source : undefined
}

const isTestFile = (path) => /\.(?:test|spec)\.[^/]+$/.test(path)
const inTestDirectory = (path) => /(?:^|\/)(?:test|tests|__tests__)\//.test(path)

/** Each path a package's `exports` names, with any `*`, through every condition. */
function exportedPaths(packageDir) {
  const paths = []
  const visit = (value) => {
    if (typeof value === "string") paths.push(value)
    else if (value && typeof value === "object") Object.values(value).forEach(visit)
  }
  try {
    visit(JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).exports)
  } catch {
    // No readable manifest: nothing is exported.
  }
  return paths
}

const matchesExport = (path, exported) => exported.includes(path) || exported.some((pattern) => {
  if (!pattern.includes("*")) return false
  const [before, after] = pattern.split("*")
  return path.startsWith(before) && path.endsWith(after) && path.length >= before.length + after.length
})

/**
 * The modules of a test directory the package publishes: each one its exports
 * name, by source or emitted path, and each one those import relatively. Such
 * a module is a runtime module, as "./test/TestDatabase":
 * "./src/test/TestDatabase.ts" is: plain Node imports it from another package,
 * and left as source its relative .vibe imports don't load.
 */
function exportedTestModules(packageDir, candidates) {
  const exported = exportedPaths(packageDir)
  const pending = [...candidates.keys()].filter((source) => matchesExport("./" + source, exported) || matchesExport("./.vibelang/js/" + candidates.get(source).relative, exported))
  const reached = new Set(pending)
  const byOutput = new Map([...candidates].map(([source, { relative }]) => [relative, source]))
  while (pending.length) {
    const { file, relative } = candidates.get(pending.pop())
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(?\s*)["'](\.[^"']+)["']/g)) {
      const source = byOutput.get(posix.normalize(posix.join(posix.dirname(relative), specifier)))
      if (source !== undefined && !reached.has(source)) {
        reached.add(source)
        pending.push(source)
      }
    }
  }
  return reached
}

/**
 * Emits a migrated package's JavaScript under <packageDir>/.vibelang/js/,
 * which its package.json's `default` exports name (rewriteExports), so the
 * `bun build` CLI and plain Node, which load no VibeLang plugin, read
 * JavaScript (opencode-32); the loaders run the .vibe source in its place.
 * The tree mirrors the package (its rootDir is the package), holds every
 * module's JavaScript but tests' (a test directory's module stays when the
 * package exports it: exportedTestModules), and each file's first line names
 * its source. A file the emit writes outside the package, beside a source outside
 * it, is removed again, or put back as it was when it existed (as
 * emitDeclarations does); a declaration sidecar, which every compile writes,
 * stays. Returns the exit code, the number of files and the diagnostics.
 */
export async function emitPackageJs({ compiler, tsconfigs, packageDir, log, root, outDir }) {
  const out = outDir ?? join(packageDir, ".vibelang", "js")
  rmSync(out, { recursive: true, force: true })
  const scope = resolve(root ?? packageDir)
  const ts = loadTypeScript([packageDir, scope, fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
  const existing = declarationFiles(scope, resolve(out), /\.(?:[cm]?js(?:\.map)?|jsx(?:\.map)?|d\.[cm]?ts)$/)
  mkdirSync(out, { recursive: true })
  const flags = "--noEmit false --declaration false --emitDeclarationOnly false --declarationMap false --sourceMap true --inlineSourceMap false --inlineSources false --composite false --incremental false --noEmitOnError false --pretty false --listEmittedFiles"
  const inside = `${resolve(out)}${sep}`
  let code = 0
  let files = 0
  let output = ""
  const outputs = {}
  const testModules = new Map()
  const keep = (file, source, relative) => {
    const text = emittedAssetImports(readFileSync(file, "utf8").replace(/(^|\r?\n)\/\/# sourceMappingURL=[^\r\n]*\r?\n?$/, "$1"), join(packageDir, source), file, ts)
    const header = `// Generated by vibelang from ${source}; the migrate flow writes it again with each batch.\n`
    writeFileSync(file, text.startsWith("#!") ? text.replace(/^(#![^\n]*\n)/, (line) => line + header) : header + text)
    outputs["./" + source] = "./.vibelang/js/" + relative
    files++
  }
  for (const tsconfig of tsconfigs) {
    // Empty CLI roots do not replace configured roots in this emitter. Keep
    // temporary maps local and physical so each output identifies its source.
    const result = await run(`${quote(compiler)} -p ${quote(tsconfig)} ${flags} --sourceRoot ${quote(resolve(packageDir) + sep)} --mapRoot ${quote(resolve(out) + sep)} --rootDir ${quote(packageDir)} --outDir ${quote(out)}`, { cwd: packageDir, log })
    assertFinished(result, log)
    code = Math.max(code, result.code)
    output += result.stdout + result.stderr
    for (const [, file] of result.stdout.matchAll(/^TSFILE: (.+)$/gm)) {
      if (!file.startsWith(inside)) {
        if (/\.d\.vibe\.ts$/.test(file)) continue
        const before = existing.get(resolve(file))
        if (before === undefined) rmSync(file, { force: true })
        else writeFileSync(file, before)
        continue
      }
      if (file.endsWith(".map")) continue // needed until all JavaScript is attributed
      const outputName = file.slice(inside.length).split(sep).join("/")
      const mapped = emittedSource(file)
      const source = mapped === undefined ? undefined : relative(packageDir, mapped).split(sep).join("/")
      if (source === undefined || source.startsWith("../") || isTestFile(source)) {
        rmSync(file, { force: true })
        continue
      }
      if (inTestDirectory(source)) {
        testModules.set(source, { file, relative: outputName })
        continue
      }
      keep(file, source, outputName)
    }
    for (const [, file] of result.stdout.matchAll(/^TSFILE: (.+)$/gm)) {
      if (file.startsWith(inside) && file.endsWith(".map")) rmSync(file, { force: true })
    }
  }
  const published = exportedTestModules(packageDir, testModules)
  for (const [source, { file, relative }] of testModules) {
    if (published.has(source)) keep(file, source, relative)
    else rmSync(file, { force: true })
  }
  return { code, files, outputs, diagnostics: parseDiagnostics(output, { cwd: packageDir, root }) }
}

/**
 * Writes the loader record (vibelang/project's writeLoaderRecord) of each
 * project a loader compiles one of the package's .vibe modules with, the
 * nearest tsconfig above the module, beside the emitted JavaScript under
 * .vibelang/js/.loader/. A process with a cold cache, such as every CI run,
 * then loads the package without compiling it while its inputs are unchanged
 * (opencode's standalone CLI child compiled five packages, 7 to 13 s each).
 * A nested package and a project outside the package are their own. A
 * project that does not compile, or a compiler that cannot record, leaves no
 * record and a receipt entry that says why; the emit stands either way.
 *
 * The writer is the package's installed vibelang/project, the loader that
 * reads the record, through its public export: a flow stages without the
 * repository's packages, and a record holds only for the loader version that
 * wrote it.
 */
export async function writeLoaderRecords({ compiler, packageDir, root }) {
  const name = (path) => rel(root ?? packageDir, path)
  let loader
  try {
    loader = await import(pathToFileURL(createRequire(join(packageDir, "package.json")).resolve("vibelang/project")).href)
  } catch (error) {
    return [{ package: name(packageDir), error: `vibelang/project is not installed for this package: ${String(error?.message ?? error).split("\n")[0]}` }]
  }
  const { formatDiagnostic, nearestProject, writeLoaderRecord } = loader
  const inside = (path) => !relative(packageDir, path).startsWith("..")
  const projects = new Set()
  const walk = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (item.name.startsWith(".") || item.name === "node_modules") continue
      const path = join(directory, item.name)
      if (item.isDirectory()) {
        if (!existsSync(join(path, "package.json"))) walk(path)
      } else if (item.name.endsWith(".vibe")) {
        const project = nearestProject(path)
        if (project !== undefined && inside(project)) projects.add(project)
      }
    }
  }
  walk(packageDir)
  return [...projects].sort().map((project) => {
    try {
      const written = writeLoaderRecord({ project, compiler })
      if (written.errors) return { project: name(project), errors: written.errors.length, first: formatDiagnostic(written.errors[0]) }
      return { project: name(project), file: name(written.file), modules: written.modules }
    } catch (error) {
      return { project: name(project), error: String(error?.message ?? error).split("\n")[0] }
    }
  })
}

/**
 * Checks each record writeLoaderRecords wrote (records, its receipt entries)
 * against the final tree, with the same installed vibelang/project's
 * checkLoaderRecord, and adds `miss` to an entry whose record does not hold.
 * A record names the package.json of every package its compile read, so one
 * written before another package's routing changed that manifest missed on
 * every cold start (opencode's ai package, 76 .vibe modules). An installed
 * vibelang without checkLoaderRecord leaves the entries as they are.
 */
export async function checkLoaderRecords({ compiler, packageDir, root, records }) {
  let check
  try {
    check = (await import(pathToFileURL(createRequire(join(packageDir, "package.json")).resolve("vibelang/project")).href)).checkLoaderRecord
  } catch {
    return records
  }
  if (typeof check !== "function") return records
  return records.map((entry) => {
    if (entry.file === undefined) return entry
    try {
      const found = check({ project: join(root ?? packageDir, entry.project), compiler })
      return found.miss === undefined ? entry : { ...entry, miss: found.miss }
    } catch (error) {
      return { ...entry, miss: String(error?.message ?? error).split("\n")[0] }
    }
  })
}

// Assets are not compiler outputs. Keep their original file identity when
// JavaScript moves under .vibelang/js, including import attributes and dynamic
// imports. The generated module alone changes; asset bytes stay at source.
function emittedAssetImports(text, source, output, ts) {
  const file = ts.createSourceFile(output, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const changes = []
  const moduleLiteral = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) return node.moduleSpecifier
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0]
    return undefined
  }
  const visit = node => {
    const literal = moduleLiteral(node)
    if (literal && ts.isStringLiteralLike(literal)) {
      const specifier = literal.text
      const cut = specifier.search(/[?#]/)
      const path = cut < 0 ? specifier : specifier.slice(0, cut)
      const suffix = cut < 0 ? "" : specifier.slice(cut)
      if ((path.startsWith("./") || path.startsWith("../")) && !/\.(?:[cm]?[jt]sx?|vibe)$/i.test(path)) {
        const asset = resolve(dirname(source), path)
        let present = false
        try { present = statSync(asset).isFile() } catch {}
        if (present) {
          let target = relative(dirname(output), asset).split(sep).join("/")
          if (!target.startsWith(".")) target = "./" + target
          if (target + suffix !== specifier) changes.push({ start: literal.getStart(file), end: literal.end, text: JSON.stringify(target + suffix) })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  for (const change of changes.sort((a, b) => b.start - a.start)) text = text.slice(0, change.start) + change.text + text.slice(change.end)
  return text
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
  let flags = "--singleThreaded --noEmit false --declaration --emitDeclarationOnly --declarationMap false --sourceMap false --inlineSourceMap false --inlineSources false --composite false --incremental false --noEmitOnError false --pretty false --listEmittedFiles"
  let result = await run(`${quote(compiler)} -p ${quote(tsconfig)} ${flags} --outDir ${quote(outDir)}`, { cwd, log })
  assertFinished(result, log)
  let optionProbeLog = null
  const unsupportedSingleThreaded = result.code !== 0 &&
    /TS5023: Unknown compiler option ['"]--singleThreaded['"]/i.test(result.stdout + result.stderr)
  if (unsupportedSingleThreaded) {
    // Strada tsc has no Go single-threading switch. Keep the selected compiler
    // and every declaration flag; retain the rejected invocation as evidence.
    if (log) {
      optionProbeLog = log + ".single-threaded.log"
      writeFileSync(optionProbeLog, readFileSync(log))
    }
    flags = flags.replace("--singleThreaded ", "")
    result = await run(`${quote(compiler)} -p ${quote(tsconfig)} ${flags} --outDir ${quote(outDir)}`, { cwd, log })
  }
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
  return { code: result.code, files: files.length, diagnostics: parseDiagnostics(result.stdout + result.stderr, { cwd, root }), ...(unsupportedSingleThreaded ? { unsupportedOptions: ["--singleThreaded"], optionProbeLog } : {}) }
}

/**
 * New declaration emit errors compared with the saved original program.
 * Source locations may move during conversion; source identity, diagnostic
 * code, message, notes and multiplicity must agree. Without an original
 * receipt, retain the strict file/global errors and failing-exit check.
 */
export function emitErrorsIn(diagnostics, files, { code = 0, log, baseline } = {}) {
  const current = diagnostics.filter(d => d.category === "error")
  const recorded = baseline && Number.isInteger(baseline.code) && Array.isArray(baseline.diagnostics)
  const key = d => JSON.stringify([
    (d.file ?? "").replace(/\.(?:ts|tsx|mts|cts|vibe|vibex)$/, ""),
    d.code, d.message, d.notes ?? []
  ])
  const remaining = new Map()
  if (recorded) for (const d of baseline.diagnostics.filter(d => d.category === "error")) {
    remaining.set(key(d), (remaining.get(key(d)) ?? 0) + 1)
  }
  const added = current.filter(d => {
    const count = remaining.get(key(d)) ?? 0
    if (!count) return true
    remaining.set(key(d), count - 1)
    return false
  })
  const errors = recorded ? added : added.filter(d => !d.file || files.includes(d.file))
  // A failing exit is inherited only when matching original diagnostics
  // explain it. No receipt, no diagnostics or new errors still fail,
  // regardless of matching declaration artifacts. Both exit codes stay in
  // the verification receipt; diagnostic identity decides inheritance.
  const inheritedExit = recorded && current.length > 0 && added.length === 0
  if (code !== 0 && !inheritedExit) errors.push({
    category: "error", file: null, code: "emit-exit",
    message: "Declaration emit exited with status " + code + "; original diagnostics do not explain this failure.",
    emitCode: code, baselineCode: recorded ? baseline.code : null,
    newDiagnostics: added.length, ...(log ? { log } : {})
  })
  return errors
}
