// The pack check: a package whose files all ship can still fail for everyone
// outside its workspace. Each published package is packed, installed in an
// empty directory and imported under Node and under Bun, and the results are
// compared with the baseline's. alchemy at be1fa00d94e1 passed its dist-list
// diff with 29 of 30 packs failing to install and 954 Bun entries failing to load.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { workspacePackages } from "./builds.mjs"
import * as Jj from "./jj.mjs"
import { packageManager } from "./wire.mjs"
import { quote, readJsonIf, run, writeJson } from "./util.mjs"

const DEFAULTS = {
  // Up to aloneUpTo entries, each gets its own process. Above it entries share
  // one per batch, and an entry that fails reruns alone: a 7,000-entry package
  // cannot start 14,000 processes. `batching` in the receipt says which ran.
  // An entry past processMs reruns alone with processMs * hangRetryFactor: alchemy's aws `.` loads
  // about 7,000 modules and passed 240 s on one 4-vCPU box but not on two others.
  aloneUpTo: 200, nodeBatch: 40, bunBatch: 80, processMs: 240_000, hangRetryFactor: 4,
  nodeCapSeconds: 2400, bunCapSeconds: 900, packMs: 1_800_000, installMs: 900_000,
  parallel: Math.min(8, availableParallelism())
}
const CONDITIONS = { node: ["node", "import"], bun: ["bun", "node", "import"] }
const RUNTIMES = Object.keys(CONDITIONS)
const LOCAL_SPEC = /^(?:file|link|workspace|catalog|portal):/
const LOADABLE = /\.(?:[cm]?[jt]sx?|vibe)$/
const DECLARATION = /\.d\.(?:[^./]+\.)?[cm]?ts$/
const ERROR_TAIL = 800

// The target a runtime takes: the first key, in the map's own order, that applies.
function pick(value, conditions) {
  if (value === null) return null
  if (typeof value === "string") return value
  if (Array.isArray(value)) { for (const item of value) { const target = pick(item, conditions); if (target !== undefined) return target } return undefined }
  if (!value || typeof value !== "object") return undefined
  for (const key of Object.keys(value)) {
    if (key !== "default" && !conditions.includes(key)) continue
    const target = pick(value[key], conditions)
    if (target !== undefined) return target
  }
  return undefined
}

function exportsMap(manifest, files) {
  const value = manifest.exports
  if (value === undefined) {
    const main = manifest.main ?? (files.has("index.js") ? "index.js" : undefined)
    return main ? { ".": main } : {}
  }
  if (typeof value === "string" || Array.isArray(value)) return { ".": value }
  return value && Object.keys(value).some(key => key.startsWith(".")) ? value : { ".": value }
}

/**
 * The specifiers a pack answers: each exact key, and each wildcard key expanded
 * over the pack's files. A specifier takes the key Node would choose, so an
 * exact key outranks a `./<star>/internal: null` block.
 */
export function exportSpecifiers(manifest, packFiles) {
  const files = new Set(packFiles)
  const map = exportsMap(manifest, files)
  const keys = Object.keys(map)
  const patterns = keys.filter(key => key.includes("*")).sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length)
  const matchKey = spec => {
    if (spec in map) return [spec, ""]
    for (const key of patterns) {
      const [before, after] = key.split("*")
      if (spec.startsWith(before) && spec.endsWith(after) && spec.length >= key.length) return [key, spec.slice(before.length, spec.length - after.length)]
    }
    return [null, ""]
  }
  const specs = new Set(keys.filter(key => !key.includes("*")))
  for (const key of patterns) for (const conditions of Object.values(CONDITIONS)) {
    const target = pick(map[key], conditions)
    if (typeof target !== "string") continue
    const [before, after = ""] = target.replace(/^\.\//, "").split("*")
    const [keyBefore, keyAfter] = key.split("*")
    for (const file of files) {
      if (!file.startsWith(before) || !file.endsWith(after) || file.length < before.length + after.length) continue
      const spec = keyBefore + file.slice(before.length, file.length - after.length) + keyAfter
      if (matchKey(spec)[0] === key) specs.add(spec)
    }
  }
  const entries = {}
  for (const spec of [...specs].sort()) {
    const [key, star] = matchKey(spec)
    const entry = {}
    const targets = RUNTIMES.map(runtime => [runtime, pick(map[key], CONDITIONS[runtime])])
    if (targets.every(([, target]) => target === null)) continue
    for (const [runtime, target] of targets) {
      if (typeof target !== "string") continue
      entry[runtime] = target.replace(/^\.\//, "").replaceAll("*", star)
      if (!files.has(entry[runtime])) (entry.missing ??= []).push(runtime + ":" + entry[runtime])
    }
    entries[spec] = entry
  }
  return { keys, entries }
}

/** Dependencies a pack names by a path or a workspace protocol, which nothing outside the tree can resolve. */
export function localDependencies(manifest) {
  const local = {}
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) for (const [name, spec] of Object.entries(manifest[field] ?? {})) if (LOCAL_SPEC.test(spec)) local[name] = spec
  return local
}

