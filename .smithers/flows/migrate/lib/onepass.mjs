// Repository-independent whole-scope conversion. The run directory owns every receipt.
import { applyState, prepareState, saveState, durableWrite } from "./codemod-state.mjs"
import { toolchainKeepsFunctionsPlain } from "./plain.mjs"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, posix, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { fixToFixedPoint, mergeFixes, renameBatch, rewriteExports, rewriteImports, rewriteTotals } from "./codemod.mjs"
import { assertFinished, newErrors, parseDiagnostics, styleProblems } from "./diagnostics.mjs"
import { parseImports, resolveRelative, resolveFile, resolveAliased } from "./imports.mjs"
import { pathReadDeferrals, rewriteReferences } from "./references.mjs"
import { isToolConfig } from "./plan.mjs"
import { assertBaselineSafe } from "./baseline.mjs"
import { assertNoTestBundleRename, testBundleDeferrals } from "./test-bundles.mjs"
import { loadTypeScript } from "./declarations.mjs"
import { projectsOf } from "./wire.mjs"
import { readToolchain } from "./toolchain.mjs"
import { aliasesOf, paths, importers, plainGroupsOf, revertMany } from "./steps.mjs"
import { regenerate } from "./hooks.mjs"
import * as Jj from "./jj.mjs"
import { appendJsonl, isDeclarationFile, quote, readJson, readJsonIf, run, slug, writeJson } from "./util.mjs"

