// Declared product builds are prerequisites of test baselines and candidates.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import * as Jj from "./jj.mjs"
import { workspaceGlobs, workspaceManifests } from "./upgrade.mjs"
import { packageManager } from "./wire.mjs"
import { readJson, run, writeJson } from "./util.mjs"
import { cleanBuildList, outputDirs } from "./dist-list.mjs"

/** Choose existing aggregate builds, otherwise the selected workspace dependency closure. */
export function buildPlan(manifests, packages, manager) {
  const root = manifests.find(f => f.path === "package.json")?.manifest ?? {}
  if (root.scripts?.["build:packages"]) return [{ cwd: ".", command: manager + " run build:packages" }]
  const byDir = new Map(manifests.map(f => [dirname(f.path), f.manifest]))
  const byName = new Map(manifests.filter(f => f.manifest.name).map(f => [f.manifest.name, dirname(f.path)]))
  const ordered = [], complete = new Set(), active = new Set()
  const visit = dir => {
    if (complete.has(dir)) return
    if (active.has(dir)) throw new Error("workspace build cycle at " + dir + "; declare build:packages to build the cycle")
    const manifest = byDir.get(dir)
    if (!manifest) throw new Error("no workspace package manifest for build prerequisite " + dir)
    active.add(dir)
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }).sort()) {
      const dependency = byName.get(name)
      if (dependency && dependency !== dir) visit(dependency)
    }
    active.delete(dir); complete.add(dir)
    if (manifest.scripts?.build) ordered.push({ cwd: dir, command: manager + " run build" })
  }
  const seeds = packages.some(p => p.dir === ".") ? [...byDir.keys()] : packages.map(p => normalize(p.dir))
  for (const dir of seeds.sort()) visit(dir)
  return ordered
}

/** The packages a plan builds: each step's package, or every member with a build script under an aggregate build. */
export function builtPackages(manifests, plan) {
  const dirs = new Set()
  for (const step of plan) {
    if (!step.command.endsWith(" run build:packages")) { dirs.add(normalize(step.cwd)); continue }
    for (const f of manifests) if (f.path !== "package.json" && Object.keys(f.manifest.scripts ?? {}).some(name => /^build(?::|$)/.test(name))) dirs.add(dirname(f.path))
  }
  return [...dirs].sort().map(dir => ({ dir, manifest: manifests.find(f => dirname(f.path) === dir)?.manifest ?? {} }))
}

/** The workspace's members and the run's packages, each with its manifest. An explicitly selected package need not be a member. */
export async function workspacePackages(config, tracked) {
  const t = config.target
  const files = existsSync(join(t,".jj")) ? tracked ?? await Jj.trackedFiles(t) : ["package.json",...config.packages.map(p=>join(p.dir,"package.json"))]
  const workspace = existsSync(join(t,"pnpm-workspace.yaml")) ? readFileSync(join(t,"pnpm-workspace.yaml"),"utf8") : ""
  const globs = workspaceGlobs(readFileSync(join(t,"package.json"),"utf8"),workspace)
  const members = workspaceManifests(files.filter(file => /(?:^|\/)package\.json$/.test(file)),globs).filter(file=>file.endsWith("package.json"))
  const selected = config.packages.map(pkg=>join(pkg.dir,"package.json"))
  return [...new Set([...members,...selected])].map(path=>({path,dir:normalize(dirname(path)),manifest:readJson(join(t,path))}))
}

/**
 * Runs the declared builds. With `distList`, each built package's output
 * directories are moved aside first, so the list in `<phase>-dist.json` is
 * what this build wrote and not a cached `dist`.
 */
export async function prepareBuilds(config, logs, phase, { distList = false } = {}) {
  const t = config.target
  const versioned = existsSync(join(t,".jj"))
  const files = versioned ? await Jj.trackedFiles(t) : []
  const manifests = await workspacePackages(config, files)
  const plan = buildPlan(manifests,config.packages,packageManager(readdirSync(t)))
  const hash = createHash("sha256")
  for (const file of [...new Set([...manifests.map(f=>f.path),...["pnpm-lock.yaml","pnpm-workspace.yaml","bun.lock","bun.lockb","package-lock.json","yarn.lock"].filter(f=>existsSync(join(t,f)))])].sort()) hash.update(file).update("\0").update(readFileSync(join(t,file))).update("\0")
  const receipt = {
    phase, state: "running", sourceCommit: versioned ? await Jj.commitId(t,"@") : null, dependenciesHash: hash.digest("hex"),
    toolchain: config.toolchain.kind === "staged" ? { kind:"staged", manifestHash:existsSync(join(config.toolchain.dir,"toolchain.json")) ? createHash("sha256").update(readFileSync(join(config.toolchain.dir,"toolchain.json"))).digest("hex") : null } : config.toolchain,
    startedAt: new Date().toISOString(), steps: []
  }
  const path = join(logs,phase + "-build.json")
  writeJson(path,receipt)
  const runPlan = async () => {
    for (const [index, item] of plan.entries()) {
      const step = {...item, startedAt:new Date().toISOString(), state:"running", log:phase+"-build-"+(index+1)+".log"}
      receipt.steps.push(step); writeJson(path,receipt)
      const result = await run(item.command,{cwd:join(t,item.cwd),log:join(logs,step.log)})
      Object.assign(step,{state:result.code===0&&!result.signal?"complete":"failed",code:result.code,signal:result.signal??null,durationMs:result.ms,finishedAt:new Date().toISOString()})
      if (step.state === "failed") {
        receipt.state="failed";receipt.finishedAt=step.finishedAt;writeJson(path,receipt)
        throw new Error("build prerequisite failed (" + item.cwd + ", exit " + result.code + (result.signal ? ", " + result.signal : "") + "); see " + join(logs,step.log))
      }
      writeJson(path,receipt)
    }
  }
  if (!distList) await runPlan()
  else if (!plan.length || !versioned) {
    receipt.dist = { state: "not-run", reason: !versioned ? "the target is not a jj repository, so tracked sources cannot be told from outputs" : "no build script: the repository declares no build:packages and no package build, so the dist-list diff did not run" }
    if (plan.length) await runPlan()
    writeJson(join(logs, phase + "-dist.json"), { ...receipt.dist, files: [] })
  } else {
    const dirs = builtPackages(manifests, plan).flatMap(pkg => outputDirs(pkg.manifest, pkg.dir, files))
    const listed = await cleanBuildList({ t, dirs, scratch: logs, build: runPlan })
    receipt.dist = { state: "complete", dirs: listed.dirs, notBuilt: listed.notBuilt, files: listed.files.length, list: phase + "-dist.json" }
    writeJson(join(logs, phase + "-dist.json"), { state: "complete", sourceCommit: receipt.sourceCommit, dirs: listed.dirs, notBuilt: listed.notBuilt, files: listed.files })
  }
  receipt.state="complete";receipt.finishedAt=new Date().toISOString();receipt.sourceAfter=versioned ? await Jj.commitId(t,"@") : null;writeJson(path,receipt)
  return receipt
}