// The staged toolchain, for a release the registry does not have yet.
function stagedPins(t) {
  const pins = {}
  const receipt = readJsonIf(join(t, ".vibelang/toolchain-publication.json"))
  for (const [name, spec] of Object.entries(receipt?.localPins ?? {})) if (spec.startsWith("file:")) pins[name] = "file:" + resolve(t, spec.slice(5))
  const stage = join(t, ".vibelang-toolchain")
  if (existsSync(stage)) for (const file of readdirSync(stage)) {
    const match = /^(vibelang(?:-[a-z]+)?)-\d.*\.tgz$/.exec(file)
    if (match) pins[match[1]] ??= "file:" + join(stage, file)
  }
  return { pins, releaseRequired: receipt?.releaseRequired ?? [] }
}

const packCommand = (manager, destination) => ({
  pnpm: "pnpm pack --pack-destination " + quote(destination),
  bun: "bun pm pack --destination " + quote(destination),
  yarn: "yarn pack --out " + quote(join(destination, "package.tgz")),
  npm: "npm pack --pack-destination " + quote(destination)
})[manager]

async function packOne({ t, dir, manager, scratch, env, tune }) {
  const destination = join(scratch, "packs", dir.replaceAll("/", "__") || "root")
  mkdirSync(destination, { recursive: true })
  const started = Date.now()
  const packed = await run(packCommand(manager, destination), { cwd: join(t, dir), env, timeoutMs: tune.packMs })
  const tgz = readdirSync(destination).find(file => file.endsWith(".tgz"))
  if (packed.code !== 0 || !tgz) return { error: (packed.stdout + packed.stderr).slice(-ERROR_TAIL), ms: Date.now() - started }
  const path = join(destination, tgz)
  const manifest = JSON.parse((await run("tar xzOf " + quote(path) + " package/package.json", { env })).stdout)
  const files = (await run("tar tzf " + quote(path), { env })).stdout.split("\n").filter(line => line && !line.endsWith("/")).map(line => line.replace(/^package\//, ""))
  return { path, manifest, files, bytes: statSync(path).size, ms: Date.now() - started }
}

// Each workspace member a package reaches through what its consumer installs.
function closureOf(start, members) {
  const seen = new Set(), queue = [start]
  while (queue.length) {
    const member = queue.pop()
    if (!member || seen.has(member.name)) continue
    seen.add(member.name)
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) for (const name of Object.keys(member.manifest[field] ?? {})) queue.push(members.get(name))
  }
  seen.delete(start.name)
  return [...seen].map(name => members.get(name))
}

const LOADER = `import { appendFileSync, readFileSync } from "node:fs"
const [list, results] = process.argv.slice(2)
let current
const write = value => appendFileSync(results, JSON.stringify(value) + "\\n")
const late = error => write({ spec: current, late: String(error?.message ?? error).slice(0, 300) })
process.on("uncaughtException", late)
process.on("unhandledRejection", late)
for (const spec of JSON.parse(readFileSync(list, "utf8"))) {
  current = spec
  write({ start: spec })
  const began = performance.now()
  const ms = () => Math.round(performance.now() - began)
  try { const names = Object.keys(await import(spec)).sort(); write({ spec, names, ms: ms() }) }
  catch (error) { write({ spec, err: (error?.code ? error.code + " " : "") + String(error?.message ?? error).slice(0, 400), ms: ms() }) }
}
process.exit(0)
`

// Imports each specifier in a fresh process; a crash or a hang marks the entry that was running.
async function loadEntries({ runtime, specs, consumer, env, tune }) {
  const results = {}
  if (!specs.length) return { results, perProcess: 0 }
  const perProcess = specs.length <= tune.aloneUpTo ? 1 : runtime === "node" ? tune.nodeBatch : tune.bunBatch
  const until = Date.now() + (runtime === "node" ? tune.nodeCapSeconds : tune.bunCapSeconds) * 1000
  let count = 0
  const pass = async (items, size, limitMs = tune.processMs) => {
    const queue = [...items]
    const worker = async () => {
      while (queue.length) {
        if (Date.now() > until) { for (const spec of queue.splice(0)) results[spec] ??= { capped: true }; return }
        const batch = queue.splice(0, size)
        const id = runtime + "-" + (++count)
        const list = join(consumer, id + ".json"), out = join(consumer, id + ".ndjson")
        writeFileSync(list, JSON.stringify(batch)); writeFileSync(out, "")
        const process_ = await run([runtime, quote(join(consumer, "load.mjs")), quote(list), quote(out)].join(" "), { cwd: consumer, env, timeoutMs: limitMs })
        const started = []
        for (const line of readFileSync(out, "utf8").split("\n").filter(Boolean)) {
          const record = JSON.parse(line)
          if (record.start) started.push(record.start)
          else if (record.late) (results[record.spec] ??= {}).late = record.late
          else results[record.spec] = { ...results[record.spec], ...record, spec: undefined }
        }
        const failure = process_.timedOut ? "HANG " + limitMs / 1000 + "s" : "CRASH status=" + process_.code + " " + process_.stderr.slice(-300)
        const last = started.at(-1)
        if (!last) for (const spec of batch) results[spec] = { err: "NOSTART " + failure }
        else {
          if (!results[last]?.names && !results[last]?.err) results[last] = { err: failure }
          queue.push(...batch.filter(spec => !started.includes(spec)))
        }
      }
    }
    while (queue.length) await Promise.all(Array.from({ length: Math.min(tune.parallel, Math.ceil(queue.length / size)) }, worker))
  }
  await pass(specs, perProcess)
  if (perProcess > 1) {
    const failed = Object.keys(results).filter(spec => results[spec].err)
    for (const spec of failed) delete results[spec]
    await pass(failed, 1)
  }
  // A slow load is not a hang: rerun each alone with the longer limit, and keep its time.
  const hung = Object.keys(results).filter(spec => results[spec].err?.startsWith("HANG "))
  if (hung.length && tune.hangRetryFactor > 1) {
    for (const spec of hung) delete results[spec]
    await pass(hung, 1, tune.processMs * tune.hangRetryFactor)
    for (const spec of hung) if (results[spec]?.names) results[spec].slowMs = results[spec].ms
  }
  return { results, perProcess }
}

async function checkPackage({ pkg, members, packed, staged, scratch, env, tune }) {
  const self = await packed(pkg)
  const record = { dir: pkg.dir, name: pkg.name, ms: { pack: self.ms } }
  if (self.error) return { ...record, packError: self.error }
  const { keys, entries } = exportSpecifiers(self.manifest, self.files)
  Object.assign(record, { files: self.files.length, bytes: self.bytes, exportKeys: keys, entries })
  // Workspace dependencies install from their own packs: this tree's, not an older release's.
  const closure = []
  for (const member of closureOf(pkg, members)) {
    const result = await packed(member)
    record.ms.pack += result.ms
    if (result.error) (record.closureErrors ??= {})[member.name] = result.error
    else closure.push([member.name, result])
  }
  record.localDeps = localDependencies(self.manifest)
  const localNames = new Set(Object.keys(record.localDeps))
  for (const [, result] of closure) for (const name of Object.keys(localDependencies(result.manifest))) localNames.add(name)
  const consumer = join(scratch, "consumers", pkg.dir.replaceAll("/", "__") || "root")
  mkdirSync(consumer, { recursive: true })
  const closurePacks = Object.fromEntries(closure.map(([name, result]) => [name, "file:" + result.path]))
  // npm refuses an override that differs from a direct dependency, so an overridden peer stays indirect.
  const peers = Object.entries(self.manifest.peerDependencies ?? {}).filter(([name]) => !self.manifest.peerDependenciesMeta?.[name]?.optional && !closurePacks[name] && !staged.pins[name])
  const write = overrides => writeJson(join(consumer, "package.json"), { name: "pack-load-consumer", private: true, type: "module",
    dependencies: { ...Object.fromEntries(peers.filter(([, spec]) => !LOCAL_SPEC.test(spec))), [pkg.name]: "file:" + self.path }, overrides })
  const install = async (overrides, flags = "") => {
    write(overrides)
    return run("npm install --no-audit --no-fund --ignore-scripts --no-package-lock " + flags, { cwd: consumer, env, timeoutMs: tune.installMs })
  }
  const without = pins => Object.fromEntries(Object.entries(pins).filter(([name]) => !localNames.has(name)))
  const asPublished = { ...without(staged.pins), ...without(closurePacks) }
  const started = Date.now()
  let attempt = await install(asPublished), flags = ""
  // A peer range the staged packs do not satisfy is a registry question, not this pack's install.
  if (attempt.code !== 0 && /ERESOLVE/.test(attempt.stdout + attempt.stderr)) { attempt = await install(asPublished, "--force"); flags = "--force" }
  record.install = { rc: attempt.code, flags }
  if (attempt.code !== 0) record.install.error = (attempt.stderr + attempt.stdout).slice(-ERROR_TAIL)
  // Past a local pin, measure the rest against the staged toolchain, so one defect hides no other.
  if (attempt.code !== 0 && localNames.size) {
    attempt = await install({ ...staged.pins, ...closurePacks }, flags)
    record.install.pastLocal = attempt.code
  }
  record.ms.install = Date.now() - started
  if (attempt.code !== 0) return record
  writeFileSync(join(consumer, "load.mjs"), LOADER)
  record.batching = {}
  for (const runtime of RUNTIMES) {
    const loadable = Object.keys(entries).filter(spec => { const target = entries[spec][runtime]; return typeof target === "string" && LOADABLE.test(target) && !DECLARATION.test(target) })
    // A target the pack does not hold cannot load, and the install ran no scripts to make it: no process.
    // On alchemy's aws, 6,580 such specifiers each reran alone and took 19 minutes.
    const absent = loadable.filter(spec => entries[spec].missing?.includes(runtime + ":" + entries[spec][runtime]))
    const specifier = spec => spec === "." ? pkg.name : pkg.name + "/" + spec.slice(2)
    const specs = loadable.filter(spec => !absent.includes(spec)).map(specifier)
    const began = Date.now()
    const { results, perProcess } = await loadEntries({ runtime, specs, consumer, env, tune })
    for (const spec of absent) results[specifier(spec)] = { err: "ABSENT " + entries[spec][runtime] + " is not in the pack" }
    record[runtime] = results
    record.ms[runtime] = Date.now() - began
    record.batching[runtime] = { entries: specs.length, perProcess, ...absent.length ? { absent: absent.length } : {} }
  }
  return record
}

/**
 * Packs, installs and imports the run's published packages (those under `only`
 * when given), and writes `<phase>-pack-load.json`. It never throws for what a
 * package does: a failure is a result. npm installs each consumer in a new
 * directory outside the tree, so the workspace's loaders and links do not reach it.
 */
export async function packLoadSnapshot({ config, logs, phase, only, env, tune }) {
  const settings = { ...DEFAULTS, ...tune }
  const t = config.target
  const path = join(logs, phase + "-pack-load.json")
  const manifests = await workspacePackages(config)
  const members = new Map(manifests.filter(file => file.manifest.name && file.manifest.private !== true && file.dir !== ".").map(file => [file.manifest.name, { dir: file.dir, name: file.manifest.name, manifest: file.manifest }]))
  const selected = config.packages.map(pkg => manifests.find(file => file.dir === pkg.dir)).filter(Boolean)
  const published = selected.filter(file => file.manifest.name && file.manifest.private !== true && file.manifest.version)
  const excluded = selected.filter(file => !published.includes(file)).map(file => file.dir)
  const chosen = published.filter(file => !only || only.includes(file.dir))
  if (!published.length) {
    const result = { state: "not-run", reason: "no published package: every package of this run is private or has no name and version", private: excluded }
    writeJson(path, result)
    return result
  }
  const manager = packageManager(readdirSync(t))
  const scratch = mkdtempSync(join(tmpdir(), "pack-load-"))
  const environment = { NODE_OPTIONS: "", NODE_PATH: "", DO_NOT_TRACK: "1", ...env }
  const started = Date.now()
  try {
    const packs = new Map()
    const packed = pkg => {
      if (!packs.has(pkg.dir)) packs.set(pkg.dir, packOne({ t, dir: pkg.dir, manager, scratch, env: environment, tune: settings }))
      return packs.get(pkg.dir)
    }
    const staged = stagedPins(t)
    const versioned = existsSync(join(t, ".jj"))
    const changedBefore = versioned ? new Set((await Jj.changedPaths(t)).map(change => change.path)) : new Set()
    const packages = {}
    for (const file of chosen) {
      packages[file.dir] = await checkPackage({ pkg: { dir: file.dir, name: file.manifest.name, manifest: file.manifest }, members, packed, staged, scratch, env: environment, tune: settings })
      // A consumer's node_modules can hold a package's whole dependency tree.
      rmSync(join(scratch, "consumers", file.dir.replaceAll("/", "__") || "root"), { recursive: true, force: true })
    }
    // A prepack script that rewrites a tracked file is the repository's to fix; record's scope check refuses it for a batch.
    const dirtied = versioned ? (await Jj.changedPaths(t)).map(change => change.path).filter(path => !changedBefore.has(path)) : []
    const result = { state: "complete", manager, private: excluded, releaseRequired: staged.releaseRequired, dirtied, ms: Date.now() - started, packages }
    writeJson(path, result)
    return result
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const ok = result => Boolean(result?.names)
const entryKey = (spec, name) => spec === name ? "." : "./" + spec.slice(name.length + 1)

function compareRuntime({ runtime, base, head, dir, name, headEntries, refuse, out }) {
  const before = base[runtime], after = head[runtime]
  if (!before || !after) return
  for (const spec of Object.keys(before)) {
    if (!ok(before[spec])) continue
    const key = entryKey(spec, name)
    // Its loss is one exports-lost refusal, not one per runtime as well.
    if (!(key in headEntries)) continue
    const result = after[spec]
    if (result?.capped) { out.unverified.push({ package: dir, runtime, specifier: spec, reason: "the load cap ran out before this entry" }); continue }
    if (!ok(result)) {
      const error = result?.err ?? "the entry no longer has a target this runtime can import"
      refuse("load-failed", { runtime, specifier: spec, error }, `${spec} loaded under ${runtime} in the baseline and now fails: ${error}`)
      continue
    }
    const lost = before[spec].names.filter(item => !result.names.includes(item))
    const gained = result.names.filter(item => !before[spec].names.includes(item))
    if (lost.length) refuse("load-names-lost", { runtime, specifier: spec, names: lost }, `${spec} no longer exports ${lost.join(", ")} under ${runtime}`)
    if (gained.length) out.namesGained.push({ package: dir, runtime, specifier: spec, names: gained })
    if (result.slowMs !== undefined) out.slowLoads.push({ package: dir, runtime, specifier: spec, ms: result.slowMs })
  }
}

/**
 * Compares two snapshots. A regression is a named refusal: a local dependency
 * that stops the pack installing, an install, pack or load that worked and now
 * fails, a lost export name, a specifier lost or added, or an export target
 * newly missing from the pack. A gained name, a capped entry, a tracked file a
 * pack script changed and a release the registry does not have yet are reported,
 * not refused.
 */
export function comparePackLoads(baseline, candidate) {
  if (!baseline) return { state: "not-run", ok: true, reason: "the baseline has no pack results: its setup ran before this check; rerun setup to compare packs" }
  if (baseline.state !== "complete") return { state: "not-run", ok: true, reason: baseline.reason ?? "the baseline's pack check did not finish" }
  if (!candidate || candidate.state !== "complete") return { state: "not-run", ok: true, reason: candidate?.reason ?? "the candidate was not packed" }
  const refusals = []
  const out = { unverified: [], namesGained: [], slowLoads: [], baselineFailures: [], newPackages: [] }
  const summaries = {}
  for (const [dir, head] of Object.entries(candidate.packages)) {
    const base = baseline.packages[dir]
    const refuse = (kind, fields, message) => refusals.push({ kind, package: dir, ...fields, message: dir + ": " + message })
    summaries[dir] = { name: head.name, ms: head.ms, install: head.install, batching: head.batching, closureErrors: head.closureErrors, loads: Object.fromEntries(RUNTIMES.map(runtime => {
      const results = Object.values(head[runtime] ?? {})
      return [runtime, { loaded: results.filter(ok).length, total: results.length }]
    })) }
    if (!base) { out.newPackages.push(dir); continue }
    if (head.packError) {
      if (base.packError) out.baselineFailures.push({ package: dir, stage: "pack", error: base.packError })
      else refuse("pack-failed", { error: head.packError }, "the package no longer packs: " + head.packError)
      continue
    }
    if (base.packError) { out.baselineFailures.push({ package: dir, stage: "pack", error: base.packError }); continue }
    // A pack that names a path outside itself cannot install anywhere; the baseline having it does not excuse it.
    const blocked = head.install?.rc !== 0 && Object.keys(head.localDeps ?? {}).length > 0
    if (blocked) for (const [dependency, spec] of Object.entries(head.localDeps)) {
      refuse("pack-local-dependency", { dependency, spec, error: head.install.error }, `the pack names ${dependency} as ${spec}, and npm install of the pack fails. Depend on the released version: setup keeps the staged build in development pins and overrides`)
    }
    const installed = !blocked ? head.install?.rc === 0 : head.install?.pastLocal === 0
    if (!installed && !blocked) {
      if (base.install?.rc === 0) refuse("pack-install-failed", { error: head.install?.error }, "the pack installed in the baseline and now fails: " + head.install?.error)
      else out.baselineFailures.push({ package: dir, stage: "install", error: base.install?.error })
    }
    const baseEntries = base.entries ?? {}, headEntries = head.entries ?? {}
    for (const specifier of Object.keys(baseEntries)) if (!(specifier in headEntries)) refuse("exports-lost", { specifier }, `the pack no longer answers ${specifier}`)
    for (const specifier of Object.keys(headEntries)) {
      if (specifier in baseEntries) continue
      // A wildcard over source files also matches each module's declaration sidecar.
      const sidecar = specifier.endsWith(".d.vibe")
      refuse("exports-added", { specifier, ...(sidecar ? { sidecar } : {}) }, `the pack now answers ${specifier}, which the baseline did not publish: ` +
        (sidecar ? 'a wildcard target matches the module\'s declaration sidecar; add "./*.d.vibe": null to exports' : "exclude it from exports (a null target, or the generator's filter) so a converted module adds no public path"))
    }
    for (const [specifier, entry] of Object.entries(headEntries)) {
      const was = new Set((baseEntries[specifier]?.missing ?? []).map(item => item.split(":")[0]))
      const missing = (entry.missing ?? []).filter(item => !was.has(item.split(":")[0]))
      if (specifier in baseEntries && missing.length) refuse("export-target-missing", { specifier, missing }, `${specifier} points at ${missing.join(", ")}, which the pack does not hold`)
    }
    if (!installed) continue
    for (const runtime of RUNTIMES) compareRuntime({ runtime, base, head, dir, name: head.name, headEntries, refuse, out })
  }
  return {
    state: "complete", ok: refusals.length === 0, refusals,
    counts: refusals.reduce((all, refusal) => ({ ...all, [refusal.kind]: (all[refusal.kind] ?? 0) + 1 }), {}),
    ...out, releaseRequired: candidate.releaseRequired ?? [], private: candidate.private ?? [], dirtied: candidate.dirtied ?? [], ms: candidate.ms, packages: summaries
  }
}

const notRun = reason => ({ state: "not-run", ok: true, reason })

/**
 * The batch's check: the published packages holding a file of the batch, against
 * the baseline. It costs the most of any gate, so it runs last, and only once
 * every other check has passed; each way it does not run says why in verify.json.
 */
export async function verifyPackLoad({ config, baselinePath, logs, files, built, earlierFailure = [], env, tune }) {
  if (earlierFailure.length) return notRun("these checks failed first, and packing would not change the verdict: " + earlierFailure.join(", "))
  if (!built) return notRun("a one-pass run builds in its measurement workspaces, not the target")
  const baseline = readJsonIf(baselinePath)
  if (!baseline) return comparePackLoads(baseline)
  if (baseline.state !== "complete") return comparePackLoads(baseline)
  const dirs = Object.keys(baseline.packages)
  const touched = dirs.filter(dir => dir === "." || files.some(file => file === dir || file.startsWith(dir + "/")))
  if (!touched.length) return notRun("this batch holds no file of a published package")
  const candidate = await packLoadSnapshot({ config, logs, phase: "candidate", only: touched, env, tune })
  return { ...comparePackLoads(baseline, candidate), notInBatch: dirs.filter(dir => !touched.includes(dir)) }
}

/** The baseline a run's batches compare with. Setup keeps going without one: `verify` then reports not-run. */
export async function packLoadBaseline({ config, logs, env, tune }) {
  try { return await packLoadSnapshot({ config, logs, phase: "baseline", env, tune }) }
  catch (error) {
    const result = { state: "not-run", reason: "the baseline's pack check failed: " + String(error?.message ?? error).slice(0, ERROR_TAIL) }
    writeJson(join(logs, "baseline-pack-load.json"), result)
    return result
  }
}
