// Reconstruct a read-only declaration snapshot's original package layout.
// Every alias forwards to one stored declaration, preserving nominal identity.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, posix, relative, resolve, sep } from "node:path"
import { tmpdir } from "node:os"

const slash = path => path.split(sep).join("/")
const declaration = path => /\.d\.(?:vibe\.)?[cm]?ts$/.test(path) ? path
  : path.replace(/\.vibe$/, ".d.vibe.ts").replace(/\.[cm]?[jt]sx?$/, extension =>
    extension === ".mts" || extension === ".mjs" ? ".d.mts" : extension === ".cts" || extension === ".cjs" ? ".d.cts" : ".d.ts")
const specifier = path => {
  const output = slash(path).replace(/\.d\.vibe\.ts$/, ".vibe").replace(/\.d\.mts$/, ".mjs").replace(/\.d\.cts$/, ".cjs").replace(/\.d\.ts$/, ".js")
  return output.startsWith(".") ? output : "./" + output
}
export function apiProjection(ts, directory, surface, files, { published = true } = {}) {
  const metadata = surface?.apiMetadata
  const original = resolve(directory)
  const direct = { directory: original, originals: new Map(files.map(file => [file, file])),
    destinations: new Map(files.map(file => [file, file])), cleanup() {} }
  if (!metadata) return direct
  const temporary = mkdtempSync(join(tmpdir(), "migrate-api-projection-"))
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
    if (!output.startsWith(root + sep)) throw new Error("Declaration snapshot path escapes its comparison projection: " + name)
    return output
  }
  const put = (name, text) => { const file = path(name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
  try {
    for (const file of files) {
      const layout = (metadata.layouts ?? []).filter(entry => typeof entry.directory === "string" &&
        (entry.prefix === "." || file.startsWith(entry.prefix + "/"))).sort((a,b) => b.prefix.length - a.prefix.length)[0]
      const destination = metadata.logicalPaths[file] ?? (layout ? posix.join(layout.directory, posix.relative(layout.prefix, file)) : file)
      const text = readFileSync(join(original, file), "utf8")
      if (originals.has(destination) && readFileSync(path(destination), "utf8") !== text)
        throw new Error("Conflicting declaration snapshot paths: " + destination)
      put(destination, text)
      originals.set(destination, file)
      destinations.set(file, destination)
    }
    for (const [name, target] of Object.entries(metadata.aliases)) {
      const destination = declaration(name)
      if (!/\.d\.(?:vibe\.)?[cm]?ts$/.test(destination)) continue
      const physical = destinations.get(target)
      if (!physical) throw new Error("Declaration snapshot alias has no stored target: " + name)
      if (originals.has(destination)) {
        if (originals.get(destination) !== target) throw new Error("Conflicting declaration snapshot alias: " + name)
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
    put("package.json", JSON.stringify(published ? { ...metadata.manifest, ...metadata.manifest.publishConfig } : metadata.manifest))
    return { directory: root, originals, destinations,
      cleanup() { rmSync(temporary, { recursive: true, force: true }) } }
  } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error }
}
