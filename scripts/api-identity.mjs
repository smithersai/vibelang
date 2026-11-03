#!/usr/bin/env node
// Published declaration identity: exported names, strict bidirectional type
// identity checked by tsc, and JSDoc. No declaration text canonicalizer.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { alignNominalIdentity } from "./api-identity-nominal.mjs"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const declaration = /\.d\.(?:[cm]?ts|vibe\.ts)$/
const slash = x => x.replaceAll("\\", "/")

export function loadTypeScript(dirs = []) {
  for (const dir of [...dirs, join(repo, "docs/tools"), join(repo, "packages/runtime"), join(repo, "experiments")]) {
    try {
      const ts = createRequire(join(resolve(dir), "package.json"))("typescript")
      if (typeof ts.createProgram === "function") return ts
    } catch {}
  }
  throw new Error("TypeScript compiler API unavailable; run (cd docs/tools && bun install --frozen-lockfile)")
}

function filesUnder(dir, includeJson = false) {
  const out = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".jj", ".git"].includes(item.name)) continue
    const path = join(dir, item.name)
    if (item.isDirectory()) out.push(...filesUnder(path, includeJson))
    else if (declaration.test(item.name) || (includeJson && item.name.endsWith(".json"))) out.push(path)
  }
  return out.sort()
}

function declarationPath(path) {
  const emitted = path.replace(/\.(?:[cm]?[jt]sx?|vibe)$/, /\.m[jt]s$/.test(path) ? ".d.mts"
    : /\.c[jt]s$/.test(path) ? ".d.cts" : ".d.ts")
  const candidates = declaration.test(path) ? [path] : [
    ...(path.endsWith(".vibe") ? [path.replace(/\.vibe$/, ".d.vibe.ts")] : []),
    emitted, path + ".d.ts", join(path, "index.d.ts"),
  ]
  return candidates.find(p => declaration.test(p) && existsSync(p))
}

// Publication discovery and probes must see the same projected sidecar tree.
function projectSidecarHost(ts, host, virtual = new Map()) {
  const read = host.readFile.bind(host)
  const originalExists = host.fileExists.bind(host)
  const projectCache = new Map(), configCache = new Map()
  function readProject(config, trail = new Set()) {
    if (configCache.has(config)) return configCache.get(config)
    if (trail.has(config)) return {}
    trail = new Set([...trail, config])
    const raw = ts.readConfigFile(config, read).config ?? {}
    let inherited = {}
    for (const extension of [raw.extends ?? []].flat()) {
      try {
        const base = extension.startsWith(".") || extension.startsWith("/")
          ? resolve(dirname(config), extension)
          : createRequire(config).resolve(extension)
        inherited = { ...inherited, ...readProject(originalExists(base) ? base : base + ".json", trail) }
      } catch {}
    }
    const parsed = ts.parseJsonConfigFileContent(raw, ts.sys, dirname(config), {}, config)
    const value = { ...inherited, options: parsed.options,
      ...(typeof raw.vibe?.sidecarDir === "string" ? { sidecar: raw.vibe.sidecarDir, sidecarBase: dirname(config) } : {}) }
    configCache.set(config, value)
    return value
  }
  function project(file) {
    const start = dirname(resolve(file))
    if (projectCache.has(start)) return projectCache.get(start)
    let dir = start, value = {}
    for (;;) {
      const config = ["vibe.config.json", "tsconfig.json"].map(name => join(dir, name)).find(originalExists)
      if (config) {
        value = readProject(config)
        value = { ...value, root: dirname(config), sidecar: value.sidecar === undefined ? undefined
          : resolve(value.sidecarBase, value.sidecar.replaceAll("${configDir}", dirname(config))) }
        break
      }
      if (dirname(dir) === dir) break
      dir = dirname(dir)
    }
    projectCache.set(start, value)
    return value
  }
  function sidecar(path) {
    if (!path.endsWith(".d.vibe.ts")) return undefined
    const config = project(path)
    if (!config.sidecar) return undefined
    const local = relative(config.root, path)
    if (local.startsWith("../") || local === "..") return undefined
    const mirror = join(config.sidecar, local)
    return originalExists(mirror) ? mirror : undefined
  }
  // Project mirrored declarations at their logical beside-source paths. Relative
  // imports inside a moved sidecar must resolve beside that source too.
  host.readFile = path => virtual.get(resolve(path)) ?? read(path) ?? (sidecar(path) ? read(sidecar(path)) : undefined)
  host.fileExists = path => virtual.has(resolve(path)) || originalExists(path) || Boolean(sidecar(path))
  return project
}

/** Names are per published subpath AND types condition, never per private file.
 * Bare declaration trees have no publishing metadata: every file is an entry.
 * An explicit unresolved entry remains in the map and fails closed.
 */
