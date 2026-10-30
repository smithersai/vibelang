// The inventory: every source file of the packages being migrated, how it uses
// Effect, its size and tokens, the local files it imports and that import it,
// the tests that import it, and its line coverage when the baseline test run
// wrote a coverage summary.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, posix } from "node:path"
import { effectUse, isEffectSpecifier, parseImports, resolveRelative } from "./imports.mjs"
import { isDeclarationFile, readJson, rel } from "./util.mjs"

const skipDirectories = new Set(["node_modules", "dist", "build", "coverage", ".git", ".jj", ".turbo", ".vite", ".cache"])
const sourceFile = /\.(?:ts|tsx|mts|cts|vibe)$/
export const isTestFile = (path) => /\.(?:test|spec)\.(?:ts|tsx|mts|vibe)$/.test(path) || /(?:^|\/)(?:test|tests|__tests__)\//.test(path)

/** Repository-relative source files under dir, sorted. Declaration files are not sources. */
export function listSources(root, dir) {
  const out = []
  const walk = (absolute) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skipDirectories.has(entry.name)) walk(join(absolute, entry.name))
      } else if (sourceFile.test(entry.name) && !isDeclarationFile(entry.name)) out.push(rel(root, join(absolute, entry.name)))
    }
  }
  if (existsSync(join(root, dir))) walk(join(root, dir))
  return out.sort()
}

/** Line coverage percentages by repository-relative path, from Vitest's or Istanbul's json-summary. */
export function readCoverage(root, packages) {
  const coverage = {}
  for (const pkg of packages) {
    const summary = join(root, pkg.dir, "coverage/coverage-summary.json")
    if (!existsSync(summary)) continue
    for (const [file, data] of Object.entries(readJson(summary))) {
      if (file === "total") continue
      coverage[rel(root, file)] = data.lines?.pct ?? null
    }
  }
  return coverage
}

/**
 * Builds the inventory from the packages' sources. tokens maps an absolute
 * path to its count; coverage maps a repository-relative path to a percent.
 */
export function buildInventory({ root, packages, tokens = {}, coverage = {} }) {
  const files = []
  for (const pkg of packages) for (const dir of pkg.sources) for (const path of listSources(root, posix.join(pkg.dir, dir))) files.push({ path, package: pkg.dir })
  const known = new Set(files.map((f) => f.path))
  const records = files.map(({ path, package: pkg }) => {
    const text = readFileSync(join(root, path), "utf8")
    const imports = parseImports(text)
    const local = []
    const external = []
    for (const i of imports) {
      const target = resolveRelative(path, i.specifier, known)
      if (target) local.push(target)
      else if (!i.specifier.startsWith(".")) external.push(i.specifier)
    }
    return {
      path,
      package: pkg,
      test: isTestFile(path),
      bytes: statSync(join(root, path)).size,
      lines: text.split("\n").length,
      tokens: tokens[join(root, path)] ?? null,
      effect: effectUse(imports),
      effectImports: [...new Set(imports.filter((i) => isEffectSpecifier(i.specifier)).map((i) => i.specifier))].sort(),
      imports: [...new Set(local)].sort(),
      external: [...new Set(external)].sort(),
      dependents: [],
      testedBy: [],
      coverage: coverage[path] ?? null
    }
  })
  const byPath = new Map(records.map((r) => [r.path, r]))
  for (const r of records) {
    for (const target of r.imports) {
      const t = byPath.get(target)
      if (!t) continue
      t.dependents.push(r.path)
      if (r.test) t.testedBy.push(r.path)
    }
  }
  const effectful = records.filter((r) => r.effect !== "none")
  return {
    version: 1,
    root,
    packages: packages.map((p) => p.dir),
    summary: {
      files: records.length,
      effectFiles: effectful.length,
      effectValueFiles: records.filter((r) => r.effect === "values").length,
      effectTypeOnlyFiles: records.filter((r) => r.effect === "types").length,
      tests: records.filter((r) => r.test).length,
      effectLines: effectful.reduce((sum, r) => sum + r.lines, 0),
      effectTokens: effectful.reduce((sum, r) => sum + (r.tokens ?? 0), 0)
    },
    files: records
  }
}