const sourceModule = f => /\.(?:ts|tsx|mts|cts|vibe)$/.test(f) && !isDeclarationFile(f)
const livePath = (root, f) => /\.(?:ts|mts)$/.test(f) && existsSync(join(root, f.replace(/\.(?:ts|mts)$/, ".vibe"))) ? f.replace(/\.(?:ts|mts)$/, ".vibe") : f
const positive = (v, fallback, name, max = Infinity) => {
  const n = Number(v ?? fallback)
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${name} must be an integer from 1 to ${max}`)
  return n
}

export function planScope(root, scope, { nativeConfigs = [] } = {}) {
  const files = [], deferred = []
  for (const file of new Set(scope.map(f => f.trim()).filter(Boolean))) {
    if (posix.isAbsolute(file) || file.split("/").includes("..") || file !== posix.normalize(file)) throw new Error("scope paths must be repository-relative: " + file)
    if (!existsSync(join(root, file))) throw new Error("scope module missing: " + file)
    if (isToolConfig(file) && !nativeConfigs.includes(file)) deferred.push({ file, reason: "tool config has no supported native loader; keep its TypeScript filename" })
    else if (/\.(?:ts|mts)$/.test(file) && !isDeclarationFile(file)) files.push(file)
    else deferred.push({ file, reason: file.endsWith(".tsx") ? "JSX source is not supported in .vibe; keep .tsx" : file.endsWith(".vibe") ? "already .vibe; no rename needed" : "not a .ts or .mts source module; keep its source format" })
  }
  const bundled = testBundleDeferrals(root, files)
  const retained = new Set(bundled.map(d => d.file))
  deferred.push(...bundled)
  for (let i = files.length - 1; i >= 0; i--) if (retained.has(files[i])) files.splice(i, 1)
  if (!files.length) throw new Error("scope contains no .ts or .mts modules to migrate; " + deferred.map(d => d.reason).join("; "))
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

/** Directory-packed transitive import closures; never silently exceed the cap. */
export function shardModules(files, graph, cap = 240) {
  positive(cap, 240, "shard cap", 240)
  const members = new Set(files), result = [], covered = new Set()
  let group = new Set()
  const order = [...members].sort((a, b) => posix.dirname(a).localeCompare(posix.dirname(b)) || a.localeCompare(b))
  for (const file of order) {
    if (covered.has(file)) continue
    const closure = new Set([file, ...reachable(graph, file)].filter(f => members.has(f)))
    if (closure.size > cap) throw new Error(`import closure of ${file} has ${closure.size} modules, exceeds ${cap}; cannot safely shard`)
    if (new Set([...group, ...closure]).size > cap) { result.push([...group]); group = new Set() }
    for (const f of closure) { group.add(f); covered.add(f) }
  }
  if (group.size) result.push([...group])
  return result
}

/** A large program fixes selected roots and their dependencies; unrelated roots stay for the wide check. */
export function fixShards(files, graph, selected, cap = 240) {
  const sharded = files.length > cap
  const work = sharded ? [...new Set(files.filter(f => selected.has(f)).flatMap(f => [f, ...reachable(graph, f)]))] : files
  return { sharded, groups: sharded ? shardModules(work, graph, cap) : [files] }
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
      const target = resolveFile(posix.normalize(posix.join(dir, value.replace(/\.d\.vibe\.ts$/, ".vibe"))), all)
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
    for (const d of diagnostics) if (d.file?.endsWith(".d.vibe.ts")) d.file = d.file.replace(/\.d\.vibe\.ts$/, ".vibe")
    return { ...task, code: result.code, ms: result.ms, crash, diagnostics }
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

/** Own EK diagnostics only blame their file. Ordinary fallout first tries changed declarations. */
export function blameCandidates(graph, diagnostic, live, same = new Set()) {
  if (/^EK/.test(diagnostic.code ?? "")) return live.has(diagnostic.file) ? [diagnostic.file] : []
  const hits = [...reachable(graph, diagnostic.file)].filter(f => live.has(f))
  const changed = hits.filter(f => !same.has(f))
  return changed.length ? changed : live.has(diagnostic.file) ? [diagnostic.file] : hits
}

function identicalDeclarations(config, p, cm) {
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
    const rel = posix.relative(root, join(config.target,r.from)).replace(/\.ts$/, ".d.ts")
    if (rel.startsWith("../")) continue
    const base = join(p.baseline,"dts",slug(dir),rel)
    const side = join(config.target,r.to.replace(/\.vibe$/, ".d.vibe.ts"))
    if (!existsSync(base) || !existsSync(side)) continue
    const normalize = text => text.replace(/(["'])(\.\.?\/[^"'\n]+?)\.(?:ts|vibe|js)\1/g,"$1$2.js$1")
    if (normalize(readFileSync(base,"utf8")) === normalize(readFileSync(side,"utf8"))) same.add(r.to)
  }
  return same
}

async function settle(config, p, cm, options) {
  const baseline = readJson(join(p.run, "onepass-baseline.json"))
  const maxRounds = positive(options.rounds, 12, "rounds")
  const causes = readJsonIf(join(p.batch("01"), "settle-causes.json"), {})
  const history = [], reverted = new Set()
  for (let round = 1; round <= maxRounds; round++) {
    await regenerate(config, p, "settle-" + round)
    const checks = await checkProjects(config, p, options)
    writeJson(join(p.batch("01"), `check-${round}.json`), checks)
    const added = checks.flatMap(c => {
      const base = baseline.find(b => b.file === c.file)
      if (!base) throw new Error("no baseline for project " + c.file + "; capture it before rename")
      // Every .vibe own error counts, even if the .ts baseline had it.
      return [...newErrors(base.diagnostics, c.diagnostics).filter(d => !d.file?.endsWith(".vibe")), ...c.diagnostics.filter(d => d.category === "error" && d.file?.endsWith(".vibe")), ...styleProblems(c.diagnostics, [...new Set(c.diagnostics.map(d => d.file).filter(f => f?.endsWith(".vibe")))])]
    })
    const live = new Set(cm.renames.map(r => r.to).filter(f => existsSync(join(config.target, f))))
    const graph = await moduleGraph(config, p)
    const bad = new Map(), own = added.filter(d => live.has(d.file) && /^EK/.test(d.code))
    const same = identicalDeclarations(config, p, cm)
    // Own language failures are handled before inferring responsibility for TS fallout.
    for (const d of own.length ? own : added) for (const file of blameCandidates(graph,d,live,same)) {
      bad.set(file,[...(bad.get(file) ?? []),d])
    }
    const roots = dependencyRoots(graph, new Set(bad.keys()))
    const receipt = { round, errors: added.length, own: bad.size, reverting: roots }
    history.push(receipt)
    appendJsonl(join(p.batch("01"), "progress.jsonl"), { at: new Date().toISOString(), stage: "settle", ...receipt })
    if (!added.length || !roots.length || round === maxRounds) {
      const result = { settled: !added.length, rounds: history, causes, remaining: added }
      writeJson(join(p.batch("01"), "settle.json"), result)
      if (result.settled) writeJson(join(p.run,"done.json"), Object.fromEntries(config.packages.map(pkg => [pkg.dir,{
        digest: packageDigest(config,pkg.dir,cm.renames.map(r=>r.to)), at: new Date().toISOString(), kept: [...live].filter(f => owner(config,f) === pkg.dir),
        reverted: Object.entries(causes).filter(([f]) => owner(config,f) === pkg.dir), checked: checks.map(c => c.file)
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
    for (const file of roots) {
      if (existsSync(join(config.target, file)) || !existsSync(join(config.target, file.replace(/\.vibe$/, ".ts")))) throw new Error("settle revert did nothing: " + file)
      reverted.add(file)
    }
  }
}

async function fix(config, p, cm, options) {
  const jobs = positive(options.jobs, 8, "jobs", 8)
  const timeoutMs = positive(options.timeout, 3600, "timeout") * 1000
  const maxRounds = positive(options.rounds, 4, "rounds")
  const compiler = compilerOf(config), projects = projectList(config), graph = await moduleGraph(config, p)
  const packages = config.packages.map(pkg => pkg.dir)
  const byName = new Map(config.packages.map(pkg => [readJsonIf(join(config.target, pkg.dir, "package.json"), {}).name, pkg.dir]))
  const deps = new Map(packages.map(dir => [dir, new Set()]))
  for (const dir of packages) {
    const manifest = readJsonIf(join(config.target, dir, "package.json"), {})
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies })) {
      const dep = byName.get(name)
      if (dep && dep !== dir) deps.get(dir).add(dep)
    }
  }
  for (const [file, imports] of graph) for (const dep of imports) {
    const a = owner(config, file), b = owner(config, dep)
    if (a && b && a !== b) deps.get(a).add(b)
  }
  const closure = new Map(packages.map(dir => [dir, reachable(deps, dir)]))
  const related = (a, b) => closure.get(a).has(b) || closure.get(b).has(a)
  const bankFile = join(p.run,"fix-bank.json"), bank = readJsonIf(bankFile,{ packages: {}, timedOut: [] })
  const settledBank = readJsonIf(join(p.run,"done.json"),{})
  const pending = new Set(packages.sort((a,b) => cm.renames.filter(r=>owner(config,r.to)===a).length - cm.renames.filter(r=>owner(config,r.to)===b).length))
  const done = new Set(), running = new Map(), failures = []
  const timedOut = new Set(bank.timedOut)
  const saveBank = () => { bank.timedOut = [...timedOut]; writeJson(bankFile,bank) }
  cm.fix ??= { rounds: [], byFile: {}, totals: {}, refused: [] }
  cm.fix.projects ??= []
  cm.fix.settled = false
  writeJson(p.codemod("01"), cm)
  const save = () => { cm.fix.totals = rewriteTotals(cm.fix.byFile); writeJson(p.codemod("01"), cm) }
  async function fixPackage(dir) {
    const only = new Set(cm.renames.filter(r => owner(config, r.to) === dir && existsSync(join(config.target, r.to))).map(r => r.to))
    const digest = packageDigest(config,dir,cm.renames.map(r=>r.to))
    if (!only.size || bank.packages[dir]?.digest === digest || settledBank[dir]?.digest === digest) {
      appendJsonl(join(p.batch("01"),"progress.jsonl"),{stage:"fix-skip-banked",package:dir})
      return
    }
    cm.fix.projects = cm.fix.projects.filter(p => p.package !== dir)
    for (const project of projects.filter(p => p.package === dir)) {
      const started = Date.now()
      const receipt = { ...project, startedAt: new Date().toISOString(), settled: false }
      cm.fix.projects.push(receipt)
      appendJsonl(join(p.batch("01"), "progress.jsonl"), { stage: "fix-start", ...receipt })
      let temporary
      try {
        if (timedOut.has(project.file)) throw new Error("timeout earlier in this pass; no retry: " + project.file)
        const shown = await run(`${quote(compiler)} --showConfig -p ${quote(project.project)}`, { cwd: join(config.target, dir), timeoutMs })
        if (shown.timedOut) { timedOut.add(project.file); saveBank() }
        if (shown.code !== 0) throw new Error("showConfig failed: " + shown.stdout + shown.stderr)
        const membership = JSON.parse(shown.stdout).files
        if (!Array.isArray(membership)) throw new Error("showConfig did not return project files")
        const roots = membership.map(f => posix.normalize(posix.join(dir, f))).filter(sourceModule)
        const files = [...new Set(roots.flatMap(f => [f, ...reachable(graph, f)]))]
        const { sharded, groups } = fixShards(files, graph, only)
        receipt.shards = groups.map(g => ({ modules: g.length, files: g }))
        for (let sweep = 1; sweep <= maxRounds; sweep++) {
          let sweepFixes = 0
          for (let i = 0; i < groups.length; i++) {
            const group = groups[i]
            const keep = group.filter(f => only.has(f))
            if (!keep.length) continue
            let tsconfig = project.project
            if (sharded) {
              temporary = join(config.target, dir, `tsconfig.vibelang-fix-${process.pid}-${i}.json`)
              if (existsSync(temporary)) throw new Error("temporary project already exists: " + temporary)
              writeJson(temporary, { extends: "./" + project.project, files: group.map(f => "./" + posix.relative(dir, f)), include: [], exclude: [] })
              tsconfig = posix.basename(temporary)
            }
            try {
              const fixed = await fixToFixedPoint({ compiler, tsconfig, cwd: join(config.target, dir), root: config.target, only: keep, timeoutMs, maxRounds, log: join(p.batch("01"), "logs", `fix-${slug(project.file)}-${sweep}-${i}`) })
              sweepFixes += fixed.rounds.reduce((n, r) => n + r.fixes, 0)
              cm.fix.rounds.push(...fixed.rounds.map(r => ({ ...project, sweep, shard: i, ...r })))
              mergeFixes(cm.fix.byFile, fixed.byFile)
              cm.fix.refused.push(...fixed.refused)
              if (!fixed.settled) throw new Error("fix did not reach a fixed point within " + maxRounds + " rounds")
            } finally { if (temporary) { rmSync(temporary, { force: true }); temporary = undefined } }
          }
          if (!sweepFixes) break
          if (sweep === maxRounds) throw new Error("project shards did not reach a fixed point within " + maxRounds + " sweeps")
        }
        receipt.settled = true
      } catch (error) {
        receipt.error = error.message
        if (/timed out|exit(?:ed)? 124|interrupted|timeout earlier/.test(error.message)) { timedOut.add(project.file); saveBank() }
        failures.push(receipt)
      } finally {
        receipt.ms = Date.now() - started
        appendJsonl(join(p.batch("01"), "progress.jsonl"), { stage: "fix-end", ...receipt })
        save()
      }
    }
    if (!failures.some(f => f.package === dir)) {
      bank.packages[dir] = { at: new Date().toISOString(), files: [...only], digest: packageDigest(config,dir,cm.renames.map(r=>r.to)) }
      saveBank()
    }
  }
  while (pending.size || running.size) {
    for (const dir of pending) {
      if (running.size >= jobs) break
      if ([...deps.get(dir)].some(d => !done.has(d) && !closure.get(d).has(dir))) continue
      if ([...running.keys()].some(d => related(dir, d))) continue
      pending.delete(dir)
      running.set(dir, fixPackage(dir).then(() => { done.add(dir); running.delete(dir) }))
    }
    if (running.size) await Promise.race(running.values())
    else if (pending.size) throw new Error("fix dependency scheduler made no progress: " + [...pending].join(", "))
  }
  cm.fix.settled = !failures.length && cm.fix.projects.every(p => p.settled)
  save()
  if (failures.length) throw new Error("fix failed; see codemod.json and progress.jsonl: " + failures.map(f => f.file + ": " + f.error).join("; "))
  return cm.fix
}

/** The CLI and library share commands, with no repository-specific paths or environment. */
export async function onePassStep(step, options) {
  const p = paths(options.run), config = readJson(p.config), batch = String(options.batch ?? "01").padStart(2, "0")
  if (batch !== "01") throw new Error("one-pass conversion uses batch 01")
  if (["plan", "rename", "fix"].includes(step)) assertBaselineSafe(p)
  if (step === "plan") {
    const setup = readJsonIf(p.setup, {})
    const nativeConfigs = setup.wired?.nativeViteConfigs ?? setup.nativeViteConfigs ?? []
    const plan = planScope(config.target, readFileSync(resolve(options.scope), "utf8").split(/\r?\n/), { nativeConfigs })
    const deferred = pathReadDeferrals(config.target, plan.batches[0].files, await Jj.trackedFiles(config.target))
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
    const existing = readJsonIf(p.codemod("01"))
    if (existing?.renameComplete) return existing
    let state = readJsonIf(p.codemodState("01"))
    const files = plan.batches[0].files
    assertNoTestBundleRename(config.target, files)
    if (!state) {
      if (existing) throw new Error("legacy interrupted rename has no durable journal; restore its recorded renames before retrying")
      const baseline = await checkProjects(config, p, options)
      if (baseline.some(p => p.crash)) throw new Error("baseline compiler did not finish: " + baseline.filter(p => p.crash).map(p => p.file + ": " + p.crash).join("; "))
      writeJson(join(p.run, "onepass-baseline.json"), baseline)
      const ts = loadTypeScript([
        ...(config.toolchain.kind === "staged" ? [config.toolchain.dir] : []),
        config.target, ...config.packages.map(pkg => join(config.target, pkg.dir)),
        fileURLToPath(new URL("../../../../packages/runtime", import.meta.url))
      ])
      const catalog = await Jj.trackedFiles(config.target)
      state = prepareState(config.target, files, await importers(config.target), { ts, aliases: aliasesOf(config), referenceFiles: catalog, references: catalog, catalog, tracked: catalog, plainGroups: plainGroupsOf(config, files, ts, { flipped: await toolchainKeepsFunctionsPlain({ compiler: compilerOf(config), modules: join(config.target, config.packages[0].dir, "node_modules"), dir: join(p.run, "probe") }) }) })
      saveState(p.codemodState("01"), state)
    }
    if (state.target !== config.target || JSON.stringify(state.files) !== JSON.stringify(files)) throw new Error("rename journal does not match target and scope")
    if (state.phase === "prepared") {
      applyState(config.target, state)
      state.phase = "fixing"
      saveState(p.codemodState("01"), state)
    }
    const { renames, exportEdits, importEdits, refEdits = [], platform } = state
    const cm = { batch: "01", at: new Date().toISOString(), files, renames, exportEdits, importEdits, refEdits, platform, buildEntries: state.buildEntries, buildEntries: state.buildEntries, plain: state.plain, functionModel: state.functionModel, scriptEdits: state.scriptEdits, packageScriptEdits: state.packageScriptEdits, referenceEdits: state.referenceEdits, referenceWarnings: state.referenceWarnings, selectorChecks: state.selectorChecks, referenceScan: state.referenceScan, renameComplete: true, fix: { settled: false, rounds: [], byFile: {}, totals: {}, refused: [] } }
    durableWrite(p.codemod("01"), JSON.stringify(cm, null, 2) + "\n")
    return cm
  }
  const cm = readJson(p.codemod("01"))
  if (step === "fix") return fix(config, p, cm, options)
  if (step === "check") {
    const checks = await checkProjects(config, p, options)
    writeJson(join(p.batch("01"), "check.json"), checks)
    return checks
  }
  if (step === "settle") return settle(config, p, cm, options)
  throw new Error("unknown one-pass step: " + step)
}

