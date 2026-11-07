// Reconstruct a read-only declaration snapshot's original package layout.
// Every alias forwards to one stored declaration, preserving nominal identity.
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path"
import { tmpdir } from "node:os"

const slash = path => path.split(sep).join("/")
const declaration = path => {
  if (/\.d\.(?:vibex?\.)?[cm]?ts$/.test(path)) return path
  if (/\.vibex?$/.test(path)) return path.replace(/\.(vibex?)$/, ".d.$1.ts")
  return path.replace(/\.[cm]?[jt]sx?$/, extension =>
    extension === ".mts" || extension === ".mjs" ? ".d.mts" : extension === ".cts" || extension === ".cjs" ? ".d.cts" : ".d.ts")
}
const specifier = path => {
  // Keep the `.d` in the stem: under moduleSuffixes, `./x.js` tries the sidecar
  // x.d.vibe.ts before x.d.ts, so a forwarder there would export itself.
  const output = slash(path).replace(/\.d\.(vibex?)\.ts$/, ".$1").replace(/\.d\.mts$/, ".d.mjs").replace(/\.d\.cts$/, ".d.cjs").replace(/\.d\.ts$/, ".d.js")
  return output.startsWith(".") ? output : "./" + output
}
// A declaration map trailer describes a stored file, not its exported surface.
// Parse the declaration before scanning its trailing trivia, so map-looking
// text in template literal types and block comments remains significant.
function snapshotWithoutMapTrailer(ts, text) {
  if (typeof ts.createSourceFile !== "function" || typeof ts.createScanner !== "function") return { text, metadata: false }
  const source = ts.createSourceFile("snapshot.d.ts", text, ts.ScriptTarget.Latest, true)
  if (source.parseDiagnostics.length) return { text, metadata: false }
  const end = source.statements.at(-1)?.end ?? 0
  const trailing = text.slice(end)
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, trailing)
  let output = "", copied = 0, metadata = false
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia || !/^\/\/[#@][ \t]*sourceMappingURL=/.test(scanner.getTokenText())) continue
    output += trailing.slice(copied, scanner.getTokenPos())
    copied = scanner.getTextPos()
    metadata = true
  }
  return metadata ? { text: (text.slice(0, end) + output + trailing.slice(copied)).trimEnd(), metadata }
    : { text, metadata }
}
function sameSnapshotDeclaration(ts, left, right) {
  if (left === right) return true
  const a = snapshotWithoutMapTrailer(ts, left), b = snapshotWithoutMapTrailer(ts, right)
  return (a.metadata || b.metadata) && a.text.trimEnd() === b.text.trimEnd()
}

