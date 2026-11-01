import { prepareBuilds } from "./builds.mjs"
// The migrate flow's steps. Each reads and writes the run directory, so it can
// run as a step of flow.ts or alone from step.mjs, and a later step reads what
// an earlier one recorded. A step that has already recorded its result returns
// it without running again.
import { wireTestProjects } from "./test-projects.mjs"
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, posix, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertBaselineSafe } from "./baseline.mjs"
import { buildInventory, listSources, readCoverage, tsconfigPaths } from "./inventory.mjs"
import { defaultLimits, draftPlan, migrationScope, planPrompt, validatePlan } from "./plan.mjs"
import { fixToFixedPoint, pathAliases, restoreExports, restoreSpecifiers, rewriteImports, rewriteTotals, vibePath } from "./codemod.mjs"
import { restoreViteScripts } from "./vite-config.mjs"
import { applyState, durableWrite, prepareReferences, prepareState, saveState } from "./codemod-state.mjs"
import { checkSelectorEdits, restoreSourceLiterals, rewriteSourceLiterals } from "./source-paths.mjs"
import { splitBatchPlatform } from "./platform.mjs"
import { check, newErrors, styleProblems, summarize } from "./diagnostics.mjs"
import { preservedErrorAdvisories } from "./preserved-errors.mjs"
import { compareDeclarations, recordDeclarationSurface, emitDeclarations, emitErrorsIn, loadTypeScript } from "./declarations.mjs"
import { compareTests, regressionIssue, runTests } from "./tests.mjs"
import { verifyRepositoryTests } from "./test-diff-run.mjs"
import { testDiffMarkdown } from "./test-diff.mjs"
import { vibeParser } from "./test-diff-format.mjs"
import { measureTests } from "./measurement.mjs"
import { regenerate } from "./hooks.mjs"
import { countTokens } from "./tokens.mjs"
import { readIssues } from "./issues.mjs"
import { repairPrompt } from "./repair.mjs"
import * as Jj from "./jj.mjs"
import { resolveAliased, resolveRelative } from "./imports.mjs"
import { restoreReferences } from "./references.mjs"
import * as Upgrade from "./upgrade.mjs"
import * as Wire from "./wire.mjs"
import { wireEsbuildBuilds } from "./esbuild-builds.mjs"
import { wirePublishingScripts } from "./publishing.mjs"
import { wireReactTools } from "./react-tools.mjs"
import { wireDeveloperTools } from "./tooling.mjs"
import { planEmittedImports, applyEmittedImports } from "./emitted-imports.mjs"
import { wireOxlintPlugins } from "./oxlint-plugins.mjs"
import { readToolchain } from "./toolchain.mjs"
import { probeVip1, probeTargetVip1 } from "./vip-flip.mjs"
import { assertPortable, machineRoots } from "./portable.mjs"
import { appendJsonl, batchName, isDeclarationFile, must, quote, readJson, readJsonIf, run as sh, slug, writeJson, writeText } from "./util.mjs"

export const flowDir = fileURLToPath(new URL("../", import.meta.url))
// The agent runs in the target, so the prompts name this checkout's step.mjs by its full path.
export const stepCommand = `node ${join(flowDir, "step.mjs")}`

/** The files of a run directory. */
export function paths(runDir) {
  const r = resolve(runDir)
  const batch = (b) => join(r, "batches", b)
  return {
    run: r,
    config: join(r, "config.json"),
    upgrade: join(r, "upgrade-effect.json"),
    setup: join(r, "setup.json"),
    inventory: join(r, "inventory.json"),
    planDraft: join(r, "plan.draft.json"),
    planPrompt: join(r, "plan.prompt.md"),
    planAnswer: join(r, "plan.answer.json"),
    plan: join(r, "plan.json"),
    issues: join(r, "issues.jsonl"),
    report: join(r, "report.md"),
    reportJson: join(r, "report.json"),
    prBody: join(r, "pr-body.md"),
    baseline: join(r, "baseline"),
    batch,
    codemod: (b) => join(batch(b), "codemod.json"),
    codemodState: (b) => join(batch(b), "codemod-state.json"),
    compile: (b) => join(batch(b), "compile.json"),
    repairPrompt: (b) => join(batch(b), "repair.prompt.md"),
    repair: (b) => join(batch(b), "repair.json"),
    verify: (b) => join(batch(b), "verify.json"),
    record: (b) => join(batch(b), "record.json"),
    reverted: (b) => join(batch(b), "reverted.json")
  }
}

const mtime = (path) => (existsSync(path) ? statSync(path).mtimeMs : 0)

/** The step to run next, from what the run directory holds. */
export function nextStep(runDir) {
  const p = paths(runDir)
  if (!existsSync(p.setup)) return { step: existsSync(p.upgrade) ? "setup" : "upgrade-effect" }
  if (!existsSync(p.plan)) return { step: "plan" }
  const plan = readJson(p.plan)
  for (let i = 0; i < plan.batches.length; i++) {
    const b = batchName(i)
    if (existsSync(p.record(b))) continue
    if (!existsSync(p.codemod(b)) || (plan.mode === "one-pass" && !readJson(p.codemod(b)).fix?.settled)) return { step: "codemod", batch: b }
    if (!existsSync(p.compile(b))) return { step: "compile", batch: b }
    if (!existsSync(p.repair(b))) return { step: "repair", batch: b }
    const verify = readJsonIf(p.verify(b))
    if (!verify || mtime(p.repair(b)) > mtime(p.verify(b))) return { step: "verify", batch: b }
    if (!verify.ok) return { step: "repair", batch: b, again: true }
    return { step: "record", batch: b }
  }
  return { step: "report" }
}

/** The batch a batch-scoped step works on: the one given, else the next unrecorded batch. */
function currentBatch(runDir, batch) {
  if (batch) return String(batch).padStart(2, "0")
  const next = nextStep(runDir)
  if (!next.batch) throw new Error(`no batch is in progress (next step: ${next.step})`)
  return next.batch
}

function loadRun(runDir) {
  const p = paths(runDir)
  if (!existsSync(p.config)) throw new Error(`${p.config} is missing: run setup first`)
  const config = readJson(p.config)
  return { p, config, setup: readJsonIf(p.setup), plan: readJsonIf(p.plan), inventory: readJsonIf(p.inventory) }
}

const compilerOf = (config) => (config.toolchain.kind === "staged"
  ? readToolchain(config.toolchain.dir).compiler
  : join(config.target, config.packages[0].dir, "node_modules/.bin/vibelang"))

const typeScriptOf = (config) => loadTypeScript([
  ...(config.toolchain.kind === "staged" ? [config.toolchain.dir] : []),
  config.target,
  ...config.packages.map((pkg) => join(config.target, pkg.dir))
])

/** Every source file of the packages, repository-relative. */
const scopeFiles = (config) => config.packages.flatMap((pkg) => pkg.sources.flatMap((s) => listSources(config.target, posix.join(pkg.dir, s))))

/**
 * The files whose imports the codemod and revert rewrite: every source file
 * the repository tracks, not only the scope's sources, since a module's tests
 * and other packages import it by path too (smithers' crypto tests import
 * ../src/Crypto.ts). A declaration file has no import to rewrite.
 */
export async function importers(t) {
  return (await Jj.trackedFiles(t)).filter((f) => /\.(?:ts|tsx|mts|cts|vibe)$/.test(f) && !isDeclarationFile(f))
}

/** A batch's files as they are now: each plan path, as .vibe when migrated. */
function batchFiles(config, plan, b) {
  return plan.batches[Number(b) - 1].files.map((file) => {
    const vibe = vibePath(file)
    if (existsSync(join(config.target, vibe))) return { planned: file, path: vibe, migrated: true }
    return { planned: file, path: file, migrated: false }
  })
}

const packageOf = (config, file) => config.packages.find((pkg) => pkg.dir === "." || file.startsWith(pkg.dir + "/"))

/** Builds the run's config from setup's options. */
export function makeConfig(options) {
  const target = resolve(options.target)
  if (!existsSync(join(target, "package.json"))) throw new Error(`${target} has no package.json`)
  const packages = (options.packages?.length ? options.packages : ["."]).map((dir) => {
    const at = join(target, dir)
    const dts = options.dtsTsconfig ?? (existsSync(join(at, "tsconfig.build.json")) ? "tsconfig.build.json" : "tsconfig.json")
    return { dir, tsconfig: options.tsconfig ?? "tsconfig.json", dtsTsconfig: dts, sources: options.sources?.length ? options.sources : ["src"] }
  })
  if (!options.test) throw new Error("--test <command> is required: the target's tests are the migration's gate")
  if (!options.toolchain && !options.vibelangVersion) throw new Error("--toolchain <dir> or --vibelang-version <version> is required")
  return {
    version: 1,
    target,
    packages,
    test: { command: options.test, cwd: options.testCwd ?? ".", ...(options.testReport ? { report: options.testReport } : {}) },
    install: options.install ?? null,
    wire: options.wire !== false,
    ...(options.emittedProjects?.length ? { emittedProjects: options.emittedProjects } : {}),
    toolchain: options.toolchain ? { kind: "staged", dir: resolve(options.toolchain) } : { kind: "npm", version: options.vibelangVersion },
    // Each recorded batch goes on this bookmark, one commit on top of the last.
    bookmark: options.bookmark ?? "vibe",
    base: options.base ?? null,
    main: options.main ?? null,
    ...(options.afterConvert?.length ? { afterConvert: options.afterConvert } : {}),
    ...(options.measureCommand ? { measureCommand: options.measureCommand } : {}),
    limits: { maxFiles: Number(options.maxFiles ?? defaultLimits.maxFiles), maxLines: Number(options.maxLines ?? defaultLimits.maxLines) }
  }
}

/** The exact Effect version the toolchain's runtime requires. */
async function runtimeEffect(config) {
  if (config.toolchain.kind === "staged") return readToolchain(config.toolchain.dir).effect
  const { stdout } = await must(`npm view vibelang-runtime@${config.toolchain.version} peerDependencies.effect`)
  return stdout.trim()
}

/**
 * Formats the files a step wrote, repository-relative, with the target's own
 * formatter (Wire.formatterOf), so its format check passes on them. A
 * formatter that fails leaves the files as written and returns its exit code.
 */
async function formatWritten(t, files, log) {
  const formatter = Wire.formatterOf(readJsonIf(join(t, "package.json"), {}))
  const targets = Wire.formattable(files).filter((file) => existsSync(join(t, file)))
  if (!formatter || !targets.length) return { formatter: formatter?.join(" ") ?? null, files: [], code: 0 }
  const [tool, ...args] = formatter
  const local = join(t, "node_modules/.bin", tool)
  const { code } = await sh([existsSync(local) ? local : tool, ...args, ...targets].map(quote).join(" "), { cwd: t, log })
  return { formatter: formatter.join(" "), files: targets, code }
}

/**
 * Formats the .vibe files a batch wrote with vibelang-format, the formatter a
 * target's format check runs on them, which neither `vibelang --fix` nor the
 * repository's own formatter does. A formatter that fails leaves the files as
 * written and returns its exit code.
 */
export async function formatVibe(config, files, log) {
  const t = config.target
  const targets = files.filter((file) => file.endsWith(".vibe") && existsSync(join(t, file)))
  if (!targets.length) return { files: [], code: 0 }
  const tool = [".", ...config.packages.map((pkg) => pkg.dir)].map((dir) => join(t, dir, "node_modules/.bin/vibelang-format")).find((path) => existsSync(path))
  if (!tool) return { files: [], code: 127 }
  const { code } = await sh([tool, "--write", ...targets].map(quote).join(" "), { cwd: t, log })
  return { files: targets, code }
}

/**
 * Formats the .vibe files the repository already has in its own packages:
 * setup wires the formatter its format check then runs on them, and Smithers
 * had 30 from VibeLang 0.0.8 that its dprint never read. A vendored tree
 * keeps its files as they are.
 */
export async function formatExistingVibe(config, log) {
  const owned = Wire.ownedPaths(config.target)
  const files = (await Jj.trackedFiles(config.target)).filter((file) => file.endsWith(".vibe") && owned(file))
  return formatVibe(config, files, log)
}

/**
 * Formats the .vibe files a batch recorded and compiles each package whose
 * files that changed: vibelang-format sorts import specifiers, which a
 * declaration prints, so the sidecar from the last compile no longer matches
 * its source, and the next batch's compile would carry the difference.
 */
