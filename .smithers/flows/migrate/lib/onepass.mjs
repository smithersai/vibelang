import { assertComputedBuildEntrypoints } from "./computed-build-entrypoints.mjs"
import { conversionIdentity } from "./conversion-context.mjs"
// Repository-independent whole-scope conversion. The run directory owns every receipt.
import { applyState, prepareState, saveState, durableWrite } from "./codemod-state.mjs"
import { toolchainKeepsFunctionsPlain } from "./plain.mjs"
import { platformCausesOf, throwingCausesOf } from "./platform.mjs"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { renameBatch, rewriteExports, rewriteImports, vibePath } from "./codemod.mjs"
import { assertFinished, newErrors, parseDiagnostics, styleProblems, warningExceptions } from "./diagnostics.mjs"
import { parseImports, resolveRelative, resolveFile, resolveAliased } from "./imports.mjs"
import { pathReadDeferrals, rewriteReferences } from "./references.mjs"
import { isToolConfig } from "./plan.mjs"
import { assertBaselineSafe, declarationBaselineDir } from "./baseline.mjs"
import { assertNoTestBundleRename, pinnedBundleInputs, testBundleDeferrals } from "./test-bundles.mjs"
import { bareRunnerDeferrals } from "./bare-runners.mjs"
import { loadTypeScript } from "./declarations.mjs"
import { projectsOf } from "./wire.mjs"
import { bindCompilerArtifact, readToolchain } from "./toolchain.mjs"
import { aliasesOf, emitMigratedJs, paths, importers, plainGroupsOf, revertMany } from "./steps.mjs"
import { regenerate } from "./hooks.mjs"
import * as Jj from "./jj.mjs"
import { appendJsonl, isDeclarationFile, quote, readJson, readJsonIf, run, slug, writeJson } from "./util.mjs"

