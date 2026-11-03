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

function filesUnder(dir) {
  const out = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".jj", ".git"].includes(item.name)) continue
    const path = join(dir, item.name)
    if (item.isDirectory()) out.push(...filesUnder(path))
    else if (declaration.test(item.name)) out.push(path)
  }
  return out.sort()
}

function declarationPath(path) {
  const candidates = declaration.test(path) ? [path] : [
    path.replace(/\.(?:[cm]?jsx?|tsx?|vibe)$/, ".d.ts"),
    path.replace(/\.mjs$/, ".d.mts"), path.replace(/\.cjs$/, ".d.cts"),
    path + ".d.ts", join(path, "index.d.ts"),
  ]
  return candidates.find(p => declaration.test(p) && existsSync(p))
}

/** Names are per published subpath AND types condition, never per private file.
 * Bare declaration trees have no publishing metadata: every file is an entry.
 * An explicit unresolved entry remains in the map and fails closed.
 */
export function publishedEntrypoints(directory) {
  directory = resolve(directory)
  if (statSync(directory).isFile()) return { ".": directory }
  const manifestFile = join(directory, "package.json")
  if (!existsSync(manifestFile)) return Object.fromEntries(filesUnder(directory).map(p => [slash(relative(directory, p)), p]))
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
  const entries = {}
  const all = filesUnder(directory)
  function add(key, target) {
    if (typeof target !== "string") return
    const path = resolve(directory, target)
    if (target.includes("*")) {
      const pieces = slash(path).split("*")
      const pattern = new RegExp("^" + pieces.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.*)") + "$")
      // Wildcard targets often name .js, while the tree contains .d.ts.
      const dpattern = new RegExp(pattern.source.replace(/\\\.js\$$/, "\\.d\\.ts$"))
      for (const file of all) {
        const match = slash(file).match(pattern) ?? slash(file).match(dpattern)
        if (match) entries[key.replace("*", match[1])] = file
      }
      if (!Object.keys(entries).some(k => k.startsWith(key.split("*")[0]))) entries[key] = path
    } else entries[key] = declarationPath(path) ?? path
  }
  function visit(value, key) {
    if (typeof value === "string") return add(key, value)
    if (Array.isArray(value)) return value.forEach((v, i) => visit(v, key + "#fallback" + i))
    if (!value || typeof value !== "object") return
    // A types condition replaces the corresponding runtime target.
    if (typeof value.types === "string") return add(key, value.types)
    for (const [condition, child] of Object.entries(value)) visit(child, key + "#" + condition)
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
  return entries
}

const normalized = text => text.replace(/\s+/gu, " ").trim()
function docs(ts, checker, symbol) {
  const text = normalized(ts.displayPartsToString(symbol.getDocumentationComment(checker)))
  const tags = symbol.getJsDocTags(checker).map(tag =>
    "@" + tag.name + " " + normalized(typeof tag.text === "string" ? tag.text : ts.displayPartsToString(tag.text)))
  return [text, ...tags].join("\n").trim()
}

const identityPrelude = `type __Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? ((<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false)
    : false;
type __Assert<T extends true> = T;
`

/** Compile a generated .ts probe. Generic type exports get a local bridge
 * inside their own declaration module, so constraints and private aliases
 * resolve in their original scope; a generic factory preserves constraints.
 * No files are written to either input tree.
 */
export function compareApiIdentity(ts, before, after, options = {}) {
  before = resolve(before); after = resolve(after)
  const entryMap = (base, supplied) => Object.fromEntries(Object.entries(supplied ?? publishedEntrypoints(base))
    .map(([key, path]) => [key, resolve(base, path)]))
  const left = entryMap(before, options.beforeEntrypoints)
  const right = entryMap(after, options.afterEntrypoints)
  const result = { identical: false, nameDifferences: [], typeDifferences: [], docDifferences: [] }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  const compilerOptions = {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
    noEmit: true, skipLibCheck: false, types: [], allowImportingTsExtensions: true,
    ...options.compilerOptions,
    strict: true, strictNullChecks: true, strictFunctionTypes: true, noImplicitAny: true, noImplicitThis: true,
    noEmit: true, skipLibCheck: false, allowSyntheticDefaultImports: true,
  }
  const virtual = new Map()
  const host = ts.createCompilerHost(compilerOptions)
  const read = host.readFile.bind(host)
  host.readFile = path => virtual.get(resolve(path)) ?? read(path)
  const originalExists = host.fileExists.bind(host)
  host.fileExists = path => virtual.has(resolve(path)) || originalExists(path)
  // Fuzz/case snapshots live outside their original package. Resolve their
  // external dependencies through the caller's pinned Effect install only
  // after ordinary package resolution has failed.
  const moduleRoots = options.moduleRoots ?? [process.env.EFFECT_NODE_MODULES, join(repo, "experiments/node_modules")].filter(Boolean)
  host.resolveModuleNames = (names, containingFile) => names.map(name => {
    let resolved = ts.resolveModuleName(name, containingFile, compilerOptions, host).resolvedModule
    if (!resolved && !name.startsWith(".") && !name.startsWith("/")) {
      for (const modules of moduleRoots) {
        resolved = ts.resolveModuleName(name, join(dirname(resolve(modules)), "__api_identity__.ts"), compilerOptions, host).resolvedModule
        if (resolved) break
      }
    }
    return resolved
  })
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
  const nominal = alignNominalIdentity(ts, program, before, after, join(repo, ".api-identity-brands.d.ts"), [left, right])
  if (nominal.size > 1) {
    for (const [path, text] of nominal) {
      virtual.set(path, text)
    }
    program = ts.createProgram(roots, compilerOptions, host)
  }
  const checker = program.getTypeChecker()
  const inputDiagnostics = ts.getPreEmitDiagnostics(program)
  const checks = []
  const imports = []
  const bridges = new Map()
  let counter = 0
  const printer = ts.createPrinter()
  const sourceExports = (file, entry, side) => {
    const sf = program.getSourceFile(file)
    if (!sf) {
      result.nameDifferences.push({ entrypoint: entry, export: "*", side, diagnostic: "Published declaration not found: " + file })
      return new Map()
    }
    const sym = checker.getSymbolAtLocation(sf)
    if (!sym) {
      result.typeDifferences.push({ entrypoint: entry, export: "*", diagnostic: "Published declaration is not an external module: " + file })
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
      if (!type || seen.has(type)) return
      seen.add(type)
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
    if (symbol.flags & ts.SymbolFlags.Type) walk(checker.getDeclaredTypeOfSymbol(symbol), "")
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
          const params = decl.typeParameters.map(p => printer.printNode(ts.EmitHint.Unspecified, p, source)).join(", ")
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
  const lines = [...imports, ...identityPrelude.split("\n")]
  const byLine = new Map()
  for (const check of checks) {
    byLine.set(lines.length, check)
    lines.push(`type __check${byLine.size} = __Assert<__Same<${check.a}, ${check.b}>>;`)
  }
  virtual.set(probe, lines.join("\n"))
  program = ts.createProgram([...roots, probe], compilerOptions, host)
  const diagnosticText = d => "TS" + d.code + ": " + ts.flattenDiagnosticMessageText(d.messageText, "\n")
  const seen = new Set()
  for (const d of [...originalDiagnostics, ...inputDiagnostics, ...ts.getPreEmitDiagnostics(program)]) {
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line : -1
    const check = d.file?.fileName === probe ? byLine.get(line) : undefined
    // Refuse unresolved/invalid inputs rather than proving identity of error-any.
    const item = check
      ? { entrypoint: check.entrypoint, export: check.export, aspect: check.aspect, diagnostic: diagnosticText(d), probe: lines[line] }
      : { entrypoint: "*", export: "*", diagnostic: diagnosticText(d), file: d.file?.fileName, line: line + 1 }
    const key = JSON.stringify(item)
    if (!seen.has(key)) result.typeDifferences.push(item)
    seen.add(key)
  }
  result.identical = !result.nameDifferences.length && !result.typeDifferences.length && !result.docDifferences.length
  return result
}

export function formatResult(result) {
  return [
    ["Name differences", result.nameDifferences],
    ["Type differences", result.typeDifferences],
    ["Doc-comment differences", result.docDifferences],
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
  return result.identical ? 0 : 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)) }
  catch (error) { console.error(error.stack ?? error); process.exitCode = 2 }
}
