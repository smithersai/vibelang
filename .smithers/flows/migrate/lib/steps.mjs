// The migrate flow's steps. Each reads and writes the run directory, so it can
// run as a step of flow.ts or alone from step.mjs, and a later step reads what
// an earlier one recorded. A step that has already recorded its result returns
// it without running again.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, posix, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildInventory, listSources, readCoverage } from "./inventory.mjs"
import { defaultLimits, draftPlan, planPrompt, validatePlan } from "./plan.mjs"
import { fixToFixedPoint, renameBatch, restoreExports, restoreSpecifiers, rewriteExports, rewriteImports, rewriteTotals } from "./codemod.mjs"
import { check, newErrors, styleProblems, summarize } from "./diagnostics.mjs"
import { compareDeclarations, emitDeclarations, loadTypeScript } from "./declarations.mjs"
import { compareTests, regressionIssue, runTests } from "./tests.mjs"
import { countTokens } from "./tokens.mjs"
import { readIssues } from "./issues.mjs"
import { repairPrompt } from "./repair.mjs"
import * as Jj from "./jj.mjs"
import * as Upgrade from "./upgrade.mjs"
import * as Wire from "./wire.mjs"
import { wireDeveloperTools } from "./tooling.mjs"
import { readToolchain } from "./toolchain.mjs"
import { assertPortable, machineRoots } from "./portable.mjs"
import { appendJsonl, batchName, must, quote, readJson, readJsonIf, run as sh, slug, writeJson, writeText } from "./util.mjs"

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
    baseline: join(r, "baseline"),
    batch,
    codemod: (b) => join(batch(b), "codemod.json"),
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
    if (!existsSync(p.codemod(b))) return { step: "codemod", batch: b }
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

