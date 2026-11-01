// Which files of a package are its tests: setup never edits a test, a fixture
// a test uses, or a helper only tests import (decided detail 272), so the
// tests a migration is judged by run as their authors wrote them.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { posix } from "node:path"
import { parseImports } from "./imports.mjs"

// Directories a package walk skips: dependencies, hidden directories, output and templates.
const skipped = (name) => name === "node_modules" || name.startsWith(".") || name === "dist" || name === "templates" || name === "coverage"
const scriptFile = /\.(?:[cm]?[jt]sx?)$/

/** A package's script files outside nested packages, dependencies and output, repository-relative. */
export function packageScripts(root, dir) {
  const files = []
  const walk = (at) => {
    for (const entry of readdirSync(posix.join(root, at), { withFileTypes: true })) {
      const path = at === "." ? entry.name : posix.join(at, entry.name)
      if (entry.isDirectory()) {
        if (!skipped(entry.name) && !existsSync(posix.join(root, path, "package.json"))) walk(path)
      } else if (scriptFile.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name)) files.push(path)
    }
  }
  walk(dir)
  return files
}

/** The warning for a test, or a file only tests use, that bundles with bundler: setup leaves it as it is. */
export const testLeftAsIs = (bundler) => `a test bundles with ${bundler}; setup leaves tests as they are (decided detail 272), so a .vibe module it bundles resolves only through the migrated package's emitted JavaScript (opencode-32)`

// A test, or a fixture a test uses, by its path in its package: setup never edits either (decided detail 272).
export const testPath = /(?:^|\/)(?:tests?|__tests__|__mocks__|[^/]*fixtures?[^/]*)\/|\.(?:test|spec)\.[^/]+$/i

// The repository-relative files a relative import in file names, with the extensions TypeScript would try.
function importedFiles(root, file) {
  const out = []
  for (const { specifier } of parseImports(readFileSync(posix.join(root, file), "utf8"))) {
    if (!specifier.startsWith(".")) continue
    const target = posix.normalize(posix.join(posix.dirname(file), specifier))
    const stem = target.replace(/\.[cm]?[jt]sx?$/, "")
    out.push(target, ...[".ts", ".tsx", ".mts", ".js", ".mjs"].flatMap((extension) => [stem + extension, posix.join(target, "index" + extension)]))
  }
  return out
}

// Whether a package's manifest names file, package-relative, as an entry point (main, module, bin, exports,
// imports), directly, through its built name under dist/ or a wildcard: other packages import it, so it is a source.
function entryPoint(manifest, file) {
  const targets = []
  const collect = (value) => {
    if (typeof value === "string") targets.push(value)
    else if (value && typeof value === "object") Object.values(value).forEach(collect)
  }
  for (const field of ["main", "module", "browser", "bin", "exports", "imports"]) collect(manifest[field])
  const stem = (path) => posix.normalize(path).replace(/^(?:dist|build|lib|out)\//, "src/").replace(/(?:\.d)?\.[cm]?[jt]sx?$/, "")
  const own = stem(file)
  return targets.some((target) => {
    const at = stem(target)
    if (!at.includes("*")) return at === own
    const [prefix, suffix] = at.split("*")
    return own.startsWith(prefix) && own.endsWith(suffix)
  })
}

/**
 * The scripts of a package that only its tests use: its tests and fixtures
 * (testPath), and each other file that some file imports when every file
 * that imports it is one of these, unless the manifest names it as an entry
 * point. A file nothing imports, such as a build script, is not one.
 */
export function testOnlyScripts(root, dir, scripts, manifest) {
  const only = new Set(scripts.filter((path) => testPath.test(posix.relative(dir, path))))
  const known = new Set(scripts)
  const importers = new Map()
  for (const from of scripts) {
    for (const target of new Set(importedFiles(root, from))) {
      if (target === from || !known.has(target)) continue
      if (!importers.has(target)) importers.set(target, new Set())
      importers.get(target).add(from)
    }
  }
  for (let grew = true; grew;) {
    grew = false
    for (const [target, from] of importers) {
      if (only.has(target) || entryPoint(manifest, posix.relative(dir, target))) continue
      if ([...from].every((path) => only.has(path))) {
        only.add(target)
        grew = true
      }
    }
  }
  return only
}
