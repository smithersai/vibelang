// The pack check (migrate-flow:pack-install-and-load): a dist-list diff passes
// a package that does not install or load outside its workspace, so each
// published package is packed, installed in an empty directory and imported
// under Node and under Bun, and compared with the baseline.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { recordDeclarationSurface } from "../lib/declarations.mjs"
import { packRepository } from "../lib/pack-policy.mjs"
import { compareDistLists } from "../lib/dist-list.mjs"
import * as Jj from "../lib/jj.mjs"
import { comparePackLoads, exportSpecifiers, packLoadSnapshot, verifyPackLoad } from "../lib/pack-load.mjs"
import { makeConfig, paths, verify } from "../lib/steps.mjs"
import { must, quote, slug, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-pack-load.json", import.meta.url)))

const put = (t, file, text) => { mkdirSync(dirname(join(t, file)), { recursive: true }); writeFileSync(join(t, file), text) }
const json = value => JSON.stringify(value, null, 2) + "\n"

/** A jj repository holding packages/<name> for each entry of `packages`: { manifest, files }. */
async function repo(root, packages, extra = {}) {
  const t = join(root, "repo")
  put(t, "package.json", json({ name: "root", private: true, workspaces: ["packages/*"] }))
  // A dead registry: nothing in these fixtures may come from the network.
  put(t, ".npmrc", "registry=http://127.0.0.1:9/\nfetch-retries=0\naudit=false\nfund=false\n")
  for (const [file, text] of Object.entries(extra)) put(t, file, text)
  for (const [name, { manifest, files }] of Object.entries(packages)) {
    put(t, `packages/${name}/package.json`, json({ name, version: "1.0.0", type: "module", ...manifest }))
    for (const [file, text] of Object.entries(files)) put(t, `packages/${name}/${file}`, text)
  }
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: t })
  await Jj.commit(t, "original")
  const config = makeConfig({ target: t, run: join(root, "run"), packages: Object.keys(packages).map(name => `packages/${name}`), test: "true", install: "true", vibelangVersion: "0.0.11" })
  return { t, config, env: { npm_config_userconfig: join(t, ".npmrc"), npm_config_cache: join(root, "npm-cache") } }
}