const sourceModule = f => /\.(?:ts|tsx|mts|cts|vibe|vibex)$/.test(f) && !isDeclarationFile(f)
const livePath = (root, f) => !isDeclarationFile(f) && /\.(?:ts|tsx|mts)$/.test(f) && existsSync(join(root, vibePath(f))) ? vibePath(f) : f
const positive = (v, fallback, name, max = Infinity) => {
  const n = Number(v ?? fallback)
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${name} must be an integer from 1 to ${max}`)
  return n
}

// TanStack Router's generator keeps only .ts, .tsx, .js, .jsx and .vue names, and
// would take a .d.vibex.ts sidecar for the route.
const fileRoute = text => /\bfrom\s+["']@tanstack\/[\w-]*router["']/.test(text) && /\bcreate(?:Lazy)?(?:File|Root)Route(?:WithContext)?\b/.test(text)

export function planScope(root, scope, { nativeConfigs = [], routeBundledImports = false } = {}) {
  const files = [], deferred = []
  for (const file of new Set(scope.map(f => f.trim()).filter(Boolean))) {
    if (posix.isAbsolute(file) || file.split("/").includes("..") || file !== posix.normalize(file)) throw new Error("scope paths must be repository-relative: " + file)
    if (!existsSync(join(root, file))) throw new Error("scope module missing: " + file)
    if (isToolConfig(file) && !nativeConfigs.includes(file)) deferred.push({ file, reason: "tool config has no supported native loader; keep its TypeScript filename" })
    else if (/\.tsx?$/.test(file) && !isDeclarationFile(file) && fileRoute(readFileSync(join(root, file), "utf8"))) deferred.push({ file, reason: "file route: the router's generator finds it by its TypeScript filename" })
    else if (/\.(?:ts|tsx|mts)$/.test(file) && !isDeclarationFile(file)) files.push(file)
    else deferred.push({ file, reason: /\.vibex?$/.test(file) ? "already a VibeLang module; no rename needed" : isDeclarationFile(file) ? "declaration file; keep its source format" : "unsupported source kind; not a .ts, .tsx or .mts module" })
  }
  const bundled = testBundleDeferrals(root, files, { routed: routeBundledImports })
  const retained = new Set(bundled.map(d => d.file))
  deferred.push(...bundled)
  for (const bare of bareRunnerDeferrals(root, files, { routed: routeBundledImports }).deferred) {
    if (retained.has(bare.file)) continue
    retained.add(bare.file)
    deferred.push(bare)
  }
  for (let i = files.length - 1; i >= 0; i--) if (retained.has(files[i])) files.splice(i, 1)
  if (!files.length) throw new Error("scope contains no .ts, .tsx or .mts modules to migrate; " + deferred.map(d => d.reason).join("; "))
  return { version: 1, mode: "one-pass", batches: [{ files, reason: "One whole-scope pass; settle returns failing modules by diagnostic cause, dependency roots first." }], deferred }
}

function reachable(graph, start) {
  const seen = new Set(), todo = [...(graph.get(start) ?? [])]
  while (todo.length) {
    const file = todo.pop()
    if (seen.has(file)) continue
    seen.add(file)
    todo.push(...[...(graph.get(file) ?? [])].filter(f => !seen.has(f)))
  }
  return seen
}

/** Sink SCCs among failures, looking through healthy intermediate modules. */
export function dependencyRoots(graph, bad = new Set(graph.keys())) {
  const reach = new Map([...bad].map(f => [f, reachable(graph, f)]))
  return [...bad].filter(f => [...bad].every(d => d === f || !reach.get(f).has(d) || reach.get(d).has(f)))
}

async function mapLimit(items, jobs, fn) {
  const result = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; result[i] = await fn(items[i], i) }
  }))
  return result
}

function packageDigest(config, dir, files) {
  const hash = createHash("sha256")
  for (const file of [...files].filter(f => owner(config,f) === dir).sort()) {
    hash.update(file)
    if (existsSync(join(config.target,file))) hash.update(readFileSync(join(config.target,file)))
    else hash.update("<missing>")
  }
  return hash.digest("hex")
}

function compilerOf(config) {
  if (config.compilerArtifact) bindCompilerArtifact(config)
  return config.toolchain.kind === "staged" ? readToolchain(config.toolchain.dir).compiler : join(config.target, config.packages[0].dir, "node_modules/.bin/vibelang")
}

function projectList(config) {
  const ts = loadTypeScript([
    ...(config.toolchain.kind === "staged" ? [config.toolchain.dir] : []),
    config.target, ...config.packages.map(pkg => join(config.target, pkg.dir)),
    fileURLToPath(new URL("../../../../packages/runtime", import.meta.url))
  ])
  const out = [], seen = new Set()
  for (const pkg of config.packages) {
    const add = name => {
      const file = posix.normalize(posix.join(pkg.dir, name))
      if (seen.has(file)) return
      seen.add(file)
      const expanded = projectsOf(ts, join(config.target, pkg.dir), name)
      if (expanded.length !== 1 || expanded[0] !== name) { for (const child of expanded) add(child); return }
      out.push({ package: pkg.dir, project: name, file })
    }
    add(pkg.tsconfig ?? "tsconfig.json")
    const manifest = readJsonIf(join(config.target, pkg.dir, "package.json"), {})
    for (const script of [manifest.scripts?.typecheck, manifest.scripts?.["typecheck:tsc"]].filter(Boolean)) {
      for (const m of script.matchAll(/(?:^|\s)(?:-p|--project)(?:\s+|=)["']?([^\s"';&]+\.json)/g)) add(m[1])
      for (const m of script.matchAll(/(?:^|\s)(?:-b|--build)\s+([^;&]+)/g)) for (const name of m[1].trim().split(/\s+/)) if (!name.startsWith("-")) add(name.replace(/^["']|["']$/g, "").replace(/\/$/, "") + (name.endsWith(".json") ? "" : "/tsconfig.json"))
    }
  }
  return out
}

function owner(config, file) {
  return [...config.packages].sort((a, b) => (b.dir === "." ? -1 : b.dir.length) - (a.dir === "." ? -1 : a.dir.length)).find(p => p.dir === "." || file.startsWith(p.dir + "/"))?.dir
}

async function moduleGraph(config, p) {
  const files = (await Jj.trackedFiles(config.target)).filter(sourceModule)
  const all = new Set(files)
  const aliases = aliasesOf(config)
  const inventory = new Map(readJsonIf(p.inventory, { files: [] }).files.map(f => [livePath(config.target, f.path), (f.imports ?? []).map(d => livePath(config.target, d))]))
  const manifests = new Map(config.packages.map(pkg => [pkg.dir, readJsonIf(join(config.target, pkg.dir, "package.json"), {})]))
  const byName = new Map([...manifests].filter(([, p]) => p.name).map(([dir, p]) => [p.name, dir]))
  const targets = value => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(targets) : value && typeof value === "object" ? Object.values(value).flatMap(targets) : []
  function bare(from, specifier) {
    const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]
    const dir = specifier.startsWith("#") ? owner(config, from) : byName.get(name)
    if (dir === undefined) return undefined
    const pkg = manifests.get(dir)
    const key = specifier.startsWith("#") ? specifier : "." + specifier.slice(name.length)
    const map = specifier.startsWith("#") ? pkg.imports : pkg.exports
    let values = []
    if (typeof map === "string" || Array.isArray(map) || (map && !Object.keys(map).some(k => k.startsWith(".") || k.startsWith("#")))) {
      if (key === ".") values = targets(map)
    } else if (map && key in map) values = targets(map[key])
    else if (map) {
      const patterns = Object.keys(map).filter(k => k.includes("*")).sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length)
      for (const pattern of patterns) {
        const [head, tail] = pattern.split("*")
        if (!key.startsWith(head) || !key.endsWith(tail) || key.length < head.length + tail.length) continue
        const star = key.slice(head.length, key.length - tail.length)
        values = targets(map[pattern]).map(t => t.replaceAll("*", star))
        break
      }
    }
    if (!map && key === ".") values = [pkg.module, pkg.main, "./index.ts"].filter(Boolean)
    for (const value of values) if (value.startsWith(".")) {
      const target = resolveFile(posix.normalize(posix.join(dir, value.replace(/\.d\.(vibex?)\.ts$/, ".$1"))), all)
      if (target) return target
    }
  }
  const graph = new Map()
  for (const file of files) {
    const deps = new Set((inventory.get(file) ?? []).filter(d => all.has(d)))
    for (const i of parseImports(readFileSync(join(config.target, file), "utf8"))) {
      const dep = resolveRelative(file, i.specifier, all) ?? resolveAliased(file, i.specifier, all, aliases)?.target ?? bare(file, i.specifier)
      if (dep) deps.add(dep)
    }
    graph.set(file, [...deps])
  }
  return graph
}

async function checkProjects(config, p, options, projects = projectList(config)) {
  const compiler = compilerOf(config)
  return mapLimit(projects, positive(options.jobs, 8, "jobs", 8), async task => {
    const cwd = join(config.target, task.package)
    const log = join(p.batch("01"), "logs", `check-${slug(task.file)}.log`)
    const result = await run(`${quote(compiler)} --singleThreaded --noEmit --pretty false -p ${quote(task.project)}`, { cwd, log, timeoutMs: positive(options.timeout, 3600, "timeout") * 1000 })
    const diagnostics = parseDiagnostics(result.stdout + result.stderr, { cwd, root: config.target })
    let crash = null
    try { assertFinished(result, log) } catch (error) { crash = error.message }
    if (crash) diagnostics.push({ file: null, code: "CRASH", category: "error", message: crash, line: 0, column: 0, notes: [] })
    for (const d of diagnostics) if (/\.d\.vibex?\.ts$/.test(d.file ?? "")) d.file = d.file.replace(/\.d\.(vibex?)\.ts$/, ".$1")
    return { ...task, compilerArtifact: config.compilerArtifact ? bindCompilerArtifact(config) : null, code: result.code, ms: result.ms, crash, diagnostics }
  })
}

function family(d) {
  if (d.code === "CRASH") return "compiler did not finish"
  if (["EK1002", "EK2128"].includes(d.code)) return "producer or generator conversion"
  if (["EK4402", "EK4403", "EK4602"].includes(d.code)) return "platform access"
  if (d.code === "EK4401") return "plain TypeScript call requires trust"
  if (/^EK48/.test(d.code)) return "idiomatic conversion"
  if (/^EK/.test(d.code)) return "Effect contract or language diagnostic"
  return d.message.includes("Effect<") ? "Effect value used as a plain value" : "TypeScript error after conversion"
}

/** A diagnostic in a live module blames that file. Foreign TS fallout tries changed declarations. */
export function blameCandidates(graph, diagnostic, live, same = new Set()) {
  if (live.has(diagnostic.file)) return [diagnostic.file]
  if (/^EK/.test(diagnostic.code ?? "")) return []
  const hits = [...reachable(graph, diagnostic.file)].filter(f => live.has(f))
  const changed = hits.filter(f => !same.has(f))
  return changed.length ? changed : hits
}

/** Modules whose saved declaration bytes still match their current sidecars. */
export function identicalDeclarations(config, p, cm) {
  const same = new Set()
  for (const r of cm.renames) {
    const dir = owner(config, r.from), pkg = config.packages.find(p => p.dir === dir)
    if (!pkg || !existsSync(join(config.target, r.to))) continue
    // Unknown roots/outputs are suspects. Never excuse a module on missing evidence.
    let ts
    try { ts = loadTypeScript([config.target, config.toolchain.dir, fileURLToPath(new URL("../../../../packages/runtime", import.meta.url))].filter(Boolean)) } catch { continue }
    const configPath = join(config.target, dir, pkg.dtsTsconfig ?? pkg.tsconfig ?? "tsconfig.json")
    const raw = ts.readConfigFile(configPath, ts.sys.readFile)
    if (raw.error) continue
    const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, posix.dirname(configPath))
    const root = parsed.options.rootDir
    if (!root) continue
    const rel = posix.relative(root, join(config.target,r.from)).replace(/\.(?:ts|tsx)$/, ".d.ts")
    if (rel.startsWith("../")) continue
    const base = join(declarationBaselineDir(p, dir, config.packages.map(pkg => pkg.dir)), rel)
    const side = join(config.target,r.to.replace(/\.(vibex?)$/, ".d.$1.ts"))
    if (!existsSync(base) || !existsSync(side)) continue
    const normalize = text => text.replace(/(["'])(\.\.?\/[^"'\n]+?)\.(?:tsx?|vibex?|jsx?)\1/g,"$1$2.js$1")
    if (normalize(readFileSync(base,"utf8")) === normalize(readFileSync(side,"utf8"))) same.add(r.to)
  }
  return same
}

async function settle(config, p, cm, options) {
  const identity = conversionIdentity(config, p)
  const baseline = readJson(join(p.run, "onepass-baseline.json"))
  const maxRounds = positive(options.rounds, 12, "rounds")
  const causes = readJsonIf(join(p.batch("01"), "settle-causes.json"), {})
  const history = [], reverted = new Set()
  // A revert restores every routed TypeScript import, so foreign diagnostics
  // after it say nothing about the modules that remain until emission routes
  // them again.
  let routesStale = false
  for (let round = 1; round <= maxRounds; round++) {
    await regenerate(config, p, "settle-" + round)
    const checks = await checkProjects(config, p, options)
    writeJson(join(p.batch("01"), `check-${round}.json`), checks)
    const added = checks.flatMap(c => {
      const base = baseline.find(b => b.file === c.file)
      if (!base) throw new Error("no baseline for project " + c.file + "; capture it before rename")
      // Every .vibe own error counts, even if the .ts baseline had it.
      return [...newErrors(base.diagnostics, c.diagnostics).filter(d => !/\.vibex?$/.test(d.file ?? "")), ...c.diagnostics.filter(d => d.category === "error" && /\.vibex?$/.test(d.file ?? "")), ...styleProblems(c.diagnostics, [...new Set(c.diagnostics.map(d => d.file).filter(f => /\.vibex?$/.test(f ?? "")))])]
    })
    const live = new Set(cm.renames.map(r => r.to).filter(f => existsSync(join(config.target, f))))
    const own = added.filter(d => live.has(d.file))
    if (routesStale && !own.length && added.length) {
      const logs = join(p.batch("01"), "logs")
      mkdirSync(logs, { recursive: true })
      const packages = config.packages.filter((pkg, i, all) => all.findIndex(other => other.dir === pkg.dir) === i)
      await emitMigratedJs({ ...config, packages }, config.target, logs)
      routesStale = false
      const receipt = { round, errors: added.length, own: 0, attribution: "routes-refreshed", reverting: [] }
      history.push(receipt)
      appendJsonl(join(p.batch("01"), "progress.jsonl"), { at: new Date().toISOString(), stage: "settle", ...receipt })
      if (round < maxRounds) continue
    }
    const graph = await moduleGraph(config, p)
    const bad = new Map()
    const same = own.length ? new Set() : identicalDeclarations(config, p, cm)
    // Retry every direct diagnostic owner before inferring foreign fallout.
    // A TS root can cause EK lint fallout in its importers, so code prefixes
    // cannot decide which file returns first; the dependency graph does.
    for (const d of own.length ? own : added) for (const file of blameCandidates(graph,d,live,same)) {
      bad.set(file,[...(bad.get(file) ?? []),d])
    }
    const roots = dependencyRoots(graph, new Set(bad.keys()))
    const receipt = { round, errors: added.length, own: bad.size, attribution: own.length ? "own-file" : "dependencies", reverting: roots }
    history.push(receipt)
    appendJsonl(join(p.batch("01"), "progress.jsonl"), { at: new Date().toISOString(), stage: "settle", ...receipt })
    if (!added.length || !roots.length || round === maxRounds) {
      const exceptions = warningExceptions(checks.flatMap(c => c.diagnostics), [...live])
      const result = { settled: !added.length, rounds: history, causes, remaining: added, warningExceptions: exceptions }
      writeJson(join(p.batch("01"), "settle.json"), result)
      if (result.settled) writeJson(join(p.run,"done.json"), Object.fromEntries(config.packages.map(pkg => [pkg.dir,{
        identity, digest: packageDigest(config,pkg.dir,cm.renames.map(r=>r.to)), at: new Date().toISOString(), kept: [...live].filter(f => owner(config,f) === pkg.dir),
        reverted: Object.entries(causes).filter(([f]) => owner(config,f) === pkg.dir), checked: checks.map(c => c.file),
        warningExceptions: exceptions.filter(e => owner(config, e.file) === pkg.dir)
      }])))
      return result
    }
    const requests = []
    for (const file of roots) {
      if (reverted.has(file)) throw new Error("settle revert made no progress: " + file)
      const diagnostics = bad.get(file)
      const families = [...new Set(diagnostics.map(family))]
      causes[file] = { cause: families[0], families, round, codes: [...new Set(diagnostics.map(d => d.code))].sort(), diagnostics }
      requests.push({ file, reason: families[0] + ": " + diagnostics[0].code + " " + diagnostics[0].message })
    }
    writeJson(join(p.batch("01"), "settle-causes.json"), causes)
    await revertMany({ run: p.run, batch: "01", files: requests })
    routesStale = Boolean(config.routeBundledImports)
    for (const file of roots) {
      if (existsSync(join(config.target, file)) || !existsSync(join(config.target, (cm.renames.find(r => r.to === file)?.from ?? file.replace(/\.vibex$/, ".tsx").replace(/\.vibe$/, ".ts"))))) throw new Error("settle revert did nothing: " + file)
      reverted.add(file)
    }
  }
}

/** The CLI and library share commands, with no repository-specific paths or environment. */
const pinnedInputs = config => config.routeBundledImports ? { pinned: pinnedBundleInputs(config.target) } : {}

export async function onePassStep(step, options) {
  const p = paths(options.run), config = readJson(p.config), batch = String(options.batch ?? "01").padStart(2, "0")
  if (batch !== "01") throw new Error("one-pass conversion uses batch 01")
  if (["plan", "rename"].includes(step)) assertBaselineSafe(p)
  if (step === "plan") {
    const setup = readJsonIf(p.setup, {})
    const nativeConfigs = setup.wired?.nativeViteConfigs ?? setup.nativeViteConfigs ?? []
    const plan = planScope(config.target, readFileSync(resolve(options.scope), "utf8").split(/\r?\n/), { nativeConfigs, routeBundledImports: Boolean(config.routeBundledImports) })
    const deferred = pathReadDeferrals(config.target, plan.batches[0].files, await Jj.trackedFiles(config.target), pinnedInputs(config))
    const keep = new Set(deferred.map(d=>d.file))
    plan.batches[0].files = plan.batches[0].files.filter(f=>!keep.has(f))
    plan.deferred.push(...deferred)
    if (!plan.batches[0].files.length) throw new Error("all scope modules are protected test inputs; keep .ts: " + deferred.map(d=>d.file + ": " + d.reason).join("; "))
    if (existsSync(p.codemod("01"))) throw new Error("cannot replace a plan after rename")
    writeJson(p.plan, { ...plan, source: "scope list", acceptedAt: new Date().toISOString() })
    return { accepted: true, plan }
  }
  const plan = readJson(p.plan)
  if (plan.mode !== "one-pass") throw new Error("run plan --scope <scope.txt> first")
  if (step === "rename") {
    const files = plan.batches[0].files
    const ts = loadTypeScript([
      ...(config.toolchain.kind === "staged" ? [config.toolchain.dir] : []),
      config.target, ...config.packages.map(pkg => join(config.target, pkg.dir)),
      fileURLToPath(new URL("../../../../packages/runtime", import.meta.url))
    ])
    const catalog = await Jj.trackedFiles(config.target)
    assertComputedBuildEntrypoints(config.target, catalog, files.map(from => ({from})), ts)
    const existing = readJsonIf(p.codemod("01"))
    bindCompilerArtifact(config, p, { resume: Boolean(existing) || existsSync(p.codemodState("01")) })
    if (existing?.renameComplete) {
      await Jj.trackFiles(config.target, existing.renames.map(r => r.to).filter(file => existsSync(join(config.target, file))))
      return existing
    }
    let state = readJsonIf(p.codemodState("01"))
    assertNoTestBundleRename(config.target, files, { routed: Boolean(config.routeBundledImports) })
    if (!state) {
      if (existing) throw new Error("legacy interrupted rename has no durable journal; restore its recorded renames before retrying")
      const baseline = await checkProjects(config, p, options)
      if (baseline.some(p => p.crash)) throw new Error("baseline compiler did not finish: " + baseline.filter(p => p.crash).map(p => p.file + ": " + p.crash).join("; "))
      writeJson(join(p.run, "onepass-baseline.json"), baseline)
      state = prepareState(config.target, files, await importers(config.target), { ...pinnedInputs(config), ts, moduleBodies: config.platformModuleBodies === true, globalsOf: platformCausesOf(config, p.run), throwsOf: throwingCausesOf(config, p.run), aliases: aliasesOf(config), referenceFiles: catalog, references: catalog, catalog, tracked: catalog, plainGroups: plainGroupsOf(config, files, ts, { flipped: await toolchainKeepsFunctionsPlain({ compiler: compilerOf(config), modules: join(config.target, config.packages[0].dir, "node_modules"), dir: join(p.run, "probe") }) }) })
      state.compilerArtifact = config.compilerArtifact ?? null
      saveState(p.codemodState("01"), state)
    }
    if (state.target !== config.target || JSON.stringify(state.files) !== JSON.stringify(files)) throw new Error("rename journal does not match target and scope")
    if (state.phase === "prepared") {
      applyState(config.target, state)
      state.phase = "fixing"
      saveState(p.codemodState("01"), state)
    }
    await Jj.trackFiles(config.target, state.renames.map(r => r.to).filter(file => existsSync(join(config.target, file))))
    const { renames, exportEdits, importEdits, refEdits = [], platform } = state
    const cm = { sourceSnippets: state.sourceSnippets, packingFiles: state.packingFiles ?? [], compilerArtifact: config.compilerArtifact ?? null, batch: "01", at: new Date().toISOString(), files, renames, exportEdits, importEdits, refEdits, platform, buildEntries: state.buildEntries, plain: state.plain, functionModel: state.functionModel, scriptEdits: state.scriptEdits, packageScriptEdits: state.packageScriptEdits, referenceEdits: state.referenceEdits, referenceWarnings: state.referenceWarnings, selectorChecks: state.selectorChecks, referenceScan: state.referenceScan, renameComplete: true }
    durableWrite(p.codemod("01"), JSON.stringify(cm, null, 2) + "\n")
    return cm
  }
  bindCompilerArtifact(config, p, { resume: true })
  const cm = readJson(p.codemod("01"))
  if (step === "check") {
    const checks = await checkProjects(config, p, options)
    writeJson(join(p.batch("01"), "check.json"), checks)
    return checks
  }
  if (step === "settle") return settle(config, p, cm, options)
  throw new Error("unknown one-pass step: " + step)
}

