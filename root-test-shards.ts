import type { Smithers } from "@smthrs/targets"
import { globSync, readFileSync, existsSync, statSync } from "node:fs"
import { dirname, resolve, relative, sep, isAbsolute, matchesGlob } from "node:path"
import { fileURLToPath } from "node:url"
import { buildContractSuites } from "./build-contract-inputs.ts"

// Dynamic fixture reads and subprocess-owned inputs supplement static imports.
// These paths are checked against file-access receipts when the root CI changes.
const fixtureInputs: Record<string, string[]> = JSON.parse(
  readFileSync(new URL("./root-test-fixtures.json", import.meta.url), "utf8")
)

const repository = fileURLToPath(new URL("./", import.meta.url))
export const releasePatterns = [
  "scripts/release/*.test.mjs",
  "scripts/*.test.mjs",
  "typescript/vibelang/harness.test.mjs",
  "typescript/vibelang/harness-deadlines.test.mjs",
  "typescript/vibelang/cov-ch004-twin.test.mjs",
  "typescript/vibelang/coverage-stock-twins.test.mjs",
  "typescript/vibelang/vip7-reference.test.mjs",
  "docs/redirect/*.test.mjs",
  "site/scripts/sync-spec-docs.test.mjs",
  "site/scripts/sync-user-docs.test.mjs",
  ".smithers/flows/effect-bump/test/*.test.mjs",
  ".smithers/flows/ts-bump/test/*.test.mjs",
  ".smithers/flows/ci-health/test/*.test.mjs",
  ".smithers/flows/first-bad/test/*.test.mjs",
  ".smithers/flows/test/*.test.mjs"
] as const
export const specLinterFiles = [
  "docs/tools/spec-rules.test.mjs",
  "docs/tools/spec-examples-compiler.test.mjs",
  "docs/tools/spec-rules-import-grammar.test.mjs",
  "docs/tools/diagnostic-identity.test.mjs",
  "docs/tools/diagnostic-examples.test.mjs",
  "docs/tools/diagnostic-archive-examples.test.mjs",
  "docs/tools/diagnostic-native-projects.test.mjs",
  "docs/tools/factory-diagnostic-retirement.test.mjs",
  "docs/tools/spec-lint.test.ts",
  "docs/tools/spec-native-source-resolution.test.ts"
] as const

// Match the previous selectors exactly, including prefix neighbours of the
// API comparator and the three separately owned documentation suites.
export function rootTestGroups(root = repository) {
  const files = (patterns: readonly string[]) => [...new Set(globSync([...patterns], { cwd: root }))].sort()
  return {
    release: files(releasePatterns).filter(
      (file) => !file.startsWith("scripts/api-identity") && !(buildContractSuites as readonly string[]).includes(file)
    ),
    "api-identity-test": files(["scripts/api-identity*.test.mjs"]),
    "docs-tools": files(["docs/tools/*.test.*"]).filter(
      (file) => !/\/(site-(contrast|spec-links)|spec-lint)\.test\./.test(file)
    ),
    "mapper-scripts": files(["scripts/mapper-*.test.mjs"]),
    "spec-linters-test": [...specLinterFiles]
  }
}

export function rootShardName(group: string, file: string) {
  // Encode, rather than discard, punctuation: neighbours must never collide.
  return group + "-file-" + file.replace(/[^a-zA-Z0-9-]/g, (c) => "_" + c.charCodeAt(0).toString(16) + "_")
}

const shardGroups: Record<string, string[][]> = JSON.parse(
  readFileSync(new URL("./root-test-shard-groups.json", import.meta.url), "utf8")
)

// Persisted membership keeps existing groups stable when new files arrive.
// New files get independent leaves until their measured cost is known.
export function rootTestShards(group: string, files: readonly string[]) {
  const selected = new Set(files)
  const assigned = new Set<string>()
  const shards: { name: string; files: string[] }[] = []
  for (const [index, candidates] of (shardGroups[group] ?? []).entries()) {
    const members = candidates.filter(file => selected.has(file))
    if (!members.length) continue
    for (const file of members) {
      if (assigned.has(file)) throw new Error("duplicate root shard assignment: " + file)
      assigned.add(file)
    }
    shards.push({
      name: members.length === 1 ? rootShardName(group, members[0]) : group + "-group-" + String(index + 1).padStart(3, "0"),
      files: members
    })
  }
  for (const file of files) if (!assigned.has(file)) shards.push({ name: rootShardName(group, file), files: [file] })
  return shards
}

export function rootTestTargetName(group: string, file: string) {
  return rootTestShards(group, rootTestGroups()[group as keyof ReturnType<typeof rootTestGroups>])
    .find(shard => shard.files.includes(file))?.name ?? rootShardName(group, file)
}

