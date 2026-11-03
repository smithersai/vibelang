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
export function routeBundledImports({ root, packages, ts, restore = false, bundled }) {
  const changed = [], modules = new Set()
  const vibes = packages.flatMap(pkg => listSources(root, pkg.dir).filter(file => file.endsWith(".vibe")))
  const reached = bundled ?? new Set(restore ? [] : testBundleDeferrals(root, vibes, { ts }).map(item => item.file))
  for (const pkg of packages) {
    const dir = pkg.dir, sources = listSources(root, dir), all = new Set(sources)
    const inPackage = file => (dir === "." ? file : posix.relative(dir, file))
    let used = false
    for (const file of sources.filter(owned)) {
      const text = readFileSync(join(root, file), "utf8")
      const edits = []
      for (const edge of runtimeEdges(text, file, ts)) {
        if (restore) {
          if (!edge.specifier.startsWith(routePrefix)) continue
          const target = posix.join(dir, edge.specifier.slice(routePrefix.length) + ".vibe")
          edits.push({ start: edge.start, end: edge.end, text: relativeTo(file, target) })
          continue
        }
        if (edge.specifier.startsWith(routePrefix)) { used = true; continue }
        const target = resolveRelative(file, edge.specifier, all)
        if (!target?.endsWith(".vibe") || !reached.has(target)) continue
        const path = inPackage(target).replace(/\.vibe$/, "")
        if (!existsSync(join(root, dir, ".vibelang/js", path + ".js"))) continue
        edits.push({ start: edge.start, end: edge.end, text: routePrefix + path })
        modules.add(target)
        used = true
      }
      if (edits.length) {
        writeFileSync(join(root, file), applyEdits(text, edits))
        changed.push(file)
      }
    }
    const manifest = join(root, dir, "package.json")
    if (!existsSync(manifest)) continue
    const before = readFileSync(manifest, "utf8"), json = JSON.parse(before)
    if (restore || !used) {
      if (!json.imports || !(routeKey in json.imports)) continue
      delete json.imports[routeKey]
      if (!Object.keys(json.imports).length) delete json.imports
    } else {
      const next = route(existsSync(join(root, dir, ".vibe/declarations")))
      const prior = json.imports?.[routeKey]
      if (prior && JSON.stringify(prior) !== JSON.stringify(next)) throw new Error(posix.join(dir, "package.json") + ": conflicting import " + routeKey)
      json.imports = { ...json.imports, [routeKey]: next }
    }
    const after = JSON.stringify(json, null, 2) + "\n"
    if (after !== before) {
      writeFileSync(manifest, after)
      changed.push(posix.join(dir, "package.json"))
    }
  }
  return { changed, modules: [...modules].sort() }
}
