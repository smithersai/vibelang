// The dist-list diff (migrate-flow:paths-to-converted-files): a build that
// selects sources by `.ts` drops a renamed module from dist and exits 0.
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { prepareBuilds } from "../lib/builds.mjs"
import { compareDistLists, outputDirs } from "../lib/dist-list.mjs"
import * as Jj from "../lib/jj.mjs"
import { makeConfig, paths, verify } from "../lib/steps.mjs"
import { must } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

// Each build writes dist/<stem>.js for the sources its selector takes.
const builds = {
  "fs.globSync **/*.ts": 'import {globSync} from "node:fs"; const files = globSync("src/**/*.ts")',
  "a recursive walk filtered by endsWith(\".ts\")": 'import {readdirSync} from "node:fs"; const files = readdirSync("src", {recursive: true}).map(String).filter(f => f.endsWith(".ts")).map(f => "src/" + f)',
  "a /\\.tsx?$/ filter": 'import {readdirSync} from "node:fs"; const files = readdirSync("src").filter(f => /\\.tsx?$/.test(f)).map(f => "src/" + f)'
}
const writer = '\nimport {mkdirSync, writeFileSync} from "node:fs"; import {basename} from "node:path"\nmkdirSync("dist", {recursive: true})\nfor (const f of files) writeFileSync("dist/" + basename(f).replace(/\\.[^.]+$/, "") + ".js", "export {}\\n")\n'
const vibeAware = 'import {readdirSync} from "node:fs"; const files = readdirSync("src").filter(f => /\\.(?:tsx?|vibe)$/.test(f)).map(f => "src/" + f)'

async function repo(root, build) {
  const t = join(root, "repo")
  const put = (file, text) => { mkdirSync(dirname(join(t, file)), { recursive: true }); writeFileSync(join(t, file), text) }
  put("package.json", JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }))
  put(".gitignore", "**/dist/\nnode_modules/\n")
  put("packages/a/package.json", JSON.stringify({ name: "a", type: "module", exports: { ".": "./dist/index.js" }, files: ["dist"], ...(build ? { scripts: { build: "node build.mjs" } } : {}) }))
  if (build) put("packages/a/build.mjs", build + writer)
  put("packages/a/src/index.ts", 'export * from "./Local.ts"\n')
  put("packages/a/src/Local.ts", "export const local = 1\n")
  // A cached dist proves nothing: this stale output must not hide the loss.
  put("packages/a/dist/Local.js", "stale\n")
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: t })
  await Jj.commit(t, "original")
  return { t, config: makeConfig({ target: t, run: join(root, "run"), packages: ["packages/a"], test: "true", install: "true", vibelangVersion: "0.0.11" }), logs: join(root, "logs") }
}

const convert = async t => {
  renameSync(join(t, "packages/a/src/Local.ts"), join(t, "packages/a/src/Local.vibe"))
  writeFileSync(join(t, "packages/a/src/index.ts"), 'export * from "./Local.vibe"\n')
  await Jj.commit(t, "convert Local")
}
const listOf = (logs, phase) => JSON.parse(readFileSync(join(logs, phase + "-dist.json"), "utf8"))
const renames = [{ from: "packages/a/src/Local.ts", to: "packages/a/src/Local.vibe" }]

