// An unchanged `Bun.build` or `bun build` in a test reads a relative `./x.vibe`
// as a file asset: "No matching export". No hook reaches them: `bun build` has no
// plugin or preload, and tsconfig `paths` skip relative specifiers. A package
// import does reach them, so a TypeScript module a test bundles names its
// `.vibe` dependency through one, whose `default` is the committed emitted
// JavaScript. Tests stay as they are, and the tool, test and type-checker
// conditions keep reading the source.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { runtimeEdges } from "./emitted-imports.mjs"
import { applyEdits, resolveRelative } from "./imports.mjs"
import { isFixtureFile, isTestFile, listSources } from "./inventory.mjs"
import { testBundleDeferrals } from "./test-bundles.mjs"
import { packageDirOf } from "./codemod.mjs"
import { packageScripts, testOnlyScripts } from "./test-files.mjs"

export const routePrefix = "#vibelang/emitted/"
const routeKey = routePrefix + "*"
const nativeSource = /(?<!\.d)\.(?:[cm]?tsx?)$/
const owned = file => nativeSource.test(file) && !/\.d\.vibe\.ts$/.test(file) && !isTestFile(file) && !isFixtureFile(file)

const route = sidecars => ({
  types: sidecars ? "./.vibe/declarations/*.d.vibe.ts" : "./*.d.vibe.ts",
  "vibelang-source": "./*.vibe",
  default: "./.vibelang/js/*.js"
})

const relativeTo = (file, target) => {
  const path = posix.relative(posix.dirname(file), target)
  return path.startsWith(".") ? path : "./" + path
}

/**
 * Routes each value edge from a package's TypeScript module to a `.vibe` module
 * a test bundles (testBundleDeferrals) through `#vibelang/emitted/*`, for
 * modules with committed emitted JavaScript. restore puts every routed edge
 * back and drops the entry. With native, every owned native value edge is
 * eligible: an opaque entry argument in an unchanged test cannot establish a
 * complete bundle graph, and bare Node children have no inherited loader.
 * outputs, when supplied, is the actual compiler output map, repository-relative.
 * Returns changed files, routed modules and unresolved-output warnings.
 */