export async function formatRecorded(config, files, logs) {
  const t = config.target
  const read = (file) => (existsSync(join(t, file)) ? readFileSync(join(t, file), "utf8") : null)
  const before = new Map(files.map((file) => [file, read(file)]))
  const formatted = await formatVibe(config, files, join(logs, "format-vibe.log"))
  const changed = formatted.files.filter((file) => read(file) !== before.get(file))
  for (const pkg of config.packages.filter((pkg) => changed.some((file) => packageOf(config, file) === pkg))) {
    await check({ compiler: compilerOf(config), tsconfig: pkg.tsconfig, cwd: join(t, pkg.dir), root: t, log: join(logs, `sidecars-${slug(pkg.dir)}.log`) })
  }
  return formatted
}

/**
 * Runs vibelang agents init in the target t with the vibelang packageDir
 * installed, then formats what it wrote with the target's formatter: the
 * settings, plugin manifests and opencode.json it writes are the
 * repository's files, which its format check reads.
 */
export async function setUpAgents(t, packageDir, logs) {
  const agents = await Wire.initAgents({ root: t, packageDir, log: join(logs, "agents-init.log") })
  return { ...agents, formatted: await formatWritten(t, agents.files, join(logs, "agents-format.log")) }
}

/** A log path for one project of several: compile-x.log becomes compile-x-tsconfig.node.log. */
const projectLog = (log, tsconfig, projects) => (projects.length > 1 ? log.replace(/(\.log)?$/, `-${slug(tsconfig)}$1`) : log)

/** Checks each project of pkg's tsconfig (Wire.projectsOf) and joins their diagnostics. */
async function checkPackage({ compiler, ts, t, pkg, log }) {
  const cwd = join(t, pkg.dir)
  const projects = Wire.projectsOf(ts, cwd, pkg.tsconfig)
  const diagnostics = []
  let code = 0
  for (const tsconfig of projects) {
    const checked = await check({ compiler, tsconfig, cwd, root: t, log: projectLog(log, tsconfig, projects) })
    code ||= checked.code
    diagnostics.push(...checked.diagnostics)
  }
  return { code, diagnostics }
}

/** Emits the declarations of each project of pkg's declaration tsconfig into outDir, each into its own subdirectory when there are several. */
async function emitPackageDeclarations({ compiler, ts, t, pkg, outDir, log }) {
  const cwd = join(t, pkg.dir)
  const projects = Wire.projectsOf(ts, cwd, pkg.dtsTsconfig)
  if (projects.length === 1) {
    const result = await emitDeclarations({ compiler, tsconfig: projects[0], cwd, outDir, log, root: t })
    recordDeclarationSurface(ts, outDir, cwd, [{ tsconfig: projects[0], prefix: "." }])
    return result
  }
  rmSync(outDir, { recursive: true, force: true })
  let code = 0
  let files = 0
  const diagnostics = []
  for (const tsconfig of projects) {
    const emitted = await emitDeclarations({ compiler, tsconfig, cwd, outDir: join(outDir, slug(tsconfig)), log: projectLog(log, tsconfig, projects), root: t })
    code ||= emitted.code
    files += emitted.files
    diagnostics.push(...emitted.diagnostics)
  }
  recordDeclarationSurface(ts, outDir, cwd, projects.map(tsconfig => ({ tsconfig, prefix: slug(tsconfig) })))
  return { code, files, diagnostics }
}

// Compare an existing native package with its installed predecessor before any repin.
async function previousCompilerChecks(config, logs) {
  const checks = {}, t = config.target
  const tracked = await Jj.trackedFiles(t)
  let ts
  for (const pkg of config.packages) {
    const prefix = posix.normalize(pkg.dir) === "." ? "" : posix.normalize(pkg.dir) + "/"
    if (!tracked.some(file => file.startsWith(prefix) && file.endsWith(".vibe"))) continue
    let directory = resolve(t, pkg.dir), compiler
    for (;;) {
      const candidate = join(directory, "node_modules/.bin/vibelang")
      if (existsSync(candidate)) { compiler = candidate; break }
      if (directory === resolve(t)) break
      const parent = dirname(directory)
      if (parent === directory || !parent.startsWith(resolve(t))) break
      directory = parent
    }
    if (!compiler) throw new Error("cannot establish the previous native compiler for " + pkg.dir + "; keep the installed predecessor before switching toolchains")
    ts ??= typeScriptOf(config)
    const { stdout: version } = await must(quote(compiler) + " --version", { cwd: join(t, pkg.dir) })
    checks[pkg.dir] = { compiler: { path: compiler, version: version.trim() },
      ...await checkPackage({ compiler, ts, t, pkg, log: join(logs, "upstream-check-" + slug(pkg.dir) + ".log") }) }
  }
  return checks
}

async function upgradedCompilerChecks(config, logs, previous) {
  if (!Object.keys(previous).length) return {}
  const compiler = compilerOf(config), ts = typeScriptOf(config)
  const { stdout: version } = await must(quote(compiler) + " --version", { cwd: config.target })
  const checks = {}
  for (const pkg of config.packages.filter(pkg => previous[pkg.dir])) checks[pkg.dir] = {
    compiler: { path: compiler, version: version.trim() },
    ...await checkPackage({ compiler, ts, t: config.target, pkg, log: join(logs, "upgraded-check-" + slug(pkg.dir) + ".log") })
  }
  return checks
}

const failedCount = tests => Array.isArray(tests?.failed) ? tests.failed.length : tests?.failed ?? 0
const testsPassed = tests => tests?.code === 0 && failedCount(tests) === 0
const verificationDescription = result => testsPassed(result.tests)
  ? "tests, declarations and style pass"
  : result.tests?.code === undefined ? "declarations and style pass; test command status was not recorded"
  : "declarations and style pass; tests still fail (exit " + result.tests.code + ", " + failedCount(result.tests) + " failing tests)"
const testReportLabel = result => {
  const tests = result.tests
  if (!result.checks.tests) return "FAIL: " + tests.newFailures.length + " new, " + tests.missing.length + " missing"
  if (tests.code === undefined) return "unknown: test command status not recorded"
  if (!testsPassed(tests)) return "FAIL (unchanged): " + failedCount(tests) + " failing tests, exit " + tests.code
  return tests.total === null ? "pass (command exit 0)" : "pass (" + tests.passed + "/" + tests.total + ")"
}

const testsOf = (r) => ({ code: r.code, total: r.total, passed: r.passed, failed: r.failed, skipped: r.skipped, ms: r.ms })

/**
 * upgrade-effect: the first step. Starts the run's bookmark on the base, runs
 * the target's tests as they are, moves every Effect version on Effect's major
 * line to the exact one the VibeLang runtime requires (with the overrides that
 * keep one copy installed), installs, runs the tests again, and commits the
 * upgrade on its own, before any VibeLang change. New failures or compiler
 * errors reject the run before setup can accept them as its baseline.
 */
export async function upgradeEffect(options) {
  const p = paths(options.run)
  if (existsSync(p.upgrade)) { assertBaselineSafe(p, { includeSetup: false }); return readJson(p.upgrade) }
  if (existsSync(p.setup)) { assertBaselineSafe(p); return { skipped: "this run was set up before upgrade-effect was a step" } }
  const config = existsSync(p.config) ? readJson(p.config) : makeConfig(options)
  writeJson(p.config, config)
  const t = config.target
  const logs = join(p.baseline, "logs")
  const repo = await Jj.ensureRepo(t)
  const dirty = await Jj.changedPaths(t)
  if (dirty.length && !options.allowDirty) throw new Error(`${t} has uncommitted changes (${dirty.slice(0, 5).map((d) => d.path).join(", ")}); commit them or pass --allow-dirty`)
  // The migration starts on its bookmark when an earlier run left one, else on the base (the default branch).
  const previous = await Jj.bookmarkTarget(t, config.bookmark)
  const base = config.base ?? (previous ? config.bookmark : "trunk()")
  const baseCommit = await Jj.commitId(t, base)
  if (/^0+$/.test(baseCommit)) throw new Error(`${base} is the root commit: the target has no default branch jj knows; pass --base <branch>`)
  if ((await Jj.commitId(t, "@-")) !== baseCommit) {
    if (dirty.length) throw new Error(`${t}'s working copy is not on ${base}; commit or discard its changes first`)
    await Jj.newAt(t, baseCommit)
  }

  const manager = Wire.packageManager(readdirSync(t))
  const install = (name) => must(config.install ?? Wire.installCommand(manager, readdirSync(t)), { cwd: t, log: join(logs, `${name}-install.log`) })
  const testRun = (name) => runTests({ command: config.test.command, report: config.test.report, cwd: join(t, config.test.cwd), root: t, jsonFile: join(p.baseline, `${name}.vitest.json`), log: join(logs, `${name}-tests.log`) })
  // The target's own tests first, as it is: what fails here fails before the migration touches anything.
  await install("upstream")
  const priorChecks = await previousCompilerChecks(config, logs)
  writeJson(join(p.baseline, "upstream-checks.json"), priorChecks)
  const upstreamBuild = await prepareBuilds(config, logs, "upstream")
  const before = await testRun("upstream")
  if (before.code !== 0 && !before.tests) throw new Error(`the target's tests do not run (exit ${before.code}); see ${join(logs, "upstream-tests.log")}`)
  writeJson(join(p.baseline, "upstream-tests.json"), { code: before.code, tests: before.tests })
  // The installed compiler migrates its own .vibe modules before the new one replaces it.
  const vip = await applyEarlierVipFixes(config, logs)

  const to = await runtimeEffect(config)
  const workspaceFile = join(t, "pnpm-workspace.yaml")
  const globs = Upgrade.workspaceGlobs(readFileSync(join(t, "package.json"), "utf8"), existsSync(workspaceFile) ? readFileSync(workspaceFile, "utf8") : "")
  const submodules = Wire.submodulePaths(t)
  const manifests = Upgrade.workspaceManifests((await Jj.trackedFiles(t)).filter((f) => (/(?:^|\/)package\.json$/.test(f) || f === "pnpm-workspace.yaml") && !Wire.inSubmodule(submodules, f)), globs)
    .sort((a, b) => (a === "package.json" ? -1 : b === "package.json" ? 1 : a === "pnpm-workspace.yaml" ? -1 : b === "pnpm-workspace.yaml" ? 1 : a < b ? -1 : 1))
  const upgrade = Upgrade.planUpgrade(manifests.map((path) => ({ path, text: readFileSync(join(t, path), "utf8") })), to, manager)
  for (const f of upgrade.files) writeFileSync(join(t, f.path), f.text)
  // A patch named for a moved package's old version is renamed for the new one, its manifest hunks carried with it.
  for (const patch of upgrade.patches) {
    writeFileSync(join(t, patch.to), Upgrade.carryPatch(readFileSync(join(t, patch.from), "utf8"), patch.versions, to))
    rmSync(join(t, patch.from))
  }
  const vibelang = repinVibeLang(config, manifests)
  const written = [...new Set([...upgrade.files.map((f) => f.path), ...vibelang.manifests, ...vibelang.written])]
  const changed = [...written, ...upgrade.patches.flatMap((patch) => [patch.from, patch.to]), ...vibelang.patchFiles, ...vip.changed]
  const formatted = await formatWritten(t, written, join(logs, "upgrade-format.log"))

  let after = before
  let upgradedBuild = upstreamBuild
  let comparison = null
  let commit = null
  if (changed.length) {
    await install("upgraded")
    upgradedBuild = await prepareBuilds(config, logs, "upgraded")
    after = await testRun("upgraded")
    comparison = compareTests(before, after)
    const issue = regressionIssue({
      change: `Upgrading Effect from ${upgrade.from} to ${to}`, command: config.test.command, cwd: config.test.cwd, changed, before, after, comparison,
      logs: { before: join(logs, "upstream-tests.log"), after: join(logs, "upgraded-tests.log") }
    })
    if (issue) appendJsonl(p.issues, issue)
    await assertPortable(t, machineRoots(t, p.run, config.toolchain.dir))
    const moved = upgrade.files.length || upgrade.patches.length
    commit = await Jj.commit(t, moved ? `migrate(vibelang): upgrade Effect to ${to}\n\nThe VibeLang runtime requires exactly effect ${to}. Moves effect and every\n@effect/* package on its major line from ${upgrade.from} to ${to}, with overrides\nthat keep one copy installed.${vibelang.manifests.length ? " The VibeLang packages it already uses move\nto this run's release, which requires that Effect." : ""}${vip.changed.length ? vipSentence(vip) : " No source file changes;\nVibeLang comes next."}` : switchMessage(config, vip))
  }
  writeJson(join(p.baseline, "upgraded-tests.json"), { code: after.code, tests: after.tests })
  writeJson(join(p.baseline, "upgraded-checks.json"), await upgradedCompilerChecks(config, logs, priorChecks))
  // A --base names where the run starts, so the bookmark restarts there even when an earlier run left it elsewhere.
  await Jj.setBookmark(t, config.bookmark, commit ?? baseCommit, { restart: Boolean(config.base) })
  const result = {
    at: new Date().toISOString(),
    jj: { initialized: repo.initialized, base, baseCommit, commit: commit ?? baseCommit, bookmark: config.bookmark },
    effect: { from: upgrade.from, to },
    builds: { upstream: upstreamBuild, upgraded: upgradedBuild },
    pins: upgrade.pins,
    bumped: upgrade.bumped,
    selectors: upgrade.selectors,
    patches: upgrade.patches.map(({ from, to }) => ({ from, to })),
    vibelang: vibelang.manifests,
    vibelangPatches: vibelang.patches,
    vipFixes: vip,
    changed,
    formatted,
    upstreamTests: testsOf(before),
    tests: testsOf(after),
    regressions: comparison && { newFailures: comparison.newFailures, missing: comparison.missing, exit: { before: before.code, after: after.code } }
  }
  writeJson(p.upgrade, result)
  assertBaselineSafe(p, { includeSetup: false })
  return result
}

