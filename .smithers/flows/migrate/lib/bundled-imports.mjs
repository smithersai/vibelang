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

export const routePrefix = "#vibelang/emitted/"
const routeKey = routePrefix + "*"
const nativeSource = /(?<!\.d)\.(?:[cm]?ts)$/
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
 * back and drops the entry. Returns the files changed and the routed modules.
 */
export function routeBundledImports({ root, packages, ts, compiler, restore = false, bundled }) {
  const changed = [], modules = new Set()
  const vibes = packages.flatMap(pkg => listSources(root, pkg.dir).filter(file => file.endsWith(".vibe")))
  const reached = bundled ?? new Set(restore ? [] : testBundleDeferrals(root, vibes, { ts }).map(item => item.file))
  const generated = value => value && typeof value === "object" &&
    typeof value["vibelang-source"] === "string" && typeof value.default === "string" &&
    value.default.startsWith("./.vibelang/js/")
  for (const pkg of packages) {
    const dir = pkg.dir, sources = listSources(root, dir), all = new Set(sources)
    const manifest = join(root, dir, "package.json")
    if (!existsSync(manifest)) continue
    const before = readFileSync(manifest, "utf8"), json = JSON.parse(before)
    const inPackage = file => dir === "." ? file : posix.relative(dir, file)
    const sidecars = existsSync(join(root, dir, ".vibe/declarations"))
    const targets = new Map(), used = new Set()
    const targetFor = (source, path) => ({
      types: source.endsWith(".vibe")
        ? "./" + (sidecars ? ".vibe/declarations/" : "") + path + ".d.vibe.ts"
        : "./" + inPackage(source),
      "vibelang-source": "./" + inPackage(source),
      default: "./.vibelang/js/" + path + ".js"
    })
    const keep = (key, source) => {
      used.add(key)
      const prior = json.imports?.[key]
      // Exact routes from normal project emission retain their own output.
      if (prior && typeof prior === "object" && typeof prior["vibelang-source"] === "string") {
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
        if (restore || !owned(file)) continue
        const source = resolveRelative(file, edge.specifier, all)
        if (!source?.endsWith(".vibe") || !reached.has(source)) continue
        const path = inPackage(source).replace(/\.vibe$/, "")
        if (!existsSync(join(root, dir, ".vibelang/js", path + ".js"))) continue
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
  return { changed, modules: [...modules].sort() }
}