/** A batch's files as they are now: each plan path, as .vibe when migrated. */
function batchFiles(config, plan, b) {
  return plan.batches[Number(b) - 1].files.map((file) => {
    const vibe = file.replace(/\.ts$/, ".vibe")
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
    toolchain: options.toolchain ? { kind: "staged", dir: resolve(options.toolchain) } : { kind: "npm", version: options.vibelangVersion },
    // Each recorded batch goes on this bookmark, one commit on top of the last.
    bookmark: options.bookmark ?? "vibe",
    base: options.base ?? null,
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
  for (const tsconfig of projects) diagnostics.push(...(await check({ compiler, tsconfig, cwd, root: t, log: projectLog(log, tsconfig, projects) })).diagnostics)
  return { diagnostics }
}

/** Emits the declarations of each project of pkg's declaration tsconfig into outDir, each into its own subdirectory when there are several. */
async function emitPackageDeclarations({ compiler, ts, t, pkg, outDir, log }) {
  const cwd = join(t, pkg.dir)
  const projects = Wire.projectsOf(ts, cwd, pkg.dtsTsconfig)
  if (projects.length === 1) return emitDeclarations({ compiler, tsconfig: projects[0], cwd, outDir, log })
  rmSync(outDir, { recursive: true, force: true })
  let code = 0
  let files = 0
  for (const tsconfig of projects) {
    const emitted = await emitDeclarations({ compiler, tsconfig, cwd, outDir: join(outDir, slug(tsconfig)), log: projectLog(log, tsconfig, projects) })
    code ||= emitted.code
    files += emitted.files
  }
  return { code, files }
}

const testsOf = (r) => ({ code: r.code, total: r.total, passed: r.passed, failed: r.failed, skipped: r.skipped, ms: r.ms })

/**
 * upgrade-effect: the first step. Starts the run's bookmark on the base, runs
 * the target's tests as they are, moves every Effect version on Effect's major
 * line to the exact one the VibeLang runtime requires (with the overrides that
 * keep one copy installed), installs, runs the tests again, and commits the
 * upgrade on its own, before any VibeLang change. A test the upgrade breaks is
 * recorded as a setup issue and the step still finishes, so setup and every
 * batch are compared with the upgraded tests.
 */
export async function upgradeEffect(options) {
  const p = paths(options.run)
  if (existsSync(p.upgrade)) return readJson(p.upgrade)
  if (existsSync(p.setup)) return { skipped: "this run was set up before upgrade-effect was a step" }
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
  const before = await testRun("upstream")
  if (before.code !== 0 && !before.tests) throw new Error(`the target's tests do not run (exit ${before.code}); see ${join(logs, "upstream-tests.log")}`)
  writeJson(join(p.baseline, "upstream-tests.json"), { code: before.code, tests: before.tests })

  const to = await runtimeEffect(config)
  const workspaceFile = join(t, "pnpm-workspace.yaml")
  const globs = Upgrade.workspaceGlobs(readFileSync(join(t, "package.json"), "utf8"), existsSync(workspaceFile) ? readFileSync(workspaceFile, "utf8") : "")
  const manifests = Upgrade.workspaceManifests((await Jj.trackedFiles(t)).filter((f) => /(?:^|\/)package\.json$/.test(f) || f === "pnpm-workspace.yaml"), globs)
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
  const changed = [...written, ...upgrade.patches.flatMap((patch) => [patch.from, patch.to]), ...vibelang.patchFiles]
  const formatted = await formatWritten(t, written, join(logs, "upgrade-format.log"))

  let after = before
  let comparison = null
  let commit = null
  if (changed.length) {
    await install("upgraded")
    after = await testRun("upgraded")
    comparison = compareTests(before, after)
    const issue = regressionIssue({
      change: `Upgrading Effect from ${upgrade.from} to ${to}`, command: config.test.command, cwd: config.test.cwd, changed, before, after, comparison,
      logs: { before: join(logs, "upstream-tests.log"), after: join(logs, "upgraded-tests.log") }
    })
    if (issue) appendJsonl(p.issues, issue)
    await assertPortable(t, machineRoots(t, p.run, config.toolchain.dir))
    const moved = upgrade.files.length || upgrade.patches.length
    commit = await Jj.commit(t, moved ? `migrate(vibelang): upgrade Effect to ${to}\n\nThe VibeLang runtime requires exactly effect ${to}. Moves effect and every\n@effect/* package on its major line from ${upgrade.from} to ${to}, with overrides\nthat keep one copy installed.${vibelang.manifests.length ? " The VibeLang packages it already uses move\nto this run's release, which requires that Effect." : ""} No source file changes;\nVibeLang comes next.` : switchMessage(config))
  }
  writeJson(join(p.baseline, "upgraded-tests.json"), { code: after.code, tests: after.tests })
  // A --base names where the run starts, so the bookmark restarts there even when an earlier run left it elsewhere.
  await Jj.setBookmark(t, config.bookmark, commit ?? baseCommit, { restart: Boolean(config.base) })
  const result = {
    at: new Date().toISOString(),
    jj: { initialized: repo.initialized, base, baseCommit, commit: commit ?? baseCommit, bookmark: config.bookmark },
    effect: { from: upgrade.from, to },
    pins: upgrade.pins,
    bumped: upgrade.bumped,
    selectors: upgrade.selectors,
    patches: upgrade.patches.map(({ from, to }) => ({ from, to })),
    vibelang: vibelang.manifests,
    vibelangPatches: vibelang.patches,
    changed,
    formatted,
    upstreamTests: testsOf(before),
    tests: testsOf(after),
    regressions: comparison && { newFailures: comparison.newFailures, missing: comparison.missing, exit: { before: before.code, after: after.code } }
  }
  writeJson(p.upgrade, result)
  return result
}

/** The commit of an upgrade step that moved no Effect package: only VibeLang's pins changed. */
function switchMessage(config) {
  const name = config.toolchain.kind === "staged" ? readToolchain(config.toolchain.dir).commit?.slice(0, 12) ?? config.toolchain.dir : config.toolchain.version
  return `migrate(vibelang): switch to the toolchain of VibeLang ${name}\n\nEffect stays where it is. Repins vibelang and its packages.`
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

/** Sets VibeLang up in the target: dependencies, scripts, the Vite plugin, tsconfigs and the declaration sidecars' format ignore. Returns what it changed. */
async function wireTarget(config, log) {
  const t = config.target
  const changed = []
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
  const warnings = []
  const ts = typeScriptOf(config)
  for (const pkg of config.packages) {
    const path = join(t, pkg.dir, "package.json")
    const next = Wire.addVibeLang(readJson(path), specsFor(pkg.dir))
    next.scripts = Wire.replaceTsc(next.scripts)
    writeIfChanged(path, readFileSync(path, "utf8"), JSON.stringify(next, null, 2) + "\n")
    const dir = join(t, pkg.dir)
    // A solution-style tsconfig's referenced projects compile the sources, so they are wired too.
    for (const tsconfig of new Set([pkg.tsconfig, pkg.dtsTsconfig, ...Wire.projectsOf(ts, dir, pkg.tsconfig), ...Wire.projectsOf(ts, dir, pkg.dtsTsconfig)])) {
      const file = join(dir, tsconfig)
      const text = readFileSync(file, "utf8")
      // Each compile writes x.d.vibe.ts beside x.vibe, which every other TypeScript checker reads,
      // and the project lists .vibe files where it lists .ts files.
      writeIfChanged(file, text, Wire.addVibeLangSetting(Wire.addCompilerOptions(Wire.addVibeIncludes(text, ts), { rewriteRelativeImportExtensions: true }), ts, "declarationSidecars", true))
    }
  }
  // Effect's lint rules run on .vibe files where the root's scripts run them on .ts files (VIP-38).
  const rootPackage = join(t, "package.json")
  if (existsSync(rootPackage)) {
    const before = readFileSync(rootPackage, "utf8")
    const root = JSON.parse(before)
    const readConfig = (file) => existsSync(join(t, file)) ? readFileSync(join(t, file), "utf8") : undefined
    const scripts = Wire.addEffectLint(root.scripts, readConfig)
    if (JSON.stringify(scripts) !== JSON.stringify(root.scripts ?? {})) writeIfChanged(rootPackage, before, JSON.stringify({ ...root, scripts }, null, 2) + "\n")
  }
  // Every project resolves an import of ./x.vibe to its sidecar, as stock TypeScript does under this option.
  for (const tsconfig of Wire.rootTsconfigs(t, ts)) {
    const file = join(t, tsconfig)
    writeIfChanged(file, readFileSync(file, "utf8"), Wire.addCompilerOptions(readFileSync(file, "utf8"), { allowArbitraryExtensions: true }))
  }
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
  const bunTests = Wire.wireBunTests({ root: t, packages: config.packages, specsFor })
  changed.push(...bunTests.changed.filter((file) => !changed.includes(file)))
  warnings.push(...bunTests.warnings)
  // The plugin goes into the config the tests load: the shared one the test command names, else each package's.
  const vite = Wire.wireVite({ root: t, packages: config.packages, test: config.test, ts, specsFor })
  changed.push(...vite.changed.filter((file) => !changed.includes(file)))
  warnings.push(...vite.warnings)
  const tooling = wireDeveloperTools({ root: t, specsFor })
  changed.push(...tooling.changed.filter(file => !changed.includes(file)))
  // And into every other config that bundles migrated sources: apps, examples and websites build and serve them too.
  const apps = Wire.wireViteApps({ root: t, packages: config.packages, ts, specsFor, wired: vite.configs })
  changed.push(...apps.changed.filter((file) => !changed.includes(file)))
  warnings.push(...apps.warnings)
  // A bundle reaches .vibe modules through vibelang-unplugin/bun: vibelang/bun's runtime plugin does not apply to Bun.build.
  const bunBuilds = Wire.wireBunBuilds({ root: t, packages: config.packages, ts, specsFor })
  changed.push(...bunBuilds.changed.filter((file) => !changed.includes(file)))
  warnings.push(...bunBuilds.warnings)
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
  return { manager, specs: Object.fromEntries(config.packages.map((pkg) => [pkg.dir, specsFor(pkg.dir)])), viteConfigs: vite.configs, viteAppConfigs: apps.configs, knipConfig: knip.config, formatted, changed, warnings, install }
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
  const wired = config.wire ? await wireTarget(config, logs) : null
  const compiler = compilerOf(config)
  const { stdout: version } = await must(`${JSON.stringify(compiler)} --version`)

  // The baseline every batch is compared with: the tests with VibeLang set up and nothing migrated.
  const tests = wired
    ? await runTests({ command: config.test.command, report: config.test.report, cwd: join(t, config.test.cwd), root: t, jsonFile: join(p.baseline, "baseline.vitest.json"), log: join(logs, "baseline-tests.log") })
    : { ...upgrade.tests, tests: upstream.tests }
  writeJson(join(p.baseline, "tests.json"), { code: tests.code, tests: tests.tests })
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
    declarations[pkg.dir] = await emitPackageDeclarations({ compiler, ts, t, pkg, outDir: join(p.baseline, "dts", slug(pkg.dir)), log: join(logs, `dts-${slug(pkg.dir)}.log`) })
  }

  const files = scopeFiles(config)
  const tokens = await countTokens(files.map((f) => join(t, f)))
  const inventory = buildInventory({ root: t, packages: config.packages, tokens, coverage: readCoverage(t, config.packages) })
  writeJson(p.inventory, inventory)

  // The target's coding agents get the skill, the language server and a check after each edit.
  const agents = wired ? await setUpAgents(t, config.packages[0].dir, logs) : null

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
  const { p, config, inventory } = loadRun(options.run)
  if (existsSync(p.plan)) return { plan: readJson(p.plan), accepted: true }
  if (!inventory) throw new Error("setup has not run")
  const draft = draftPlan(inventory, config.limits)
  writeJson(p.planDraft, draft)
  writeText(p.planPrompt, planPrompt({ inventory, draft, limits: config.limits, output: p.planAnswer }))
  let answer = options.accept ? resolve(options.accept) : options.acceptDraft ? p.planDraft : null
  if (!answer && options.agent) {
    await runAgent(options.agent, { prompt: p.planPrompt, cwd: config.target, env: { MIGRATE_OUTPUT: p.planAnswer, MIGRATE_RUN: p.run }, log: join(p.run, "logs", "plan-agent.log") })
    answer = p.planAnswer
  }
  if (!answer) return { accepted: false, prompt: p.planPrompt, output: p.planAnswer, draft: p.planDraft }
  const proposed = readJson(answer)
  const { errors, warnings } = validatePlan(proposed, inventory, config.limits)
  if (errors.length) throw new Error(`the plan is not valid:\n${errors.map((e) => `- ${e}`).join("\n")}`)
  const accepted = { ...proposed, source: options.acceptDraft ? "draft" : answer === p.planAnswer ? "agent" : `accepted ${answer}`, warnings, acceptedAt: new Date().toISOString() }
  writeJson(p.plan, accepted)
  return { plan: accepted, accepted: true }
}

/** codemod: rename the batch to .vibe, rewrite imports, and run vibelang --fix to a fixed point. */
export async function codemod(options) {
  const { p, config, plan: thePlan } = loadRun(options.run)
  if (!thePlan) throw new Error("plan has not been accepted")
  const b = currentBatch(options.run, options.batch)
  if (existsSync(p.codemod(b))) return readJson(p.codemod(b))
  const t = config.target
  const files = thePlan.batches[Number(b) - 1].files
  const renames = renameBatch(t, files)
  const exportEdits = rewriteExports(t, renames)
  const importEdits = rewriteImports(t, scopeFiles(config))
  const compiler = compilerOf(config)
  const byFile = {}
  const refused = []
  const rounds = []
  let settled = true
  for (const pkg of config.packages.filter((pkg) => files.some((f) => packageOf(config, f) === pkg))) {
    const projects = Wire.projectsOf(typeScriptOf(config), join(t, pkg.dir), pkg.tsconfig)
    for (const tsconfig of projects) {
      const fixed = await fixToFixedPoint({ compiler, tsconfig, cwd: join(t, pkg.dir), root: t, only: renames.map((r) => r.to), log: join(p.batch(b), "logs", `fix-${slug(pkg.dir)}${projects.length > 1 ? `-${slug(tsconfig)}` : ""}`) })
      for (const [file, kinds] of Object.entries(fixed.byFile)) byFile[file] = kinds
      refused.push(...fixed.refused)
      rounds.push(...fixed.rounds.map((r) => ({ package: pkg.dir, ...(projects.length > 1 ? { project: tsconfig } : {}), ...r })))
      settled &&= fixed.settled
    }
  }
  const result = { batch: b, at: new Date().toISOString(), files, renames, exportEdits, importEdits, fix: { settled, rounds, byFile, totals: rewriteTotals(byFile), refused } }
  writeJson(p.codemod(b), result)
  return result
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
  const result = { batch: b, at: new Date().toISOString(), files, summary: summarize(diagnostics, files), style: styleProblems(diagnostics, files), newErrors: added, diagnostics: diagnostics.filter((d) => files.includes(d.file) || added.includes(d)) }
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

/** revert: return one migrated file of the current batch to its .ts source, with a reason. */
export async function revert(options) {
  const { p, config, plan } = loadRun(options.run)
  const b = currentBatch(options.run, options.batch)
  if (!options.file || !options.reason) throw new Error("revert needs --file <path.vibe> and --reason <text>")
  const vibe = options.file.replace(/\.ts$/, ".vibe")
  const ts = vibe.replace(/\.vibe$/, ".ts")
  const source = await revertSource(config.target, p, plan, b, ts, vibe)
  await Jj.restore(config.target, source.revision, [ts, vibe])
  rmSync(join(config.target, vibe.replace(/\.vibe$/, ".d.vibe.ts")), { force: true }) // its declaration sidecar
  // A TypeScript importer gets the specifier it had before the codemod; a .vibe importer names the .ts source.
  const codemodResult = readJsonIf(p.codemod(source.batch))
  const exportEdits = restoreExports(config.target, codemodResult?.exportEdits ?? [], ts)
  const importEdits = [...restoreSpecifiers(config.target, codemodResult?.importEdits ?? [], ts), ...rewriteImports(config.target, scopeFiles(config))]
  const reverted = readJsonIf(p.reverted(b), [])
  reverted.push({ file: ts, reason: options.reason, at: new Date().toISOString(), ...(source.batch === b ? {} : { from: source.batch }), exportEdits, importEdits })
  writeJson(p.reverted(b), reverted)
  return reverted.at(-1)
}

/**
 * Where revert brings a module back from: the batch's parent while it still
 * has the TypeScript, else the commit before the latest recorded batch that
 * migrated the module, whose codemod made the import and export edits to undo.
 */
async function revertSource(t, p, plan, b, ts, vibe) {
  if ((await Jj.fileAt(t, "@-", ts)) !== null) return { revision: "@-", batch: b }
  for (let i = (plan?.batches?.length ?? 0) - 1; i >= 0; i--) {
    const record = readJsonIf(p.record(batchName(i)))
    if (record?.commit && record.files?.some((f) => f.path === vibe && f.migrated)) return { revision: `${record.commit}-`, batch: batchName(i) }
  }
  throw new Error(`${ts} is not in the batch's parent, and no recorded batch migrated ${vibe}`)
}

/** verify: tests against the baseline, declaration identity, and no TypeScript-style form or platform global in the batch. */
export async function verify(options) {
  const { p, config, plan: thePlan } = loadRun(options.run)
  const b = currentBatch(options.run, options.batch)
  const t = config.target
  const files = batchFiles(config, thePlan, b)
  const migrated = files.filter((f) => f.migrated).map((f) => f.path)
  const compiler = compilerOf(config)
  const logs = join(p.batch(b), "logs")

  const checked = await compile({ run: options.run, batch: b, noRecord: true })
  const baselineTests = readJson(join(p.baseline, "tests.json"))
  const tests = await runTests({ command: config.test.command, report: config.test.report, cwd: join(t, config.test.cwd), root: t, jsonFile: join(p.batch(b), "vitest.json"), log: join(logs, "tests.log") })
  const testDiff = compareTests(baselineTests, tests)
  const ts = typeScriptOf(config)
  const declarations = {}
  for (const pkg of config.packages) {
    const outDir = join(p.batch(b), "dts", slug(pkg.dir))
    await emitPackageDeclarations({ compiler, ts, t, pkg, outDir, log: join(logs, `dts-${slug(pkg.dir)}.log`) })
    declarations[pkg.dir] = compareDeclarations(ts, join(p.baseline, "dts", slug(pkg.dir)), outDir)
  }
  const batchErrors = checked.diagnostics.filter((d) => migrated.includes(d.file) && d.category === "error")
  const style = checked.style.filter((d) => migrated.includes(d.file))
  const result = {
    batch: b,
    at: new Date().toISOString(),
    files,
    tests: { code: tests.code, total: tests.total, passed: tests.passed, failed: tests.failed.length, skipped: tests.skipped, ...testDiff },
    declarations,
    compile: { batchErrors, newErrors: checked.newErrors, style },
    checks: {
      tests: testDiff.ok,
      declarations: Object.values(declarations).every((d) => d.identical),
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
  const { p, config, plan: thePlan, inventory } = loadRun(options.run)
  const b = currentBatch(options.run, options.batch)
  if (existsSync(p.record(b))) return readJson(p.record(b))
  const verified = readJsonIf(p.verify(b))
  if (!verified?.ok && !options.force) throw new Error(`batch ${b} has not passed verify; run verify, or record with --force <reason>`)
  const t = config.target
  const files = batchFiles(config, thePlan, b)
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
    `Verify: ${verified?.ok ? "tests, declarations and style pass" : `forced: ${options.force}`}.`
  ]
  // The batch's other files, such as a test or config the repair edited, are in the repository's own format.
  const written = (await Jj.changedPaths(t)).filter((c) => c.status !== "D").map((c) => c.path)
  const formatted = await formatWritten(t, written, join(p.batch(b), "logs", "format.log"))
  const vibeFormatted = await formatRecorded(config, written, join(p.batch(b), "logs"))
  await assertPortable(t, machineRoots(t, p.run, config.toolchain.dir))
  const commit = await Jj.commit(t, lines.join("\n"))
  if (commit) await Jj.setBookmark(t, config.bookmark, commit)
  const result = { batch: b, at: new Date().toISOString(), commit, bookmark: config.bookmark, files: rows, tokens, formatted, vibeFormatted, forced: verified?.ok ? null : options.force }
  writeJson(p.record(b), result)
  return result
}

/** report: every batch's outcome, the token totals and the run's issues, as Markdown and JSON. */
export async function report(options) {
  const { p, config, setup: setupResult, plan: thePlan } = loadRun(options.run)
  const upgrade = readJsonIf(p.upgrade)
  const batches = (thePlan?.batches ?? []).map((batch, i) => {
    const b = batchName(i)
    return { batch: b, files: batch.files, reason: batch.reason, codemod: readJsonIf(p.codemod(b)), verify: readJsonIf(p.verify(b)), record: readJsonIf(p.record(b)), reverted: readJsonIf(p.reverted(b), []) }
  })
  const issues = readIssues(p.issues).map((i) => i.entry)
  const done = batches.filter((b) => b.record)
  const tokens = done.reduce((acc, b) => ({ before: acc.before + b.record.tokens.before, after: acc.after + b.record.tokens.after }), { before: 0, after: 0 })
  const data = {
    target: config.target,
    packages: config.packages.map((pkg) => pkg.dir),
    compiler: setupResult?.compiler?.version ?? null,
    effect: upgrade && !upgrade.skipped ? { ...upgrade.effect, commit: upgrade.jj.commit, changed: upgrade.changed.length, regressions: upgrade.regressions } : null,
    baseline: setupResult?.tests ?? null,
    batches: { planned: batches.length, recorded: done.length },
    tokens: { ...tokens, percent: tokens.before ? Number((100 * (tokens.after - tokens.before) / tokens.before).toFixed(1)) : null },
    issues: issues.filter((i) => i.kind === "issue"),
    codemodGaps: issues.filter((i) => i.kind === "codemod-gap"),
    idioms: issues.filter((i) => i.kind === "idiom"),
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
      ? `Effect upgraded from ${data.effect.from} to ${data.effect.to} in \`${data.effect.commit.slice(0, 12)}\`, before VibeLang was set up; ${data.effect.regressions?.newFailures.length || data.effect.regressions?.missing.length ? "the upgrade broke tests (see the setup issues)" : "the tests pass as before"}.`
      : `Effect was already ${data.effect.to}.`, ""] : []),
    `${data.batches.recorded} of ${data.batches.planned} batches recorded. Tokens of migrated files: ${tokens.before} -> ${tokens.after} (${data.tokens.percent ?? 0}%).`,
    "",
    "| Batch | Files | Migrated | Tests | Declarations | Style | Tokens | Commit |",
    "| --- | ---: | ---: | --- | --- | --- | --- | --- |",
    ...batches.map((b) => {
      const v = b.verify
      return `| ${b.batch} | ${b.files.length} | ${v ? v.files.filter((f) => f.migrated).length : "-"} | ${v ? (v.checks.tests ? `pass (${v.tests.passed}/${v.tests.total})` : `FAIL: ${v.tests.newFailures.length} new, ${v.tests.missing.length} missing`) : "-"} | ${v ? (v.checks.declarations ? "identical" : "CHANGED") : "-"} | ${v ? (v.checks.style ? "clean" : `${v.compile.style.length} EK48xx/EK4402`) : "-"} | ${b.record ? `${b.record.tokens.before} -> ${b.record.tokens.after}` : "-"} | ${b.record?.commit?.slice(0, 12) ?? "-"} |`
    }),
    "",
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
  writeText(p.report, md)
  writeJson(p.reportJson, data)
  return data
}

export const steps = { "upgrade-effect": upgradeEffect, setup, plan, codemod, compile, repair, revert, verify, record, report }

const summaries = {
  "upgrade-effect": (r) => (r.skipped ? `skipped: ${r.skipped}` : `Effect ${r.effect.from} -> ${r.effect.to} in ${r.changed.length} files; ${r.regressions && (r.regressions.newFailures.length || r.regressions.missing.length) ? "tests regressed (a setup issue)" : "tests as before"}`),
  setup: (r) => `baseline: ${r.tests.passed ?? "?"} tests pass, ${r.tests.failed.length} fail; ${r.inventory.effectValueFiles} Effect files`,
  plan: (r) => (r.accepted ? `${r.plan.batches.length} batches` : `waiting for a plan at ${r.output}`),
  codemod: (r) => `${r.renames.length} renamed, ${r.importEdits.length} imports rewritten, ${Object.values(r.fix.totals).reduce((a, b) => a + b, 0)} fixes, ${r.fix.refused.length} refused`,
  compile: (r) => `${r.summary.batch.errors} errors, ${r.summary.batch.warnings} warnings in the batch; ${r.newErrors.length} new errors`,
  repair: (r) => (r.done === false ? `waiting for the repair agent: ${r.prompt}` : `repaired; recorded ${JSON.stringify(r.recorded)}`),
  verify: (r) => `${r.ok ? "pass" : "FAIL"}: ${JSON.stringify(r.checks)}`,
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
  if (step === "repair" && !options.agent) throw new Error(`repair needs an agent: set MIGRATE_AGENT, or follow ${p.repairPrompt(next.batch)} and run step.mjs repair --done`)
  return done(next.batch, await steps[step]({ ...options, batch: next.batch }))
}
