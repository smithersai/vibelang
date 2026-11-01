// One job owns all three measurements, so provider and load cannot differ by side.
import { prepareBuilds } from "./builds.mjs"
import { existsSync, mkdirSync, rmSync, cpSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as Jj from "./jj.mjs"
import * as Wire from "./wire.mjs"
import { readdirSync } from "node:fs"
import { compareTests, runTests } from "./tests.mjs"
import { assertReadableTests } from "./test-receipts.mjs"
import { must, quote, readJson, writeJson } from "./util.mjs"

export async function runMeasurementJob(manifest) {
  const receipts = {}, builds = {}
  for (const side of manifest.sides) {
    if (side.install) await must(side.install, { cwd: side.target, log: join(manifest.out, side.name + "-install.log") })
    if (manifest.build) builds[side.name] = await prepareBuilds({ ...manifest.build, target: side.target }, manifest.out, side.name)
    receipts[side.name] = await runTests({ command: manifest.test.command, report: manifest.test.report,
      cwd: join(side.target, manifest.test.cwd ?? "."), root: side.target,
      jsonFile: join(manifest.out, side.name + "-vitest.json"), log: join(manifest.out, side.name + "-tests.log"), strict: true })
  }
  writeJson(join(manifest.out, "receipts.json"), { job: manifest.job, receipts, builds })
}

async function mainRevision(config) {
  for (const ref of config.main ? [config.main] : ["main@origin", "main@github", "main"]) {
    try { return { ref, revision: await Jj.commitId(config.target, ref) } } catch {}
  }
  throw new Error("main comparison requires a main bookmark or --main <revision>")
}

export async function measureTests(config, { run, batch }) {
  const out = join(resolve(run), "measure", batch), job = "tests-" + Date.now() + "-" + process.pid
  mkdirSync(out, { recursive: true })
  const main = await mainRevision(config), previous = await Jj.commitId(config.target)
  const names = [], sides = []
  try {
    for (const [name, revision] of [["main",main.revision],["previous",previous]]) {
      const target = join(out,name), workspace = "migrate-" + job + "-" + name
      if (existsSync(target)) throw new Error("unfinished measurement workspace: " + target)
      await must("jj workspace add " + quote(target) + " --name " + quote(workspace) + " -r " + quote(revision), { cwd: config.target })
      names.push({ workspace,target })
      // Staged tarballs are ignored by the target's checkout, but its manifests refer to them.
      if (existsSync(join(config.target,Wire.toolchainDirectory))) cpSync(join(config.target,Wire.toolchainDirectory),join(target,Wire.toolchainDirectory),{recursive:true})
      sides.push({name,target,revision,install:config.install ?? Wire.installCommand(Wire.packageManager(readdirSync(target)),readdirSync(target))})
    }
    sides.push({name:"candidate",target:config.target,revision:await Jj.commitId(config.target,"@"),install:config.install ?? Wire.installCommand(Wire.packageManager(readdirSync(config.target)),readdirSync(config.target))})
    const manifest = { job, out, test:config.test, sides, build: { packages: config.packages ?? [{ dir: "." }], toolchain: config.toolchain ?? { kind: "registry" } } }
    const manifestPath = join(out,"manifest.json")
    writeJson(manifestPath,manifest)
    const command = [process.execPath,fileURLToPath(import.meta.url),manifestPath].map(quote).join(" ")
    // A box adapter must run the complete manifest in one job, remap all targets and
    // return receipts.json with the same job id. No separate per-side launches.
    await must(config.measureCommand ?? command,{cwd:config.target,log:join(out,"job.log"),
      env:{VIBELANG_MEASURE_MANIFEST:manifestPath,VIBELANG_MEASURE_COMMAND:command}})
    const result = readJson(join(out,"receipts.json"))
    if (result.job !== job) throw new Error("stale test measurement job")
    for (const side of ["main","previous","candidate"]) assertReadableTests(result.receipts[side] ?? {})
    const compared = before => {
      const diff = compareTests(before,result.receipts.candidate)
      const skipped = Object.keys(before.tests).filter(id => before.tests[id] === "passed" && result.receipts.candidate.tests[id] === "skipped")
      return { ...diff, skipped, ok:diff.ok && !skipped.length }
    }
    const previousDiff = compared(result.receipts.previous), mainDiff = compared(result.receipts.main)
    const receipt = { job, mainRevision:main, previousRevision:previous, receipts:result.receipts, builds:result.builds,
      previous:previousDiff,main:mainDiff,ok:previousDiff.ok && mainDiff.ok }
    writeJson(join(out,"comparison.json"),receipt)
    return receipt
  } finally {
    for (const {workspace,target} of names.reverse()) {
      await must("jj workspace forget " + quote(workspace),{cwd:config.target})
      rmSync(target,{recursive:true,force:true})
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMeasurementJob(readJson(process.argv[2])).catch(error=>{console.error(error.message);process.exitCode=1})
}