/**
 * Applies the installed compiler's VIP migrations to the .vibe modules an
 * earlier run migrated, only across the VIP-1 flip, before repinning VibeLang:
 * `vibelang -p <tsconfig> --fix --fix-vip-only` with the `vibelang` installed
 * nearest each project that holds a tracked .vibe file. Only that compiler can
 * still make them: once VIP-1's rules apply, a later one cannot tell which
 * unmarked helpers were Effect functions (opencode: 187 errors in ai's 15
 * modules, none after the earlier compiler's 165 fixes). Returns the .vibe
 * files it changed, projects run, failures, probe declarations and skip reasons.
 */
async function applyEarlierVipFixes(config, logs) {
  const t = config.target
  const vibe = (await Jj.trackedFiles(t)).filter((f) => f.endsWith(".vibe") && !f.split("/").includes("node_modules"))
  const empty = { changed: [], projects: [], failed: [] }
  if (!vibe.length) return empty
  const plan = earlierVipProjects(t, vibe)
  let ts
  try { ts = typeScriptOf(config) }
  catch (error) { return { ...empty, skipped: `VIP-1 probe failed: ${error.message}` } }
  const first = plan.find(entry => entry.compiler)
  const target = await probeTargetVip1({ toolchain: config.toolchain, readToolchain,
    nodeModules: first && dirname(dirname(join(t, first.compiler))), directory: logs,
    log: join(logs, "vip-probe-target.log"), ts })
  const probes = { target, installed: [] }
  if (target.error) return { ...empty, skipped: target.error, probes }
  const before = new Map(vibe.map((f) => [f, readFileSync(join(t, f), "utf8")]))
  const failed = [], projects = [], skippedProjects = [], installed = new Map()
  for (const { project, compiler } of plan) {
    if (!compiler) {
      skippedProjects.push({ project, reason: "no installed vibelang" })
      continue
    }
    if (!installed.has(compiler)) {
      const result = await probeVip1({ compiler: join(t, compiler),
        nodeModules: dirname(dirname(join(t, compiler))), directory: logs,
        log: join(logs, `vip-probe-installed-${slug(compiler)}.log`), ts })
      installed.set(compiler, result)
      probes.installed.push({ compiler, ...result })
    }
    const previous = installed.get(compiler)
    const reason = previous.error ?? (previous.side === target.side ? "same side of the flip"
      : previous.side !== "pre" || target.side !== "post" ? "switch does not cross from pre-flip to post-flip" : null)
    if (reason) {
      skippedProjects.push({ project, reason })
      continue
    }
    projects.push(project)
    const result = await sh(`${quote(join(t, compiler))} -p ${quote(join(t, project))} --fix --fix-vip-only --noEmit --pretty false`,
      { cwd: join(t, posix.dirname(project)), log: join(logs, `vip-fix-${slug(posix.dirname(project))}.log`) })
    if (result.code !== 0) failed.push({ project, code: result.code })
  }
  return { changed: vibe.filter((f) => readFileSync(join(t, f), "utf8") !== before.get(f)), projects, failed, probes,
    ...(skippedProjects.length ? { skippedProjects } : {}),
    ...(!projects.length ? { skipped: [...new Set(skippedProjects.map(p => p.reason))].join("; ") || "no project with a tracked .vibe file" } : {}) }
}

/**
 * The projects applyEarlierVipFixes runs on, sorted: the nearest tsconfig.json
 * at or above each of vibe (repository-relative .vibe files in t), once each,
 * with the vibelang installed nearest that project, or undefined.
 */
export function earlierVipProjects(t, vibe) {
  // The nearest name at or above file's directory, repository-relative.
  const upward = (file, name) => {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      if (existsSync(join(t, dir, name))) return posix.join(dir, name)
      if (dir === ".") return undefined
    }
  }
  return [...new Set(vibe.map((f) => upward(f, "tsconfig.json")).filter(Boolean))].sort()
    .map((project) => ({ project, compiler: upward(project, "node_modules/.bin/vibelang") }))
}

// The sentence a commit adds for the VIP migrations applyEarlierVipFixes made.
const vipSentence = (vip) => vip.changed.length
  ? ` First applies the earlier toolchain's VIP migrations\n(vibelang --fix --fix-vip-only) to ${vip.changed.length} .vibe file${vip.changed.length === 1 ? "" : "s"}.`
  : ""

/** The commit of an upgrade step that moved no Effect package: only VibeLang's pins changed. */
function switchMessage(config, vip) {
  const name = config.toolchain.kind === "staged" ? readToolchain(config.toolchain.dir).commit?.slice(0, 12) ?? config.toolchain.dir : config.toolchain.version
  return `migrate(vibelang): switch to the toolchain of VibeLang ${name}\n\nEffect stays where it is. Repins vibelang and its packages.${vipSentence(vip)}`
}

/**
 * Moves a repository VibeLang already set up to the VibeLang this run
 * installs, for the Effect upgrade's commit: the runtime pins Effect exactly,
 * so the new Effect under the old runtime would fail for the runtime's sake.
 * Each VibeLang package a workspace manifest depends on moves to this run's
 * version, a staged toolchain's tarballs copied where setup puts them, and
 * the manifests it changed are returned, with what carryVibeLangPatches did.
 */
function repinVibeLang(config, manifests) {
  const t = config.target
  const files = manifests.filter((path) => posix.basename(path) === "package.json").map((path) => ({ path, text: readFileSync(join(t, path), "utf8") }))
  if (!files.some((f) => Upgrade.repinVibeLang(f.text, {}).found.length)) return { manifests: [], written: [], patchFiles: [], patches: [] }
  let version = config.toolchain.version
  let specsFor = () => ({ vibelang: version, "vibelang-runtime": version, "vibelang-vite": version, "vibelang-unplugin": version })
  let release = () => undefined
  const ignored = []
  if (config.toolchain.kind === "staged") {
    const toolchain = readToolchain(config.toolchain.dir)
    version = toolchain.version
    // A repository set up from a published VibeLang has no ignore line for the tarballs yet, and the upgrade commit would carry them.
    const ignore = join(t, ".gitignore")
    const ignoreText = existsSync(ignore) ? readFileSync(ignore, "utf8") : ""
    const ignoreNext = Wire.setIgnoreLine(ignoreText, `${Wire.toolchainDirectory}/`, true)
    if (ignoreNext !== ignoreText) {
      writeFileSync(ignore, ignoreNext)
      ignored.push(".gitignore")
    }
    const local = join(t, Wire.toolchainDirectory)
    rmSync(local, { recursive: true, force: true })
    const tarballs = Wire.copyTarballs(toolchain.dir, toolchain.packages, local)
    specsFor = (dir) => Wire.toolchainSpecs(dir, tarballs)
    release = (name) => toolchain.packages[name] && Upgrade.tarballFiles(readFileSync(join(toolchain.dir, toolchain.packages[name])))
  }
  const changed = []
  const moved = new Map()
  for (const f of files) {
    const repinned = Upgrade.repinVibeLang(f.text, specsFor(posix.dirname(f.path)))
    for (const { name, from } of repinned.moved) moved.set(name, new Set([...(moved.get(name) ?? []), from]))
    if (repinned.text !== f.text) {
      writeFileSync(join(t, f.path), repinned.text)
      changed.push(f.path)
    }
  }
  const carried = carryVibeLangPatches(t, moved, version, release)
  return { manifests: changed, ...carried, written: [...ignored, ...carried.written] }
}

/**
 * The patched dependencies and selectors that name a VibeLang package's old
 * version, carried to the version this run installs, which pnpm otherwise
 * refuses as an unused patch: a patch the new release already contains goes,
 * with its file; one that still applies moves to the new version, as
 * Effect's do; one that does neither stops the upgrade for a person to
 * update. release(name) gives the new release's files, or undefined for a
 * published version, whose patches move. moved maps each package to its old
 * versions.
 */
function carryVibeLangPatches(t, moved, version, release) {
  const written = []
  const patchFiles = []
  const patches = []
  for (const path of ["pnpm-workspace.yaml", "package.json"]) {
    const file = join(t, path)
    if (!moved.size || !existsSync(file)) continue
    const before = readFileSync(file, "utf8")
    let text = before
    for (const entry of Upgrade.patchedDependencies(path, before)) {
      if (!moved.get(entry.name)?.has(entry.version) || entry.version === version) continue
      const files = release(entry.name)
      const state = files ? Upgrade.patchState(readFileSync(join(t, entry.patch), "utf8"), (p) => files[p]) : "applies"
      const record = { key: entry.key, patch: entry.patch, release: `${entry.name}@${version}` }
      if (state === "conflict") throw new Error(`${entry.patch} patches ${entry.key}, and ${entry.name}@${version} neither has the lines it changes nor its change: update the patch for ${entry.name}@${version}, or delete it, then run upgrade-effect again`)
      if (state === "contained") {
        text = Upgrade.dropPatchedDependency(path, text, entry.key)
        rmSync(join(t, entry.patch))
        patchFiles.push(entry.patch)
        patches.push({ ...record, outcome: "dropped: the release contains it" })
      } else {
        patches.push({ ...record, outcome: "moved" })
      }
    }
    const carried = Upgrade.carrySelectors(text, moved, version)
    for (const patch of carried.patches) {
      writeFileSync(join(t, patch.to), Upgrade.carryPatch(readFileSync(join(t, patch.from), "utf8"), patch.versions, version))
      rmSync(join(t, patch.from))
      patchFiles.push(patch.from, patch.to)
      for (const p of patches) if (p.patch === patch.from && p.outcome === "moved") p.outcome = `moved to ${patch.to}`
    }
    if (carried.text !== before) {
      writeFileSync(file, carried.text)
      written.push(path)
    }
  }
  return { written, patchFiles, patches }
}

/**
 * Wires each of packages: the runtime and compiler dependencies and vibelang
 * for tsc in its package.json, and .vibe sources in its tsconfigs.
 */
function wirePackages({ t, ts, packages, specsFor, writeIfChanged, warnings }) {
  for (const pkg of packages) {
    const path = join(t, pkg.dir, "package.json")
    // A migrated module's declarations spell a relative import as the package's sources do (C′).
    const sources = pkg.sources.flatMap((dir) => listSources(t, posix.join(pkg.dir, dir)))
    const spelling = Wire.importSpelling(sources.map((file) => readFileSync(join(t, file), "utf8")))
    if (!spelling.style && Object.values(spelling.counts).some(Boolean)) {
      const counts = Object.entries(spelling.counts).filter(([, n]) => n).map(([style, n]) => `${n} ${style}`).join(", ")
      warnings.push(`setup leaves ${pkg.dir}'s declarations importing migrated modules as ./x.js: its sources mix relative import spellings (${counts}), so no vibelang.declarationImportStyle fits; make them one spelling and run setup again`)
    }
    const next = Wire.addVibeLang(readJson(path), specsFor(pkg.dir))
    next.scripts = Wire.replaceTsc(next.scripts)
    writeIfChanged(path, readFileSync(path, "utf8"), JSON.stringify(next, null, 2) + "\n")
    const dir = join(t, pkg.dir)
    // A solution-style tsconfig's referenced projects compile the sources, so they are wired too.
    for (const tsconfig of new Set([pkg.tsconfig, pkg.dtsTsconfig, ...Wire.projectsOf(ts, dir, pkg.tsconfig), ...Wire.projectsOf(ts, dir, pkg.dtsTsconfig)])) {
      const file = join(dir, tsconfig)
      const text = readFileSync(file, "utf8")
      // Each compile writes x.d.vibe.ts beside x.vibe, which every other TypeScript checker reads,
      // and the project lists .vibe files where it lists .ts files. An earlier setup's
      // declarationSidecars setting is retired: the compiler rejects it (TS5023).
      const current = Wire.removeVibeLangSetting(text, ts, "declarationSidecars")
      // ".js" is the default, so an earlier setup's other spelling goes; mixed sources keep what the file says.
      const styled = !spelling.style ? current
        : spelling.style === ".js" ? Wire.removeVibeLangSetting(current, ts, "declarationImportStyle")
        : Wire.addVibeLangSetting(current, ts, "declarationImportStyle", spelling.style)
      writeIfChanged(file, text, Wire.addCompilerOptions(Wire.addVibeIncludes(styled, ts), { rewriteRelativeImportExtensions: true }))
    }
  }
}

