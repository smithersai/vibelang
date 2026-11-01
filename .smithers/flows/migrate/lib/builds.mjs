// Declared product builds are prerequisites of test baselines and candidates.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import * as Jj from "./jj.mjs"
import { workspaceGlobs, workspaceManifests } from "./upgrade.mjs"
import { packageManager } from "./wire.mjs"
import { readJson, run, writeJson } from "./util.mjs"

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

export async function prepareBuilds(config, logs, phase) {
  const t = config.target
  const versioned = existsSync(join(t,".jj"))
  const files = versioned ? await Jj.trackedFiles(t) : ["package.json",...config.packages.map(p=>join(p.dir,"package.json"))]
  const workspace = existsSync(join(t,"pnpm-workspace.yaml")) ? readFileSync(join(t,"pnpm-workspace.yaml"),"utf8") : ""
  const globs = workspaceGlobs(readFileSync(join(t,"package.json"),"utf8"),workspace)
  const members = workspaceManifests(files.filter(file => /(?:^|\/)package\.json$/.test(file)),globs).filter(file=>file.endsWith("package.json"))
  // An explicitly selected package need not be a workspace member.
  const selected = config.packages.map(pkg=>join(pkg.dir,"package.json"))
  const manifests = [...new Set([...members,...selected])].map(path=>({path,manifest:readJson(join(t,path))}))
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
  receipt.state="complete";receipt.finishedAt=new Date().toISOString();receipt.sourceAfter=versioned ? await Jj.commitId(t,"@") : null;writeJson(path,receipt)
  return receipt
}
