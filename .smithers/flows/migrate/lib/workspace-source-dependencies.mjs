// Relative source and test imports are package dependencies even when the
// consumer has no workspace dependency in its manifest.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "./declarations.mjs"

const script = /\.(?:[cm]?[jt]sx?|vibe|vibex)$/
const generated = /(?:\.d\.[cm]?ts|\.d\.(?:vibe|vibex)\.ts|\.(?:vibe|vibex)\..*\.d\.ts)$/
const skipped = name => name === "node_modules" || name.startsWith(".") || ["dist", "build", "out", "coverage", "templates"].includes(name)
const physical = file => { try { return realpathSync(file) } catch { return undefined } }

export function sourcePackageDependencies(root, packages) {
  const base = realpathSync(resolve(root)), byPath = new Map(packages.map(pkg => [physical(resolve(base, pkg.dir)), pkg]))
  byPath.delete(undefined)
  const imports = new Map(packages.map(pkg => [pkg.dir, new Set()]))
  let ts
  const owner = file => {
    for (let at = dirname(file); ; at = dirname(at)) {
      if (byPath.has(at)) return byPath.get(at)
      if (at === base || dirname(at) === at) return undefined
    }
  }
  const dependency = (from, specifier) => {
    const target = resolve(dirname(from), specifier)
    // Native extensions name the implementation; TypeScript reads its
    // declaration sidecar instead.
    if (/\.(?:vibe|vibex)$/.test(target) && existsSync(target)) return physical(target)
    const result = ts.resolveModuleName(specifier, from, {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowArbitraryExtensions: true
    }, ts.sys).resolvedModule?.resolvedFileName
    if (result) return physical(result)
    if (!extname(target)) {
      for (const suffix of [".vibe", ".vibex", "/index.vibe", "/index.vibex"]) {
        if (existsSync(target + suffix)) return physical(target + suffix)
      }
    }
  }
  for (const pkg of packages) {
    const at = resolve(base, pkg.dir)
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name)
        if (entry.isDirectory()) {
          // A nested package is scanned with its own manifest. A fixture
          // package outside the workspace does not belong to this package.
          if (!skipped(entry.name) && !existsSync(join(file, "package.json"))) walk(file)
        } else if (entry.isFile() && script.test(entry.name) && !generated.test(entry.name)) {
          ts ??= loadTypeScript([base,
            fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url)),
            fileURLToPath(new URL("../../../../docs/tools/", import.meta.url))])
          for (const imported of ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles) {
            if (!imported.fileName.startsWith(".")) continue
            const target = dependency(file, imported.fileName)
            if (!target || relative(base, target).startsWith("..")) continue
            const to = owner(target)
            if (to && to.dir !== pkg.dir) imports.get(pkg.dir).add(to.dir)
          }
        }
      }
    }
    walk(at)
  }
  return imports
}