/**
 * setup under --no-wire: the target already has VibeLang, and setup leaves its
 * wiring as it is, except for a package of the run that has none yet, such as
 * a directory added to --package after an earlier setup wired the others
 * (t3code's oxlint-plugin-t3code, scripts and evals). Each such package is
 * wired as wireTarget wires a package, with the specifiers a wired package of
 * the run already names, rebased to its directory, so it installs the same
 * tarballs or version; then the target installs. Returns null when every
 * package has VibeLang or none does, else what changed.
 */
export async function wireNewPackages(config, log) {
  const t = config.target
  const submodules = Wire.submodulePaths(t)
  const packages = config.packages.filter((pkg) => !Wire.inSubmodule(submodules, pkg.dir) && existsSync(join(t, pkg.dir, "package.json")))
  const isWired = (pkg) => Wire.hasVibeLang(readJson(join(t, pkg.dir, "package.json")))
  const added = packages.filter((pkg) => !isWired(pkg))
  if (!added.length) return null
  const wired = packages.find(isWired)
  // No wired package to take specifiers from: wire nothing, as --no-wire says, rather than guess them.
  if (!wired) return null
  const from = readJson(join(t, wired.dir, "package.json"))
  const specsFor = (dir) => Wire.specsFrom(from, wired.dir, dir)
  const changed = []
  const writeIfChanged = (path, before, after) => {
    if (before === after) return
    writeFileSync(path, after)
    changed.push(posix.relative(t, path))
  }
  const warnings = []
  wirePackages({ t, ts: typeScriptOf(config), packages: added, specsFor, writeIfChanged, warnings })
  const formatted = await formatWritten(t, changed, join(log, "setup-format.log"))
  if (formatted.code !== 0) warnings.push(`${formatted.formatter} exited ${formatted.code} on the files setup wrote; see ${join(log, "setup-format.log")}`)
  const manager = Wire.packageManager(readdirSync(t))
  const install = config.install ?? Wire.installCommand(manager, readdirSync(t))
  await must(install, { cwd: t, log: join(log, "install.log") })
  return { manager, added: added.map((pkg) => pkg.dir), specs: Object.fromEntries(added.map((pkg) => [pkg.dir, specsFor(pkg.dir)])), formatted, changed, warnings, install }
}

/** Sets VibeLang up in the target: dependencies, scripts, the Vite plugin, tsconfigs and the declaration sidecars' format ignore. Returns what it changed. */
export async function wireTarget(config, log) {
  const t = config.target
  const changed = []
  const warnings = []
  // A Git submodule's packages stay as its own repository has them (alchemy-31).
  const submodules = Wire.submodulePaths(t)
  const packages = config.packages.filter((pkg) => !Wire.inSubmodule(submodules, pkg.dir))
  for (const pkg of config.packages) {
    if (!packages.includes(pkg)) warnings.push(`setup leaves ${pkg.dir} as it is: it is inside a Git submodule, ${submodules.find((dir) => Wire.inSubmodule([dir], pkg.dir))}, whose files a commit of this repository cannot hold`)
  }
  const toolchain = config.toolchain.kind === "staged" ? readToolchain(config.toolchain.dir) : null
  // A staged toolchain's tarballs go into an ignored directory at the target's
  // root, named relatively by each package; a published version is an exact
  // registry version, and a toolchain directory an earlier run left is removed.
  const ignore = join(t, ".gitignore")
  const ignoreText = existsSync(ignore) ? readFileSync(ignore, "utf8") : ""
  const ignoreNext = Wire.setIgnoreLine(ignoreText, `${Wire.toolchainDirectory}/`, Boolean(toolchain))
  if (ignoreNext !== ignoreText) {
    writeFileSync(ignore, ignoreNext)
    changed.push(".gitignore")
  }
  const local = join(t, Wire.toolchainDirectory)
  rmSync(local, { recursive: true, force: true })
  const tarballs = toolchain ? Wire.copyTarballs(toolchain.dir, toolchain.packages, local) : {}
  const specsFor = (dir) => (toolchain
    ? Wire.toolchainSpecs(dir, tarballs)
    : { vibelang: config.toolchain.version, "vibelang-runtime": config.toolchain.version, "vibelang-vite": config.toolchain.version, "vibelang-unplugin": config.toolchain.version })

  const writeIfChanged = (path, before, after) => {
    if (before === after) return
    writeFileSync(path, after)
    changed.push(posix.relative(t, path))
  }
  const ts = typeScriptOf(config)
  wirePackages({ t, ts, packages, specsFor, writeIfChanged, warnings })
  // Effect's lint rules run on .vibe files where the root's scripts run them on .ts files (VIP-38).
  const rootPackage = join(t, "package.json")
  if (existsSync(rootPackage)) {
    const before = readFileSync(rootPackage, "utf8")
    const root = JSON.parse(before)
    const readConfig = (file) => existsSync(join(t, file)) ? readFileSync(join(t, file), "utf8") : undefined
    const next = Wire.addCompilerScripts(root, specsFor(".").vibelang)
    const scripts = Wire.addEffectLint(next.scripts, readConfig)
    if (JSON.stringify(scripts) !== JSON.stringify(next.scripts ?? {})) next.scripts = scripts
    if (JSON.stringify(next) !== JSON.stringify(root)) writeIfChanged(rootPackage, before, JSON.stringify(next, null, 2) + "\n")
  }
  // Every project resolves an import of ./x.vibe to its sidecar, as stock TypeScript does under this option.
  for (const tsconfig of Wire.rootTsconfigs(t, ts)) {
    const file = join(t, tsconfig)
    const text = readFileSync(file, "utf8")
    writeIfChanged(file, text, Wire.addCompilerOptions(Wire.removeVibeLangSetting(text, ts, "declarationSidecars"), { allowArbitraryExtensions: true }))
  }
  const testProjects = wireTestProjects({ root: t, packages, ts })
  changed.push(...testProjects.changed.filter(file => !changed.includes(file)))
  warnings.push(...testProjects.warnings)
  appendJsonl(join(log, "test-projects.jsonl"), { at: new Date().toISOString(), ...testProjects })
  // The sidecars are vibelang's output, in its format; formatters leave them alone.
  const formatIgnore = join(t, ".prettierignore")
  const formatIgnoreText = existsSync(formatIgnore) ? readFileSync(formatIgnore, "utf8") : ""
  writeIfChanged(formatIgnore, formatIgnoreText, Wire.setIgnoreLine(formatIgnoreText, Wire.sidecarIgnore, true))
  // And Oxlint leaves them alone: it reads x.d.vibe.ts as TypeScript, not as a declaration file.
  for (const name of Wire.oxlintConfigs.filter((name) => existsSync(join(t, name)))) {
    const text = readFileSync(join(t, name), "utf8")
    const next = Wire.addOxlintIgnore(text)
    if (next === null) warnings.push(`${name}: add "**/${Wire.sidecarIgnore}" to its ignorePatterns by hand`)
    else writeIfChanged(join(t, name), text, next)
  }
  // Oxlint's plugin host is Node: a JS plugin the migration moves to VibeLang loads through vibelang/register.
  for (const file of wireOxlintPlugins({ root: t, migrated: config.packages.map((pkg) => pkg.dir), ts })) if (!changed.includes(file)) changed.push(file)
  // pnpm 11 and later fail an install that leaves a build script undecided, and vibelang's dprint has one that links its binary.
  if (Wire.packageManager(readdirSync(t)) === "pnpm") {
    const workspace = join(t, "pnpm-workspace.yaml")
    const text = existsSync(workspace) ? readFileSync(workspace, "utf8") : ""
    writeIfChanged(workspace, text, Upgrade.setYamlMap(text, "allowBuilds", { dprint: true }))
  }
  // bun test loads .vibe modules through vibelang/bun, which only a [test] preload applies to it.
  const testCwd = join(t, config.test.cwd)
  const testScripts = existsSync(join(testCwd, "package.json")) ? readJson(join(testCwd, "package.json")).scripts : undefined
  if (Wire.runsBunTest(config.test.command, testScripts)) {
    const bunfig = join(testCwd, "bunfig.toml")
    const text = existsSync(bunfig) ? readFileSync(bunfig, "utf8") : ""
    writeIfChanged(bunfig, text, Wire.addBunTestPreload(text))
  }
  // And in every package that runs bun test and reaches migrated sources: a workspace import loads them too.
  const bunTests = Wire.wireBunTests({ root: t, packages: packages, specsFor })
  changed.push(...bunTests.changed.filter((file) => !changed.includes(file)))
  warnings.push(...bunTests.warnings)
  // The plugin goes into the config the tests load: the shared one the test command names, else each package's.
  const vite = Wire.wireVite({ root: t, packages: packages, test: config.test, ts, specsFor })
  changed.push(...vite.changed.filter((file) => !changed.includes(file)))
  warnings.push(...vite.warnings)
  const tooling = wireDeveloperTools({ root: t, specsFor, ts })
  changed.push(...tooling.changed.filter(file => !changed.includes(file)))
  warnings.push(...tooling.warnings)
  // And into every other config that bundles migrated sources: apps, examples and websites build and serve them too.
  const apps = Wire.wireViteApps({ root: t, packages: packages, ts, specsFor, wired: vite.configs })
  changed.push(...apps.changed.filter((file) => !changed.includes(file)))
  warnings.push(...apps.warnings)
  // Metro, Babel and oxc-transform-react read a module's source themselves; each gets vibelang's adapter (lib/react-tools.mjs).
  const reactTools = wireReactTools({ root: t, packages: packages, ts, specsFor })
  changed.push(...reactTools.changed.filter((file) => !changed.includes(file)))
  warnings.push(...reactTools.warnings)
  // A bundle reaches .vibe modules through vibelang-unplugin/bun: vibelang/bun's runtime plugin does not apply to Bun.build.
  const bunBuilds = Wire.wireBunBuilds({ root: t, packages: packages, ts, specsFor })
  changed.push(...bunBuilds.changed.filter((file) => !changed.includes(file)))
  warnings.push(...bunBuilds.warnings)
  // And esbuild's build and context calls in scripts and sources (a sandbox bundles migrated flows); tests stay as they are (decided detail 272).
  const esbuildBuilds = wireEsbuildBuilds({ root: t, packages: packages, ts, specsFor })
  changed.push(...esbuildBuilds.changed.filter((file) => !changed.includes(file)))
  warnings.push(...esbuildBuilds.warnings)
  // Publication helpers may live in a shared scripts package rather than a migrated package.
  const publishing = wirePublishingScripts({ root: t, ts })
  changed.push(...publishing.changed.filter((file) => !changed.includes(file)))
  warnings.push(...publishing.warnings)
  // Knip reads .vibe files through vibelang/knip.
  const knip = Wire.wireKnip({ root: t, specs: specsFor(".") })
  changed.push(...knip.changed.filter((file) => !changed.includes(file)))
  warnings.push(...knip.warnings)
  // What setup wrote is in the repository's own format.
  const formatted = await formatWritten(t, changed, join(log, "setup-format.log"))
  if (formatted.code !== 0) warnings.push(`${formatted.formatter} exited ${formatted.code} on the files setup wrote; see ${join(log, "setup-format.log")}`)
  const manager = Wire.packageManager(readdirSync(t))
  const install = config.install ?? Wire.installCommand(manager, readdirSync(t))
  await must(install, { cwd: t, log: join(log, "install.log") })
  for (const build of tooling.builds) await must(build.command, { cwd: join(t, build.cwd), log: join(log, "ast-grep-build.log") })
  const emittedImports = await wireEmittedProjects(config, ts, join(log, "emitted-imports"))
  changed.push(...emittedImports.changed.filter(file => !changed.includes(file)))
  const existingVibe = await formatExistingVibe(config, join(log, "setup-format-vibe.log"))
  if (existingVibe.code !== 0) warnings.push(`vibelang-format exited ${existingVibe.code} on the repository's .vibe files; see ${join(log, "setup-format-vibe.log")}`)
  return { manager, emittedImports, formattedVibe: existingVibe.files, specs: Object.fromEntries(packages.map((pkg) => [pkg.dir, specsFor(pkg.dir)])), viteConfigs: vite.configs, viteAppConfigs: apps.configs, nativeViteConfigs: apps.nativeConfigs ?? [], knipConfig: knip.config, formatted, changed, warnings, install }
}