export function apiProjection(ts, directory, surface, files, { published = true, absentSources: comparable } = {}) {
  const metadata = surface?.apiMetadata
  const original = resolve(directory)
  const direct = { directory: original, originals: new Map(files.map(file => [file, file])),
    destinations: new Map(files.map(file => [file, file])), projectContexts: [], cleanup() {} }
  if (!metadata) return direct
  const temporary = resolve(mkdtempSync(join(tmpdir(), "migrate-api-projection-")))
  const ancestors = []
  for (let cursor = resolve(metadata.packageDir); ; cursor = dirname(cursor)) {
    ancestors.push(cursor)
    if (dirname(cursor) === cursor) break
  }
  const root = join(temporary, ...ancestors.map((_, index) => "level-" + index))
  mkdirSync(root, { recursive: true })
  // Mirror Node's ancestor search without copying or changing installed packages.
  let projected = root
  for (const ancestor of ancestors) {
    const modules = join(ancestor, "node_modules")
    if (existsSync(modules)) symlinkSync(modules, join(projected, "node_modules"), "junction")
    projected = dirname(projected)
  }
  const originals = new Map(), destinations = new Map()
  const path = name => {
    const output = resolve(root, name)
    // Sibling declarations may live above the package, inside its mirrored
    // ancestors. The temporary directory bounds that whole isolated layout.
    const escaped = () => { throw new Error("Declaration snapshot path escapes its comparison projection: " + name) }
    if (!output.startsWith(temporary + sep)) escaped()
    // Ancestor node_modules links are resolution inputs, never write targets.
    for (let cursor = dirname(output); cursor !== temporary; cursor = dirname(cursor))
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) escaped()
    return output
  }
  const put = (name, text) => { const file = path(name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
  try {
    for (const file of files) {
      const layout = (metadata.layouts ?? []).filter(entry => typeof entry.directory === "string" &&
        (entry.prefix === "." || file.startsWith(entry.prefix + "/"))).sort((a,b) => b.prefix.length - a.prefix.length)[0]
      // A layout directory above the package re-enters it by its real name,
      // which the projection's ancestors do not have: resolve it there.
      const placed = layout && slash(relative(metadata.packageDir,
        resolve(metadata.packageDir, layout.directory, posix.relative(layout.prefix, file))))
      const destination = metadata.logicalPaths[file] ?? (layout ? placed || "." : file)
      const text = readFileSync(join(original, file), "utf8")
      if (originals.has(destination) && !sameSnapshotDeclaration(ts, readFileSync(path(destination), "utf8"), text))
        throw new Error("Conflicting declaration snapshot paths: " + destination)
      put(destination, text)
      originals.set(destination, file)
      destinations.set(file, destination)
    }
    for (const [name, target] of Object.entries(metadata.aliases)) {
      const destination = declaration(name)
      if (!/\.d\.(?:vibex?\.)?[cm]?ts$/.test(destination)) continue
      const physical = destinations.get(target)
      if (!physical) throw new Error("Declaration snapshot alias has no stored target: " + name)
      if (originals.has(destination)) {
        // Explicit logical-path provenance can store the same declaration
        // twice. Their declarations were checked above; a different owner still fails.
        if (originals.get(destination) !== target && destination !== physical)
          throw new Error("Conflicting declaration snapshot alias: " + name)
        continue
      }
      const source = ts.createSourceFile(target, readFileSync(path(physical), "utf8"), ts.ScriptTarget.Latest, true)
      const reference = JSON.stringify(specifier(relative(dirname(path(destination)), path(physical))))
      const equals = source.statements.some(node => ts.isExportAssignment(node) && node.isExportEquals)
      const hasDefault = source.statements.some(node =>
        ts.isExportAssignment(node) && !node.isExportEquals ||
        node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword) ||
        ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(element => element.name.text === "default"))
      put(destination, equals ? `import original = require(${reference}); export = original;\n`
        : `export * from ${reference};\n` + (hasDefault ? `export { default } from ${reference};\n` : ""))
      originals.set(destination, target)
    }
    // A module that emitted no declaration is read from its saved source.
    const absentSources = {}
    for (const [absent, { source, stored }] of Object.entries(metadata.absentSources ?? {})) {
      if (comparable && !comparable.includes(absent)) continue
      put(source, readFileSync(join(original, stored), "utf8"))
      originals.set(source, stored)
      absentSources[absent] = path(source)
    }
    // Native source targets in conditional exports are exact paths. Resolve
    // only recorded source aliases through the declarations reconstructed
    // above, retaining condition order and the rest of the package manifest.
    const sourceConditions = value => {
      if (Array.isArray(value)) return value.map(sourceConditions)
      if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sourceConditions(child)]))
      if (typeof value !== "string" || !value.startsWith("./") || !/\.(?:[cm]?ts|tsx|vibex?)$/.test(value)) return value
      const name = posix.normalize(value)
      if (!Object.hasOwn(metadata.aliases, name)) return value
      return "./" + declaration(name)
    }
    const manifest = { ...(published ? { ...metadata.manifest, ...metadata.manifest.publishConfig } : metadata.manifest) }
    for (const field of ["exports", "imports", "types", "typings"])
      if (Object.hasOwn(manifest, field)) manifest[field] = sourceConditions(manifest[field])
    put("package.json", JSON.stringify(manifest))
    const projectContexts = []
    for (const saved of metadata.projectContexts ?? []) {
      const originalBase = resolve(metadata.packageDir, saved.directory)
      const compilerOptions = { ...saved.compilerOptions }
      // Installed type packages remain pinned resolution inputs. Project
      // paths instead follow the isolated, frozen declaration tree.
      for (const name of ["typeRoots", "baseUrl", "rootDirs"]) {
        if (compilerOptions[name] === undefined) continue
        const installed = value => {
          const absolute = resolve(originalBase, value)
          return slash(absolute).includes("/node_modules/") ? absolute : value
        }
        compilerOptions[name] = Array.isArray(compilerOptions[name])
          ? compilerOptions[name].map(installed) : installed(compilerOptions[name])
      }
      // Absolute project aliases must not fall back to mutable source files.
      // Dependency targets remain the installed resolution inputs.
      if (compilerOptions.paths) compilerOptions.paths = Object.fromEntries(
        Object.entries(compilerOptions.paths).map(([name, targets]) => [name, targets.map(value =>
          isAbsolute(value) && !slash(value).includes("/node_modules/")
            ? path(relative(metadata.packageDir, value)) : value)]))
      const directory = path(saved.directory)
      const parsed = ts.convertCompilerOptionsFromJson(compilerOptions, directory, undefined, join(directory, "__snapshot_context__.json"))
      parsed.options.configFilePath = join(directory, "__snapshot_context__.json")
      if (compilerOptions.paths && compilerOptions.baseUrl === undefined) {
        const name = saved.pathsBase ?? saved.directory, absolute = resolve(metadata.packageDir, name)
        parsed.options.pathsBasePath = slash(absolute).includes("/node_modules/") ? absolute : path(name)
      }
      if (parsed.errors.length) throw new Error("Invalid recorded declaration project options: " +
        parsed.errors.map(error => "TS" + error.code).join(", "))
      const owners = new Set(saved.files)
      const projectedFiles = [...originals].filter(([, owner]) => owners.has(owner)).map(([file]) => path(file))
      if (projectedFiles.length) projectContexts.push({ directory, compilerOptions: parsed.options, files: projectedFiles })
    }
    // A file placed off the package's ancestor chain, such as a saved source in
    // a sibling package, resolves bare imports from its own directories first.
    const chain = new Set(ancestors)
    for (const name of originals.keys()) {
      let real = dirname(resolve(metadata.packageDir, name)), copy = dirname(path(name))
      for (; !chain.has(real) && copy.startsWith(temporary + sep); real = dirname(real), copy = dirname(copy)) {
        const modules = join(real, "node_modules"), link = join(copy, "node_modules")
        if (!slash(real).includes("/node_modules/") && existsSync(modules) && !existsSync(link))
          symlinkSync(modules, link, "junction")
      }
    }
    // A declaration may import another workspace package's module by a
    // relative path that leaves this package, as a flow imports
    // ../../../packages/x/src/Bridge.js. The projection mirrors only this
    // package and its ancestors' node_modules, so link the tree's directory
    // where that path leaves the package's ancestors. The import then
    // resolves as it does in the tree, to the same file on both sides.
    const providerExists = target => [target, join(target, "index.ts"), join(target, "index.d.ts"),
      ...[".ts", ".tsx", ".d.ts", ".mts", ".d.mts", ".cts", ".d.cts"].map(extension => target.replace(/\.[cm]?jsx?$/, "") + extension)].some(file => existsSync(file))
    for (const entry of surface.unresolved ?? []) {
      const at = entry.indexOf(": ")
      const placed = at > 0 && destinations.get(entry.slice(0, at)), specifier = entry.slice(at + 2)
      if (!placed || !/^\.\.?\//.test(specifier)) continue
      const target = resolve(metadata.packageDir, dirname(placed), specifier)
      // The deepest ancestor holding the target; 0 is the package itself.
      const index = ancestors.findIndex(ancestor => target.startsWith(ancestor === sep ? sep : ancestor + sep))
      if (index <= 0 || !providerExists(target)) continue
      // Only another package's module: a file of this project above its
      // tsconfig has a declaration of its own, or a recorded reason it has none.
      let owner = dirname(target)
      while (owner !== ancestors[index] && !existsSync(join(owner, "package.json"))) owner = dirname(owner)
      if (owner === ancestors[index]) continue
      const top = join(ancestors[index], relative(ancestors[index], target).split(sep)[0])
      if (basename(top) === "node_modules") continue
      let mirror = root
      for (let level = 0; level < index; level++) mirror = dirname(mirror)
      const link = join(mirror, basename(top))
      if (!existsSync(link)) symlinkSync(top, link, "junction")
    }
    return { directory: root, originals, destinations, projectContexts, absentSources,
      cleanup() { rmSync(temporary, { recursive: true, force: true }) } }
  } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error }
}