for (const [name, build] of Object.entries(builds)) {
  test(`dist list: ${name} drops a renamed module, exits 0, and the diff refuses it by file and module`, async () => {
    const root = mkdtempSync(join(tmpdir(), "dist-list-"))
    try {
      const { t, config, logs } = await repo(root, build)
      const before = await prepareBuilds(config, logs, "baseline", { distList: true })
      assert.equal(before.state, "complete")
      assert.deepEqual(listOf(logs, "baseline").files, ["packages/a/dist/Local.js", "packages/a/dist/index.js"])
      await convert(t)
      const after = await prepareBuilds(config, logs, "candidate", { distList: true })
      assert.equal(after.state, "complete", "the build itself exits 0")
      assert.deepEqual(after.steps.map(s => s.code), [0])
      assert.equal(existsSync(join(t, "packages/a/dist/Local.js")), false, "built from a clean output, the stale file is gone")
      const diff = compareDistLists(listOf(logs, "baseline"), listOf(logs, "candidate"), renames)
      assert.equal(diff.state, "complete")
      assert.equal(diff.ok, false)
      assert.deepEqual(diff.refusals.map(r => [r.kind, r.file, r.modules]), [["dist-missing", "packages/a/dist/Local.js", ["packages/a/src/Local.ts"]]])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test("dist list: a build that takes .vibe passes the same rename", async () => {
  const root = mkdtempSync(join(tmpdir(), "dist-list-ok-"))
  try {
    const { t, config, logs } = await repo(root, vibeAware)
    await prepareBuilds(config, logs, "baseline", { distList: true })
    await convert(t)
    await prepareBuilds(config, logs, "candidate", { distList: true })
    const diff = compareDistLists(listOf(logs, "baseline"), listOf(logs, "candidate"), renames)
    assert.equal(diff.state, "complete")
    assert.equal(diff.ok, true)
    assert.deepEqual(diff.refusals, [])
    assert.equal(diff.baseline.files, 2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("dist list: a repository with no build script says the check did not run", async () => {
  const root = mkdtempSync(join(tmpdir(), "dist-list-none-"))
  try {
    const { t, config, logs } = await repo(root, null)
    const before = await prepareBuilds(config, logs, "baseline", { distList: true })
    assert.equal(before.dist.state, "not-run")
    assert.match(before.dist.reason, /no build script/)
    assert.equal(existsSync(join(t, "packages/a/dist/Local.js")), true, "nothing builds, so nothing is moved")
    const diff = compareDistLists(listOf(logs, "baseline"), listOf(logs, "baseline"), renames)
    assert.equal(diff.state, "not-run")
    assert.match(diff.reason, /no build script/)
    assert.equal(compareDistLists(undefined, listOf(logs, "baseline")).state, "not-run")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("dist list: an output directory the build does not write is restored and not compared", async () => {
  const root = mkdtempSync(join(tmpdir(), "dist-list-restore-"))
  try {
    const { t, config, logs } = await repo(root, vibeAware)
    const manifest = JSON.parse(readFileSync(join(t, "packages/a/package.json"), "utf8"))
    manifest.types = "./types/index.d.ts"
    writeFileSync(join(t, "packages/a/package.json"), JSON.stringify(manifest))
    writeFileSync(join(t, ".gitignore"), "**/dist/\n**/types/\nnode_modules/\n")
    mkdirSync(join(t, "packages/a/types")); writeFileSync(join(t, "packages/a/types/index.d.ts"), "export {}\n")
    await Jj.commit(t, "types from another step")
    const receipt = await prepareBuilds(config, logs, "baseline", { distList: true })
    assert.deepEqual(receipt.dist.notBuilt, ["packages/a/types"])
    assert.equal(readFileSync(join(t, "packages/a/types/index.d.ts"), "utf8"), "export {}\n")
    assert.ok(listOf(logs, "baseline").files.every(f => f.startsWith("packages/a/dist/")))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("dist list: a failing build restores the outputs it moved aside", async () => {
  const root = mkdtempSync(join(tmpdir(), "dist-list-fail-"))
  try {
    const { t, config, logs } = await repo(root, "process.exit(7)\nconst files = []")
    await assert.rejects(prepareBuilds(config, logs, "baseline", { distList: true }), /build prerequisite failed/)
    assert.equal(readFileSync(join(t, "packages/a/dist/Local.js"), "utf8"), "stale\n")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("outputDirs: manifest targets outside tracked sources, never src or a root file", () => {
  const tracked = ["packages/a/package.json", "packages/a/src/index.ts", "packages/a/README.md"]
  const manifest = { main: "./dist/index.js", types: "./src/index.ts", bin: { a: "bin/a.js" }, exports: { ".": { bun: "./src/index.ts", import: "./dist/index.js" }, "./*": "./lib/*.js" }, files: ["dist", "README.md", "src"] }
  assert.deepEqual(outputDirs(manifest, "packages/a", tracked), ["packages/a/bin", "packages/a/dist", "packages/a/lib"])
  assert.deepEqual(outputDirs({ main: "index.js" }, ".", ["index.js"]), ["dist"], "no directory named: dist, when untracked")
  assert.deepEqual(outputDirs({ files: ["**/*.js"] }, ".", []), ["dist"])
})

test("compareDistLists: a shipped source copy that moved with its rename is reported; extras are reported", () => {
  const baseline = { state: "complete", files: ["p/dist/X.js", "p/dist/src/X.ts", "p/dist/Y.js"] }
  const candidate = { state: "complete", files: ["p/dist/X.js", "p/dist/src/X.vibe", "p/dist/Y.js", "p/dist/X.vibe.js"] }
  const diff = compareDistLists(baseline, candidate, [{ from: "p/src/X.ts", to: "p/src/X.vibe" }])
  assert.equal(diff.ok, true)
  assert.deepEqual(diff.renamedSources, [{ from: "p/dist/src/X.ts", to: "p/dist/src/X.vibe" }])
  assert.deepEqual(diff.extras, ["p/dist/X.vibe.js"])
  const lost = compareDistLists(baseline, { state: "complete", files: ["p/dist/X.js"] }, [{ from: "p/src/X.ts", to: "p/src/X.vibe" }])
  assert.deepEqual(lost.refusals.map(r => [r.file, r.modules]), [["p/dist/src/X.ts", ["p/src/X.ts"]], ["p/dist/Y.js", []]], "a loss with no renamed module of its name is still refused")
})

test("compareDistLists: a hashed bundler chunk pairs by name; a lost chunk with no new twin is refused", () => {
  const baseline = { state: "complete", files: ["p/dist/chunk-AbCd1234.js", "p/dist/index.js", "p/dist/worker-Zz99Yy88.js"] }
  const diff = compareDistLists(baseline, { state: "complete", files: ["p/dist/chunk-QqRr5566.js", "p/dist/index.js"] })
  assert.deepEqual(diff.rehashed, [{ from: "p/dist/chunk-AbCd1234.js", to: "p/dist/chunk-QqRr5566.js" }])
  assert.deepEqual(diff.extras, [])
  assert.deepEqual(diff.refusals.map(r => r.file), ["p/dist/worker-Zz99Yy88.js"])
  // alchemy cloudflare-runtime: rolldown renamed a chunk, index-workers-jVknflMe.mjs became dist-C5YBph1v.mjs.
  const renamed = compareDistLists({ state: "complete", files: ["w/index-workers-jVknflMe.mjs"] }, { state: "complete", files: ["w/dist-C5YBph1v.mjs"] })
  assert.deepEqual([renamed.ok, renamed.rehashed], [true, [{ from: "w/index-workers-jVknflMe.mjs", to: "w/dist-C5YBph1v.mjs", renamed: true }]])
  assert.equal(compareDistLists({ state: "complete", files: ["w/a-jVknflMe.mjs"] }, { state: "complete", files: ["v/dist-C5YBph1v.mjs"] }).ok, false, "a chunk in another directory does not pair")
})

// Property: every file the baseline lists is either in the candidate, a
// source copy that moved with its rename, or a refusal; nothing else is.
test("compareDistLists property: each lost file is refused or paired, and a kept file is never refused", () => {
  const name = fc.constantFrom("A", "B", "C", "Local", "index")
  const file = fc.tuple(fc.constantFrom("p/dist/", "p/dist/src/", "q/lib/"), name, fc.constantFrom(".js", ".d.ts", ".ts", ".js.map")).map(([d, n, e]) => d + n + e)
  fc.assert(fc.property(fc.uniqueArray(file, { maxLength: 12 }), fc.func(fc.boolean()), fc.subarray(["A", "B", "C", "Local", "index"]), (files, keep, renamedNames) => {
    const renames = renamedNames.map(n => ({ from: "p/src/" + n + ".ts", to: "p/src/" + n + ".vibe" }))
    const kept = files.filter(f => keep(f))
    const moved = files.filter(f => !keep(f) && f.endsWith(".ts") && !f.endsWith(".d.ts")).map(f => f.replace(/\.ts$/, ".vibe"))
    const diff = compareDistLists({ state: "complete", files }, { state: "complete", files: [...kept, ...moved] }, renames)
    const refused = new Set(diff.refusals.map(r => r.file)), paired = new Set([...diff.renamedSources, ...diff.rehashed].map(r => r.from))
    for (const f of files) {
      if (kept.includes(f)) assert.ok(!refused.has(f) && !paired.has(f))
      else assert.ok(refused.has(f) !== paired.has(f), f)
    }
    assert.equal(diff.ok, diff.refusals.length === 0)
    for (const r of diff.refusals) assert.deepEqual(r.modules, renames.filter(m => m.from.split("/").pop().replace(/\.ts$/, "") === r.file.split("/").pop().replace(/(?:\.d)?\.(?:ts|js)(?:\.map)?$/, "")).map(m => m.from))
  }), { numRuns: 300 })
})

// verify writes the diff into the batch's receipt and fails the batch on it.
test("verify: a file the baseline build shipped and the batch's build does not fails checks.distList, named in verify.json", async () => {
  const root = mkdtempSync(join(tmpdir(), "dist-list-verify-"))
  try {
    const { t, logs } = await repo(root, vibeAware)
    const toolchain = join(root, "toolchain"), run = join(root, "run")
    const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
    put(join(toolchain, "toolchain.json"), JSON.stringify({ version: "0.0.11", effect: "4.0.6", compiler: "native/vibelang", packages: {} }))
    put(join(toolchain, "native/vibelang"), "#!/bin/sh\nexit 0\n"); chmodSync(join(toolchain, "native/vibelang"), 0o755)
    const manifest = JSON.parse(readFileSync(join(t, "packages/a/package.json"), "utf8")); manifest.private = true
    put(join(t, "packages/a/package.json"), JSON.stringify(manifest))
    put(join(t, "packages/a/tsconfig.json"), '{"files":["src/index.ts"]}')
    await Jj.commit(t, "private")
    mkdirSync(join(t, "node_modules"))
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(t, "node_modules/typescript"))
    const config = makeConfig({ target: t, run, packages: ["packages/a"], test: "true", testReport: "^(?<status>PASS) (?<name>.+)$", install: "true", toolchain })
    const p = paths(run)
    put(p.config, JSON.stringify(config))
    put(p.plan, JSON.stringify({ batches: [{ files: ["packages/a/src/Local.ts"] }] }))
    put(join(p.baseline, "compile-packages__a.json"), "[]")
    put(join(p.baseline, "tests.json"), JSON.stringify({ code: 0, tests: {} }))
    put(join(p.baseline, "logs/baseline-dist.json"), JSON.stringify({ state: "complete", files: ["packages/a/dist/Gone.js", "packages/a/dist/Local.js", "packages/a/dist/index.js"] }))
    const result = await verify({ run, batch: "01" })
    assert.equal(result.distList.state, "complete")
    assert.deepEqual(result.distList.refusals.map(r => r.file), ["packages/a/dist/Gone.js"])
    assert.equal(result.checks.distList, false)
    assert.equal(result.ok, false)
    const receipt = JSON.parse(readFileSync(p.verify("01"), "utf8"))
    assert.equal(receipt.distList.refusals[0].kind, "dist-missing")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