/**
 * Only accept product wiring whose published declarations stay byte-identical.
 * Roll back every planned edit if emitting or comparison fails.
 */
export async function wireEmittedProjects(config, ts, log) {
  const root = config.target
  const plan = planEmittedImports({ root, ts, packages: config.packages, projects: config.emittedProjects, compiler: compilerOf(config) })
  if (!plan.changed.length) return { changed: [], modules: plan.modules }
  const packages = config.packages.filter(pkg => plan.modules.some(m => packageOf(config, m.source) === pkg) &&
    readJson(join(root, pkg.dir, "package.json")).private !== true)
  const snapshot = async label => {
    const result = new Map()
    for (const pkg of packages) {
      const outDir = join(log, label, slug(pkg.dir))
      const emitted = await emitPackageDeclarations({ compiler: compilerOf(config), ts, t: root, pkg, outDir, log: outDir + ".log" })
      if (emitted.code !== 0) throw new Error("emitted import wiring: declaration emit failed for " + pkg.dir + "; see " + outDir + ".log")
      const visit = dir => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const file = join(dir, entry.name)
          if (entry.isDirectory()) visit(file)
          else if (/\.d\.(?:ts|mts|cts)$/.test(file)) result.set(pkg.dir + "/" + posix.relative(outDir, file), readFileSync(file, "utf8"))
        }
      }
      visit(outDir)
    }
    return result
  }
  const before = await snapshot("before")
  if (packages.length && !before.size) throw new Error("emitted import wiring: published packages emitted no declarations")
  applyEmittedImports(plan, { root })
  try {
    const formatted = await formatWritten(root, plan.changed, join(log, "format.log"))
    if (formatted.code !== 0) throw new Error("emitted import wiring: formatting failed; see " + join(log, "format.log"))
    const after = await snapshot("after")
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file) !== after.get(file))
    if (changed.length) throw new Error("emitted import wiring changes published declarations: " + changed.join(", "))
  } catch (error) {
    applyEmittedImports(plan, { root, restore: true })
    throw error
  }
  return { changed: plan.changed, modules: plan.modules, declarations: "byte-identical" }
}

/**
 * Moves the working copy to the upgrade's commit. An earlier setup's toolchain
 * directory is ignored only by that setup's .gitignore, so jj would snapshot
 * its tarballs into this setup's commit; it goes first, and wiring copies it again.
 */
export async function returnToUpgrade(t, commit) {
  rmSync(join(t, Wire.toolchainDirectory), { recursive: true, force: true })
  await Jj.newAt(t, commit)
}

/** setup: on the Effect upgrade's commit, wire the toolchain, install, record the baseline tests, compile, declarations and inventory, and commit. */
export async function setup(options) {
  const p = paths(options.run)
  assertBaselineSafe(p, { includeSetup: existsSync(p.setup) })
  if (existsSync(p.setup)) return readJson(p.setup)
  const upgrade = readJsonIf(p.upgrade)
  if (!upgrade) throw new Error("upgrade-effect has not run: it is the first step, and setup continues from its commit")
  const config = readJson(p.config)
  const t = config.target
  const logs = join(p.baseline, "logs")
  // The working copy holds at most what the run's own installs changed since the upgrade's commit.
  if ((await Jj.commitId(t, "@-")) !== upgrade.jj.commit) {
    if ((await Jj.changedPaths(t)).length) throw new Error(`${t}'s working copy is not on the Effect upgrade's commit ${upgrade.jj.commit.slice(0, 12)}; commit or discard its changes first`)
    await returnToUpgrade(t, upgrade.jj.commit)
  }
  // The tests as the upgrade left them are what setting VibeLang up is compared with.
  const upstream = readJson(join(p.baseline, "upgraded-tests.json"))
  // Under --no-wire, only a package of the run that has no VibeLang yet is wired.
  const wired = config.wire ? await wireTarget(config, logs) : await wireNewPackages(config, logs)
  const compiler = compilerOf(config)
  const { stdout: version } = await must(`${JSON.stringify(compiler)} --version`)

  // The baseline every batch is compared with: the tests with VibeLang set up and nothing migrated.
  const baselineBuild = await prepareBuilds(config, logs, "baseline")
  const tests = await runTests({ command: config.test.command, report: config.test.report, cwd: join(t, config.test.cwd), root: t, jsonFile: join(p.baseline, "baseline.vitest.json"), log: join(logs, "baseline-tests.log") })
  writeJson(join(p.baseline, "tests.json"), { code: tests.code, tests: tests.tests, build: baselineBuild })
  assertBaselineSafe(p)
  const wiring = wired ? compareTests(upstream, tests) : null
  // Setting VibeLang up broke tests before any file moved: record it, so it is
  // not mistaken for a batch's regression, and finish setup with its evidence.
  const issue = wiring && regressionIssue({
    change: "Setting up VibeLang (the compiler, the runtime and the Vite plugin)",
    command: config.test.command, cwd: config.test.cwd, changed: wired.changed, before: upstream, after: tests, comparison: wiring,
    logs: { before: join(logs, upgrade.changed.length ? "upgraded-tests.log" : "upstream-tests.log"), after: join(logs, "baseline-tests.log") }
  })
  if (issue) appendJsonl(p.issues, issue)

  const compile = {}
  const declarations = {}
  const ts = typeScriptOf(config)
  for (const pkg of config.packages) {
    const checked = await checkPackage({ compiler, ts, t, pkg, log: join(logs, `compile-${slug(pkg.dir)}.log`) })
    writeJson(join(p.baseline, `compile-${slug(pkg.dir)}.json`), checked.diagnostics)
    compile[pkg.dir] = summarize(checked.diagnostics)
    assertBaselineSafe(p)
    declarations[pkg.dir] = await emitPackageDeclarations({ compiler, ts, t, pkg, outDir: join(p.baseline, "dts", slug(pkg.dir)), log: join(logs, `dts-${slug(pkg.dir)}.log`) })
  }

  const files = scopeFiles(config)
  const tokens = await countTokens(files.map((f) => join(t, f)))
  // An import through a tsconfig `paths` alias, ~/main, is a dependency edge as ./main is.
  const aliasPaths = Object.fromEntries(config.packages.map((pkg) => [pkg.dir, tsconfigPaths(ts, t, Wire.projectsOf(ts, join(t, pkg.dir), pkg.tsconfig).map((tsconfig) => join(t, pkg.dir, tsconfig)))]))
  const inventory = buildInventory({ root: t, packages: config.packages, tokens, coverage: readCoverage(t, config.packages), paths: aliasPaths })
  writeJson(p.inventory, inventory)

  // The target's coding agents get the skill, the language server and a check after each edit.
  const agents = config.wire ? await setUpAgents(t, config.packages[0].dir, logs) : null

  await assertPortable(t, machineRoots(t, p.run, config.toolchain.dir))
  const setupCommit = await Jj.commit(t, `migrate(vibelang): set up ${version.trim()}\n\nAdds the compiler, the runtime and the Vite plugin, replaces tsc with vibelang\nin scripts, lets .vibe files import modules by source name, and sets coding\nagents up for .vibe files (vibelang agents init). Effect\n${upgrade.effect.to} came in the commit before.`)
  await Jj.replaceBookmark(t, config.bookmark, setupCommit ?? upgrade.jj.commit, upgrade.jj.commit)
  const result = {
    at: new Date().toISOString(),
    jj: { initialized: upgrade.jj.initialized, base: upgrade.jj.base, baseCommit: upgrade.jj.baseCommit, upgradeCommit: upgrade.jj.commit, setupCommit: setupCommit ?? upgrade.jj.commit, bookmark: config.bookmark },
    compiler: { path: compiler, version: version.trim(), toolchain: config.toolchain.kind === "staged" ? readToolchain(config.toolchain.dir) : config.toolchain },
    effect: upgrade.effect,
    wired,
    agents,
    upstreamTests: upgrade.tests,
    tests: testsOf(tests),
    wiringRegressions: wiring && { newFailures: wiring.newFailures, missing: wiring.missing, exit: { before: upstream.code, after: tests.code } },
    compile,
    declarations,
    inventory: inventory.summary
  }
  writeJson(p.setup, result)
  return result
}

/** Runs an agent command: the prompt on stdin and in MIGRATE_PROMPT, in the target's root. */
async function runAgent(agent, { prompt, cwd, env, log }) {
  const result = await sh(agent, { cwd, env: { MIGRATE_PROMPT: prompt, ...env }, input: readFileSync(prompt, "utf8"), log })
  if (result.code !== 0) throw new Error(`the agent exited ${result.code}; log ${log}`)
  return result
}

/**
 * plan: write the planning prompt and a deterministic draft; accept an answer
 * (--accept file, or the file the agent wrote), validate it, and persist it.
 */
export async function plan(options) {
  if (options.scope) return (await import("./onepass.mjs")).onePassStep("plan", options)
  assertBaselineSafe(paths(options.run))
  const { p, config, inventory, setup } = loadRun(options.run)
  if (existsSync(p.plan)) return { plan: readJson(p.plan), accepted: true }
  if (!inventory) throw new Error("setup has not run")
  const nativeConfigs = setup?.wired?.nativeViteConfigs ?? setup?.nativeViteConfigs ?? []
  const draft = draftPlan(inventory, config.limits, { nativeConfigs })
  writeJson(p.planDraft, draft)
  writeText(p.planPrompt, planPrompt({ inventory, draft, limits: config.limits, output: p.planAnswer, nativeConfigs }))
  let answer = options.accept ? resolve(options.accept) : options.acceptDraft ? p.planDraft : null
  if (!answer && options.agent) {
    await runAgent(options.agent, { prompt: p.planPrompt, cwd: config.target, env: { MIGRATE_OUTPUT: p.planAnswer, MIGRATE_RUN: p.run }, log: join(p.run, "logs", "plan-agent.log") })
    answer = p.planAnswer
  }
  if (!answer) return { accepted: false, prompt: p.planPrompt, output: p.planAnswer, draft: p.planDraft }
  const proposed = readJson(answer)
  const { errors, warnings } = validatePlan(proposed, inventory, config.limits, { nativeConfigs })
  if (errors.length) throw new Error(`the plan is not valid:\n${errors.map((e) => `- ${e}`).join("\n")}`)
  const accepted = { ...proposed, source: options.acceptDraft ? "draft" : answer === p.planAnswer ? "agent" : `accepted ${answer}`, warnings, acceptedAt: new Date().toISOString() }
  writeJson(p.plan, accepted)
  return { plan: accepted, accepted: true }
}

// The tsconfig paths aliases of the target's projects (pathAliases), or none
// where no TypeScript compiler API is installed to read them.
export function aliasesOf(config) {
  try {
    return pathAliases(typeScriptOf(config), config.target)
  } catch {
    return undefined
  }
}

