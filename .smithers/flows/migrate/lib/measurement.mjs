// One job owns all three measurements, so provider and load cannot differ by side.
import { prepareBuilds } from "./builds.mjs"
import { packRepository } from "./pack-policy.mjs"
import { existsSync, mkdirSync, rmSync, cpSync, realpathSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as Jj from "./jj.mjs"
import * as Wire from "./wire.mjs"
import { readdirSync } from "node:fs"
import { compareTests, runTests } from "./tests.mjs"
import { assertReadableTests } from "./test-receipts.mjs"
import { must, quote, readJson, readJsonIf, writeJson } from "./util.mjs"

export async function runMeasurementJob(manifest) {
  const receipts = {}, builds = {}, packs = {}
  for (const side of manifest.sides) {
    if (side.install) await must(side.install, { cwd: side.target, log: join(manifest.out, side.name + "-install.log") })
    if (manifest.build) builds[side.name] = await prepareBuilds({ ...manifest.build, target: side.target }, manifest.out, side.name)
    if (manifest.build) packs[side.name] = await packRepository({ ...manifest.build, target: side.target }, join(manifest.out, side.name + "-packs"), { baseline: manifest.packBaseline })
    receipts[side.name] = await runTests({ command: manifest.test.command, report: manifest.test.report,
      cwd: join(side.target, manifest.test.cwd ?? "."), root: side.target,
      jsonFile: join(manifest.out, side.name + "-vitest.json"), log: join(manifest.out, side.name + "-tests.log"), strict: true })
  }
  writeJson(join(manifest.out, "receipts.json"), { job: manifest.job, receipts, builds, packs })
}

async function mainRevision(config) {
  for (const ref of config.main ? [config.main] : ["main@origin", "main@github", "main"]) {
    try { return { ref, revision: await Jj.commitId(config.target, ref) } } catch {}
  }
  throw new Error("main comparison requires a main bookmark or --main <revision>")
}

/**
 * Forget and remove what a killed or failed measurement of this batch left: each
 * `migrate-tests-` workspace whose root lies under out, and the side directories.
 */
async function clearLeftovers(target, out) {
  const real = path => { try { return realpathSync(path) } catch { return resolve(path) } }
  const under = (base, path) => { const r = relative(base, path); return r !== "" && !r.startsWith("..") && !isAbsolute(r) }
  const inside = path => under(resolve(out), resolve(path)) || under(real(out), real(path))
  const listed = await must("jj workspace list -T " + quote('name ++ "\\n"'), { cwd: target })
  for (const workspace of listed.stdout.split("\n").filter(name => name.startsWith("migrate-tests-"))) {
    const root = await must("jj workspace root --name " + quote(workspace), { cwd: target }).then(r => r.stdout.trim(), () => null)
    if (root && inside(root)) await must("jj workspace forget " + quote(workspace), { cwd: target })
  }
  for (const name of ["main", "previous"]) rmSync(join(out, name), { recursive: true, force: true })
}

export async function measureTests(config, { run, batch }) {
  const out = join(resolve(run), "measure", batch), job = "tests-" + Date.now() + "-" + process.pid
  mkdirSync(out, { recursive: true })
  await clearLeftovers(config.target, out)
  const main = await mainRevision(config), previous = await Jj.commitId(config.target)
  const names = [], sides = []
  let failure = null
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
    const manifest = { job, out, test:config.test, sides, packBaseline: readJsonIf(join(resolve(run), "baseline", "upstream-packs.json")), build: { packages: config.packages ?? [{ dir: "." }], toolchain: config.toolchain ?? { kind: "registry" } } }
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
      const renames = Array.from({ length: Number(batch) }, (_, i) =>
        readJsonIf(join(resolve(run), "batches", String(i + 1).padStart(2, "0"), "codemod.json"))?.renames ?? []).flat()
      return compareTests(before, result.receipts.candidate, { renames })
    }
    const previousDiff = compared(result.receipts.previous), mainDiff = compared(result.receipts.main)
    const receipt = { job, mainRevision:main, previousRevision:previous, receipts:result.receipts, builds:result.builds, packs:result.packs,
      previous:previousDiff,main:mainDiff,ok:previousDiff.ok && mainDiff.ok }
    writeJson(join(out,"comparison.json"),receipt)
    return receipt
  } catch (error) {
    failure = { error }
    throw error
  } finally {
    // Clean every workspace even when one step fails, and never hide the measurement's own error.
    const errors = []
    for (const {workspace,target} of names.reverse()) {
      try { await must("jj workspace forget " + quote(workspace),{cwd:config.target}) } catch (error) { errors.push(error) }
      try { rmSync(target,{recursive:true,force:true}) } catch (error) { errors.push(error) }
    }
    if (errors.length && !failure) throw new AggregateError(errors, "measurement cleanup failed: " + errors.map(e => e.message).join("; "))
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMeasurementJob(readJson(process.argv[2])).catch(error=>{console.error(error.message);process.exitCode=1})
}