export function publishedEntrypoints(directory, tsCompiler) {
  directory = resolve(directory)
  if (statSync(directory).isFile()) return { ".": directory }
  const manifestFile = join(directory, "package.json")
  if (!existsSync(manifestFile)) {
    const entries = {}
    for (const file of filesUnder(directory)) {
      const key = slash(relative(directory, file)).replace(/\.d\.vibe\.ts$/, ".d.ts")
      if (entries[key]) throw new Error("Ambiguous declaration twins for " + key)
      entries[key] = file
    }
    return entries
  }
  const raw = JSON.parse(readFileSync(manifestFile, "utf8"))
  const manifest = { ...raw, ...raw.publishConfig }
  const entries = {}
  const all = filesUnder(directory, true)
  const exportMap = manifest.exports && !Array.isArray(manifest.exports) && typeof manifest.exports === "object" &&
    Object.keys(manifest.exports).some(key => key.startsWith(".")) ? manifest.exports : undefined
  // Exact subpaths override patterns; longest prefixes, then longest trailers,
  // win among matching patterns, independently of object insertion order.
  const exportKeys = Object.keys(exportMap ?? {})
  const patterns = exportKeys.filter(key => key.includes("*")).sort((a, b) =>
    b.indexOf("*") - a.indexOf("*") || b.length - a.length)
  const selectedExport = subpath => exportKeys.includes(subpath) ? subpath : patterns.find(key => {
    const star = key.indexOf("*"), prefix = key.slice(0, star), suffix = key.slice(star + 1)
    return subpath.length >= prefix.length + suffix.length && subpath.startsWith(prefix) && subpath.endsWith(suffix)
  })
  function add(key, target, origin) {
    if (typeof target !== "string") return
    // CSS and WASM have no TypeScript declaration surface. JSON is a tsc module.
    // Missing declaration targets fail closed.
    if (/\.(?:css|wasm)$/.test(target)) return
    const path = resolve(directory, target)
    if (target.includes("*")) {
      const expected = declaration.test(path) ? path
        : path.replace(/\.(?:[cm]?[jt]sx?|vibe)$/, path.endsWith(".mjs") || path.endsWith(".mts") ? ".d.mts"
          : path.endsWith(".cjs") || path.endsWith(".cts") ? ".d.cts" : ".d.ts")
      const pieces = slash(expected).split("*")
      const pattern = new RegExp("^" + pieces.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.*)") + "$")
      let found = false
      for (const file of all) {
        const match = slash(file).match(pattern)
        if (match) {
          if (!exportMap || selectedExport(origin.replace("*", match[1])) === origin)
            entries[key.replace("*", match[1])] = file
          found = true
        }
      }
      if (!found) entries[key] = expected
    } else entries[key] = declarationPath(path) ?? path
  }

  function visit(value, key, origin = key) {
    if (typeof value === "string") return add(key, value, origin)
    if (Array.isArray(value)) return value.forEach((v, i) => visit(v, key + "#fallback" + i, origin))
    if (!value || typeof value !== "object") return
    // Discover candidates; ordered condition selection belongs to tsc below.
    for (const [condition, child] of Object.entries(value))
      visit(child, condition === "types" ? key : key + "#" + condition, origin)
  }
  if (manifest.exports !== undefined) {
    const exp = manifest.exports
    if (exp && !Array.isArray(exp) && typeof exp === "object" && Object.keys(exp).some(k => k.startsWith("."))) {
      for (const [key, value] of Object.entries(exp)) visit(value, key)
    } else visit(exp, ".")
  } else if (manifest.types ?? manifest.typings) add(".", manifest.types ?? manifest.typings)
  else {
    const root = declarationPath(join(directory, manifest.main ?? "index"))
    if (root) entries["."] = root
  }
  // Both arrays and conditional objects select ordered alternatives.
  // A later types condition cannot override an earlier resolvable default.
  if (manifest.exports !== undefined) {
    const ts = tsCompiler ?? loadTypeScript([directory])
    const packageName = "__api_identity_snapshot__"
    const publishedManifest = JSON.stringify({ ...manifest, name: packageName })
    const host = { ...ts.sys, readFile: path => resolve(path) === manifestFile ? publishedManifest : ts.sys.readFile(path) }
    projectSidecarHost(ts, host)
    const clean = key => key.replace(/#fallback\d+|#default/g, "")
    const conditionSets = [...new Set(Object.keys(entries).map(key => JSON.stringify(key.split("#").slice(1)
      .filter(key => !/^fallback\d+$/.test(key) && !["import", "require", "default", "types"].includes(key)))))].map(JSON.parse)
    for (const subpath of [...new Set(Object.keys(entries).map(key => key.split("#")[0]))]) {
      const candidates = Object.entries(entries).filter(([key]) => key.split("#")[0] === subpath)
      for (const [key] of candidates) delete entries[key]
      let found = false
      for (const extra of [[], ...conditionSets]) {
        for (const [mode, meaning] of [[ts.ModuleKind.ESNext, "import"], [ts.ModuleKind.CommonJS, "require"]]) {
          const resolved = ts.resolveModuleName(packageName + (subpath === "." ? "" : subpath.slice(1)),
            join(directory, "__api_identity_consumer.ts"), {
              module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
              allowArbitraryExtensions: true, resolveJsonModule: projectJsonModules(ts, directory), customConditions: extra
            }, host, undefined, undefined, mode).resolvedModule
          if (!resolved) continue
          const target = declarationPath(resolved.resolvedFileName) ?? resolved.resolvedFileName
          const applicable = candidates.filter(([key, path]) =>
            (path === target || path.endsWith(".vibe") && path.replace(/\.vibe$/, ".d.vibe.ts") === target) &&
            clean(key).split("#").slice(1).every(condition =>
              condition === meaning || condition === "default" || extra.includes(condition)))
          if (!applicable.length) continue
          const key = applicable.map(([key]) => clean(key)).sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
          entries[key] = target
          found = true
        }
      }
      if (!found && candidates.length) entries[subpath] = candidates.at(-1)[1]
    }
  }
  return entries
}

const normalized = text => text.replace(/\s+/gu, " ").trim()
function docs(ts, checker, symbol) {
  const text = normalized(ts.displayPartsToString(symbol.getDocumentationComment(checker)))
  const tags = symbol.getJsDocTags(checker).map(tag =>
    "@" + tag.name + " " + normalized(typeof tag.text === "string" ? tag.text : ts.displayPartsToString(tag.text)))
  return [text, ...tags].join("\n").trim()
}

const identityPrelude = `type __Assignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type __Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? ((<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false)
    : false;
type __Assert<T extends true> = T;
`

// Deferred infer/mapped parameters carry declaration-local tsc identities.
// Intern corresponding modules only after proving their complete resolved
// dependency closures have the same syntax (comments/quotes/specifiers aside).
// The final generated strict probe still imports both published entry points.
// Changed or unresolved dependencies invalidate every ancestor, including cycles.
function equivalentModules(ts, program, host, left, right, externalGroups, documentation) {
  const printer = ts.createPrinter({ removeComments: true })
  const nodes = new Map(), normalized = new Map(), origins = new Map()
  function externalOrigin(file) {
    if (origins.has(file)) return origins.get(file)
    const marker = "/node_modules/"
    const start = file.lastIndexOf(marker)
    let origin
    if (start >= 0) {
      const tail = file.slice(start + marker.length).split("/")
      const root = file.slice(0, start + marker.length) + tail.slice(0, tail[0].startsWith("@") ? 2 : 1).join("/")
      let manifest = {}
      try { manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) } catch {}
      origin = JSON.stringify([manifest.name ?? relative(dirname(root), root), manifest.version, slash(relative(root, file))])
    }
    origins.set(file, origin)
    return origin
  }
  function syntax(file) {
    if (normalized.has(file)) return normalized.get(file)
    const source = program.getSourceFile(file)
    if (!source) return undefined
    const imports = []
    const factory = ts.factory
    const canonicalImport = (node, module = node.moduleSpecifier) => {
      let bindings = node.importClause.namedBindings
      if (bindings && ts.isNamedImports(bindings)) bindings = factory.updateNamedImports(bindings,
        [...bindings.elements].sort((a, b) => a.name.text.localeCompare(b.name.text))
          .map(specifier => factory.updateImportSpecifier(specifier, false, specifier.propertyName, specifier.name)))
      const clause = factory.updateImportClause(node.importClause, false, node.importClause.name, bindings)
      return factory.updateImportDeclaration(node, node.modifiers, clause, module, node.attributes)
    }
    const imported = node => ts.isImportDeclaration(node) && node.importClause
    const importKey = node => printer.printNode(ts.EmitHint.Unspecified,
      canonicalImport(node, factory.createStringLiteral("__module")), source)
    const orderedMembers = members => {
      const name = node => node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) ? node.name.text : undefined
      const counts = new Map()
      for (const member of members) if (name(member) !== undefined) counts.set(name(member), (counts.get(name(member)) ?? 0) + 1)
      const eligible = member => name(member) !== undefined && counts.get(name(member)) === 1 &&
        (ts.isPropertySignature(member) || ts.isMethodSignature(member) ||
          ts.isPropertyDeclaration(member) && !member.initializer || ts.isMethodDeclaration(member))
      const sorted = members.filter(eligible).sort((a, b) => name(a).localeCompare(name(b)))
      let index = 0
      return factory.createNodeArray(members.map(member => eligible(member) ? sorted[index++] : member))
    }
    const transform = context => {
      const visit = node => {
        if (ts.isTypeLiteralNode(node)) node = factory.updateTypeLiteralNode(node, orderedMembers(node.members))
        else if (ts.isInterfaceDeclaration(node)) node = factory.updateInterfaceDeclaration(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, orderedMembers(node.members))
        else if (ts.isClassDeclaration(node)) node = factory.updateClassDeclaration(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, orderedMembers(node.members))
        if (ts.isStringLiteral(node)) {
          const p = node.parent
          const module = p && ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node ||
            ts.isLiteralTypeNode(p) && p.parent && ts.isImportTypeNode(p.parent) ||
            ts.isExternalModuleReference(p) && p.expression === node)
          if (module) { imports.push(node); return ts.factory.createStringLiteral("__edge" + (imports.length - 1)) }
          return ts.factory.createStringLiteral(node.text)
        }
        const visited = ts.visitEachChild(node, visit, context)
        return imported(visited) ? canonicalImport(visited) : visited
      }
      return source => {
        const sorted = source.statements.filter(imported).sort((a, b) => importKey(a).localeCompare(importKey(b)))
        let index = 0
        const ordered = factory.updateSourceFile(source, source.statements.map(statement => imported(statement) ? sorted[index++] : statement))
        return ts.visitNode(ordered, visit)
      }
    }
    const transformed = ts.transform(source, [transform])
    const text = printer.printFile(transformed.transformed[0]) + (documentation?.get(file) ?? "")
    transformed.dispose()
    const deps = host.resolveModuleNameLiterals(imports, file, undefined, program.getCompilerOptions(), source).map(x => x.resolvedModule?.resolvedFileName)
    for (const ref of source.referencedFiles) deps.push(resolve(dirname(file), ref.fileName))
    for (const ref of source.typeReferenceDirectives)
      deps.push(ts.resolveTypeReferenceDirective(ref.fileName, file, program.getCompilerOptions(), host).resolvedTypeReferenceDirective?.resolvedFileName)
    const value = { text, deps }
    normalized.set(file, value)
    return value
  }
  function pair(a, b) {
    const key = a + "\0" + b
    if (nodes.has(key)) return nodes.get(key)
    const node = { a, b, good: true, parents: [] }
    nodes.set(key, node)
    if (a === b) return node
    if (externalOrigin(a) !== externalOrigin(b)) { node.good = false; return node }
    const x = syntax(a), y = syntax(b)
    if (!x || !y || x.text !== y.text || x.deps.length !== y.deps.length) { node.good = false; return node }
    for (let i = 0; i < x.deps.length; i++) {
      if (!x.deps[i] || !y.deps[i]) { node.good = false; continue }
      pair(x.deps[i], y.deps[i]).parents.push(node)
    }
    return node
  }
  for (const key of Object.keys(left)) if (right[key]) pair(left[key], right[key])
  // Entry syntax can legitimately differ (alias expansion/import order).
  // Seed dependency pairs independently using tsc's package identities, then
  // prove their full resolved closures before interning either copy.
  for (const files of externalGroups.values()) {
    const [a, b, ...extra] = [...files]
    if (a && b && !extra.length) pair(a, b)
  }
  // Paths and frozen resolution edges can bypass tsc package IDs. Recover
  // the same candidates from logical installed-package/module origins.
  const logicalGroups = new Map()
  for (const source of program.getSourceFiles()) {
    if (source.hasNoDefaultLib) continue
    const origin = externalOrigin(source.fileName)
    if (origin === undefined) continue
    if (!logicalGroups.has(origin)) logicalGroups.set(origin, [])
    logicalGroups.get(origin).push(source.fileName)
  }
  for (const files of logicalGroups.values()) if (files.length === 2) pair(files[0], files[1])
  const bad = [...nodes.values()].filter(n => !n.good)
  for (let i = 0; i < bad.length; i++) for (const parent of bad[i].parents) {
    if (parent.good) { parent.good = false; bad.push(parent) }
  }
  // Only one-to-one pairings preserve the distinct nominal identities of two
  // same-text modules in a single tree.
  const candidates = [...nodes.values()].filter(n => n.good && n.a !== n.b)
  const from = new Map(), to = new Map()
  for (const n of candidates) {
    from.set(n.b, (from.get(n.b) ?? new Set()).add(n.a))
    to.set(n.a, (to.get(n.a) ?? new Set()).add(n.b))
  }
  for (const n of candidates) if (from.get(n.b).size !== 1 || to.get(n.a).size !== 1) {
    n.good = false; bad.push(n)
  }
  for (let i = 0; i < bad.length; i++) for (const parent of bad[i].parents) {
    if (parent.good) { parent.good = false; bad.push(parent) }
  }
  return new Map(candidates.filter(n => n.good).map(n => [n.b, n.a]))
}