/** codemod: rename the batch to .vibe, rewrite imports, and run vibelang --fix to a fixed point. */
export async function codemod(options) {
  assertBaselineSafe(paths(options.run))
  const { p, config, plan: thePlan, inventory } = loadRun(options.run)
  if (!thePlan) throw new Error("plan has not been accepted")
  if (thePlan.mode === "one-pass") {
    const { onePassStep } = await import("./onepass.mjs")
    await onePassStep("rename", options)
    await onePassStep("fix", options)
    return readJson(p.codemod("01"))
  }
  const b = currentBatch(options.run, options.batch)
  if (existsSync(p.codemod(b))) return readJson(p.codemod(b))
  const t = config.target
  const files = thePlan.batches[Number(b) - 1].files
  // Setup's source inventory is the scan boundary; older runs without one
  // use the configured source directories, never all tracked text files.
  const references = () => [...new Set(inventory?.files.map(f => {
    if (existsSync(join(t, f.path))) return f.path
    const native = vibePath(f.path)
    return existsSync(join(t, native)) ? native : null
  }).filter(Boolean) ?? scopeFiles(config))]
  let state = readJsonIf(p.codemodState(b))
  if (!state) {
    state = prepareState(t, files, await importers(t), { ts: typeScriptOf(config), aliases: aliasesOf(config), references: references(), catalog: [...new Set([...(await Jj.trackedFiles(t)), ...references()])] })
    saveState(p.codemodState(b), state)
  }
  if (state.version !== 1 || state.target !== t || JSON.stringify(state.files) !== JSON.stringify(files)) {
    throw new Error(`batch ${b}: codemod state does not match this target and plan`)
  }
  if (state.phase === "prepared") {
    applyState(t, state)
    state.phase = "fixing"
    saveState(p.codemodState(b), state)
  }
  if (state.referenceVersion !== 1) {
    Object.assign(state, prepareReferences(t, state.renames, typeScriptOf(config), references(), [...new Set([...(await Jj.trackedFiles(t)), ...references()])]))
    saveState(p.codemodState(b), state)
  }
  if (state.referencePending) {
    applyState(t, { renames: [], writes: state.referenceWrites })
    state.referencePending = false
    saveState(p.codemodState(b), state)
  }
  const { renames, exportEdits, importEdits, refEdits = [], scriptEdits = [], referenceEdits = [], referenceWarnings = [], referenceScan, selectorChecks = [] } = state
  const platform = state.platform ?? { splits: [], refused: [] }
  const attempt = state.attempts.length + 1
  state.attempts.push({ attempt, compiler: compilerOf(config), startedAt: new Date().toISOString(), projects: [] })
  saveState(p.codemodState(b), state)
  const compiler = compilerOf(config)
  const byFile = {}
  const refused = []
  const rounds = []
  let settled = true
  for (const pkg of config.packages.filter((pkg) => files.some((f) => packageOf(config, f) === pkg))) {
    const projects = Wire.projectsOf(typeScriptOf(config), join(t, pkg.dir), pkg.tsconfig)
    for (const tsconfig of projects) {
      const progress = { package: pkg.dir, project: tsconfig, startedAt: new Date().toISOString() }
      state.attempts.at(-1).projects.push(progress)
      saveState(p.codemodState(b), state)
      const fixed = await fixToFixedPoint({ compiler, tsconfig, cwd: join(t, pkg.dir), root: t, only: renames.map((r) => r.to), log: join(p.batch(b), "logs", `fix-attempt-${attempt}-${slug(pkg.dir)}${projects.length > 1 ? `-${slug(tsconfig)}` : ""}`) })
      for (const [file, kinds] of Object.entries(fixed.byFile)) byFile[file] = kinds
      refused.push(...fixed.refused)
      rounds.push(...fixed.rounds.map((r) => ({ package: pkg.dir, ...(projects.length > 1 ? { project: tsconfig } : {}), ...r })))
      settled &&= fixed.settled
      Object.assign(progress, { finishedAt: new Date().toISOString(), settled: fixed.settled, rounds: fixed.rounds.length })
      saveState(p.codemodState(b), state)
    }
  }
  state.attempts.at(-1).finishedAt = new Date().toISOString()
  saveState(p.codemodState(b), state)
  const result = { batch: b, at: new Date().toISOString(), files, platform, renames, exportEdits, importEdits, refEdits, scriptEdits, referenceEdits, referenceWarnings, referenceScan, selectorChecks, fix: { settled, rounds, byFile, totals: rewriteTotals(byFile), refused } }
  durableWrite(p.codemod(b), JSON.stringify(result, null, 2) + "\n")
  return result
}

/** A migrated module's TypeScript source as the codemod journaled it, from whichever batch renamed it; null for runs that kept no state. */
function originalSourceOf(p, plan, file) {
  for (let i = 0; i < (plan?.batches.length ?? 0); i++) {
    const retained = readJsonIf(p.codemodState(batchName(i)))?.originals?.find(o => o.to === file)
    if (retained) return { path: retained.from, text: Buffer.from(retained.bytes, "base64").toString("utf8") }
  }
  return null
}

/** compile: check each package with the batch's files; record their diagnostics and any error new against the baseline. */
export async function compile(options) {
  const { p, config, plan: thePlan } = loadRun(options.run)
  const b = currentBatch(options.run, options.batch)
  const files = batchFiles(config, thePlan, b).map((f) => f.path)
  const compiler = compilerOf(config)
  const diagnostics = []
  const added = []
  const ts = typeScriptOf(config)
  for (const pkg of config.packages) {
    const checked = await checkPackage({ compiler, ts, t: config.target, pkg, log: join(p.batch(b), "logs", `compile-${slug(pkg.dir)}.log`) })
    diagnostics.push(...checked.diagnostics)
    added.push(...newErrors(readJson(join(p.baseline, `compile-${slug(pkg.dir)}.json`)), checked.diagnostics))
  }
  const preserved = await preservedErrorAdvisories({
    compiler, target: config.target, packages: config.packages,
    baseline: pkg => join(p.baseline, "dts", slug(pkg.dir)), files, diagnostics,
    original: file => originalSourceOf(p, thePlan, file)
  })
  const result = { batch: b, at: new Date().toISOString(), files, summary: summarize(diagnostics, files), style: styleProblems(diagnostics, files, preserved.accepted), styleExemptions: preserved.decisions, newErrors: added, diagnostics: diagnostics.filter((d) => files.includes(d.file) || added.includes(d)) }
  if (!options.noRecord) writeJson(p.compile(b), result)
  return result
}

/**
 * repair: write the repair agent's prompt; run the agent when one is given;
 * with --done (or after the agent), check issues.jsonl and record the step.
 */
export async function repair(options) {
  const { p, config, plan: thePlan } = loadRun(options.run)
  const b = currentBatch(options.run, options.batch)
  if (thePlan?.mode === "one-pass") {
    const settled = await (await import("./onepass.mjs")).onePassStep("settle", options)
    if (!settled.settled) throw new Error("NOT SETTLED: see " + join(p.batch(b), "settle.json"))
    const result = { batch: b, at: new Date().toISOString(), agent: "one-pass", files: batchFiles(config, thePlan, b), recorded: { "codemod-gap": 0, issue: 0, idiom: 0 }, notes: "settled by cause; see settle.json" }
    writeJson(p.repair(b), result)
    return result
  }
  const codemodResult = readJsonIf(p.codemod(b))
  if (!codemodResult) throw new Error(`batch ${b}: codemod has not run`)
  const compileResult = readJsonIf(p.compile(b)) ?? (await compile({ run: options.run, batch: b }))
  const files = batchFiles(config, thePlan, b).map((f) => f.path)
  const context = readFileSync(join(flowDir, "context.md"), "utf8")
  writeText(p.repairPrompt(b), repairPrompt({
    context, run: p.run, batch: b, target: config.target, packages: config.packages.map((pkg) => pkg.dir),
    test: config.test.command, files, codemod: codemodResult, compile: compileResult, step: stepCommand
  }))
  if (!options.done && !options.agent) return { batch: b, done: false, prompt: p.repairPrompt(b) }
  if (options.agent) {
    await runAgent(options.agent, { prompt: p.repairPrompt(b), cwd: config.target, env: { MIGRATE_RUN: p.run, MIGRATE_BATCH: b }, log: join(p.batch(b), "logs", `repair-agent-${Date.now()}.log`) })
  }
  const issues = readIssues(p.issues)
  const malformed = issues.filter((i) => i.problems.length)
  if (malformed.length) throw new Error(`issues.jsonl has malformed entries:\n${malformed.map((i) => `- line ${i.line}: ${i.problems.join("; ")}`).join("\n")}`)
  const mine = issues.filter((i) => i.entry.batch === b).map((i) => i.entry.kind)
  const result = {
    batch: b,
    at: new Date().toISOString(),
    agent: options.agent ? "command" : "external",
    files: batchFiles(config, thePlan, b),
    recorded: { "codemod-gap": mine.filter((k) => k === "codemod-gap").length, issue: mine.filter((k) => k === "issue").length, idiom: mine.filter((k) => k === "idiom").length },
    notes: options.notes ?? null
  }
  writeJson(p.repair(b), result)
  return result
}

/** Return one or many modules to their original TypeScript; validate the entire request first. */
export async function revert(options) {
  if (!options.file || !options.reason) throw new Error("revert needs --file <path.vibe> and --reason <text>")
  return (await revertMany({ ...options, files: [{ file: options.file, reason: options.reason }] }))[0]
}

export async function revertMany(options) {
  const { p, config, plan } = loadRun(options.run)
  const b = currentBatch(options.run, options.batch)
  const aliases = aliasesOf(config)
  const requests = options.files ?? []
  if (!requests.length) throw new Error("revert needs at least one file")
  const seen = new Set(), prepared = []
  for (const item of requests) {
    const { file, reason = options.reason } = typeof item === "string" ? { file: item } : item
    if (typeof file !== "string" || !/\.(?:ts|mts|vibe)$/.test(file) || isDeclarationFile(file) || !reason) throw new Error("revert needs module paths and a cause")
    if (posix.isAbsolute(file) || file.split("/").includes("..")) throw new Error("revert paths must be repository-relative")
    const vibe = file.replace(/\.(?:ts|mts)$/, ".vibe"), ts = plan.batches.flatMap(batch => batch.files).find(source => vibePath(source) === vibe) ?? vibe.replace(/\.vibe$/, ".ts")
    if (seen.has(ts)) throw new Error("duplicate revert: " + file)
    seen.add(ts)
    if (!existsSync(join(config.target, vibe))) throw new Error("missing .vibe module (already reverted?): " + vibe)
    const source = await revertSource(config.target, p, plan, b, ts, vibe)
    const original = source.original ? Buffer.from(source.original.bytes, "base64") : await Jj.fileAt(config.target, source.revision, ts)
    if (original === null) throw new Error("missing revert source: " + ts)
    prepared.push({ ts, vibe, reason, source, original })
  }
  const groups = new Map()
  for (const item of prepared) {
    if (item.source.original) {
      durableWrite(join(config.target, item.ts), item.original, item.source.original.mode)
      rmSync(join(config.target, item.vibe), { force: true })
      continue
    }
    const list = groups.get(item.source.revision) ?? []
    list.push(item)
    groups.set(item.source.revision, list)
  }
  for (const [revision, items] of groups) for (let i = 0; i < items.length; i += 100) {
    await Jj.restore(config.target, revision, items.slice(i, i + 100).flatMap(x => [x.ts, x.vibe]))
  }
  // Check before rewriting: jj may exit successfully without restoring a missing path.
  for (const { ts, vibe, original } of prepared) {
    if (existsSync(join(config.target, vibe)) || !existsSync(join(config.target, ts)) || !readFileSync(join(config.target, ts)).equals(Buffer.from(original))) throw new Error("revert did not restore " + vibe)
    rmSync(join(config.target, vibe.replace(/\.vibe$/, ".d.vibe.ts")), { force: true })
  }
  const results = []
  for (const { ts, reason, source } of prepared) {
    const cm = readJsonIf(p.codemod(source.batch)) ?? readJsonIf(p.codemodState(source.batch)) ?? {}
    const split = cm.platform?.splits?.find(s => s.file === ts)
    if (split) rmSync(join(config.target, split.platform), { force: true })
    const exportEdits = restoreExports(config.target, cm.exportEdits ?? [], ts)
    const scriptEdits = restoreViteScripts(config.target, cm.scriptEdits ?? [], ts)
    const importEdits = restoreSpecifiers(config.target, cm.importEdits ?? [], ts, aliases)
    const refEdits = restoreReferences(config.target, cm.refEdits ?? [], ts)
    const referenceEdits = []
    const history = (plan?.batches ?? []).map((_, i) => readJsonIf(p.codemod(batchName(i))) ?? readJsonIf(p.codemodState(batchName(i)))).filter(Boolean)
    if (history.some(result => result.referenceEdits?.length)) {
      const api = loadTypeScript([
        ...(config.toolchain.kind === "staged" ? [config.toolchain.dir] : []),
        config.target, ...config.packages.map(pkg => join(config.target, pkg.dir)),
        fileURLToPath(new URL("../../../../packages/runtime", import.meta.url))
      ]), vibe = vibePath(ts)
      referenceEdits.push(...restoreSourceLiterals(api, config.target, cm.referenceEdits ?? [], ts, cm.renames ?? []))
      const known = [...new Map(history.flatMap(result => result.renames ?? []).map(r => [r.from, r])).values()]
      const current = known.flatMap(r => {
        const native = existsSync(join(config.target, r.to)), original = existsSync(join(config.target, r.from))
        if (native === original || r.from === ts) return []
        return native ? [r] : [{ from:r.to, to:r.from }]
      })
      const text = readFileSync(join(config.target, ts), "utf8")
      const contexts = new Set(history.flatMap(result => result.referenceEdits ?? [])
        .filter(edit => edit.kind === "source-reference" && (edit.file === ts || edit.file === vibe))
        .map(edit => edit.context).filter(Boolean))
      const rewired = rewriteSourceLiterals(api, text, ts, current, { selectors: false, exactContexts: contexts, inventory: await Jj.trackedFiles(config.target) })
      if (rewired.edits.length) writeFileSync(join(config.target, ts), rewired.text)
      referenceEdits.push(...rewired.edits)
    }
    results.push({ file: ts, reason, at: new Date().toISOString(), ...(source.batch === b ? {} : { from: source.batch }), exportEdits, importEdits, scriptEdits, referenceEdits, ...(cm.refEdits ? { refEdits } : {}) })
  }
  const importEdits = rewriteImports(config.target, await importers(config.target), prepared.map(x => x.ts), aliases)
  for (const result of results) result.importEdits.push(...importEdits.filter(e => {
    const vibe = vibePath(result.file)
    return (resolveRelative(e.file, e.from, new Set([vibe])) ?? resolveAliased(e.file, e.from, new Set([vibe]), aliases)?.target) === vibe
  }))
  writeJson(p.reverted(b), [...readJsonIf(p.reverted(b), []), ...results])
  return results
}