export function routeBundledImports({ root, packages, ts, compiler, restore = false, bundled, native = false, outputs }) {
  const changed = [], modules = new Set(), warnings = []
  const vibes = packages.flatMap(pkg => listSources(root, pkg.dir).filter(file => file.endsWith(".vibe")))
  const reached = bundled ?? new Set(restore ? [] : native ? vibes : testBundleDeferrals(root, vibes, { ts }).map(item => item.file))
  const generated = value => value && typeof value === "object" &&
    typeof value["vibelang-source"] === "string" && typeof value.default === "string" &&
    value.default.startsWith("./.vibelang/js/")
  for (const pkg of packages) {
    const dir = pkg.dir, sources = listSources(root, dir).filter(file => packageDirOf(root, file) === dir), all = new Set(sources)
    const manifest = join(root, dir, "package.json")
    if (!existsSync(manifest)) continue
    const before = readFileSync(manifest, "utf8"), json = JSON.parse(before)
    const protectedFiles = native ? testOnlyScripts(root, dir, packageScripts(root, dir), json) : new Set()
    const inPackage = file => dir === "." ? file : posix.relative(dir, file)
    const sidecars = existsSync(join(root, dir, ".vibe/declarations"))
    const targets = new Map(), used = new Set()
    const targetFor = (source, path) => ({
      types: source.endsWith(".vibe")
        ? "./" + (sidecars ? ".vibe/declarations/" : "") + path + ".d.vibe.ts"
        : "./" + inPackage(source),
      "vibelang-source": "./" + inPackage(source),
      default: outputs?.[source] ? "./" + posix.relative(dir, outputs[source]) : "./.vibelang/js/" + path + ".js"
    })
    const keep = (key, source) => {
      used.add(key)
      const prior = json.imports?.[key]
      // Exact routes from normal project emission retain their own output.
      if (prior && typeof prior === "object" && typeof prior["vibelang-source"] === "string") {
        const originalSource = posix.join(dir, prior["vibelang-source"])
        if (native && outputs && generated(prior) && originalSource.endsWith(".vibe")) {
          const output = outputs[originalSource]
          if (!output || !existsSync(join(root, output))) {
            warnings.push(posix.join(dir, "package.json") + ": missing emitted JavaScript for " + originalSource + " (" + key + ")")
          } else {
            targets.set(key, { ...prior, default: "./" + posix.relative(dir, output) })
            return
          }
        }
        targets.set(key, prior)
        return
      }
      if (prior) throw new Error(posix.join(dir, "package.json") + ": conflicting import " + key)
      const path = key.slice(routePrefix.length)
      source ??= [".vibe", ".ts", ".mts", ".cts"].map(ext => posix.join(dir, path + ext)).find(file => all.has(file))
      if (!source) throw new Error(posix.join(dir, "package.json") + ": emitted import " + key + " has no source counterpart")
      targets.set(key, targetFor(source, path))
    }
    // A previously native importer can itself become VibeLang. Keep its
    // existing routes even though only native value edges need rewriting.
    for (const file of sources.filter(file => owned(file) || file.endsWith(".vibe") && !isTestFile(file) && !isFixtureFile(file))) {
      const text = readFileSync(join(root, file), "utf8"), edits = []
      // A Vibe source only needs parsing to retain or restore an existing route.
      if (file.endsWith(".vibe") && !text.includes(routePrefix)) continue
      for (const edge of runtimeEdges(text, file, ts, compiler, root)) {
        if (edge.specifier.startsWith(routePrefix)) {
          if (restore) {
            const prior = json.imports?.[edge.specifier]
            const source = typeof prior?.["vibelang-source"] === "string"
              ? posix.join(dir, prior["vibelang-source"])
              : posix.join(dir, edge.specifier.slice(routePrefix.length) + ".vibe")
            edits.push({ start: edge.start, end: edge.end, text: relativeTo(file, source) })
          } else keep(edge.specifier)
          continue
        }
        if (restore || !owned(file) || protectedFiles.has(file)) continue
        const source = resolveRelative(file, edge.specifier, all)
        if (!source?.endsWith(".vibe") || !reached.has(source)) continue
        const path = inPackage(source).replace(/\.vibe$/, "")
        const output = outputs ? outputs[source] : posix.join(dir, ".vibelang/js", path + ".js")
        if (!output || !existsSync(join(root, output))) {
          if (native) warnings.push(file + ":" + (text.slice(0, edge.start).split("\n").length) + ": missing emitted JavaScript for " + source + "; the native load path remains unresolved")
          continue
        }
        const key = routePrefix + path
        keep(key, source)
        edits.push({ start: edge.start, end: edge.end, text: key })
        modules.add(source)
      }
      if (edits.length) {
        writeFileSync(join(root, file), applyEdits(text, edits))
        changed.push(file)
      }
    }
    const imports = { ...json.imports }
    const prior = imports[routeKey]
    if (prior && !restore && used.size && ![route(false), route(true)].some(value => JSON.stringify(value) === JSON.stringify(prior))) {
      throw new Error(posix.join(dir, "package.json") + ": conflicting import " + routeKey)
    }
    // Exact source paths let each package's native publication mapper apply
    // its src/outDir/declarationDir policy. A generic star loses that prefix.
    delete imports[routeKey]
    for (const [key, value] of Object.entries(imports)) {
      if (key.startsWith(routePrefix) && generated(value) && (restore || !used.has(key))) delete imports[key]
    }
    if (!restore) for (const [key, value] of targets) imports[key] = value
    if (JSON.stringify(imports) === JSON.stringify(json.imports ?? {})) continue
    if (Object.keys(imports).length) json.imports = imports
    else delete json.imports
    const after = JSON.stringify(json, null, 2) + "\n"
    if (after !== before) { writeFileSync(manifest, after); changed.push(posix.join(dir, "package.json")) }
  }
  return { changed, modules: [...modules].sort(), ...(warnings.length ? { warnings } : {}) }
}