// Read the inherited project setting rather than assuming a JSON export opts
// the project into JSON imports. Declaration-only snapshots may have no config.
function projectJsonModules(ts, path) {
  const start = statSync(path).isFile() ? dirname(path) : path
  const config = ["vibe.config.json", "tsconfig.json"]
    .map(name => ts.findConfigFile(start, ts.sys.fileExists, name)).filter(Boolean)
    .sort((a, b) => dirname(b).length - dirname(a).length)[0]
  if (!config) return true
  return ts.getParsedCommandLineOfConfigFile(config, {}, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {},
  })?.options.resolveJsonModule ?? false
}

/** Compile a generated .ts probe. Generic type exports get a local bridge
 * inside their own declaration module, so constraints and private aliases
 * resolve in their original scope; a generic factory preserves constraints.
 * No files are written to either input tree.
 */
export function compareApiIdentity(ts, before, after, options = {}) {
  before = resolve(before); after = resolve(after)
  const entryMap = (base, supplied) => Object.fromEntries(Object.entries(supplied ?? publishedEntrypoints(base, ts))
    .map(([key, path]) => [key, resolve(base, path)]))
  const left = entryMap(before, options.beforeEntrypoints)
  const right = entryMap(after, options.afterEntrypoints)
  const result = { identical: false, comparisonComplete: true, nameDifferences: [], typeDifferences: [], docDifferences: [], environmentDiagnostics: [] }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  const compilerOptions = {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
    noEmit: true, skipLibCheck: false, types: [], allowImportingTsExtensions: true, allowArbitraryExtensions: true,
    resolveJsonModule: projectJsonModules(ts, before) && projectJsonModules(ts, after),
    ...options.compilerOptions,
    strict: true, strictNullChecks: true, strictFunctionTypes: true, noImplicitAny: true, noImplicitThis: true,
    noEmit: true, skipLibCheck: false, allowSyntheticDefaultImports: true,
  }
  const virtual = new Map()
  const host = ts.createCompilerHost(compilerOptions)
  const project = projectSidecarHost(ts, host, virtual)
  for (const entries of [left, right]) for (const [key, path] of Object.entries(entries)) {
    if (path.endsWith(".vibe") && host.fileExists(path.replace(/\.vibe$/, ".d.vibe.ts")))
      entries[key] = path.replace(/\.vibe$/, ".d.vibe.ts")
  }
  // Fuzz/case snapshots live outside their original package. Resolve their
  // external dependencies through the caller's pinned Effect install only
  // after ordinary package resolution has failed.
  const moduleRoots = options.moduleRoots ?? [process.env.EFFECT_NODE_MODULES, join(repo, "experiments/node_modules")].filter(Boolean)
  const frozenResolutions = new Map()
  for (const [base, hints] of [[before, options.beforeResolutions], [after, options.afterResolutions]]) {
    for (const [file, name, target] of hints ?? []) {
      const key = resolve(base, file) + "\0" + name
      const destination = resolve(base, target)
      if (frozenResolutions.has(key) && frozenResolutions.get(key) !== destination)
        throw new Error("Ambiguous frozen declaration resolution: " + file + " -> " + name)
      frozenResolutions.set(key, destination)
    }
  }
  const externalGroups = new Map()
  host.resolveModuleNames = (names, containingFile, modes = []) => names.map((name, index) => {
    const mode = modes[index]
    const frozen = frozenResolutions.get(resolve(containingFile) + "\0" + name)
    if (frozen) return { resolvedFileName: frozen, extension: frozen.endsWith(".d.mts") ? ts.Extension.Dmts
      : frozen.endsWith(".d.cts") ? ts.Extension.Dcts : ts.Extension.Dts, isExternalLibraryImport: false }
    const resolutionOptions = { ...compilerOptions, ...project(containingFile).options, ...options.compilerOptions, allowArbitraryExtensions: true }
    let resolved = ts.resolveModuleName(name, containingFile, resolutionOptions, host, undefined, undefined, mode).resolvedModule
    if (!resolved && !name.startsWith(".") && !name.startsWith("/")) {
      for (const modules of moduleRoots) {
        resolved = ts.resolveModuleName(name, join(dirname(resolve(modules)), "__api_identity__.ts"), compilerOptions, host, undefined, undefined, mode).resolvedModule
        if (resolved) break
      }
    }
    // Do not let equal name/version hide a mutated installed snapshot. The
    // closure proof above restores shared identity for equivalent dependency
    // copies even when the published entry itself uses different syntax.
    if (resolved?.packageId && resolved.resolvedFileName.includes("/node_modules/")) {
      const id = JSON.stringify(resolved.packageId)
      if (!externalGroups.has(id)) externalGroups.set(id, new Set())
      externalGroups.get(id).add(resolved.resolvedFileName)
    }
    return resolved && { ...resolved, packageId: undefined }
  })
  // A name alone discards import attributes and import/require resolution mode.
  // Keep the usage's mode all the way through the original and final probes.
  host.resolveModuleNameLiterals = (literals, file, redirected, compiler, source) => {
    const resolverOptions = { ...compilerOptions, ...project(file).options, ...options.compilerOptions }
    return host.resolveModuleNames(literals.map(literal => literal.text), file,
      literals.map(literal => ts.getModeForUsageLocation(source, literal, resolverOptions)))
      .map(resolvedModule => ({ resolvedModule }))
  }
  const probe = join(repo, ".api-identity-probe.mts")
  const roots = [...new Set([...Object.values(left), ...Object.values(right)])]
  let program = ts.createProgram(roots, compilerOptions, host)
  const originalDiagnostics = []
  // Diagnose originals before asking for enum constants: tsc can cache a
  // non-diagnostic enum computation when getConstantValue is called first.
  for (const source of program.getSourceFiles()) {
    if ([before, after].some(base => source.fileName === base || source.fileName.startsWith(base + "/")) &&
        !source.fileName.includes("/node_modules/"))
      originalDiagnostics.push(...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source))
  }

  // A shared program merges ambient globals and module augmentations. Prove
  // these shared contributions equivalent using separate dependency closures.
  // Changed contributions cannot be compared soundly by the combined probe.
  const contributesAmbient = source => {
    if (source.hasNoDefaultLib || ts.isJsonSourceFile(source)) return false
    let contributes = !ts.isExternalModule(source)
    const visit = node => {
      if (ts.isModuleDeclaration(node) && ((node.flags & ts.NodeFlags.GlobalAugmentation) || ts.isStringLiteral(node.name))) contributes = true
      ts.forEachChild(node, visit)
    }
    visit(source)
    return contributes
  }
  if (program.getSourceFiles().some(contributesAmbient)) {
    const ambientDocumentation = new Map()
    const ambient = (roots, base) => {
      const isolated = ts.createProgram(Object.values(roots), compilerOptions, host)
      const sources = new Map()
      const docChecker = isolated.getTypeChecker()
      for (const source of isolated.getSourceFiles()) {
        if (source.hasNoDefaultLib) continue
        const comments = []
        const inspect = (node, path) => {
          const name = node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) ? node.name.text : ""
          const key = path + "/" + ts.SyntaxKind[node.kind] + ":" + name
          const symbol = node.name && docChecker.getSymbolAtLocation(node.name)
          if (symbol) {
            const value = docs(ts, docChecker, symbol)
            if (value) comments.push([key, value])
          }
          ts.forEachChild(node, child => inspect(child, key))
        }
        inspect(source, "")
        ambientDocumentation.set(source.fileName, JSON.stringify(comments.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))))
        if (!contributesAmbient(source)) continue
        const file = resolve(source.fileName)
        let key
        const marker = "/node_modules/", at = file.lastIndexOf(marker)
        if (at >= 0) {
          const tail = file.slice(at + marker.length).split("/")
          const count = tail[0].startsWith("@") ? 2 : 1
          const root = file.slice(0, at + marker.length) + tail.slice(0, count).join("/")
          let manifest = {}
          try { manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) } catch {}
          key = "package:" + JSON.stringify([manifest.name ?? tail.slice(0, count).join("/"), manifest.version, relative(root, file)])
        } else if (file === base || file.startsWith(base + "/")) key = "owned:" + relative(base, file)
        else key = "shared:" + file
        if (sources.has(key) && sources.get(key) !== file) {
          result.environmentDiagnostics.push({ blocking: true, file, diagnostic: "Ambiguous ambient declaration origin: " + key })
        }
        sources.set(key, file)
      }
      return sources
    }
    const ambientLeft = ambient(left, before), ambientRight = ambient(right, after)
    // Global overload precedence follows source-file binding order.
    // Equal per-file closures cannot prove a reordered ambient environment.
    if (JSON.stringify([...ambientLeft.keys()]) !== JSON.stringify([...ambientRight.keys()])) {
      result.environmentDiagnostics.push({ blocking: true,
        diagnostic: "Ambient declaration load order differs; shared-program comparison is unavailable" })
      result.comparisonComplete = false
      return result
    }
    const ambientProof = equivalentModules(ts, program, host, Object.fromEntries(ambientLeft), Object.fromEntries(ambientRight), externalGroups, ambientDocumentation)
    for (const key of new Set([...ambientLeft.keys(), ...ambientRight.keys()])) {
      const a = ambientLeft.get(key), b = ambientRight.get(key)
      if (a && b && (a === b || ambientProof.get(b) === a)) continue
      result.environmentDiagnostics.push({ blocking: true, file: b ?? a, diagnostic: "Ambient declaration closures differ; shared-program comparison is unavailable: " + key })
    }
    if (result.environmentDiagnostics.some(d => d.blocking)) {
      result.comparisonComplete = false
      return result
    }
  }
  const equivalents = equivalentModules(ts, program, host, left, right, externalGroups)
  const nominal = alignNominalIdentity(ts, program, before, after, join(repo, ".api-identity-brands.d.cts"), [left, right])
  if (nominal.size > 1) {
    for (const [path, text] of nominal) {
      virtual.set(path, text)
    }
    program = ts.createProgram(roots, compilerOptions, host)
  }
  const checker = program.getTypeChecker()
  const inputDiagnostics = ts.getPreEmitDiagnostics(program)
  // Error-any can make a strict identity probe pass vacuously. Inspect only
  // compared export types, so an unrelated error in a dependency is harmless.
  const invalidExports = []
  function erroneous(type, seen = new Set(), expanded = new Set()) {
    if (!type || seen.has(type)) return false
    seen.add(type)
    const identity = type.target ?? type
    if (type.flags & ts.TypeFlags.Any && ["error", "unresolved"].includes(type.intrinsicName)) return true
    const nested = [...(type.types ?? []), ...(type.aliasTypeArguments ?? [])]
    if (type.flags & ts.TypeFlags.TypeParameter) nested.push(checker.getBaseConstraintOfType(type), type.getDefault?.())
    if (type.flags & ts.TypeFlags.Conditional) nested.push(type.checkType, type.extendsType, type.resolvedTrueType, type.resolvedFalseType)
    if (type.flags & ts.TypeFlags.IndexedAccess) nested.push(type.objectType, type.indexType)
    if (type.flags & ts.TypeFlags.Object) {
      if (type.objectFlags & ts.ObjectFlags.Reference) nested.push(...checker.getTypeArguments(type))
      // Arguments are checked for every instantiation; expand a generic shape
      // once to bound recursive Box<T[]> without hiding Box<Box<Missing>>.
      if (!expanded.has(identity)) {
      expanded.add(identity)
      // Default-library methods are not declarations from the compared surface.
      for (const prop of checker.getPropertiesOfType(type)) {
        const d = prop.valueDeclaration ?? prop.declarations?.[0]
        if (d && !d.getSourceFile().hasNoDefaultLib) nested.push(checker.getTypeOfSymbolAtLocation(prop, d))
      }
      for (const sig of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
        if (sig.getDeclaration()?.getSourceFile().hasNoDefaultLib) continue
        nested.push(checker.getReturnTypeOfSignature(sig), ...(sig.typeParameters ?? []))
        for (const prop of sig.parameters) {
          const d = prop.valueDeclaration ?? prop.declarations?.[0]
          if (d) nested.push(checker.getTypeOfSymbolAtLocation(prop, d))
        }
      }
      for (const index of checker.getIndexInfosOfType(type)) nested.push(index.type, index.keyType)
      }
    }
    return nested.some(t => erroneous(t, seen, expanded))
  }
  const checks = []
  const imports = []
  const bridges = new Map()
  let counter = 0
  const printer = ts.createPrinter()
  const sourceExports = (file, entry, side) => {
    const sf = program.getSourceFile(file)
    if (!sf) {
      result.environmentDiagnostics.push({ entrypoint: entry, side, file, blocking: true, diagnostic: "Published declaration not found: " + file })
      return new Map()
    }
    // JSON is bound as an export-equals module even though its syntax is not
    // recognized by getSymbolAtLocation(SourceFile).
    const sym = checker.getSymbolAtLocation(sf) ?? (ts.isJsonSourceFile(sf) ? sf.symbol : undefined)
    if (!sym) {
      result.environmentDiagnostics.push({ entrypoint: entry, file, blocking: true, diagnostic: "Published declaration is not an external module: " + file })
      return new Map()
    }
    // export = is not included in getExportsOfModule.
    const exp = sym.exports?.get("export=")
    const exports = new Map(exp ? [["export=", exp]] : checker.getExportsOfModule(sym).map(s => [s.name, s]))
    exports.runtime = runtimeExports(sym)
    if (exp) exports.runtime.add("export=")
    return exports
  }
  function runtimeExports(module, trail = new Set()) {
    if (trail.has(module)) return new Set()
    trail = new Set([...trail, module])
    const source = module.declarations?.find(ts.isSourceFile)
    const runtime = new Set()
    const unalias = s => s?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s
    for (const symbol of checker.getExportsOfModule(module)) {
      if (!(symbol.flags & ts.SymbolFlags.Alias) && symbol.flags & ts.SymbolFlags.Value &&
          symbol.declarations?.some(d => d.getSourceFile() === source)) runtime.add(symbol.name)
    }
    for (const statement of source?.statements ?? []) {
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) runtime.add("default")
      if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue
      const clause = statement.exportClause
      const target = statement.moduleSpecifier && checker.getSymbolAtLocation(statement.moduleSpecifier)
      const available = target ? runtimeExports(target, trail) : undefined
      if (!clause) {
        for (const name of available ?? []) if (name !== "default") runtime.add(name)
      } else if (ts.isNamespaceExport(clause)) runtime.add(clause.name.text)
      else for (const specifier of clause.elements) {
        if (specifier.isTypeOnly) continue
        const name = (specifier.propertyName ?? specifier.name).text
        if (available ? available.has(name) : (() => {
          const local = checker.getExportSpecifierLocalTargetSymbol(specifier)
          return local && !checker.getTypeOnlyAliasDeclaration?.(local) && unalias(local).flags & ts.SymbolFlags.Value
        })()) runtime.add(specifier.name.text)
      }
    }
    return runtime
  }
  function recordCheck(entrypoint, name, a, b, aspect) {
    checks.push({ entrypoint, export: name, aspect, a, b })
  }
  function memberDocs(symbol) {
    const found = new Map(), seen = new Set()
    const own = s => s?.declarations?.some(d => [before, after].some(base =>
      (d.getSourceFile().fileName === base || d.getSourceFile().fileName.startsWith(base + "/")) &&
      !d.getSourceFile().fileName.includes("/node_modules/")))
    const walk = (type, path) => {
      const identity = type?.target ?? type
      if (!type || seen.has(identity)) return
      seen.add(identity)
      for (const property of checker.getPropertiesOfType(type).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!own(property)) continue
        const key = path + "." + property.name
        const text = docs(ts, checker, property)
        if (text) found.set(key, text)
        const declaration = property.valueDeclaration ?? property.declarations?.[0]
        if (declaration) walk(checker.getTypeOfSymbolAtLocation(property, declaration), key)
      }
      for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
        const declaration = signature.getDeclaration()
        if (declaration && [before, after].some(base => declaration.getSourceFile().fileName.startsWith(base + "/")))
          walk(checker.getReturnTypeOfSignature(signature), path + "()")
      }
    }
    if (symbol.flags & ts.SymbolFlags.Type) walk(checker.getDeclaredTypeOfSymbol(symbol), symbol.flags & ts.SymbolFlags.Class ? ".prototype" : "")
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (declaration && symbol.flags & ts.SymbolFlags.Value) walk(checker.getTypeOfSymbolAtLocation(symbol, declaration), "")
    return found
  }
  function visit(a, b, apath, bpath, entrypoint, name, trail = new Set()) {
    const unalias = s => s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s
    const adoc = docs(ts, checker, a) || docs(ts, checker, unalias(a))
    const bdoc = docs(ts, checker, b) || docs(ts, checker, unalias(b))
    if (adoc !== bdoc) result.docDifferences.push({ entrypoint, export: name, before: adoc, after: bdoc })
    a = unalias(a); b = unalias(b)
    if (inputDiagnostics.length || originalDiagnostics.length) {
      for (const symbol of [a, b]) {
        const d = symbol.valueDeclaration ?? symbol.declarations?.[0]
        const invalidParameter = symbol.declarations?.some(decl => decl.typeParameters?.some(parameter =>
          [parameter.constraint, parameter.default].some(type => type && erroneous(checker.getTypeAtLocation(type))) ||
          inputDiagnostics.some(diagnostic => diagnostic.file?.fileName === parameter.getSourceFile().fileName &&
            diagnostic.start >= parameter.pos && diagnostic.start < parameter.end)))
        if (invalidParameter || (symbol.flags & ts.SymbolFlags.Type && erroneous(checker.getDeclaredTypeOfSymbol(symbol))) ||
            (d && symbol.flags & ts.SymbolFlags.Value && erroneous(checker.getTypeOfSymbolAtLocation(symbol, d))))
          invalidExports.push({ entrypoint, export: name, blocking: true, diagnostic: "Compared export depends on an unresolved or erroneous type; identity probe cannot establish its API." })
      }
    }
    const amembers = memberDocs(a), bmembers = memberDocs(b)
    for (const key of [...new Set([...amembers.keys(), ...bmembers.keys()])].sort()) {
      if (amembers.get(key) !== bmembers.get(key)) result.docDifferences.push({
        entrypoint, export: name + key, before: amembers.get(key) ?? "", after: bmembers.get(key) ?? ""
      })
    }
    const amask = a.flags & (ts.SymbolFlags.Type | ts.SymbolFlags.Value | ts.SymbolFlags.Namespace)
    const bmask = b.flags & (ts.SymbolFlags.Type | ts.SymbolFlags.Value | ts.SymbolFlags.Namespace)
    for (const [flag, aspect] of [[ts.SymbolFlags.Value, "value"], [ts.SymbolFlags.Type, "type"]]) {
      if (!!(amask & flag) !== !!(bmask & flag)) {
        result.nameDifferences.push({ entrypoint, export: name, meaning: aspect, side: amask & flag ? "before" : "after" })
        continue
      }
      if (!(amask & flag)) continue
      if (aspect === "value") recordCheck(entrypoint, name, "typeof " + apath, "typeof " + bpath, aspect)
      else {
        const bridge = (symbol, path) => {
          const decl = symbol.declarations?.find(d => d.typeParameters?.length)
          if (!decl) return path
          const source = decl.getSourceFile()
          const id = "__api_identity_" + counter++
          const params = decl.typeParameters.map(parameter => {
            // Variance belongs to the original class/interface/type alias.
            // A generic function bridge cannot carry in/out modifiers.
            const legal = ts.factory.updateTypeParameterDeclaration(parameter,
              parameter.modifiers?.filter(modifier => modifier.kind !== ts.SyntaxKind.InKeyword && modifier.kind !== ts.SyntaxKind.OutKeyword),
              parameter.name, parameter.constraint, parameter.default)
            return printer.printNode(ts.EmitHint.Unspecified, legal, source)
          }).join(", ")
          const args = decl.typeParameters.map(p => p.name.text).join(", ")
          // Append where the exported symbol is defined, with its local name.
          let local = decl.name?.text ?? symbol.name
          for (let parent = decl.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
            if (ts.isModuleDeclaration(parent)) local = parent.name.text + "." + local
          }
          const exportAssignment = source.statements.some(s => ts.isExportAssignment(s) && s.isExportEquals)
          const definition = `export type ${id} = <${params}>() => ${local}<${args}>;`
          const text = exportAssignment
            ? `\ndeclare namespace ${local} { ${definition} }\n`
            : `\n${definition}\n`
          bridges.set(source.fileName, (bridges.get(source.fileName) ?? source.text) + text)
          return `import(${JSON.stringify(slash(source.fileName))}).${id}`
        }
        recordCheck(entrypoint, name, bridge(a, apath), bridge(b, bpath), aspect)
      }
    }
    // Member documentation is observable even when its type is unchanged.
    const members = (symbol) => {
      const out = new Map()
      for (const table of [symbol.members, symbol.exports]) {
        for (const [key, member] of table ?? []) {
          if (key === "prototype" || key.startsWith("__")) continue
          const doc = docs(ts, checker, member)
          if (doc) out.set(key, doc)
        }
      }
      return out
    }
    const amd = members(a), bmd = members(b)
    for (const child of new Set([...amd.keys(), ...bmd.keys()])) {
      if ((amd.get(child) ?? "") !== (bmd.get(child) ?? ""))
        result.docDifferences.push({ entrypoint, export: name + "." + child, before: amd.get(child) ?? "", after: bmd.get(child) ?? "" })
    }
    // A namespace's runtime shape omits type-only members.
    if (((amask | bmask) & ts.SymbolFlags.Namespace) && !((a.flags | b.flags) & ts.SymbolFlags.Enum)) {
      if (trail.has(a) || trail.has(b)) return
      trail = new Set([...trail, a, b])
      const ae = new Map(checker.getExportsOfModule(a).map(s => [s.name, s]))
      const be = new Map(checker.getExportsOfModule(b).map(s => [s.name, s]))
      for (const child of [...new Set([...ae.keys(), ...be.keys()])].sort()) {
        if (!ae.has(child) || !be.has(child)) result.nameDifferences.push({ entrypoint, export: name + "." + child, side: ae.has(child) ? "before" : "after" })
        else visit(ae.get(child), be.get(child), apath + "." + child, bpath + "." + child, entrypoint, name + "." + child, trail)
      }
    }
  }
  for (const key of keys) {
    if (!left[key] || !right[key]) {
      result.nameDifferences.push({ entrypoint: key, export: "*", side: left[key] ? "before" : "after" })
      continue
    }
    const a = sourceExports(left[key], key, "before"), b = sourceExports(right[key], key, "after")
    for (const name of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      if (!a.has(name) || !b.has(name)) result.nameDifferences.push({ entrypoint: key, export: name, side: a.has(name) ? "before" : "after" })
      else {
        if (a.runtime?.has(name) !== b.runtime?.has(name))
          result.nameDifferences.push({ entrypoint: key, export: name, meaning: "runtime value", side: a.runtime?.has(name) ? "before" : "after" })
        const ref = (path, name) => {
          if (name === "export=") {
            const alias = "__api_export_" + counter++
            imports.push(`import type ${alias} from ${JSON.stringify(slash(path))};`)
            return alias
          }
          if (ts.isIdentifierText(name, ts.ScriptTarget.Latest)) return `import(${JSON.stringify(slash(path))}).${name}`
          const alias = "__api_export_" + counter++
          imports.push(`import type { ${JSON.stringify(name)} as ${alias} } from ${JSON.stringify(slash(path))};`)
          return alias
        }
        visit(a.get(name), b.get(name), ref(left[key], name), ref(right[key], name), key, name)
      }
    }
  }
  for (const [path, text] of bridges) virtual.set(resolve(path), text)
  for (const [from, to] of equivalents) {
    const text = bridges.get(from)
    if (text) {
      const original = program.getSourceFile(from).text
      virtual.set(to, (virtual.get(to) ?? host.readFile(to)) + text.slice(original.length))
    }
  }
  const resolveModules = host.resolveModuleNames
  host.resolveModuleNames = (names, file, modes) => resolveModules(names, file, modes).map(resolved => resolved &&
    { ...resolved, resolvedFileName: equivalents.get(resolved.resolvedFileName) ?? resolved.resolvedFileName })
  const lines = [...imports, ...identityPrelude.split("\n")]
  const byLine = new Map()
  const assignmentLines = new Map()
  for (const check of checks) {
    byLine.set(lines.length, check)
    lines.push(`type __check${byLine.size} = __Assert<__Same<${check.a}, ${check.b}>>;`)
    assignmentLines.set(lines.length, check)
    lines.push(`type __assign${byLine.size} = __Assert<__Assignable<${check.a}, ${check.b}>>;`)
  }
  virtual.set(probe, lines.join("\n"))
  program = ts.createProgram([...roots, probe], compilerOptions, host)
  const diagnosticText = d => "TS" + d.code + ": " + ts.flattenDiagnosticMessageText(d.messageText, "\n")
  const diagnostics = [...originalDiagnostics, ...inputDiagnostics, ...ts.getPreEmitDiagnostics(program)]
  const assignmentFailures = new Set(diagnostics.filter(d => d.file?.fileName === probe && d.start !== undefined)
    .map(d => assignmentLines.get(d.file.getLineAndCharacterOfPosition(d.start).line)).filter(Boolean))
  const seen = new Set()
  for (const d of diagnostics) {
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line : -1
    if (d.file?.fileName === probe && assignmentLines.has(line) && d.code === 2344) continue
    const check = d.file?.fileName === probe && d.code === 2344 ? byLine.get(line) : undefined
    const item = check
      ? { entrypoint: check.entrypoint, export: check.export, aspect: check.aspect, mutuallyAssignable: !assignmentFailures.has(check), diagnostic: diagnosticText(d), probe: lines[line] }
      : { diagnostic: diagnosticText(d), file: d.file?.fileName, line: line + 1,
          blocking: !d.file || d.file.fileName === probe || [before, after].some(base =>
            (d.file.fileName === base || d.file.fileName.startsWith(base + "/")) && !d.file.fileName.includes("/node_modules/")) }
    const key = JSON.stringify(item)
    if (!seen.has(key)) (check ? result.typeDifferences : result.environmentDiagnostics).push(item)
    seen.add(key)
  }
  for (const item of invalidExports) {
    const key = JSON.stringify(item)
    if (!seen.has(key)) result.environmentDiagnostics.push(item)
    seen.add(key)
  }
  result.comparisonComplete = !result.environmentDiagnostics.some(d => d.blocking)
  // No error-recovery probe result qualifies as an API difference.
  if (!result.comparisonComplete) result.typeDifferences = []
  result.identical = result.comparisonComplete && !result.nameDifferences.length && !result.typeDifferences.length && !result.docDifferences.length
  return result
}