/**
 * Where revert brings a module back from: the batch's parent while it still
 * has the TypeScript, else the commit before the latest recorded batch that
 * migrated the module, whose codemod made the import and export edits to undo.
 */
async function revertSource(t, p, plan, b, ts, vibe) {
  for (let i = Number(b) - 1; i >= 0; i--) {
    const batch = batchName(i)
    const original = readJsonIf(p.codemodState(batch))?.originals?.find(o => o.from === ts && o.to === vibe)
    if (original) return { batch, original }
  }
  if ((await Jj.fileAt(t, "@-", ts)) !== null) return { revision: "@-", batch: b }
  for (let i = (plan?.batches?.length ?? 0) - 1; i >= 0; i--) {
    const record = readJsonIf(p.record(batchName(i)))
    if (record?.commit && record.files?.some((f) => f.path === vibe && f.migrated)) return { revision: `${record.commit}-`, batch: batchName(i) }
  }
  throw new Error(`${ts} is not in the batch's parent, and no recorded batch migrated ${vibe}`)
}

/** Cumulative test identity, from before setup through this batch. */
export async function testEdits(config, p, plan, b, ts) {
  const setup = readJsonIf(p.setup)
  const renames = (plan?.batches ?? []).slice(0, Number(b)).flatMap((_, i) =>
    readJsonIf(p.codemod(batchName(i)))?.renames ?? [])
  return verifyRepositoryTests({
    ts, target: config.target,
    base: setup?.jj?.upgradeCommit ?? setup?.jj?.setupCommit ?? "@-",
    renames, directories: [config.target, ...config.packages.map(pkg => join(config.target, pkg.dir))],
    scratch: p.batch(b), cwd: config.test.cwd, globRoot: config.test.globRoot,
    parseVibe: vibeParser(() => compilerOf(config))
  })
}

/** verify: tests against the baseline, declaration identity, and no TypeScript-style form or platform global in the batch. */
export async function verify(options) {
  assertBaselineSafe(paths(options.run))
  const { p, config, plan: thePlan } = loadRun(options.run)
  const b = currentBatch(options.run, options.batch)
  const t = config.target
  const files = batchFiles(config, thePlan, b)
  const migrated = files.filter((f) => f.migrated).map((f) => f.path)
  const compiler = compilerOf(config)
  const logs = join(p.batch(b), "logs")

  const hooks = await regenerate(config,p,"verify-" + b)
  // Certify the generated and formatted text that record will commit.
  const formatted = await formatVibe(config, migrated, join(logs, "verify-format-vibe.log"))
  const checked = await compile({ run: options.run, batch: b, noRecord: true })
  const codemodReceipt = readJsonIf(p.codemod(b))
  const hasSelectorEdits = codemodReceipt?.referenceEdits?.some(edit => edit.selectorKind || ["source-reference", "source-glob", "source-extensions"].includes(edit.kind))
  const selectorChecks = hasSelectorEdits ? checkSelectorEdits(codemodReceipt, [...new Set([...(await Jj.trackedFiles(t)), ...scopeFiles(config)])], { ts: typeScriptOf(config), read: file => readFileSync(join(t, file), "utf8") }) : []
  const baselineTests = readJson(join(p.baseline, "tests.json"))
  const candidateBuild = thePlan.mode === "one-pass" ? null : await prepareBuilds(config, logs, "candidate")
  const measurement = thePlan.mode === "one-pass" ? await measureTests(config,{run:p.run,batch:b}) : null
  const tests = measurement?.receipts.candidate ?? await runTests({ command: config.test.command, report: config.test.report, cwd: join(t, config.test.cwd), root: t, jsonFile: join(p.batch(b), "vitest.json"), log: join(logs, "tests.log") })
  const testResults = compareTests(baselineTests, tests)
  const ts = typeScriptOf(config)
  const testDiff = await testEdits(config, p, thePlan, b, ts)
  const declarations = {}
  const emitErrors = []
  for (const pkg of config.packages) {
    if (readJson(join(t, pkg.dir, "package.json")).private === true) {
      declarations[pkg.dir] = "not published"
      continue
    }
    const outDir = join(p.batch(b), "dts", slug(pkg.dir))
    const emitted = await emitPackageDeclarations({ compiler, ts, t, pkg, outDir, log: join(logs, `dts-${slug(pkg.dir)}.log`) })
    const baselineDir = join(p.baseline, "dts", slug(pkg.dir))
    const surfacePath = join(baselineDir, "public-surface.json")
    const oldSurface = existsSync(surfacePath) ? readJson(surfacePath) : null
    if (!oldSurface || (!oldSurface.snapshotVersion && oldSurface.unresolved?.length)) {
      // A legacy run must snapshot the setup commit's shipped declarations,
      // never the candidate's current package files.
      const setup = readJson(p.setup)
      const revision = setup.jj.setupCommit
      const original = await Jj.fileAt(t, revision, posix.join(pkg.dir, "package.json"))
      if (original !== null) {
        const handwritten = new Map()
        const prefix = pkg.dir === "." ? "" : pkg.dir + "/"
        for (const file of await Jj.trackedFiles(t, revision)) {
          if (!file.startsWith(prefix) || !/\.d\.[cm]?ts$/.test(file) || /\.d\.vibe\.ts$/.test(file) || file.split("/").includes("node_modules")) continue
          const text = await Jj.fileAt(t, revision, file)
          if (text !== null) handwritten.set(file.slice(prefix.length), text)
        }
        const projects = Wire.projectsOf(ts, join(t, pkg.dir), pkg.dtsTsconfig)
        recordDeclarationSurface(ts, baselineDir, join(t, pkg.dir),
          projects.map(tsconfig => ({ tsconfig, prefix: projects.length === 1 ? "." : slug(tsconfig) })), JSON.parse(original), { handwritten })
      }
    }
    declarations[pkg.dir] = compareDeclarations(ts, baselineDir, outDir)
    emitErrors.push(...emitErrorsIn(emitted.diagnostics, migrated, { code: emitted.code, log: join(logs, "dts-" + slug(pkg.dir) + ".log") }))
  }
  const batchErrors = checked.diagnostics.filter((d) => migrated.includes(d.file) && d.category === "error")
  const style = checked.style.filter((d) => migrated.includes(d.file))
  const result = {
    batch: b,
    at: new Date().toISOString(),
    files,
    formatted,
    tests: { code: tests.code, total: tests.total, passed: tests.passed, failed: tests.failed.length, skipped: tests.skipped,
      status: testsPassed(tests) ? "passed" : "failing", failedNames: tests.failed, baseline: { code: baselineTests.code, failed: baselineTests.tests ? Object.keys(baselineTests.tests).filter(name => baselineTests.tests[name] === "failed") : [] }, ...testResults },
    build: measurement?.builds?.candidate ?? candidateBuild,
    declarations,
    measurement, hooks,
    // Each published specifier the gate excused, for the pull request's description.
    excusedSpecifiers: Object.entries(declarations).flatMap(([dir, d]) => (d.excused ?? []).map((pair) => ({ package: dir, ...pair }))),
    selectorChecks,
    testDiff,
    compile: { batchErrors, newErrors: checked.newErrors, style, emitErrors },
    checks: {
      tests: testResults.ok,
      testEdits: testDiff.ok && (measurement?.ok ?? true),
      selectors: selectorChecks.every(proof => proof.pass),
      baselinePrepared: baselineTests.code === 0 || baselineTests.build?.state === "complete",
      declarations: Object.values(declarations).every((d) => d === "not published" || d.identical),
      declarationEmit: emitErrors.length === 0,
      batchErrors: batchErrors.length === 0,
      newErrors: checked.newErrors.length === 0,
      style: style.length === 0,
      migrated: migrated.length > 0
    }
  }
  result.ok = Object.values(result.checks).every(Boolean)
  writeJson(p.verify(b), result)
  return result
}

/** record: commit the batch with jj and record its tokens before and after. */
export async function record(options) {
  assertBaselineSafe(paths(options.run))
  const { p, config, plan: thePlan, inventory } = loadRun(options.run)
  const b = currentBatch(options.run, options.batch)
  if (existsSync(p.record(b))) return readJson(p.record(b))
  let verified = readJsonIf(p.verify(b))
  if (!verified?.ok && !options.force) throw new Error(`batch ${b} has not passed verify; run verify, or record with --force <reason>`)
  const t = config.target
  const files = batchFiles(config, thePlan, b)
  // Legacy verify receipts and other formatters can still change the tree.
  // Re-certify that exact tree before counting its tokens or committing it.
  const beforeFormat = await Jj.commitId(t, "@")
  const written = (await Jj.changedPaths(t)).filter((c) => c.status !== "D").map((c) => c.path)
  const formatted = await formatWritten(t, written, join(p.batch(b), "logs", "format.log"))
  const vibeFormatted = await formatRecorded(config, written, join(p.batch(b), "logs"))
  const afterFormat = await Jj.commitId(t, "@")
  if (thePlan.mode === "one-pass" && (formatted.code !== 0 || vibeFormatted.code !== 0)) throw new Error("record refused: formatter failed")
  const verificationRefreshed = beforeFormat !== afterFormat || thePlan.mode === "one-pass"
  if (verificationRefreshed) {
    // Reject protected edits before verification can run the tests again.
    const testDiffBeforeCertification = await testEdits(config, p, thePlan, b, typeScriptOf(config))
    if (!testDiffBeforeCertification.ok) throw new Error(`batch ${b}: forbidden test/fixture edits; see ${join(p.batch(b), "test-diff.md")}; revert the edit or leave its module TypeScript`)
    verified = await verify({ run: options.run, batch: b })
    if (thePlan.mode === "one-pass" && (!verified.ok || !verified.measurement?.ok)) throw new Error("record refused: final candidate fails tests against main/previous or another verify gate")
    if (!verified.ok && !options.force) {
      throw new Error(`batch ${b} failed verify after formatting; inspect ${p.verify(b)} before recording`)
    }
  }
  const reverted = readJsonIf(p.reverted(b), [])
  const byPath = new Map(inventory.files.map((f) => [f.path, f]))
  const after = await countTokens(files.map((f) => join(t, f.path)))
  const rows = files.map((f) => ({ ...f, before: byPath.get(f.planned)?.tokens ?? null, after: after[join(t, f.path)] }))
  const migrated = rows.filter((r) => r.migrated)
  const before = migrated.reduce((sum, r) => sum + (r.before ?? 0), 0)
  const now = migrated.reduce((sum, r) => sum + r.after, 0)
  const tokens = { before, after: now, delta: now - before, percent: before ? Number((100 * (now - before) / before).toFixed(1)) : null }
  const lines = [
    `migrate(vibelang): batch ${b}: ${migrated.map((r) => posix.basename(r.path)).join(", ") || "no file migrated"}`,
    "",
    ...rows.map((r) => (r.migrated ? `- ${r.planned} -> ${r.path} (${r.before} -> ${r.after} tokens)` : `- ${r.planned} stays .ts: ${reverted.find((x) => x.file === r.planned)?.reason ?? "not migrated"}`)),
    "",
    `Tokens (o200k) of the migrated files: ${before} -> ${now} (${tokens.percent ?? 0}%).`,
    `Verify: ${verified?.ok ? verificationDescription(verified) : `forced: ${options.force}`}.`
  ]
  await assertPortable(t, machineRoots(t, p.run, config.toolchain.dir))
  // Formatters and sidecar emission run after verify. Recheck the exact tree
  // being committed; --force cannot waive the test-oracle contract.
  const testDiff = await testEdits(config, p, thePlan, b, typeScriptOf(config))
  if (!testDiff.ok) throw new Error(`batch ${b}: forbidden test/fixture edits; see ${join(p.batch(b), "test-diff.md")}; revert the edit or leave its module TypeScript`)
  const commit = await Jj.commit(t, lines.join("\n"))
  if (commit) await Jj.setBookmark(t, config.bookmark, commit)
  const result = { batch: b, at: new Date().toISOString(), commit, bookmark: config.bookmark, files: rows, tokens, formatted, vibeFormatted, verificationRefreshed, testDiff, forced: verified?.ok ? null : options.force }
  writeJson(p.record(b), result)
  return result
}

