// The inventory: every source file of the packages being migrated, how it uses
// Effect, its size and tokens, the local files it imports and that import it,
// the tests that import it, and its line coverage when the baseline test run
// wrote a coverage summary.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "./declarations.mjs"
import { testBundleDeferrals } from "./test-bundles.mjs"
import { bareRunnerDeferrals } from "./bare-runners.mjs"
import { effectUse, isEffectSpecifier, parseImports, resolveAlias, resolveRelative } from "./imports.mjs"
import { describe, enumerates, namedSelectors } from "./enumerations.mjs"
import { isDeclarationFile, readJson, rel } from "./util.mjs"

const skipDirectories = new Set(["node_modules", "dist", "build", "coverage", ".git", ".jj", ".turbo", ".vite", ".cache"])
const sourceFile = /\.(?:ts|tsx|mts|cts|vibex?)$/
export const isTestFile = (path) => /\.(?:test|spec)\.(?:[cm]?[jt]sx?|vibe|vibex)$/.test(path) || /(?:^|\/)(?:test|tests|__tests__)\//.test(path)

export const isFixtureFile = path => /(?:^|\/)(?:[^/]*fixtures?[^/]*|__snapshots__|snapshots|testdata)(?:\/|$)/i.test(path) || /\.snap$/.test(path)

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

/**
 * The source file names a module's own code writes as a string, with each
 * non-test file that writes it: alchemy's CLI defaults to "alchemy.run.ts",
 * so a project's alchemy.run.ts is found by that name. A test's string, an
 * index file (found by its directory) and a path are no such lookup. A name
 * joined to the writer's own directory, join(import.meta.dirname, "x.ts"),
 * reaches that directory only; any other reaches the writer's package and the
 * packages that depend on it.
 */