// Remove only redundant positive patterns. A whole-tree reader uses the
// existing tree target, which includes all declared package trees.
const knownTreeOwners = new Set(["", "packages", "typescript", "typescript/tsc", "typescript/vibelang"])
const inputOwnerCache = new Map<string, string>()
function inputOwner(pattern: string) {
  const directory = pattern.endsWith("/**") ? pattern.slice(0, -3) : dirname(pattern)
  if (inputOwnerCache.has(directory)) return inputOwnerCache.get(directory)!
  let current = directory
  while (current !== "." && current) {
    if (existsSync(resolve(repository, current, "PACKAGE.ts"))) {
      inputOwnerCache.set(directory, current)
      return current
    }
    current = dirname(current)
  }
  inputOwnerCache.set(directory, "")
  return ""
}
export function minimizeRootTestInputs(patterns: readonly string[]) {
  const unique = [...new Set(patterns)].sort()
  if (unique.includes("**")) return ["**", ...unique.filter(pattern => !pattern.includes("*") && !knownTreeOwners.has(inputOwner(pattern)))]
  const directories = unique.filter(pattern => pattern.endsWith("/**") && !/[?*[{]/.test(pattern.slice(0, -3)))
  return unique.filter(pattern => !directories.some(directory =>
    directory !== pattern && knownTreeOwners.has(inputOwner(directory)) &&
    inputOwner(pattern) === inputOwner(directory) &&
    pattern.startsWith(directory.slice(0, -2)) && matchesGlob(pattern, directory)
  ))
}

type SDK = typeof Smithers
type Group = ReturnType<SDK["Filegroup"]>

// Globs stop at PACKAGE.ts boundaries. Exact files remain explicit file inputs;
// directory reads in another package depend on that package's existing tree.
export function createRootTestInputs(S: SDK, patterns: readonly string[], trees: Readonly<Record<string, Group>>) {
  const minimized = minimizeRootTestInputs(patterns)
  if (minimized.includes("**")) return [
    trees[""],
    ...(minimized.length > 1 ? [S.Filegroup({ srcs: minimized.filter(pattern => pattern !== "**").map(pattern => S.file(pattern)) })] : [])
  ]
  const dependencies = new Set<Group>()
  const files: ReturnType<SDK["file"]>[] = []
  const globs: string[] = []
  const owners = Object.keys(trees).filter(Boolean)
  for (const pattern of minimized) {
    if (!pattern.includes("*")) { files.push(S.file(pattern)); continue }
    const directory = pattern.slice(0, -3)
    const parents = owners.filter(owner => directory === owner || directory.startsWith(owner + "/"))
      .sort((a, b) => b.length - a.length)
    if (parents.length) dependencies.add(trees[parents[0]])
    else globs.push(pattern)
    for (const owner of owners) if (owner.startsWith(directory + "/")) dependencies.add(trees[owner])
  }
  return [
    ...dependencies,
    ...(files.length || globs.length ? [S.Filegroup({ srcs: [...files, ...(globs.length ? S.glob(globs) : [])] })] : [])
  ]
}

export const shellQuote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"

// Resolve local source imports and literal fixture paths transitively. Directory
// inputs remain globs so adding a fixture invalidates its readers. Installed
// libraries are represented by their owning manifests and frozen lockfiles.
const inputCache = new Map<string, { patterns: string[]; source: string }>()

function rootTestInputs(file: string, root = repository) {
  const key = resolve(root, file)
  if (inputCache.has(key)) return inputCache.get(key)!
  const sources: string[] = []
  const patterns = new Set<string>([
    file,
    ...globSync(["*.json", "*.jsonc"], { cwd: root }).filter(path => !["root-test-fixtures.json", "root-test-shard-groups.json"].includes(path)),
    "docs/tools/package.json",
    "docs/tools/bun.lock",
    ".smithers/package.json",
    ".smithers/bun.lock"
  ])
  const visited = new Set<string>()
  const add = (path: string) => {
    const absolute = resolve(root, path)
    const rel = relative(root, absolute).split(sep).join("/")
    if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel) || !existsSync(absolute)) return
    if (rel.includes("node_modules") || rel.startsWith(".jj/")) return
    if (["typescript/built/", "packages/compiler/native/", "packages/runtime/dist/", "packages/ts-mapper/dist/", "site/dist/"].some(prefix => rel.startsWith(prefix))) return
    if (/^packages\/ts-mapper\/bin\/vibelang-mapper(?:\.exe)?$/.test(rel)) return
    patterns.add(statSync(absolute).isDirectory() ? rel + "/**" : rel)
  }
  const visit = (path: string) => {
    if (visited.has(path) || !existsSync(resolve(root, path))) return
    visited.add(path)
    add(path)
    const source = readFileSync(resolve(root, path), "utf8")
    sources.push(source)
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?|require\s*\()\s*["'](\.[^"'\n]+)["']/g)) {
      const start = resolve(root, dirname(path), match[1])
      const dependency = [start, start + ".ts", start + ".mjs", start + ".js", start + "/index.ts"].find(
        (p) => existsSync(p) && statSync(p).isFile()
      )
      if (dependency) visit(relative(root, dependency).split(sep).join("/"))
    }
    // A quoted repository-relative path, a URL relative to this module, or
    // an existing basename relative to it. Prefixes retain their whole subtree.
    for (const match of source.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
      const literal = match[2]
      if (path.startsWith("scripts/api-identity") && ["typescript", "docs"].includes(literal)) continue
      if (path === "scripts/api-identity.mjs" && ["docs/tools", "packages/runtime", "experiments"].includes(literal)) {
        add(literal + "/package.json")
        add(literal + "/bun.lock")
        continue
      }
      if (/^(?:docs|scripts|packages|typescript|experiments|site|templates|editors|\.smithers)(?:\/|$)/.test(literal)) {
        const prefix = literal.split(/[\s*?$\x60]/)[0].replace(/\/$/, "")
        add(prefix)
      }
      if (/^\.{1,2}\//.test(literal) || /^[\w.-]+\.(?:[cm]?[jt]s|json|md|sh|tsv)$/.test(literal))
        add(relative(root, resolve(root, dirname(path), literal)))
      if (/^[\w.-]+\.(?:[cm]?[jt]s|json|md|sh|tsv)$/.test(literal)) add(literal)
    }
    if (path === "scripts/testing/package-declaration.mjs") {
      for (const p of [
        "PACKAGE.ts",
        "packages/PACKAGE.ts",
        "typescript/PACKAGE.ts",
        "typescript/tsc/PACKAGE.ts",
        "typescript/vibelang/PACKAGE.ts",
        "api-inputs.ts",
        "build-contract-inputs.ts",
        "root-test-shards.ts"
      ])
        add(p)
    }
    // Repository inventories deliberately inspect every source/test filename.
    // Keep that dependency explicit rather than using the root tree target.
    if (/testFiles\(|check-tracked-leaks|check-case-collisions|check-generated-freshness/.test(source)) {
      for (const p of [
        "scripts",
        "docs",
        "packages",
        "typescript",
        "site",
        ".smithers",
        "templates",
        "editors",
        "experiments"
      ])
        add(p)
    }
  }
  // These readers walk or copy every authored repository file. Explicit
  // graph-inspection fixture contracts may also retain this tree inventory.
  if (/^\.smithers\/flows\/test\/api-inputs-(?:key(?:-[a-z]+)?|guard)\.test\.mjs$/.test(file) || file === "scripts/brand-gate.test.mjs") patterns.add("**")
  visit(file)
  for (const pattern of fixtureInputs[file] ?? []) patterns.add(pattern)
  // These harnesses invoke compilers against generated and copied projects.
  // Their source directory is the fixture domain; native compiler/runtime
  // targets are separate graph dependencies supplied by PACKAGE.ts.
  if (file.startsWith("scripts/api-identity"))
    for (const p of [
      "packages/ts-mapper/package.json",
      "experiments/package.json",
      "experiments/bun.lock",
      "packages/runtime/package.json",
      "packages/runtime/bun.lock"
    ])
      add(p)
  if (file.startsWith("scripts/mapper-"))
    for (const p of ["packages/ts-mapper", "typescript/vibelang/lsp-fixture"]) add(p)
  const result = { patterns: [...patterns].sort(), source: sources.join("\n") }
  inputCache.set(key, result)
  return result
}

export function rootTestInputPatterns(file: string, root = repository) {
  return rootTestInputs(file, root).patterns
}

export function rootTestBuildNeeds(file: string, root = repository) {
  if (/^\.smithers\/flows\/test\/api-inputs-.*\.test\.mjs$/.test(file))
    return { compiler: false, runtime: false, forms: false, mapper: false }
  const { source } = rootTestInputs(file, root)
  return {
    compiler: /compiler|vibelang|harness|\btsc\b|binary|nativeProjectHost|snippets/i.test(source),
    runtime: /runtime|effect|kernel/i.test(source),
    forms: /forms-generator|vibelang-forms|FORMS_BINARY|check-forms|forms.table|formsgenerator/i.test(source),
    mapper: file.startsWith("scripts/mapper-")
  }
}