const snapshot = async ({ config, env }, root, name, options = {}) => packLoadSnapshot({ config, logs: join(root, "logs"), phase: name, env, ...options })
const kinds = result => result.refusals.map(r => r.kind)
const inTemp = (prefix, body) => async () => {
  const root = mkdtempSync(join(tmpdir(), prefix))
  try { await body(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
const redisShape = (dependencies = {}) => ({ manifest: { exports: { ".": "./dist/index.js" }, files: ["dist"], dependencies }, files: { "dist/index.js": "export const ProtocolError = 1\n" } })

test("pack check: a package that installs and loads the same passes, with the names under each runtime", { timeout: 120_000 }, inTemp("pack-ok-", async root => {
  const fixture = await repo(root, { a: redisShape() })
  const baseline = await snapshot(fixture, root, "baseline")
  const candidate = await snapshot(fixture, root, "candidate")
  assert.equal(baseline.state, "complete")
  const record = baseline.packages["packages/a"]
  assert.deepEqual(record.node.a.names, ["ProtocolError"])
  assert.deepEqual(record.bun.a.names, ["ProtocolError"])
  assert.equal(record.install.rc, 0)
  const diff = comparePackLoads(baseline, candidate)
  assert.deepEqual([diff.state, diff.ok, diff.refusals], ["complete", true, []])
  assert.ok(existsSync(join(root, "logs/baseline-pack-load.json")))
  assert.equal(typeof diff.packages["packages/a"].ms.install, "number")
}))

// DISTDIFF cause 1: 29 of 30 alchemy packs carried this pin, and `npm install` of the pack exits 254.
test("pack check: a file: runtime pin in the pack is refused, with the install's own error, and the loads still run", { timeout: 120_000 }, inTemp("pack-pin-", async root => {
  const stagedRuntime = await repo(join(root, "s"), { "vibelang-runtime": { manifest: { version: corpus.filePin.runtimeVersion, exports: "./index.js", files: ["index.js"] }, files: { "index.js": "export const marker = 1\n" } } })
  const packed = join(root, "staged"); mkdirSync(packed)
  await must("npm pack --ignore-scripts --pack-destination " + quote(packed), { cwd: join(stagedRuntime.t, "packages/vibelang-runtime"), env: stagedRuntime.env })
  const tgz = readFileSync(join(packed, `vibelang-runtime-${corpus.filePin.runtimeVersion}.tgz`))
  const uses = { "dist/index.js": 'export { marker } from "vibelang-runtime"\nexport const ProtocolError = 1\n' }
  const pkg = dependencies => ({ manifest: { exports: { ".": "./dist/index.js" }, files: ["dist"], dependencies }, files: uses })
  const toolchain = `.vibelang-toolchain/vibelang-runtime-${corpus.filePin.runtimeVersion}-2fe05486ecc6.tgz`
  const fixture = await repo(root, { a: pkg({ "vibelang-runtime": corpus.filePin.spec }) }, { [toolchain]: tgz })
  const candidate = await snapshot(fixture, root, "candidate")
  const baseline = structuredClone(candidate)
  const base = baseline.packages["packages/a"]
  base.localDeps = {}; base.install = { rc: 0, flags: "" }
  const diff = comparePackLoads(baseline, candidate)
  assert.deepEqual(kinds(diff), ["pack-local-dependency"])
  const [refusal] = diff.refusals
  assert.deepEqual([refusal.package, refusal.dependency, refusal.spec], ["packages/a", "vibelang-runtime", corpus.filePin.spec])
  assert.match(refusal.error, corpus.filePin.errorPattern ? new RegExp(corpus.filePin.errorPattern) : /ENOENT/)
  assert.deepEqual(candidate.packages["packages/a"].node.a.names, ["ProtocolError", "marker"], "loaded past the pin against the staged tarball, so nothing else stays hidden")
  // After migfix-alchemy's publishable-runtime-dep: the pack names the release, the receipt holds the staged pin.
  const fixed = await repo(join(root, "f"), { a: pkg({ "vibelang-runtime": corpus.filePin.runtimeVersion }) }, {
    [toolchain]: tgz, ".vibelang/toolchain-publication.json": json({ version: 1, localPins: { "vibelang-runtime": "file:" + toolchain }, releaseRequired: [{ name: "vibelang-runtime", version: corpus.filePin.runtimeVersion }] }) })
  const released = await snapshot(fixed, join(root, "f"), "candidate")
  const passes = comparePackLoads(released, released)
  assert.deepEqual(passes.refusals, [])
  assert.deepEqual(released.packages["packages/a"].node.a.names, ["ProtocolError", "marker"])
  assert.deepEqual(passes.releaseRequired, [{ name: "vibelang-runtime", version: corpus.filePin.runtimeVersion }], "an unpublished release is reported: the pack cannot install from the registry yet")
}))

// DISTDIFF cause 2: the workspace preloads vibelang/bun, so its tests pass; a consumer outside it gets `Export named ... not found`, or nothing.
const bunReexport = source => ({
  manifest: { exports: { ".": { bun: "./src/index.ts", default: "./dist/index.js" } }, files: ["dist", "src"] },
  files: { "dist/index.js": `export const ${corpus.bun.name} = 1\n`, "src/index.ts": `export * from "./Errors.${source}"\n`, [`src/Errors.${source}`]: `export const ${corpus.bun.name} = 1\n` }
})

test("pack check: export * from \"./x.vibe\" under Bun is refused for Bun alone; the dist list and Node pass it", { timeout: 120_000 }, inTemp("pack-bun-", async root => {
  const before = await repo(join(root, "b"), { a: bunReexport("ts") })
  const after = await repo(join(root, "a"), { a: bunReexport("vibe") })
  const baseline = await snapshot(before, join(root, "b"), "baseline")
  const candidate = await snapshot(after, join(root, "a"), "candidate")
  assert.deepEqual(baseline.packages["packages/a"].bun.a.names, [corpus.bun.name])
  const diff = comparePackLoads(baseline, candidate)
  assert.deepEqual([...new Set(diff.refusals.map(r => r.runtime))], ["bun"])
  assert.ok(["load-failed", "load-names-lost"].includes(diff.refusals[0].kind), diff.refusals[0].kind)
  assert.equal(diff.refusals[0].specifier, "a")
  assert.equal(diff.ok, false)
  assert.equal(compareDistLists({ state: "complete", files: ["packages/a/dist/index.js"] }, { state: "complete", files: ["packages/a/dist/index.js"] }).ok, true, "the dist list reads clean")
  // alchemy's fix: a package holding .vibe publishes no bun condition, so Bun takes dist.
  const dropped = bunReexport("vibe"); dropped.manifest.exports = { ".": "./dist/index.js" }
  const repaired = await repo(join(root, "r"), { a: dropped })
  assert.deepEqual(comparePackLoads(baseline, await snapshot(repaired, join(root, "r"), "candidate")).refusals, [])
}))

// DISTDIFF cause 4: an exact key for a file named internal outranks the `./*/internal` block: 94 entries.
const internalExports = extra => ({
  manifest: { exports: { ".": "./dist/index.js", "./*": "./dist/*.js", "./*/internal": null, ...extra }, files: ["dist", "src"] },
  files: { "dist/index.js": "export const a = 1\n", [`dist/${corpus.internal.dir}/internal.js`]: "export const secret = 1\n", [`dist/${corpus.internal.dir}.js`]: "export const b = 1\n", [`src/${corpus.internal.dir}/internal.vibe`]: "export const secret = 1\n" }
})

test("pack check: a published internal.vibe is a refused specifier, and the wildcard block is not", { timeout: 120_000 }, inTemp("pack-internal-", async root => {
  const before = await repo(join(root, "b"), { a: internalExports({}) })
  const baseline = await snapshot(before, join(root, "b"), "baseline")
  assert.deepEqual(Object.keys(baseline.packages["packages/a"].entries).sort(), [".", `./${corpus.internal.dir}`, "./index"], "the block keeps ./X/internal out")
  const leak = `./${corpus.internal.dir}/internal`
  const after = await repo(join(root, "a"), { a: internalExports({ [leak]: `./dist/${corpus.internal.dir}/internal.js` }) })
  const diff = comparePackLoads(baseline, await snapshot(after, join(root, "a"), "candidate"))
  assert.deepEqual(diff.refusals.map(r => [r.kind, r.specifier]), [["exports-added", leak]])
}))

// DISTDIFF cause 5: alchemy's `./*` and `./Bootstrap/*` targets select each module's X.d.vibe.ts.
test("pack check: a wildcard that selects a declaration sidecar is refused and names the block that fixes it", { timeout: 120_000 }, inTemp("pack-sidecar-", async root => {
  const shape = extra => ({ manifest: { exports: { "./*": { bun: "./src/*.ts", default: "./dist/*.js" }, ...extra }, files: ["dist", "src"] }, files: { "dist/Errors.js": "export const e = 1\n", "src/Errors.ts": "export const e = 1\n" } })
  const baseline = await snapshot(await repo(join(root, "b"), { a: shape({}) }), join(root, "b"), "baseline")
  const converted = extra => { const pkg = shape(extra); delete pkg.files["src/Errors.ts"]; pkg.manifest.exports["./Errors"] = "./dist/Errors.js"; pkg.files["src/Errors.vibe"] = "export const e = 1\n"; pkg.files["src/Errors.d.vibe.ts"] = "export declare const e = 1;\n"; return pkg }
  const leaked = comparePackLoads(baseline, await snapshot(await repo(join(root, "a"), { a: converted({}) }), join(root, "a"), "candidate"))
  assert.deepEqual(leaked.refusals.map(r => [r.kind, r.specifier, r.sidecar]), [["exports-added", "./Errors.d.vibe", true]])
  assert.match(leaked.refusals[0].message, /"\.\/\*\.d\.vibe": null/)
  const blocked = comparePackLoads(baseline, await snapshot(await repo(join(root, "c"), { a: converted({ "./*.d.vibe": null }) }), join(root, "c"), "candidate"))
  assert.deepEqual(blocked.refusals, [], "the block the message names clears it")
}))

test("pack check: an entry that stops loading under Node, a lost name and a lost specifier are each refused by name; a gained name is reported", { timeout: 120_000 }, inTemp("pack-reg-", async root => {
  const base = { manifest: { exports: { ".": "./dist/index.js", "./gone": "./dist/gone.js", "./broke": "./dist/broke.js" }, files: ["dist"] },
    files: { "dist/index.js": "export const kept = 1, lost = 2\n", "dist/gone.js": "export const g = 1\n", "dist/broke.js": "export const b = 1\n" } }
  const head = { manifest: { exports: { ".": "./dist/index.js", "./broke": "./dist/broke.js" }, files: ["dist"] },
    files: { "dist/index.js": "export const kept = 1, gained = 3\n", "dist/broke.js": "bootstrap()\nexport const b = 1\n" } }
  const baseline = await snapshot(await repo(join(root, "b"), { a: base }), join(root, "b"), "baseline")
  const candidate = await snapshot(await repo(join(root, "a"), { a: head }), join(root, "a"), "candidate")
  const diff = comparePackLoads(baseline, candidate)
  const seen = diff.refusals.map(r => [r.kind, r.runtime ?? null, r.specifier]).sort((x, y) => String(x).localeCompare(String(y)))
  assert.deepEqual(seen, [
    ["exports-lost", null, "./gone"],
    ["load-failed", "bun", "a/broke"],
    ["load-failed", "node", "a/broke"],
    ["load-names-lost", "bun", "a"],
    ["load-names-lost", "node", "a"]
  ])
  assert.match(diff.refusals.find(r => r.kind === "load-failed" && r.runtime === "node").error, /bootstrap/)
  assert.deepEqual(diff.refusals.find(r => r.kind === "load-names-lost").names, ["lost"])
  assert.deepEqual(diff.namesGained.map(g => [g.specifier, g.names]).sort(), [["a", ["gained"]], ["a", ["gained"]]])
}))

test("pack check: a crash and a hang mark only their own entry, and the rest still load in a fresh process", { timeout: 120_000 }, inTemp("pack-hang-", async root => {
  const pkg = { manifest: { exports: { "./crash": "./dist/crash.js", "./hang": "./dist/hang.js", "./ok": "./dist/ok.js", "./sibling": "./dist/sibling.js", "./setter": "./dist/setter.js" }, files: ["dist"] },
    files: { "dist/crash.js": "process.exit(3)\n", "dist/hang.js": "await new Promise(() => setInterval(() => {}, 1000))\n", "dist/ok.js": "export const ok = 1\n",
      "dist/setter.js": "globalThis.__set = 1\nexport const setter = 1\n", "dist/sibling.js": "if (!globalThis.__set) throw new Error('needs setter first')\nexport const sibling = 1\n" } }
  const fixture = await repo(root, { a: pkg })
  const snap = await snapshot(fixture, root, "candidate", { tune: { processMs: 4000, hangRetryFactor: 1 } })
  const { node, batching } = snap.packages["packages/a"]
  assert.match(node["a/crash"].err, /CRASH status=3/)
  assert.match(node["a/hang"].err, /HANG/)
  assert.deepEqual(node["a/ok"].names, ["ok"])
  assert.match(node["a/sibling"].err, /needs setter first/, "under the size limit each entry gets its own process, so no entry passes on a sibling's side effect")
  assert.deepEqual(batching.node, { entries: 5, perProcess: 1 })
  // Over the limit entries share a process, and the receipt says how many: a failure reruns alone.
  const large = await snapshot(fixture, root, "large", { tune: { processMs: 4000, hangRetryFactor: 1, aloneUpTo: 1, nodeBatch: 2, bunBatch: 2 } })
  assert.equal(large.packages["packages/a"].batching.node.perProcess, 2)
  assert.match(large.packages["packages/a"].node["a/crash"].err, /CRASH status=3/)
  assert.deepEqual(large.packages["packages/a"].node["a/ok"].names, ["ok"])
}))

test("pack check: an entry past the hang limit reruns alone with a longer limit, so a slow load is reported and only a real hang is refused", { timeout: 120_000 }, inTemp("pack-slow-", async root => {
  // alchemy's aws: `.` and `index` load about 7,000 modules and passed 240 s on one 4-vCPU box but not on two others.
  const pkg = { manifest: { exports: { "./slow": "./dist/slow.js", "./hang": "./dist/hang.js", "./ok": "./dist/ok.js" }, files: ["dist"] },
    files: { "dist/slow.js": "await new Promise(done => setTimeout(done, 2500))\nexport const slow = 1\n", "dist/hang.js": "await new Promise(() => setInterval(() => {}, 1000))\n", "dist/ok.js": "export const ok = 1\n" } }
  const fixture = await repo(root, { a: pkg })
  const snap = await snapshot(fixture, root, "candidate", { tune: { processMs: 1000, hangRetryFactor: 6 } })
  const { node } = snap.packages["packages/a"]
  assert.deepEqual(node["a/slow"].names, ["slow"])
  assert.ok(node["a/slow"].slowMs >= 2000, "the load's own time is in the receipt")
  assert.match(node["a/hang"].err, /^HANG 6s/, "a real hang fails at the longer limit")
  assert.ok(node["a/ok"].ms < 1000)
  const baseline = structuredClone(snap)
  for (const runtime of ["node", "bun"]) { baseline.packages["packages/a"][runtime]["a/slow"] = { names: ["slow"], ms: 5 }; baseline.packages["packages/a"][runtime]["a/hang"] = { names: [], ms: 5 } }
  const diff = comparePackLoads(baseline, snap)
  assert.deepEqual(diff.refusals.map(r => [r.kind, r.runtime, r.specifier]).sort(), [["load-failed", "bun", "a/hang"], ["load-failed", "node", "a/hang"]])
  assert.deepEqual(diff.slowLoads.map(s => [s.runtime, s.specifier]).sort(), [["bun", "a/slow"], ["node", "a/slow"]])
}))

test("pack check: a target the pack does not hold fails without a process, so absent wildcard targets cost no load", { timeout: 120_000 }, inTemp("pack-absent-", async root => {
  // alchemy's aws: `./*.d.vibe` specifiers whose Node target is not in the pack took 6,580 solo processes and 19 minutes.
  const pkg = { manifest: { exports: { "./*": { bun: "./src/*.js", default: "./dist/*.js" } }, files: ["dist", "src"] },
    files: { "dist/a.js": "export const a = 1\n", "src/a.js": "export const a = 1\n", "src/b.js": "export const b = 1\n", "src/c.js": "export const c = 1\n" } }
  const fixture = await repo(root, { x: pkg })
  const snap = await snapshot(fixture, root, "candidate", { tune: { aloneUpTo: 0, nodeBatch: 2, bunBatch: 2 } })
  const { node, bun, batching } = snap.packages["packages/x"]
  assert.deepEqual(node["x/a"].names, ["a"])
  for (const spec of ["x/b", "x/c"]) assert.match(node[spec].err, /^ABSENT .*dist\/[bc]\.js is not in the pack/)
  assert.deepEqual(batching.node, { entries: 1, perProcess: 2, absent: 2 }, "only the target the pack holds starts a process")
  assert.deepEqual(Object.keys(bun).sort(), ["x/a", "x/b", "x/c"])
  assert.deepEqual(batching.bun, { entries: 3, perProcess: 2 })
  // A specifier that loaded in the baseline and lost its target is still refused, both as a missing target and as a failed load.
  const baseline = structuredClone(snap)
  const was = baseline.packages["packages/x"]
  was.node["x/b"] = { names: ["b"] }; delete was.entries["./b"].missing
  const diff = comparePackLoads(baseline, snap)
  assert.deepEqual(diff.refusals.map(r => [r.kind, r.runtime ?? null, r.specifier]).sort(), [["export-target-missing", null, "./b"], ["load-failed", "node", "x/b"]])
}))

test("pack check: a workspace dependency installs from its own pack, not the registry", { timeout: 120_000 }, inTemp("pack-closure-", async root => {
  const fixture = await repo(root, {
    a: { manifest: { exports: "./dist/index.js", files: ["dist"], dependencies: { b: "workspace:*" } }, files: { "dist/index.js": 'export { fromB } from "b"\n' } },
    b: { manifest: { exports: "./dist/index.js", files: ["dist"] }, files: { "dist/index.js": "export const fromB = 1\n" } }
  })
  await must("bun install --ignore-scripts", { cwd: fixture.t, env: fixture.env })
  fixture.config.packages = fixture.config.packages.filter(pkg => pkg.dir === "packages/a")
  const snap = await snapshot(fixture, root, "candidate")
  const record = snap.packages["packages/a"]
  assert.equal(record.packError, undefined)
  assert.deepEqual(record.localDeps, {}, "the package manager rewrites workspace: when it packs")
  assert.equal(record.install.rc, 0)
  assert.deepEqual(record.node.a.names, ["fromB"])
  assert.deepEqual(Object.keys(snap.packages), ["packages/a"], "b is packed for a's closure and not loaded on its own")
}))

test("pack check: only published packages run, a private one is listed, and none at all says not-run", { timeout: 120_000 }, inTemp("pack-private-", async root => {
  const secret = redisShape(); secret.manifest.private = true
  const fixture = await repo(root, { p: secret })
  const snap = await snapshot(fixture, root, "baseline")
  assert.equal(snap.state, "not-run")
  assert.match(snap.reason, /no published package/)
  assert.equal(comparePackLoads(snap, snap).state, "not-run")
  assert.equal(comparePackLoads(undefined, snap).state, "not-run")
  assert.equal(comparePackLoads(undefined, snap).ok, true)
}))

test("verifyPackLoad: packs only the batch's packages, lists the others, and never reads as a pass it did not make", { timeout: 120_000 }, inTemp("pack-verify-", async root => {
  const fixture = await repo(root, { a: redisShape(), b: redisShape() })
  const logs = join(root, "logs")
  await packLoadSnapshot({ config: fixture.config, logs, phase: "baseline", env: fixture.env })
  const baselinePath = join(logs, "baseline-pack-load.json")
  const args = { config: fixture.config, baselinePath, logs, env: fixture.env, built: true }
  const onlyA = await verifyPackLoad({ ...args, files: ["packages/a/dist/index.js"] })
  assert.deepEqual([onlyA.state, onlyA.ok], ["complete", true])
  assert.deepEqual(Object.keys(onlyA.packages), ["packages/a"])
  assert.deepEqual(onlyA.notInBatch, ["packages/b"])
  renameSync(join(fixture.t, "packages/a/dist/index.js"), join(fixture.t, "packages/a/dist/renamed.js"))
  const refused = await verifyPackLoad({ ...args, files: ["packages/a/dist/index.js"] })
  assert.equal(refused.ok, false)
  assert.ok(refused.refusals.some(r => r.kind === "export-target-missing" && r.specifier === "."))
  assert.ok(existsSync(join(logs, "candidate-pack-load.json")))
  const skipped = await verifyPackLoad({ ...args, files: ["packages/a/dist/index.js"], earlierFailure: ["tests", "style"] })
  assert.deepEqual([skipped.state, skipped.ok], ["not-run", true])
  assert.match(skipped.reason, /tests, style/)
  const noBaseline = await verifyPackLoad({ ...args, baselinePath: join(logs, "absent.json"), files: [] })
  assert.equal(noBaseline.state, "not-run")
  assert.match(noBaseline.reason, /baseline/)
  const onePass = await verifyPackLoad({ ...args, built: false, files: [] })
  assert.match(onePass.reason, /one-pass/)
}))

test("pack check: a prepack script that rewrites a tracked file is reported", { timeout: 120_000 }, inTemp("pack-dirty-", async root => {
  const pkg = redisShape()
  pkg.manifest.scripts = { prepack: 'node -e "require(\'node:fs\').writeFileSync(\'tracked.txt\', \'changed\\n\')"' }
  pkg.files["tracked.txt"] = "original\n"
  const fixture = await repo(root, { a: pkg })
  const snap = await snapshot(fixture, root, "baseline")
  assert.deepEqual(snap.dirtied, ["packages/a/tracked.txt"])
  assert.deepEqual(comparePackLoads(snap, snap).dirtied, ["packages/a/tracked.txt"])
}))

// verify writes the result into the batch's receipt, and only a passing batch pays for the packs.
async function verifiable(root) {
  const target = join(root, "repo"), run = join(root, "run")
  mkdirSync(join(target, "src"), { recursive: true }); mkdirSync(join(target, "dist")); mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
  symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
  writeJson(join(target, "package.json"), { name: "pub", version: "1.0.0", type: "module", exports: "./dist/main.js", files: ["dist"] })
  writeJson(join(target, "tsconfig.json"), { compilerOptions: { rootDir: "src", outDir: "dist" }, include: ["src/**/*.ts", "src/**/*.vibe"] })
  writeFileSync(join(target, ".gitignore"), "node_modules/\ndist/\n")
  writeFileSync(join(target, ".npmrc"), "registry=http://127.0.0.1:9/\nfetch-retries=0\naudit=false\nfund=false\n")
  writeFileSync(join(target, "src/main.ts"), "export const value = 1\n")
  writeFileSync(join(target, "dist/main.js"), "export const value = 1\n")
  writeFileSync(join(target, "node_modules/.bin/vibelang"), [
    "#!/usr/bin/env node",
    'const fs = require("node:fs"), path = require("node:path");',
    'const at = process.argv.indexOf("--outDir");',
    'if (at >= 0) { const out = process.argv[at + 1]; fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "main.d.ts"), "export declare const value = 1;\\n"); }'
  ].join("\n") + "\n", { mode: 0o755 })
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
  await must("jj commit -m fixture", { cwd: target })
  const p = paths(run)
  const config = makeConfig({ target, test: "true", vibelangVersion: "0.0.11" })
  writeJson(p.config, config)
  writeJson(p.plan, { batches: [{ files: ["src/main.ts"] }] })
  writeJson(p.inventory, { files: [{ path: "src/main.ts", tokens: 1 }] })
  writeJson(join(p.baseline, "tests.json"), { code: 0, tests: {}, total: 0, passed: 0, failed: [], skipped: 0 })
  writeJson(join(p.baseline, "compile-" + slug(".") + ".json"), [])
  writeJson(join(p.baseline, "declaration-oracle.json"), { ".": { compiler: "fixture-stock", files: [], missing: [], extra: [], changed: [] } })
  const dts = join(p.baseline, "dts", slug("."))
  mkdirSync(dts, { recursive: true })
  writeFileSync(join(dts, "main.d.ts"), "export declare const value = 1;\n")
  assert.deepEqual(recordDeclarationSurface(require("typescript"), dts, target, [{ tsconfig: "tsconfig.json", prefix: "." }]).unresolved, [])
  writeJson(join(p.baseline, "upstream-packs.json"), await packRepository(config, join(p.baseline, "upstream-packs")))
  return { target, run, p, config, env: { npm_config_userconfig: join(target, ".npmrc"), npm_config_cache: join(root, "npm-cache") } }
}

test("verify: a pack regression fails checks.packLoad, named in verify.json; a failed batch skips it and says so", { timeout: 300_000 }, inTemp("pack-verify-gate-", async root => {
  const { target, run, p, config, env } = await verifiable(root)
  const saved = { ...process.env }
  Object.assign(process.env, env)
  try {
    await packLoadSnapshot({ config, logs: join(p.baseline, "logs"), phase: "baseline" })
    renameSync(join(target, "src/main.ts"), join(target, "src/main.vibe"))
    writeFileSync(join(target, "dist/main.js"), "bootstrap()\nexport const value = 1\n")
    const refused = await verify({ run, batch: "01" })
    assert.equal(refused.checks.packs, true, JSON.stringify(refused.packs))
    assert.equal(refused.packLoad.state, "complete", JSON.stringify(refused.checks))
    assert.deepEqual(refused.packLoad.refusals.map(r => [r.kind, r.runtime, r.specifier]).sort(), [["load-failed", "bun", "pub"], ["load-failed", "node", "pub"]])
    assert.equal(refused.checks.packLoad, false)
    assert.equal(refused.ok, false)
    assert.equal(JSON.parse(readFileSync(p.verify("01"), "utf8")).packLoad.refusals[0].kind, "load-failed")
    writeFileSync(join(target, "dist/main.js"), "export const value = 1\n")
    const passed = await verify({ run, batch: "01" })
    assert.deepEqual([passed.packLoad.state, passed.packLoad.refusals, passed.checks.packLoad, passed.ok], ["complete", [], true, true], JSON.stringify(passed.checks))
    writeJson(p.config, { ...config, test: { ...config.test, command: "exit 1" } })
    const failing = await verify({ run, batch: "01" })
    assert.equal(failing.packLoad.state, "not-run")
    assert.match(failing.packLoad.reason, /tests/)
    assert.equal(failing.checks.packLoad, true, "the check it never ran does not fail the batch")
    assert.equal(failing.ok, false)
  } finally { process.env = saved }
}))

test("exportSpecifiers: wildcards expand over the pack, Node's key order decides, and a null target is blocked", () => {
  const files = ["lib/A.js", "lib/B/C.js", "lib/B/internal.js", "src/A.vibe", "src/Boot/X.ts", "src/Boot/X.d.vibe.ts", "lib/style.css"]
  const manifest = { exports: { ".": { types: "./lib/A.d.ts", default: "./lib/A.js" }, "./*": { bun: "./src/*.ts", default: "./lib/*.js" }, "./*/internal": null, "./Boot/*": "./src/Boot/*.ts", "./typed": { types: "./lib/t.d.ts" }, "./gone": "./lib/gone.js", "./css": "./lib/style.css" } }
  const { entries, keys } = exportSpecifiers(manifest, files)
  assert.deepEqual(Object.keys(entries).sort(), [".", "./A", "./B/C", "./Boot/X", "./Boot/X.d.vibe", "./css", "./gone", "./typed"])
  assert.equal(entries["./A"].node, "lib/A.js")
  assert.equal(entries["./A"].bun, "src/A.ts")
  assert.deepEqual(entries["./A"].missing, ["bun:src/A.ts"])
  assert.deepEqual(entries["./gone"].missing, ["node:lib/gone.js", "bun:lib/gone.js"])
  assert.equal(entries["./typed"].node, undefined)
  assert.equal(keys.length, 7)
  assert.deepEqual(exportSpecifiers({ exports: "./x.js" }, ["x.js"]).keys, ["."])
  assert.deepEqual(exportSpecifiers({ exports: { import: "./x.js" } }, ["x.js"]).keys, ["."], "a condition map is the root entry")
  assert.deepEqual(exportSpecifiers({ main: "lib/m.js" }, ["lib/m.js"]).entries["."].node, "lib/m.js")
  assert.deepEqual(exportSpecifiers({}, ["index.js"]).entries["."].node, "index.js")
  assert.deepEqual(exportSpecifiers({}, ["other.js"]).keys, [])
})

// Property: for generated load results, each specifier's outcome decides its refusal and nothing else does.
test("comparePackLoads property: a regression is always refused by name, and anything else never is", () => {
  const outcome = fc.oneof(fc.subarray(["a", "b", "c"]).map(names => ({ names: [...names].sort() })), fc.constant({ err: "ERR boom" }), fc.constant({ capped: true }))
  const spec = fc.constantFrom("p", "p/a", "p/b", "p/c")
  const side = fc.dictionary(spec, outcome)
  const entriesOf = (node, bun) => Object.fromEntries([...new Set([...Object.keys(node), ...Object.keys(bun)])].map(s => [s === "p" ? "." : "./" + s.slice(2), {}]))
  const rec = (node, bun) => ({ dir: "packages/p", name: "p", install: { rc: 0 }, localDeps: {}, node, bun, entries: entriesOf(node, bun), ms: {} })
  const snap = record => ({ state: "complete", packages: { "packages/p": record } })
  fc.assert(fc.property(side, side, side, side, (bn, bb, cn, cb) => {
    const diff = comparePackLoads(snap(rec(bn, bb)), snap(rec(cn, cb)))
    for (const [runtime, base, head] of [["node", bn, cn], ["bun", bb, cb]]) for (const s of new Set([...Object.keys(base), ...Object.keys(head)])) {
      const b = base[s], h = head[s]
      const found = kind => diff.refusals.some(r => r.kind === kind && r.runtime === runtime && r.specifier === s)
      const specifierKept = s in cn || s in cb || !(s in bn || s in bb)
      const expectFailed = Boolean(b?.names && specifierKept && h?.err) || Boolean(b?.names && specifierKept && !h)
      assert.equal(found("load-failed"), expectFailed, `${runtime} ${s} ${JSON.stringify([b, h])}`)
      const lost = b?.names && h?.names ? b.names.filter(n => !h.names.includes(n)) : []
      assert.equal(found("load-names-lost"), lost.length > 0)
      if (b?.names && h?.capped) assert.ok(diff.unverified.some(u => u.runtime === runtime && u.specifier === s), "capped is reported, not passed silently")
      if (lost.length) assert.deepEqual(diff.refusals.find(r => r.kind === "load-names-lost" && r.runtime === runtime && r.specifier === s).names, lost)
    }
    const baseSpecs = Object.keys(entriesOf(bn, bb)), headSpecs = Object.keys(entriesOf(cn, cb))
    assert.deepEqual(diff.refusals.filter(r => r.kind === "exports-lost").map(r => r.specifier).sort(), baseSpecs.filter(s => !headSpecs.includes(s)).sort())
    assert.deepEqual(diff.refusals.filter(r => r.kind === "exports-added").map(r => r.specifier).sort(), headSpecs.filter(s => !baseSpecs.includes(s)).sort())
    assert.equal(diff.ok, diff.refusals.length === 0)
  }), { numRuns: 400 })
})