const bareFilename = new RegExp("[\"'`][^\"'`/\r\n]*\\.(?:ts|mts|cts)[\"'`]")
const indexFile = /^index\.[cm]?ts$/
function namedFiles(texts, root) {
  const names = new Map()
  let ts
  for (const [path, text] of texts) {
    if (isTestFile(path) || isFixtureFile(path) || !bareFilename.test(text) && !text.includes(String.fromCharCode(92))) continue
    ts ??= loadTypeScript([root,
      fileURLToPath(new URL("../../../../docs/tools/", import.meta.url)),
      fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.getScriptKindFromFileName(path))
    // join(__dirname, "lib", "x.ts"): the directory the name is joined to, when every earlier part is known.
    const joinedDirectory = (node, call) => {
      if (!ts.isCallExpression(call) || call.arguments.at(-1) !== node) return null
      const callee = ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : ts.isIdentifier(call.expression) ? call.expression.text : ""
      if (!["join", "resolve"].includes(callee) || call.arguments.length < 2) return null
      const parts = []
      for (const argument of call.arguments.slice(0, -1)) {
        const text = argument.getText(source)
        if (text === "__dirname" || text === "import.meta.dirname") { if (parts.length) return null; parts.push(posix.dirname(path)) }
        else if (ts.isStringLiteralLike(argument) && parts.length && !posix.isAbsolute(argument.text)) parts.push(argument.text)
        else return null
      }
      return posix.join(...parts)
    }
    const visit = node => {
      if (ts.isStringLiteralLike(node)) {
        const name = node.text, parent = node.parent
        const specifier = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) ||
          ts.isExternalModuleReference(parent) || ts.isLiteralTypeNode(parent) ||
          ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword
        if (!specifier && [".ts", ".mts", ".cts"].some(ext => name.endsWith(ext)) && !indexFile.test(name) && !name.includes("/") && !name.includes(String.fromCharCode(92))) {
          names.set(name, [...names.get(name) ?? [], { writer: path, directory: joinedDirectory(node, parent) }])
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return names
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
 * path to its count; coverage maps a repository-relative path to a percent;
 * paths maps a package's directory to its tsconfig's `paths`, with
 * repository-relative substitutions (tsconfigPaths), so an import through an
 * alias, `~/main`, is a local import as a relative one is.
 * enumerations are setup's findings of code that lists *.ts files: a file
 * under one records each in enumeratedBy, and stays .ts (decided detail 268).
 */
export function buildInventory({ root, packages, tokens = {}, coverage = {}, paths = {}, enumerations = [], routedBundles = false }) {
  const files = []
  for (const pkg of packages) for (const dir of pkg.sources) for (const path of listSources(root, posix.join(pkg.dir, dir))) files.push({ path, package: pkg.dir })
  const known = new Set(files.map((f) => f.path))
  const texts = new Map(files.map(({ path }) => [path, readFileSync(join(root, path), "utf8")]))
  const named = namedFiles(texts, root)
  const packageOf = new Map(files.map(f => [f.path, f.package]))
  const manifests = new Map()
  const manifest = dir => {
    if (!manifests.has(dir)) { let json = null; try { json = readJson(join(root, dir, "package.json")) } catch {} manifests.set(dir, json) }
    return manifests.get(dir)
  }
  const dependsOn = (dir, on) => {
    const name = manifest(on)?.name, json = manifest(dir)
    return Boolean(name && json) && ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(field => json[field]?.[name] !== undefined)
  }
  const namedBy = (path, pkg) => named.get(posix.basename(path))?.find(({ writer, directory }) => directory !== null
    ? posix.join(directory, posix.basename(path)) === path
    : packageOf.get(writer) === pkg || dependsOn(pkg, packageOf.get(writer)))?.writer ?? null
  // A package's tool config and scripts name modules too: read them for named globs.
  const scanned = [...new Set(packages.flatMap(pkg => listSources(root, pkg.dir)))]
  const selectors = [...enumerations, ...namedSelectors(scanned, file => texts.get(file) ?? readFileSync(join(root, file), "utf8"))]
  const records = files.map(({ path, package: pkg }) => {
    const text = texts.get(path)
    const imports = parseImports(text)
    const local = []
    const external = []
    for (const i of imports) {
      const target = resolveRelative(path, i.specifier, known) ?? resolveAlias(i.specifier, paths[pkg], known)
      if (target) local.push(target)
      else if (!i.specifier.startsWith(".")) external.push(i.specifier)
    }
    const enumeratedBy = selectors.filter((finding) => finding.file !== path && enumerates(finding, path)).map(describe)
    return {
      path,
      package: pkg,
      ...(enumeratedBy.length ? { enumeratedBy } : {}),
      test: isTestFile(path) || isFixtureFile(path),
      namedBy: namedBy(path, pkg),
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
  const bundleWarnings = []
  for (const deferred of testBundleDeferrals(root, records.map(r => r.path), { paths, routed: routedBundles, onWarning: warning => bundleWarnings.push(warning) })) {
    const record = byPath.get(deferred.file)
    record.bundledBy = deferred.bundledBy
    record.bundleReason = deferred.reason
  }
  const bareRunners = bareRunnerDeferrals(root, records.map(r => r.path), { paths, routed: routedBundles })
  for (const deferred of bareRunners.deferred) {
    const record = byPath.get(deferred.file)
    record.bareRunBy = deferred.runBy
    record.bareRunReason = deferred.reason
  }
  const effectful = records.filter((r) => r.effect !== "none")
  return {
    version: 1,
    ...(bundleWarnings.length ? { bundleWarnings } : {}),
    bareRunners: { entries: bareRunners.entries, wired: bareRunners.wired, modules: bareRunners.deferred.map(d => d.file) },
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

/**
 * A package's `paths`, from each project its tsconfig compiles (a solution's
 * references included, the first to map a pattern winning), with each
 * substitution made repository-relative from the directory TypeScript reads it
 * from: baseUrl, or the tsconfig that sets `paths`. projects are absolute
 * tsconfig paths; ts is TypeScript's compiler API.
 */
export function tsconfigPaths(ts, root, projects) {
  const paths = {}
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} }
  for (const tsconfig of projects) {
    if (!existsSync(tsconfig)) continue
    const options = ts.getParsedCommandLineOfConfigFile(tsconfig, {}, host)?.options
    if (!options?.paths) continue
    const base = options.baseUrl ?? options.pathsBasePath ?? posix.dirname(tsconfig)
    for (const [pattern, substitutions] of Object.entries(options.paths)) {
      paths[pattern] ??= substitutions.map((s) => rel(root, posix.resolve(base, s)))
    }
  }
  return paths
}