export function formatResult(result) {
  return [
    ["Name differences", result.nameDifferences],
    ["Type differences", result.typeDifferences],
    ["Doc-comment differences", result.docDifferences],
    ["Environment diagnostics" + (result.comparisonComplete === false ? " (comparison unavailable)" : ""), result.environmentDiagnostics ?? []],
  ].map(([label, items]) => label + ":\n" + (items.length ? items.map(x => "  " + JSON.stringify(x)).join("\n") : "  (none)")).join("\n")
}

function main(args) {
  if (args.includes("--help")) {
    console.log("node scripts/api-identity.mjs --before <dir|package> --after <dir|package> [--json]")
    return 0
  }
  const values = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") values.json = true
    else if (["--before", "--after"].includes(args[i]) && args[i + 1]) values[args[i].slice(2)] = args[++i]
    else throw new Error("Unknown or incomplete argument: " + args[i])
  }
  if (!values.before || !values.after) throw new Error("--before and --after are required")
  const ts = loadTypeScript([values.before, values.after])
  const result = compareApiIdentity(ts, values.before, values.after)
  console.log(values.json ? JSON.stringify(result, null, 2) : formatResult(result))
  return result.comparisonComplete === false ? 2 : result.identical ? 0 : 1
}
const evaluating = process.execArgv.some(arg => ["-e", "--eval", "-p", "--print"].includes(arg) ||
  arg.startsWith("--eval=") || arg.startsWith("--print="))
if (!evaluating && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)) }
  catch (error) { console.error(error.stack ?? error); process.exitCode = 2 }
}