/** report: every batch's outcome, the token totals and the run's issues, as Markdown and JSON. */
export async function report(options) {
  const { p, config, setup: setupResult, plan: thePlan, inventory } = loadRun(options.run)
  const upgrade = readJsonIf(p.upgrade)
  const batches = (thePlan?.batches ?? []).map((batch, i) => {
    const b = batchName(i)
    return { batch: b, files: batch.files, reason: batch.reason, codemod: readJsonIf(p.codemod(b)), verify: readJsonIf(p.verify(b)), record: readJsonIf(p.record(b)), reverted: readJsonIf(p.reverted(b), []) }
  })
  const issues = readIssues(p.issues).map((i) => i.entry)
  const done = batches.filter((b) => b.record)
  const testFailures = batches.flatMap(b => (b.verify?.tests?.failedNames ?? []).map(name => ({ batch: b.batch, name })))
  const testCommands = batches.filter(b => b.verify).map(b => ({ batch: b.batch, code: b.verify.tests.code, passed: testsPassed(b.verify.tests) }))

  const tokens = done.reduce((acc, b) => ({ before: acc.before + b.record.tokens.before, after: acc.after + b.record.tokens.after }), { before: 0, after: 0 })
  const data = {
    target: config.target,
    packages: config.packages.map((pkg) => pkg.dir),
    compiler: setupResult?.compiler?.version ?? null,
    effect: upgrade && !upgrade.skipped ? { ...upgrade.effect, commit: upgrade.jj.commit, changed: upgrade.changed.length, tests: upgrade.tests, regressions: upgrade.regressions } : null,
    baseline: setupResult?.tests ?? null,
    scope: migrationScope(inventory, thePlan, { nativeConfigs: setupResult?.wired?.nativeViteConfigs ?? setupResult?.nativeViteConfigs ?? [] }),
    testFailures,
    testCommands,
    batches: { planned: batches.length, recorded: done.length },
    tokens: { ...tokens, percent: tokens.before ? Number((100 * (tokens.after - tokens.before) / tokens.before).toFixed(1)) : null },
    issues: issues.filter((i) => i.kind === "issue"),
    codemodGaps: issues.filter((i) => i.kind === "codemod-gap"),
    idioms: issues.filter((i) => i.kind === "idiom"),
    testDiffs: batches.map(b => ({ batch: b.batch, result: b.record?.testDiff ?? b.verify?.testDiff })).filter(b => b.result),
    fixRefusals: batches.flatMap((b) => b.codemod?.fix.refused ?? [])
  }
  const rewrites = {}
  for (const b of batches) for (const [k, n] of Object.entries(b.codemod?.fix.totals ?? {})) rewrites[k] = (rewrites[k] ?? 0) + n
  const md = [
    `# Migration report: ${config.packages.map((pkg) => pkg.dir).join(", ")}`,
    "",
    `Target \`${config.target}\`, compiler ${data.compiler}. Baseline tests: ${data.baseline?.passed ?? "?"} passed, ${data.baseline?.failed?.length ?? 0} failing before the migration, ${data.baseline?.skipped ?? 0} skipped.`,
    "",
    ...(data.effect ? [data.effect.changed
      ? `Effect upgraded from ${data.effect.from} to ${data.effect.to} in \`${data.effect.commit.slice(0, 12)}\`, before VibeLang was set up; ${data.effect.regressions?.newFailures.length || data.effect.regressions?.missing.length ? "the upgrade broke tests (see the setup issues)" : testsPassed(data.effect.tests) ? "the tests pass as before" : data.effect.tests?.code === undefined ? "the test command status was not recorded" : "the tests still fail (exit " + data.effect.tests.code + ", " + failedCount(data.effect.tests) + " failing tests)"}.`
      : `Effect was already ${data.effect.to}.`, ""] : []),
    `${data.batches.recorded} of ${data.batches.planned} batches recorded. Tokens of migrated files: ${tokens.before} -> ${tokens.after} (${data.tokens.percent ?? 0}%).`,
    "",
    ...(data.scope ? [
      "Scope: " + data.scope.counts.owned + " owned source files; " + data.scope.counts.effectImports + " import Effect; " +
      data.scope.counts.automaticCandidates + " automatic candidates; " + data.scope.counts.planned + " explicitly or automatically selected files; " +
      data.scope.counts.retainedTypeOnly + " type-only files deliberately retained as TypeScript. The complete ownership list, including tests, is in " + "`" + "report.json" + "`" + ".", "",
      ...data.scope.retainedTypeOnly.map(file => "- " + "`" + file.path + "`" + ": " + file.reason),
      ""
    ] : []),
    "| Batch | Files | Migrated | Tests | Declarations | Style | Tokens | Commit |",
    "| --- | ---: | ---: | --- | --- | --- | --- | --- |",
    ...batches.map((b) => {
      const v = b.verify
      return `| ${b.batch} | ${b.files.length} | ${v ? v.files.filter((f) => f.migrated).length : "-"} | ${v ? testReportLabel(v) : "-"} | ${v ? (v.checks.declarationEmit === false ? "EMIT FAILED" : v.checks.declarations ? (Object.values(v.declarations ?? {}).every(d => d === "not published") ? "not published" : "identical") : "CHANGED") : "-"} | ${v ? (v.checks.style ? "clean" : `${v.compile.style.length} EK48xx/EK4402`) : "-"} | ${b.record ? `${b.record.tokens.before} -> ${b.record.tokens.after}` : "-"} | ${b.record?.commit?.slice(0, 12) ?? "-"} |`
    }),
    "",
    "## Test and fixture edits",
    "",
    ...data.testDiffs.flatMap(b => [`Batch ${b.batch}`, "", testDiffMarkdown(b.result)]),
    "",
    ...(testCommands.some(command => !command.passed) ? [
      "## Recorded test failures", "",
      ...testFailures.map(failure => "- Batch " + failure.batch + ": " + failure.name),
      ...testCommands.filter(command => !command.passed && !testFailures.some(failure => failure.batch === command.batch)).map(command =>
        "- Batch " + command.batch + ": test command exit " + (command.code ?? "not recorded") + "; individual failure names were not recorded"),
      ""
    ] : []),
    "## Rewrites vibelang --fix applied",
    "",
    ...(Object.keys(rewrites).length ? Object.entries(rewrites).map(([k, n]) => `- ${k}: ${n}`) : ["- none"]),
    "",
    "## Codemod gaps",
    "",
    ...(data.codemodGaps.length ? data.codemodGaps.map((g) => `- **${g.pattern}** (batch ${g.batch}${g.count ? `, ×${g.count}` : ""}): \`${g.before.replaceAll("\n", " ")}\` -> \`${g.after.replaceAll("\n", " ")}\``) : ["- none"]),
    "",
    "## VibeLang issues",
    "",
    ...(data.issues.length ? data.issues.map((i) => `- **${i.title}** (batch ${i.batch}): ${i.actual}`) : ["- none"]),
    "",
    "## Idiom lessons",
    "",
    ...(data.idioms.length ? data.idioms.map((i) => `- ${i.lesson} (batch ${i.batch})`) : ["- none"]),
    ""
  ].join("\n")
  writeText(p.prBody, ["# Migration test and fixture verification", "",
    ...data.testDiffs.flatMap(b => [`Batch ${b.batch}`, "", testDiffMarkdown(b.result)])].join("\n"))
  writeText(p.report, md)
  writeJson(p.reportJson, data)
  return data
}

export const steps = { "upgrade-effect": upgradeEffect, setup, plan, codemod, compile, repair, revert, revertMany, verify, record, report,
  ...Object.fromEntries(["rename", "fix", "check", "settle"].map(name => [name, async options => (await import("./onepass.mjs")).onePassStep(name, options)]))
}

const summaries = {
  "upgrade-effect": (r) => (r.skipped ? `skipped: ${r.skipped}` : `Effect ${r.effect.from} -> ${r.effect.to} in ${r.changed.length} files; ${r.regressions && (r.regressions.newFailures.length || r.regressions.missing.length) ? "tests regressed (a setup issue)" : testsPassed(r.tests) ? "tests pass as before" : r.tests?.code === undefined ? "test command status not recorded" : "tests still FAIL (exit " + r.tests.code + ", " + failedCount(r.tests) + " failing tests)"}`),
  setup: (r) => `baseline: ${r.tests.passed ?? "?"} tests pass, ${r.tests.failed.length} fail; ${r.inventory.effectValueFiles} Effect files`,
  plan: (r) => (r.accepted ? `${r.plan.batches.length} batches` : `waiting for a plan at ${r.output}`),
  codemod: (r) => `${r.renames.length} renamed, ${r.importEdits.length} imports rewritten, ${Object.values(r.fix.totals).reduce((a, b) => a + b, 0)} fixes, ${r.fix.refused.length} refused`,
  compile: (r) => `${r.summary.batch.errors} errors, ${r.summary.batch.warnings} warnings in the batch; ${r.newErrors.length} new errors`,
  repair: (r) => (r.done === false ? `waiting for the repair agent: ${r.prompt}` : `repaired; recorded ${JSON.stringify(r.recorded)}`),
  verify: (r) => (r.ok ? (testsPassed(r.tests) ? "pass" : r.tests?.code === undefined ? "baseline matched; test status unknown" : "baseline matched; tests FAIL") : "FAIL") + ": " + JSON.stringify(r.checks),
  record: (r) => `${r.commit ?? "nothing to commit"}; tokens ${r.tokens.before} -> ${r.tokens.after}`,
  report: (r) => `${r.batches.recorded}/${r.batches.planned} batches; ${r.codemodGaps.length} codemod gaps, ${r.issues.length} issues`
}

/**
 * One step as flow.ts runs it: each execution of the flow migrates the next
 * batch, so a batch step runs only when the run directory says it is next,
 * returns its recorded result when it already ran, and does nothing when no
 * batch is left. The agent steps need an agent command.
 */
export async function flowStep(step, options) {
  const done = (batch, result) => ({ step, batch: batch ?? "", summary: summaries[step](result) })
  if (step === "upgrade-effect" || step === "setup" || step === "report") return done("", await steps[step](options))
  if (step === "plan") {
    const result = await plan(options)
    if (!result.accepted) throw new Error(`plan needs an agent: set MIGRATE_AGENT, or answer ${result.prompt} and run step.mjs plan --accept`)
    return done("", result)
  }
  const next = nextStep(options.run)
  if (next.step === "report") return { step, batch: "", summary: "no batch left" }
  const p = paths(options.run)
  const recorded = { codemod: p.codemod, compile: p.compile, repair: p.repair, verify: p.verify, record: p.record }[step](next.batch)
  if (next.step !== step) {
    if (existsSync(recorded)) return done(next.batch, readJson(recorded))
    throw new Error(`${step} cannot run before ${next.step} for batch ${next.batch}`)
  }
  if (step === "repair" && !options.agent && readJson(p.plan).mode !== "one-pass") throw new Error(`repair needs an agent: set MIGRATE_AGENT, or follow ${p.repairPrompt(next.batch)} and run step.mjs repair --done`)
  return done(next.batch, await steps[step]({ ...options, batch: next.batch }))
}
