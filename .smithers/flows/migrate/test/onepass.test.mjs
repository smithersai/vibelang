import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"
import assert from "node:assert/strict"
import { symlinkSync, chmodSync, existsSync, readdirSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { packRepository } from "../lib/pack-policy.mjs"
import { rewriteReferences, restoreReferences } from "../lib/references.mjs"
import { warningExceptions } from "../lib/diagnostics.mjs"
import { renameBatch } from "../lib/codemod.mjs"
import { planScope, blameCandidates, dependencyRoots, shardModules, fixShards, onePassStep } from "../lib/onepass.mjs"
import { revertMany, paths, flowStep, nextStep, verify, record } from "../lib/steps.mjs"
import { must, quote, run, writeJson, readJson } from "../lib/util.mjs"
import * as Jj from "../lib/jj.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const text = (root, file) => readFileSync(join(root, file), "utf8")
const put = (root, file, value) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), value) }
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "migrate-onepass-"))
  const target = join(root, "repo"), run = join(root, "run"), tool = join(root, "tool")
  mkdirSync(target); mkdirSync(tool)
  put(target, "package.json", '{"private":true}\n')
  for (const name of ["core", "app", "consumer"]) {
    writeJson(join(target, name, "package.json"), { name, exports: { "./*": "./src/*.ts" }, dependencies: name === "core" ? {} : { core: "workspace:*" }, scripts: { typecheck: "vibelang -p tsconfig.json && vibelang -p tsconfig.tests.json", start: "node src/index.ts" } })
    writeJson(join(target, name, "tsconfig.json"), { include: ["src"], compilerOptions: { allowArbitraryExtensions: true } })
    writeJson(join(target, name, "tsconfig.tests.json"), { include: ["tests"] })
  }
  const corpus = readJson(fileURLToPath(new URL("./corpus/opencode-one-pass.json", import.meta.url)))
  for (const [file, value] of Object.entries(corpus.sources)) put(target, file, value)
  put(target, "app/src/index.ts", 'import { value } from "../../core/src/index.js"\nexport const result = value\n')
  put(target, "consumer/src/index.ts", 'import { value } from "../../core/src/index.ts"\nexport const result = value\n')
  put(target, "app/src/view.tsx", "export const view = <div />\n")
  put(target, "entry.vibe", 'import { value } from "./core/src/index.ts"\n')
  put(target, "run.sh", "node --import=vibelang/register core/src/index.ts\n")
  put(target, "PACKAGE.ts", 'const source = "core/src/index.ts"\n')
  // Compiler traces and installed dependencies are instrumentation, never batch source.
  put(target, ".gitignore", "node_modules/\nchecks.log\n")
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
  await Jj.commit(target, "fixture")
  const compiler = join(tool, "compiler.cjs")
  put(root, "tool/toolchain.json", JSON.stringify({ compiler: "compiler.cjs" }))
  writeProbeAwareCompiler(join(root, "tool/compiler.cjs"), `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
const args = process.argv.slice(2), project = args[args.indexOf("-p") + 1]
const cwd = process.cwd(), root = path.dirname(cwd), pkg = path.basename(cwd)
fs.appendFileSync(path.join(root, "checks.log"), JSON.stringify({ pkg, project, args }) + "\\n")
if (args.includes("--showConfig")) {
  const config = JSON.parse(fs.readFileSync(path.resolve(project), "utf8"))
  const files = config.files ?? fs.readdirSync("src").filter(f => /\\.(ts|vibe)$/.test(f) && !f.includes(".d.")).map(f => "./src/" + f)
  console.log(JSON.stringify({ files })); process.exit(0)
}
if (args.includes("--fix")) { console.log("vibelang --fix: 0 fixes in 0 files."); process.exit(0) }
const core = fs.existsSync(path.join(root, "core/src/index.vibe"))
if (pkg === "core" && core) { console.log("src/index.vibe(1,1): error EK1002: unsupported producer"); process.exitCode = 1 }
if (pkg === "app" && core && fs.existsSync("src/index.vibe")) { console.log("src/index.vibe(2,1): error TS2322: dependency fallout"); process.exitCode = 1 }
if (pkg === "consumer") { console.log("src/index.ts(3,1): error TS9999: pre-existing failure"); process.exitCode = 1 }
`)
  chmodSync(compiler, 0o755)
  // These tests vary a test double after rename to exercise diagnostics and timeouts.
  // Use an installed command; staged executable immutability has its own regression suite.
  mkdirSync(join(target, "app/node_modules/.bin"), { recursive: true })
  symlinkSync(compiler, join(target, "app/node_modules/.bin/vibelang"))
  mkdirSync(join(target, "node_modules"), { recursive: true })
  symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
  writeJson(paths(run).config, { target, packages: ["app", "consumer", "core"].map(dir => ({ dir, tsconfig: "tsconfig.json", sources: ["src"] })), toolchain: { kind: "npm", version: "0.0.11" } })
  writeJson(paths(run).setup, {})
  const scope = corpus.scope
  put(run, "scope.txt", scope.join("\n") + "\n")
  writeJson(paths(run).inventory, { files: [{ path: scope[0], imports: [] }, { path: scope[1], imports: [scope[0]] }] })
  return { root, target, run, compiler, scope: join(run, "scope.txt") }
}

test("scope planning includes plain modules once and defers TSX and declarations with causes", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-scope-"))
  try {
    for (const f of ["a.ts", "b.ts", "view.tsx", "a.d.ts"]) put(root, f, "")
    const plan = planScope(root, ["a.ts", "b.ts", "a.ts", "view.tsx", "a.d.ts"])
    assert.deepEqual(plan.batches[0].files, ["a.ts", "b.ts"])
    assert.deepEqual(plan.deferred.map(x => x.file), ["view.tsx", "a.d.ts"])
    assert.ok(plan.deferred.every(x => x.reason))
    assert.throws(() => planScope(root, ["missing.ts"]), /missing/)
    assert.throws(() => planScope(root, ["../outside.ts"]), /relative|outside/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("dependency roots retain a failing importer's conversion until the root has been retried", () => {
  assert.deepEqual(dependencyRoots(new Map([["app", ["middle"]], ["middle", ["core"]], ["core", []]]), new Set(["app", "core"])), ["core"])
  assert.deepEqual(new Set(dependencyRoots(new Map([["a", ["b"]], ["b", ["a"]], ["c", ["a"]]]))), new Set(["a", "b"]))
})

test("directory shards are import-closed and capped, including dependency cycles", () => {
  const graph = new Map(Array.from({ length: 500 }, (_, i) => [`src/dir${Math.floor(i / 50)}/f${i}.vibe`, []]))
  const names = [...graph.keys()]
  graph.set(names[1], [names[0]])
  graph.set(names[0], [names[1]])
  const groups = shardModules(names, graph)
  assert.ok(groups.length > 1)
  assert.deepEqual(new Set(groups.flat()), new Set(names))
  for (const group of groups) {
    assert.ok(group.length <= 240)
    for (const f of group) for (const d of graph.get(f)) assert.ok(group.includes(d))
  }
  const chain = new Map(names.slice(0, 241).map((f, i, all) => [f, i ? [all[i - 1]] : []]))
  assert.deepEqual(shardModules([...chain.keys()], chain), [[...chain.keys()]])
})

test("three-package one-pass checks every project, reverts the root cause, and keeps its importer", async () => {
  const f = await fixture()
  try {
    await onePassStep("plan", { run: f.run, scope: f.scope })
    const renamed = await onePassStep("rename", { run: f.run, jobs: 2 })
    assert.equal(renamed.renames.length, 2)
    assert.equal(readJson(join(f.target, "core/package.json")).scripts.start, "node src/index.vibe")
    assert.ok(renamed.packageScriptEdits.some(edit => edit.manifest === "core/package.json" && edit.script === "start"))
    assert.match(text(f.target, "run.sh"), /core\/src\/index.vibe/)
    assert.match(text(f.target, "core/package.json"), /src\/index.vibe/)
    await onePassStep("fix", { run: f.run, jobs: 2, timeout: 10 })
    const settled = await onePassStep("settle", { run: f.run, jobs: 2 })
    assert.equal(settled.settled, true)
    assert.equal(existsSync(join(f.target, "core/src/index.vibe")), false)
    assert.equal(existsSync(join(f.target, "core/src/index.d.vibe.ts")), false)
    assert.equal(existsSync(join(f.target, "app/src/index.vibe")), true)
    // The converted importer keeps its written ../../core/src/index.js (detail 272).
    assert.match(text(f.target, "app/src/index.vibe"), /core\/src\/index.js/)
    assert.match(text(f.target, "consumer/src/index.ts"), /core\/src\/index.ts/)
    assert.match(text(f.target, "entry.vibe"), /core\/src\/index.ts/)
    assert.match(text(f.target, "run.sh"), /core\/src\/index.ts/)
    assert.equal(readJson(join(f.target, "core/package.json")).scripts.start, "node src/index.ts")
    assert.deepEqual(Object.keys(settled.causes), ["core/src/index.vibe"])
    const checks = text(f.target, "checks.log").trim().split("\n").map(JSON.parse)
    for (const pkg of ["core", "app", "consumer"]) for (const project of ["tsconfig.json", "tsconfig.tests.json"]) assert.ok(checks.some(c => c.pkg === pkg && c.project === project))
    const fixes = checks.filter(c => c.args.includes("--fix")).map(c => c.pkg)
    assert.ok(fixes.indexOf("core") < fixes.indexOf("app"))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("settle refuses global, new TS, crash and exhausted-round failures", async () => {
  for (const failure of ["global", "ts", "crash", "limit"]) {
    const f = await fixture()
    try {
      await onePassStep("plan", { run: f.run, scope: f.scope })
      await onePassStep("rename", { run: f.run })
      if (failure !== "limit") {
        writeProbeAwareCompiler(f.compiler, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(failure === "global" ? "error TS9998: global failure" : failure === "ts" ? "src/unrelated.ts(1,1): error TS9998: unrelated" : "panic: bad compiler")}); process.exitCode = 1\n`, { mode: 0o755 })
      }
      const out = await onePassStep("settle", { run: f.run, rounds: 1 })
      assert.equal(out.settled, false, failure)
      assert.ok(out.remaining.length, failure)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }
})

test("bulk revert validates every request before mutation and never silently skips a module", async () => {
  const f = await fixture()
  try {
    await onePassStep("plan", { run: f.run, scope: f.scope })
    await onePassStep("rename", { run: f.run })
    await assert.rejects(revertMany({ run: f.run, batch: "01", files: [{ file: "core/src/index.vibe", reason: "bad" }, { file: "missing.vibe", reason: "bad" }] }), /missing/)
    assert.ok(existsSync(join(f.target, "core/src/index.vibe")))
    await revertMany({ run: f.run, batch: "01", files: ["core/src/index.vibe", "app/src/index.vibe"], reason: "bad" })
    assert.equal(text(f.target, "app/src/index.ts"), 'import { value } from "../../core/src/index.js"\nexport const result = value\n')
    await assert.rejects(revertMany({ run: f.run, batch: "01", files: ["core/src/index.vibe"], reason: "again" }), /not.*vibe|missing|already/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("bulk reverts restore arbitrary subsets, exports, path references, sources and all importers", async () => {
  await fc.assert(fc.asyncProperty(fc.subarray(["core", "app"]), fc.boolean(), async (subset, reverse) => {
    const f = await fixture()
    try {
      await onePassStep("plan", { run: f.run, scope: f.scope })
      await onePassStep("rename", { run: f.run })
      const files = subset.map(p => p + "/src/index.vibe")
      for (const file of files) put(f.target, file.replace(/\.vibe$/, ".d.vibe.ts"), "sidecar")
      if (files.length) await revertMany({ run: f.run, batch: "01", files: reverse ? files.reverse() : files, reason: "property witness" })
      for (const pkg of ["core", "app"]) {
        const reverted = subset.includes(pkg)
        assert.equal(existsSync(join(f.target, pkg, "src/index.ts")), reverted)
        assert.equal(existsSync(join(f.target, pkg, "src/index.vibe")), !reverted)
        assert.equal(existsSync(join(f.target, pkg, "src/index.d.vibe.ts")), false)
        if (reverted) assert.deepEqual(readJson(join(f.target, pkg, "package.json")).exports, { "./*": "./src/*.ts" })
        assert.equal(readJson(join(f.target, pkg, "package.json")).scripts.start, "node src/index." + (reverted ? "ts" : "vibe"))
      }
      if (subset.includes("core")) {
        assert.match(text(f.target, "entry.vibe"), /index.ts/)
        assert.match(text(f.target, "run.sh"), /index.ts/)
        assert.match(text(f.target, "PACKAGE.ts"), /index.ts/)
        const app = subset.includes("app") ? "app/src/index.ts" : "app/src/index.vibe"
        // Converted or reverted, app keeps its written ../../core/src/index.js.
        assert.match(text(f.target, app), /index.js/)
      }
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }), { seed: 1101, numRuns: 20 })
})


test("fix timeouts fail loudly with receipts, even after ordinary diagnostics", async () => {
  const f = await fixture()
  try {
    await onePassStep("plan", { run: f.run, scope: f.scope })
    await onePassStep("rename", { run: f.run })
    const before = text(f.root, "tool/compiler.cjs")
    writeProbeAwareCompiler(f.compiler, before.replace('if (args.includes("--fix")) {', 'if (args.includes("--fix")) { console.log("src/index.vibe(1,1): error EK1002: still fixing"); setInterval(() => {}, 1000); return;'), { mode: 0o755 })
    await assert.rejects(onePassStep("fix", { run: f.run, timeout: 1, jobs: 2 }), /fix failed.*did not finish/s)
    const receipt = readJson(paths(f.run).codemod("01"))
    assert.equal(receipt.fix.settled, false)
    assert.ok(receipt.fix.projects.some(p => /did not finish/.test(p.error)))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("shard closure invariants hold for generated DAGs, aliases and cycles", () => {
  fc.assert(fc.property(fc.array(fc.array(fc.nat(39), { maxLength: 3 }), { minLength: 1, maxLength: 40 }), edges => {
    const files = edges.map((_, i) => `src/d${i % 5}/m${i}.vibe`)
    const graph = new Map(files.map((f, i) => [f, edges[i].map(n => files[n % files.length])]))
    const groups = shardModules(files, graph, 40)
    assert.deepEqual(new Set(groups.flat()), new Set(files))
    for (const group of groups) {
      assert.ok(group.length <= 40)
      for (const f of group) for (const dep of graph.get(f)) assert.ok(group.includes(dep))
    }
    const roots = dependencyRoots(graph)
    assert.ok(roots.length > 0)
    for (const f of roots) assert.ok(graph.has(f))
  }), { seed: 1102, numRuns: 150 })
})

test("actual step CLI accepts a scope and repeated revert files, with a nonzero unsettled exit", async () => {
  const f = await fixture()
  try {
    const cli = fileURLToPath(new URL("../step.mjs", import.meta.url))
    await must(`node ${quote(cli)} plan --run ${quote(f.run)} --scope ${quote(f.scope)}`)
    await must(`node ${quote(cli)} rename --run ${quote(f.run)}`)
    const result = await run(`node ${quote(cli)} settle --run ${quote(f.run)} --rounds 1`)
    assert.equal(result.code, 1)
    assert.match(result.stderr, /NOT SETTLED/)
    assert.doesNotMatch(result.stderr, /^SETTLED$/m)
    await must(`node ${quote(cli)} revert --run ${quote(f.run)} --file core/src/index.vibe --file app/src/index.vibe --reason witness`)
    const clean = await run(`node ${quote(cli)} settle --run ${quote(f.run)}`)
    assert.equal(clean.code, 0)
    assert.match(clean.stderr, /^SETTLED$/m)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})


test("fix executes capped temporary projects and removes them, rather than just limiting its kept output", async () => {
  const f = await fixture()
  try {
    const scope = []
    for (let i = 0; i < 245; i++) {
      const file = `core/src/part${Math.floor(i / 50)}/m${i}.ts`
      put(f.target, file, `export const value${i} = ${i}\n`)
      scope.push(file)
    }
    put(f.run, "large-scope.txt", scope.join("\n"))
    await Jj.commit(f.target, "large project")
    await onePassStep("plan", { run: f.run, scope: join(f.run, "large-scope.txt") })
    await onePassStep("rename", { run: f.run })
    // The compiler oracle enumerates nested project roots, then asserts the
    // actual temporary project's roots passed to --fix, not just a keep list.
    const original = text(f.root, "tool/compiler.cjs")
    const discovery = 'fs.readdirSync("src", { recursive: true }).filter(f => /\\.(ts|vibe)$/.test(f) && !f.includes(".d.")).map(f => "./src/" + f)'
    let next = original.replace('fs.readdirSync("src").filter(f => /\\.(ts|vibe)$/.test(f) && !f.includes(".d.")).map(f => "./src/" + f)', discovery)
    next = next.replace('if (args.includes("--fix")) { console.log("vibelang --fix: 0 fixes in 0 files."); process.exit(0) }', `
if (args.includes("--fix")) {
  const config = JSON.parse(fs.readFileSync(project, "utf8"))
  if (!config.files || config.files.length > 240 || !config.extends) throw new Error("uncapped or optionless shard")
  let total = 0
  for (const file of config.files.filter(f => f.endsWith(".vibe"))) {
    const source = fs.readFileSync(file, "utf8")
    if (source.includes("// fixed")) continue
    fs.writeFileSync(file, source + "// fixed\\n")
    console.log("vibelang --fix: " + file + ": 1 fix (EK4801 ×1)"); total++
  }
  console.log("vibelang --fix: " + total + " fixes"); process.exit(0)
}`)
    writeProbeAwareCompiler(f.compiler, next, { mode: 0o755 })
    const fixed = await onePassStep("fix", { run: f.run, jobs: 2 })
    assert.equal(fixed.settled, true)
    assert.equal(Object.keys(fixed.byFile).length, 245)
    assert.ok(fixed.projects.every(p => p.shards.length > 1 && p.shards.every(g => g.modules <= 240)))
    for (const file of scope) assert.match(text(f.target, file.replace(/\.ts$/, ".vibe")), /fixed/)
    assert.ok(!readdirSync(join(f.target, "core")).some(p => p.startsWith("tsconfig.vibelang-fix-")))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("the normal flow codemod and repair actions use one-pass without an agent", async () => {
  const f = await fixture()
  try {
    await onePassStep("plan", { run: f.run, scope: f.scope })
    const coded = await flowStep("codemod", { run: f.run })
    assert.equal(coded.batch, "01")
    assert.equal(nextStep(f.run).step, "compile")
    writeJson(paths(f.run).compile("01"), {})
    const repaired = await flowStep("repair", { run: f.run })
    assert.equal(repaired.batch, "01")
    assert.equal(readJson(paths(f.run).repair("01")).agent, "one-pass")
    assert.equal(nextStep(f.run).step, "verify")
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})


test("the flow's plan step plans a scope without an agent, and a later execution keeps that plan", async () => {
  const f = await fixture()
  try {
    const planned = await flowStep("plan", { run: f.run, scope: f.scope })
    assert.equal(planned.summary, "1 batches")
    assert.equal(readJson(paths(f.run).plan).mode, "one-pass")
    await flowStep("codemod", { run: f.run })
    const again = await flowStep("plan", { run: f.run, scope: f.scope })
    assert.equal(again.summary, "1 batches")
    assert.equal(readJson(paths(f.run).plan).mode, "one-pass")
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("root attribution follows conditional workspace exports through a bare package import", async () => {
  const f = await fixture()
  try {
    put(f.target, "app/src/index.ts", 'import { value } from "core/index"\nexport const result = value\n')
    // No inventory edge: the graph must read workspace exports, including
    // the types sidecar target rewriteExports creates for this module.
    writeJson(paths(f.run).inventory, { files: [] })
    await Jj.commit(f.target, "bare import")
    await onePassStep("plan", { run: f.run, scope: f.scope })
    await onePassStep("rename", { run: f.run })
    const out = await onePassStep("settle", { run: f.run })
    assert.equal(out.settled, true)
    assert.deepEqual(Object.keys(out.causes), ["core/src/index.vibe"])
    assert.ok(existsSync(join(f.target, "app/src/index.vibe")))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})


test("path references follow the source, while comments and JSDoc remain byte-identical", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-reference-comments-"))
  try {
    put(root, "src/value.ts", "export const value = 1\n")
    put(root, "package.json", "{}")
    const comment = '/** See src/value.ts and import("./src/value.ts"). */\n'
    const code = 'const entry = new URL("./src/value.ts", import.meta.url)\n'
    put(root, "entry.ts", comment + code + '// src/value.ts\n')
    const renames = renameBatch(root, ["src/value.ts"])
    const edits = rewriteReferences(root, renames, ["entry.ts", "src/value.vibe"])
    assert.match(text(root, "entry.ts"), /new URL\("\.\/src\/value.vibe"/)
    assert.ok(text(root, "entry.ts").startsWith(comment))
    assert.ok(text(root, "entry.ts").endsWith("// src/value.ts\n"))
    restoreReferences(root, edits, "src/value.ts")
    assert.equal(text(root, "entry.ts"), comment + code + '// src/value.ts\n')
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test("one-pass rename, root attribution and bulk revert preserve main's paths-alias rewrites", async () => {
  const f = await fixture()
  try {
    mkdirSync(join(f.root, "tool/node_modules"))
    symlinkSync(fileURLToPath(new URL("../../../../packages/runtime/node_modules/typescript", import.meta.url)), join(f.root, "tool/node_modules/typescript"))
    writeJson(join(f.target, "app/tsconfig.json"), { compilerOptions: { baseUrl: ".", paths: { "@core/*": ["../core/src/*"] } }, include: ["src"] })
    put(f.target, "app/src/index.ts", 'import { value } from "@core/index.js"\nexport const result = value\n')
    writeJson(paths(f.run).inventory, { files: [] })
    await Jj.commit(f.target, "alias import")
    await onePassStep("plan", { run: f.run, scope: f.scope })
    await onePassStep("rename", { run: f.run })
    assert.match(text(f.target, "app/src/index.vibe"), /@core\/index.vibe/)
    const result = await onePassStep("settle", { run: f.run })
    assert.equal(result.settled, true)
    assert.deepEqual(Object.keys(result.causes), ["core/src/index.vibe"])
    assert.match(text(f.target, "app/src/index.vibe"), /@core\/index.js/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})



test("large unselected roots do not prevent a small scope from using one capped temporary project", async () => {
  const f = await fixture()
  try {
    const corpus = readJson(fileURLToPath(new URL("./corpus/opencode-small-scope-large-project.json", import.meta.url)))
    for (let i = 0; i < corpus.plainModules; i++) put(f.target, `core/src/unused${i}.ts`, `export const value${i} = ${i}\n`)
    put(f.target, "core/src/unselected.ts", Array.from({ length: corpus.plainModules }, (_, i) => `import { value${i} } from "./unused${i}.ts"`).join("\n"))
    await Jj.commit(f.target, "large outside-scope roots")
    await onePassStep("plan", { run: f.run, scope: f.scope })
    await onePassStep("rename", { run: f.run })
    const result = await onePassStep("fix", { run: f.run, jobs: 2 })
    assert.equal(result.settled, true)
    const project = result.projects.find(p => p.package === "core")
    assert.deepEqual(project.shards.map(s => s.files), [["core/src/index.vibe"]])
    const calls = text(f.target, "checks.log").trim().split("\n").map(JSON.parse).filter(c => c.pkg === "core" && c.args.includes("--fix"))
    assert.ok(calls.length && calls.every(c => c.project.startsWith("tsconfig.vibelang-fix-")))
    assert.match(text(f.target, "core/src/unselected.ts"), /unused244.ts/)
    assert.ok(existsSync(join(f.target, "core/src/unused244.ts")))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})


test("unselected import graphs cannot enlarge selected fix shards", () => {
  const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  assert.ok(contract.includes("Unselected roots remain in the full-project checks."))
  fc.assert(fc.property(
    fc.array(fc.array(fc.nat(29), { maxLength: 3 }), { minLength: 1, maxLength: 30 }),
    fc.integer({ min: 241, max: 280 }),
    (edges, outsideCount) => {
      const selected = edges.map((_, i) => `src/selected/m${i}.vibe`)
      const outside = Array.from({ length: outsideCount }, (_, i) => `tests/unselected/m${i}.ts`)
      const graph = new Map(selected.map((f, i) => [f, edges[i].map(n => selected[n % selected.length])]))
      for (const file of outside) graph.set(file, outside.filter(f => f !== file))
      const result = fixShards([...selected, ...outside], graph, new Set(selected))
      assert.equal(result.sharded, true)
      assert.deepEqual(new Set(result.groups.flat()), new Set(selected))
      assert.ok(result.groups.every(group => group.length <= 240))
      for (const group of result.groups) for (const file of group) for (const dependency of graph.get(file)) assert.ok(group.includes(dependency))
    }
  ), { seed: 1146, numRuns: 100 })
})


test("restart skips banked packages, but a changed source invalidates its bank", async () => {
  const f = await fixture()
  try {
    await onePassStep("plan",{run:f.run,scope:f.scope})
    await onePassStep("rename",{run:f.run})
    await onePassStep("fix",{run:f.run,jobs:1})
    const fixes = () => text(f.target,"checks.log").trim().split("\n").map(JSON.parse).filter(c=>c.args.includes("--fix"))
    const count = fixes().length
    await onePassStep("fix",{run:f.run,jobs:1})
    assert.equal(fixes().length,count)
    put(f.target,"app/src/index.vibe",text(f.target,"app/src/index.vibe")+"// changed\n")
    await onePassStep("fix",{run:f.run,jobs:1})
    assert.equal(fixes().filter(c=>c.pkg==="core").length,2)
    assert.equal(fixes().filter(c=>c.pkg==="app").length,4)
  } finally {rmSync(f.root,{recursive:true,force:true})}
})

test("a timed-out config is not retried after restarting the same pass", async () => {
  const f=await fixture()
  try {
    await onePassStep("plan",{run:f.run,scope:f.scope})
    await onePassStep("rename",{run:f.run})
    put(f.root,"tool/compiler.cjs",text(f.root,"tool/compiler.cjs").replace('console.log("vibelang --fix: 0 fixes in 0 files."); process.exit(0)','setTimeout(()=>{},10000); return'))
    await assert.rejects(onePassStep("fix",{run:f.run,jobs:1,timeout:1}),/fix failed/)
    const first=text(f.target,"checks.log").trim().split("\n").map(JSON.parse).filter(c=>c.args.includes("--fix")).length
    assert.ok(first>0)
    await assert.rejects(onePassStep("fix",{run:f.run,jobs:1,timeout:1}),/no retry/)
    const second=text(f.target,"checks.log").trim().split("\n").map(JSON.parse).filter(c=>c.args.includes("--fix")).length
    assert.equal(second,first)
  } finally {rmSync(f.root,{recursive:true,force:true})}
})

test("repository regeneration hooks run before each settle check and fail loudly",async()=>{
  const f=await fixture()
  try {
    const config=readJson(paths(f.run).config)
    config.afterConvert=['node -e \'require("node:fs").writeFileSync("generated.txt","fresh")\'']
    writeJson(paths(f.run).config,config)
    await onePassStep("plan",{run:f.run,scope:f.scope})
    await onePassStep("rename",{run:f.run})
    const result=await onePassStep("settle",{run:f.run})
    assert.equal(result.settled,true)
    assert.equal(text(f.target,"generated.txt"),"fresh")
    assert.ok(Object.keys(readJson(join(f.run,"done.json"))).includes("app"))
    config.afterConvert=["exit 23"];writeJson(paths(f.run).config,config)
    await assert.rejects(onePassStep("settle",{run:f.run}),/exited 23/)
  } finally {rmSync(f.root,{recursive:true,force:true})}
})

test("scope planning defers a module whose text a test asserts on",async()=>{
  const f=await fixture()
  try {
    put(f.target,"app/tests/read.test.ts",'readFileSync(new URL("../../core/src/index.ts", import.meta.url), "utf8")\n')
    const result=await onePassStep("plan",{run:f.run,scope:f.scope})
    assert.ok(result.plan.deferred.some(d=>d.file==="core/src/index.ts"&&/PATHNAME-READS/.test(d.reason)))
    await onePassStep("rename",{run:f.run})
    assert.ok(existsSync(join(f.target,"core/src/index.ts")))
  } finally {rmSync(f.root,{recursive:true,force:true})}
})

test("record rechecks final generated bytes against main and refuses force on a regression",async()=>{
  const f=await fixture()
  try {
    const config=readJson(paths(f.run).config)
    config.test={command:"node --test --test-reporter=spec gate.test.mjs",cwd:"."}
    config.install="true"; config.main="main"
    put(f.target,"node_modules/.bin/vibelang-format","#!/bin/sh\nexit 0\n")
    chmodSync(join(f.target,"node_modules/.bin/vibelang-format"),0o755)
    put(f.target,"gate.test.mjs",'import {test} from "node:test";import assert from "node:assert/strict";import fs from "node:fs";test("generated bundle",()=>assert.equal(fs.existsSync("bad"),false))\n')
    for(const dir of ["core","app","consumer"]) {
      const pkg=readJson(join(f.target,dir,"package.json"));pkg.private=true;writeJson(join(f.target,dir,"package.json"),pkg)
    }
    await Jj.commit(f.target,"baseline tests")
    await Jj.setBookmark(f.target,"main","@-")
    writeJson(paths(f.run).config,config)
    writeJson(join(paths(f.run).baseline,"upstream-packs.json"),await packRepository(config,join(paths(f.run).baseline,"upstream-packs")))
    writeJson(join(paths(f.run).baseline,"tests.json"),{code:0,tests:{"generated bundle":"passed"}})
    await onePassStep("plan",{run:f.run,scope:f.scope})
    await onePassStep("rename",{run:f.run})
    for(const c of readJson(join(f.run,"onepass-baseline.json")).filter(c=>c.project==="tsconfig.json")) {
      writeJson(join(paths(f.run).baseline,"compile-"+c.package+".json"),c.diagnostics)
    }
    await onePassStep("settle",{run:f.run})
    // The fixture's compiler stub emits no JavaScript, so the lost-wrapper check cannot read app's module.
    writeJson(paths(f.run).lostWrapperAllow,[{file:"app/src/index.vibe",function:"*",reason:"the fixture's compiler stub emits no JavaScript"}])
    const initial = await verify({run:f.run,batch:"01"})
    assert.equal(initial.ok,true,JSON.stringify({checks:initial.checks,foreign:initial.foreign}))
    const scope=readJson(paths(f.run).codemod("01")).packingFiles
    assert.ok(scope.includes("app/.npmignore"))
    assert.ok(scope.includes("app/.vibelang/pack-policy.json"))
    const again=await verify({run:f.run,batch:"01"})
    assert.equal(again.ok,true,JSON.stringify({checks:again.checks,foreign:again.foreign}))
    assert.deepEqual(readJson(paths(f.run).codemod("01")).packingFiles,scope)

    // Keep the missing-producer refusal as an independent, force-resistant control.
    const unidentified = {...config, toolchain: {kind: "npm"}}
    writeJson(paths(f.run).config, unidentified)
    const beforeProducer = await Jj.commitId(f.target)
    await assert.rejects(record({run:f.run,batch:"01",force:"ignored"}), /record refused: no producing toolchain/)
    assert.equal(await Jj.commitId(f.target), beforeProducer)
    assert.equal(existsSync(paths(f.run).record("01")), false)
    writeJson(paths(f.run).config, config)

    config.afterConvert=['node -e \'require("node:fs").writeFileSync("bad","stale generated bundle")\'']
    writeJson(paths(f.run).config,config)
    const parent=await Jj.commitId(f.target)
    await assert.rejects(record({run:f.run,batch:"01",force:"ignored"}),/record refused.*main\/previous/)
    assert.equal(await Jj.commitId(f.target),parent)
    assert.equal(existsSync(paths(f.run).record("01")),false)
  } finally {rmSync(f.root,{recursive:true,force:true})}
})

test("restart property preserves both completed work and timed-out config admission",async()=>{
  await fc.assert(fc.asyncProperty(fc.constantFrom("core","app"),fc.boolean(),fc.boolean(),async(pkg,timeout,changed)=>{
    const f=await fixture()
    try {
      put(f.run,"scope.txt",pkg+"/src/index.ts\n")
      await onePassStep("plan",{run:f.run,scope:f.scope})
      await onePassStep("rename",{run:f.run})
      if(timeout) put(f.root,"tool/compiler.cjs",text(f.root,"tool/compiler.cjs").replace('console.log("vibelang --fix: 0 fixes in 0 files."); process.exit(0)','setTimeout(()=>{},10000); return'))
      const action=()=>onePassStep("fix",{run:f.run,jobs:1,timeout:1})
      if(timeout) await assert.rejects(action(),/fix failed/)
      else await action()
      const count=()=>text(f.target,"checks.log").trim().split("\n").map(JSON.parse).filter(c=>c.args.includes("--fix")).length
      const first=count()
      if(changed) put(f.target,pkg+"/src/index.vibe",text(f.target,pkg+"/src/index.vibe")+"// source changed\n")
      if(timeout) await assert.rejects(action(),/no retry/)
      else await action()
      if(changed&&!timeout) assert.ok(count()>first)
      else assert.equal(count(),first)
    }finally{rmSync(f.root,{recursive:true,force:true})}
  }),{seed:110716,numRuns:6})
})

test("opencode-57: scope retains a package when unrelated migration moves asserted native bundle inputs",async()=>{
  const f=await fixture()
  try{
    put(f.target,"core/src/mcp.ts","export const answer = 42\n")
    const original='const build=await Bun.build({entrypoints:["core"],metafile:true});\nexpect(Object.keys(build.metafile.inputs)).toContain("src/mcp.ts");\n'
    put(f.target,"core/tests/import-boundaries.test.ts",original)
    const result=await onePassStep("plan",{run:f.run,scope:f.scope})
    assert.ok(result.plan.deferred.some(d=>d.file==="core/src/index.ts"&&/BUNDLE-INPUT-PATHS/.test(d.reason)&&d.reason.includes("core/src/mcp.ts")))
    assert.ok(result.plan.batches[0].files.includes("app/src/index.ts"))
    await onePassStep("rename",{run:f.run})
    assert.ok(existsSync(join(f.target,"core/src/index.ts")))
    assert.ok(existsSync(join(f.target,"core/src/mcp.ts")))
    assert.equal(text(f.target,"core/tests/import-boundaries.test.ts"),original)
    assert.equal(readJson(join(f.target,"core/package.json")).exports["./*"],"./src/*.ts")
  }finally{rmSync(f.root,{recursive:true,force:true})}
})

test("opencode-57: an entirely protected scope reports the module, source and reader",async()=>{
  const f=await fixture()
  try{
    put(f.target,"core/src/mcp.ts","export const answer = 42\n")
    put(f.target,"core/tests/import-boundaries.test.ts",'const build=await Bun.build({metafile:true}); expect(Object.keys(build.metafile.inputs)).toContain("src/mcp.ts")\n')
    put(f.run,"scope.txt","core/src/index.ts\n")
    await assert.rejects(onePassStep("plan",{run:f.run,scope:f.scope}),e=>{
      assert.match(e.message,/core\/src\/index\.ts/)
      assert.match(e.message,/BUNDLE-INPUT-PATHS/)
      assert.match(e.message,/core\/tests\/import-boundaries\.test\.ts:1/)
      assert.match(e.message,/observes core\/src\/mcp\.ts/)
      return true
    })
    assert.ok(existsSync(join(f.target,"core/src/index.ts")))
    assert.ok(!existsSync(paths(f.run).plan))
  }finally{rmSync(f.root,{recursive:true,force:true})}
})


test("t3code oversized selected closure falls back to every project root, including observers", () => {
  const c = readJson(fileURLToPath(new URL("./corpus/t3code-oversized-import-closure.json", import.meta.url)))
  const dependencies = Array.from({ length: c.closureModules - 2 }, (_, i) => `apps/mobile/src/lib/m${i}.ts`)
  const files = [c.selected, c.tsx, ...dependencies, c.observer, c.unrelated]
  const graph = new Map(files.map(f => [f, []]))
  graph.set(c.selected, [c.tsx])
  graph.set(c.tsx, [c.selected, ...dependencies])
  graph.set(c.observer, [c.selected])
  const result = fixShards(files, graph, new Set([c.selected]), c.cap)
  assert.equal(result.sharded, false)
  assert.deepEqual(result.groups, [files])
  assert.ok([c.selected, c.tsx].includes(result.fallback.file))
  assert.equal(result.fallback.modules, c.closureModules)
  assert.equal(result.fallback.cap, c.cap)
})

test("generated oversized closures use the original project while bounded closures keep capped shards", () => {
  const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  // Flow contract, rather than a language-semantic oracle.
  assert.ok(contract.includes("A selected import closure larger than the cap uses the original project."))
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 30 }),
    fc.integer({ min: 1, max: 45 }),
    fc.boolean(), fc.boolean(),
    (cap, count, cycle, reverse) => {
      const selected = "src/selected.vibe"
      const deps = Array.from({ length: count - 1 }, (_, i) => `src/dep${i}.ts`)
      const observer = "src/observer.ts", unrelated = "src/unrelated.ts"
      const files = [selected, ...deps, observer, unrelated]
      if (reverse) files.reverse()
      const graph = new Map(files.map(f => [f, []]))
      graph.set(selected, deps)
      graph.set(observer, [selected])
      if (cycle && deps.length) graph.set(deps.at(-1), [selected])
      const result = fixShards(files, graph, new Set([selected]), cap)
      if (files.length <= cap) {
        assert.equal(result.sharded, false)
        assert.deepEqual(result.groups, [files])
        assert.equal(result.fallback, undefined)
      } else if (count > cap) {
        assert.equal(result.sharded, false)
        assert.deepEqual(result.groups, [files])
        assert.equal(result.fallback.modules, count)
      } else {
        assert.equal(result.sharded, true)
        assert.ok(result.groups.every(g => g.length <= cap))
        assert.deepEqual(new Set(result.groups.flat()), new Set([selected, ...deps]))
      }
    }
  ), { seed: 1147, numRuns: 200 })
})

test("oversized fallback invokes the original tsconfig and restores nonselected fixes", async () => {
  const f = await fixture()
  try {
    const names = Array.from({ length: 241 }, (_, i) => `dep${i}.ts`)
    for (const [i, name] of names.entries()) put(f.target, "core/src/" + name, `export const value${i} = ${i}\n`)
    put(f.target, "core/src/observer.vibe", 'import { value } from "./index.ts"\nexport const check: number = value\n')
    const imports = names.map((name, i) => `import { value${i} } from "./${name}"`).join("\n")
    put(f.target, "core/src/index.ts", imports + "\nexport const value = 1\n")
    await Jj.commit(f.target, "oversized project with an observer")
    put(f.run, "scope.txt", "core/src/index.ts\n")
    await onePassStep("plan", { run: f.run, scope: f.scope })
    await onePassStep("rename", { run: f.run })
    const before = text(f.target, "core/src/observer.vibe")
    const original = text(f.root, "tool/compiler.cjs")
    const next = original.replace('if (args.includes("--fix")) { console.log("vibelang --fix: 0 fixes in 0 files."); process.exit(0) }', `
if (args.includes("--fix")) {
  if (project !== "tsconfig.json" && project !== "tsconfig.tests.json") throw new Error("observer omitted from fix gate")
  const file = "src/index.vibe", observer = "src/observer.vibe"
  const source = fs.readFileSync(file, "utf8")
  fs.appendFileSync(observer, "// nonselected rewrite\\n")
  if (!source.includes("// fixed")) {
    fs.appendFileSync(file, "// fixed\\n")
    console.log("vibelang --fix: " + file + ": 1 fix (EK4801 ×1)")
  }
  console.log("vibelang --fix: 0 fixes in 0 files."); process.exit(0)
}`)
    writeProbeAwareCompiler(f.compiler, next, { mode: 0o755 })
    const result = await onePassStep("fix", { run: f.run, jobs: 1 })
    assert.equal(result.settled, true)
    assert.equal(result.projects[0].mode, "whole-project")
    assert.equal(result.projects[0].fallback.modules, 242)
    assert.equal(result.projects[0].fallback.cap, 240)
    assert.equal(result.projects[0].shards[0].modules, 243)
    assert.match(text(f.target, "core/src/index.vibe"), /fixed/)
    assert.equal(text(f.target, "core/src/observer.vibe"), before)
    assert.ok(!readdirSync(join(f.target, "core")).some(p => p.startsWith("tsconfig.vibelang-fix-")))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

const settleCorpus = readJson(fileURLToPath(new URL("./corpus/t3code-settle-innocent-importers.json", import.meta.url)))

for (const witness of settleCorpus.witnesses) for (const ownImporter of [false, true]) {
  test("t3code settle: " + witness.name + "; independent importer error " + ownImporter, async () => {
    const f = await fixture()
    try {
      put(f.target, "core/src/index.ts", witness.rootSource)
      put(f.target, "app/src/index.ts", witness.importerSource)
      put(f.target, "consumer/src/index.ts", "export const value = 1\n")
      put(f.run, "scope.txt", "core/src/index.ts\napp/src/index.ts\nconsumer/src/index.ts\n")
      // Every project repeats its imported root diagnostic, as themePalette did.
      const prefix = text(f.root, "tool/compiler.cjs").split("const core =")[0]
      const emit = (file, code, message) => "console.log(" + JSON.stringify(file + "(1,1): error " + code + ": " + message) + "); process.exitCode = 1;"
      put(f.root, "tool/compiler.cjs", prefix + [
        "const core = fs.existsSync(path.join(root, \"core/src/index.vibe\"))",
        "if (core) { " + emit("../core/src/index.vibe", witness.rootCode, witness.rootMessage) + " }",
        "if (pkg === \"app\" && fs.existsSync(\"src/index.vibe\")) {",
        "if (core) { " + emit("src/index.vibe", witness.importerCode, "dependency fallout") + " }",
        ownImporter ? emit("src/index.vibe", "TS2375", "independent importer failure") : "",
        "}"
      ].join("\n"))
      await Jj.commit(f.target, "t3code minimized settle witness")
      await onePassStep("plan", { run: f.run, scope: f.scope })
      await onePassStep("rename", { run: f.run, jobs: 2 })
      const out = await onePassStep("settle", { run: f.run, jobs: 2 })
      assert.equal(out.settled, true)
      assert.deepEqual(out.rounds[0].reverting, ["core/src/index.vibe"])
      assert.deepEqual(Object.keys(out.causes), ownImporter ? ["core/src/index.vibe", "app/src/index.vibe"] : ["core/src/index.vibe"])
      assert.ok(existsSync(join(f.target, "consumer/src/index.vibe")), "a healthy dependency stays migrated")
      assert.equal(existsSync(join(f.target, "app/src/index.vibe")), !ownImporter)
      assert.ok(out.causes["core/src/index.vibe"].diagnostics.every(d => d.file === "core/src/index.vibe"))
      if (ownImporter) {
        assert.deepEqual(out.rounds[1].reverting, ["app/src/index.vibe"])
        assert.deepEqual(out.causes["app/src/index.vibe"].codes, ["TS2375"])
      }
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  })
}

test("t3code settle property: root retries preserve all importers whose fallout disappears", () => {
  assert.ok(text(fileURLToPath(new URL("..", import.meta.url)), "README.md").replace(/\s+/g, " ").includes(settleCorpus.oracle))
  fc.assert(fc.property(
    fc.integer({ min: 2, max: 24 }), fc.array(fc.nat(100), { maxLength: 80 }),
    fc.subarray(["TS2883", "EK1002", "EK3805", "TS2345", "TS2375"], { minLength: 1 }),
    (size, extras, codes) => {
      const names = Array.from({ length: size }, (_, i) => "m" + i + ".vibe")
      const helper = "helper.vibe"
      const graph = new Map([[helper, []], ...names.map((f, i) => [f, [i ? names[i - 1] : helper]])])
      for (let i = 1; i < size; i++) for (const n of extras) if (n % size < i) graph.get(names[i]).push(names[n % size])
      const live = new Set([helper, ...names])
      const diagnostics = names.map((file, i) => ({ file, code: codes[i % codes.length] }))
      const blamed = new Set(diagnostics.flatMap(d => blameCandidates(graph, d, live)))
      const reverting = dependencyRoots(graph, blamed)
      assert.deepEqual(reverting, [names[0]], "only the root returns before recompilation")
      // The oracle clears propagated diagnostics after the root returns.
      // An independent importer error must still be actionable on retry.
      const independent = names.at(-1)
      const remaining = new Set([...live].filter(f => !reverting.includes(f)))
      assert.deepEqual(dependencyRoots(graph, new Set(blameCandidates(graph, { file: independent, code: "TS2375" }, remaining))), [independent])
    }
  ), { seed: 110404, numRuns: 250 })
})

test("t3code settle: cycles include diagnostic owners, never a healthy SCC member", () => {
  const graph = new Map([["a.vibe", ["b.vibe"]], ["b.vibe", ["a.vibe"]], ["observer.vibe", ["a.vibe"]]])
  const live = new Set(graph.keys())
  assert.deepEqual(dependencyRoots(graph, new Set(blameCandidates(graph, { file: "a.vibe", code: "TS2883" }, live))), ["a.vibe"])
  assert.deepEqual(new Set(dependencyRoots(graph, new Set(["a.vibe", "b.vibe", "observer.vibe"]))), new Set(["a.vibe", "b.vibe"]))
})


// These use the real plan/rename/fix/settle path. The compiler is deliberately
// stubbed: the ruling is about flow policy after a safe fix refuses, regardless
// of which compiler version emits the warning.
for (const withError of [false, true]) test("warning refusal provenance survives settle" + (withError ? " alongside an own error" : ""), async () => {
  const f = await fixture()
  const corpus = readJson(fileURLToPath(new URL("./corpus/flow-warning-exceptions.json", import.meta.url)))
  try {
    put(f.target, "core/src/index.ts", corpus.witnesses[0].source)
    put(f.target, "app/src/index.ts", corpus.witnesses[1].source)
    const compiler = `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
const args = process.argv.slice(2), pkg = path.basename(process.cwd())
if (args.includes("--showConfig")) {
  console.log(JSON.stringify({ files: fs.readdirSync("src").filter(f => /\\.(ts|vibe)$/.test(f) && !f.includes(".d.")).map(f => "./src/" + f) }))
  process.exit(0)
}
if (!fs.existsSync("src/index.vibe") || pkg === "consumer") {
  if (args.includes("--fix")) console.log("vibelang --fix: 0 fixes in 0 files.")
  process.exit(0)
}
if (args.includes("--fix")) {
  console.log("vibelang --fix: src/index.vibe:4: EK4802 not fixed: the fixed program would report " + ${JSON.stringify(corpus.refusalError)})
  console.log("vibelang --fix: 0 fixes in 0 files.")
}
const ds = ${JSON.stringify(corpus.diagnostics)}
for (const d of ds) {
  console.log("src/index.vibe(" + d.line + "," + d.column + "): " + d.category + " " + d.code + ": " + d.message)
  for (const note of d.notes) console.log("  " + note)
}
if (${withError} && pkg === "app") {
  console.log("src/index.vibe(1,1): error EK4833: configured as an error, with the same code as a retained warning.")
  console.log("  No quick fix: keep the qualified Effect type here.")
  process.exitCode = 1
}
`
    writeProbeAwareCompiler(f.compiler, compiler, { mode: 0o755 })
    await Jj.commit(f.target, "t3code warning witnesses")
    await onePassStep("plan", { run: f.run, scope: f.scope })
    await onePassStep("rename", { run: f.run })
    await onePassStep("fix", { run: f.run, jobs: 2 })
    const out = await onePassStep("settle", { run: f.run, jobs: 2 })
    assert.equal(out.settled, true)
    assert.ok(existsSync(join(f.target, "core/src/index.vibe")))
    assert.equal(existsSync(join(f.target, "app/src/index.vibe")), !withError)
    assert.equal(existsSync(join(f.target, "app/src/index.ts")), withError)
    assert.deepEqual(Object.keys(out.causes), withError ? ["app/src/index.vibe"] : [])
    const kept = withError ? ["core/src/index.vibe"] : ["app/src/index.vibe", "core/src/index.vibe"]
    const refused = readJson(paths(f.run).codemod("01")).fix.refused
    for (const file of kept) {
      const expected = warningExceptions(corpus.diagnostics.map(d => ({ ...d, file })), [file], refused)
      const actual = out.warningExceptions.filter(e => e.file === file)
      assert.equal(actual.length, 4)
      assert.ok(actual.every(e => e.name === "warning-fix-refused"))
      assert.deepEqual(actual, expected)
      assert.equal(actual.find(e => e.code === "EK4802").reason, "The fixed program would report " + corpus.refusalError)
      assert.equal(text(f.target, file), corpus.witnesses[file.startsWith("core") ? 0 : 1].source)
    }
    assert.ok(out.warningExceptions.every(e => kept.includes(e.file)))
    assert.deepEqual(readJson(join(paths(f.run).batch("01"), "settle.json")).warningExceptions, out.warningExceptions)
    const done = readJson(join(f.run, "done.json"))
    assert.deepEqual(done.core.warningExceptions, out.warningExceptions.filter(e => e.file.startsWith("core/")))
    if (withError) assert.equal(done.app.warningExceptions.length, 0)
    // Replaying does not accumulate stale or duplicate exception sites.
    assert.deepEqual((await onePassStep("settle", { run: f.run })).warningExceptions, out.warningExceptions)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("property: generated warning/error mixes retain exactly the error-free modules and their provenance", async () => {
  const entry = fc.record({
    pkg: fc.constantFrom("core", "app"),
    category: fc.constantFrom("warning", "error"),
    code: fc.oneof(fc.constantFrom("EK4833", "EK4839", "EK4802", "TS2322"),
      fc.integer({ min: 1, max: 999999 }).map(n => "GENERATED" + n)),
    line: fc.integer({ min: 1, max: 20 }),
    receipt: fc.boolean()
  })
  await fc.assert(fc.asyncProperty(fc.array(entry, { maxLength: 12 }), async entries => {
    const f = await fixture()
    try {
      // Independent modules let the property distinguish a module's own error
      // from warnings in its neighbour, without dependency fallout.
      for (const pkg of ["core", "app"]) put(f.target, pkg + "/src/index.ts", "export const value = 1\n")
      writeJson(paths(f.run).inventory, { files: ["core/src/index.ts", "app/src/index.ts"].map(path => ({ path, imports: [] })) })
      writeProbeAwareCompiler(f.compiler, `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
const args = process.argv.slice(2), pkg = path.basename(process.cwd())
if (args.includes("--showConfig")) {
  console.log(JSON.stringify({ files: ["./src/index." + (fs.existsSync("src/index.vibe") ? "vibe" : "ts")] }))
  process.exit(0)
}
if (!fs.existsSync("src/index.vibe")) process.exit(0)
for (const d of ${JSON.stringify(entries)}) {
  if (d.pkg !== pkg) continue
  console.log("src/index.vibe(" + d.line + ",1): " + d.category + " " + d.code + ": generated finding")
  if (d.receipt) {
    if (args.includes("--fix")) console.log("vibelang --fix: src/index.vibe:" + d.line + ": " + d.code + " not fixed: the fixed program would report TS2322: changed API.")
  } else console.log("  No quick fix: preserve this signature.")
  if (d.category === "error") process.exitCode = 1
}
if (args.includes("--fix")) console.log("vibelang --fix: 0 fixes in 0 files.")
`, { mode: 0o755 })
      await Jj.commit(f.target, "generated diagnostic mix")
      await onePassStep("plan", { run: f.run, scope: f.scope })
      await onePassStep("rename", { run: f.run })
      await onePassStep("fix", { run: f.run })
      const settled = await onePassStep("settle", { run: f.run })
      assert.equal(settled.settled, true)
      const done = readJson(join(f.run, "done.json"))
      for (const pkg of ["core", "app"]) {
        const file = pkg + "/src/index.vibe"
        const rejected = entries.some(d => d.pkg === pkg && d.category === "error")
        assert.equal(existsSync(join(f.target, file)), !rejected)
        assert.equal(existsSync(join(f.target, pkg + "/src/index.ts")), rejected)
        const expected = entries.filter(d => d.pkg === pkg && d.category === "warning" && !rejected)
        const records = settled.warningExceptions.filter(e => e.file === file)
        assert.deepEqual(new Set(records.map(e => e.code + ":" + e.line)),
          new Set(expected.map(d => d.code + ":" + d.line)))
        assert.ok(records.every(e => e.name === "warning-fix-refused" && /signature|TS2322/.test(e.reason)))
        assert.deepEqual(done[pkg].warningExceptions, records)
      }
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }), { seed: 48394803, numRuns: 16, examples: [
    [[]],
    [[{ pkg: "core", category: "warning", code: "GENERATED65001", line: 1, receipt: true },
      { pkg: "app", category: "error", code: "GENERATED65001", line: 1, receipt: false }]]
  ] })
})

const staleProducerCorpus = readJson(fileURLToPath(new URL("./corpus/smithers-stale-conversion-producer.json", import.meta.url)))
async function changedConversionContext(kind, failed) {
  const f = await fixture()
  try {
    const config = readJson(paths(f.run).config)
    config.base = staleProducerCorpus.oldBaseline
    writeJson(paths(f.run).config, config)
    const tool = join(f.root, "tool/toolchain.json")
    writeJson(tool, { ...readJson(tool), commit: staleProducerCorpus.oldProducer })
    await onePassStep("plan", { run: f.run, scope: f.scope })
    await onePassStep("rename", { run: f.run })
    const workingCompiler = text(f.root, "tool/compiler.cjs")
    if (failed) {
      put(f.root, "tool/compiler.cjs", workingCompiler.replace('console.log("vibelang --fix: 0 fixes in 0 files."); process.exit(0)', 'setTimeout(()=>{},10000); return'))
      await assert.rejects(onePassStep("fix", { run: f.run, jobs: 1, timeout: 1 }), /fix failed/)
    } else await onePassStep("fix", { run: f.run, jobs: 1 })
    const fixes = () => text(f.target, "checks.log").trim().split("\n").map(JSON.parse).filter(c => c.args.includes("--fix")).length
    const previous = fixes()
    if (kind === "producer") {
      config.toolchain.version = "0.0.12"
      writeJson(paths(f.run).config, config)
    }
    if (kind === "baseline") {
      config.base = staleProducerCorpus.newBaseline
      writeJson(paths(f.run).config, config)
    }
    if (failed) put(f.root, "tool/compiler.cjs", workingCompiler)
    if (kind === "compiler") put(f.root, "tool/compiler.cjs", workingCompiler + "\n// new compiler build\n")
    assert.equal(nextStep(f.run).step, "codemod", "next must reopen a stale conversion")
    await onePassStep("fix", { run: f.run, jobs: 1, timeout: 5 })
    assert.ok(fixes() > previous, kind + " must reopen the previous " + (failed ? "failure" : "success"))
    const bank = readJson(join(f.run, "fix-bank.json"))
    assert.deepEqual(bank.timedOut, [])
    assert.equal(typeof bank.identity, "string")
    const next = fixes()
    await onePassStep("fix", { run: f.run, jobs: 1, timeout: 5 })
    assert.equal(fixes(), next, "an unchanged context retains its completed bank")
    assert.match(text(f.run, "batches/01/progress.jsonl"), /fix-context-changed/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
}
test("a new producer reopens a previous one-pass timeout", () => changedConversionContext("producer", true))
test("a new baseline rechecks an unchanged successful conversion", () => changedConversionContext("baseline", false))
test("conversion banks follow baseline, producer and compiler identity for either outcome", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom("baseline", "producer", "compiler"), fc.boolean(), changedConversionContext),
    { seed: 392, numRuns: 6 })
})
test("settled success receipts cannot certify a different producer", async () => {
  const f = await fixture()
  try {
    put(f.root, "tool/compiler.cjs", text(f.root, "tool/compiler.cjs").replace(/^if \(pkg === "(?:core|app)".*$/gm, ""))
    await onePassStep("plan", { run: f.run, scope: f.scope })
    await onePassStep("rename", { run: f.run })
    await onePassStep("fix", { run: f.run, jobs: 1 })
    assert.equal((await onePassStep("settle", { run: f.run })).settled, true)
    const done = readJson(join(f.run, "done.json"))
    assert.ok(Object.values(done).every(item => typeof item.identity === "string"))
    writeJson(join(f.run, "fix-bank.json"), { identity: done.app.identity, packages: {}, timedOut: [] })
    const config = readJson(paths(f.run).config)
    config.toolchain.version = "0.0.12"
    writeJson(paths(f.run).config, config)
    const fixes = () => text(f.target, "checks.log").trim().split("\n").map(JSON.parse).filter(c => c.args.includes("--fix")).length
    const before = fixes()
    await onePassStep("fix", { run: f.run, jobs: 1 })
    assert.ok(fixes() > before, "done.json must be rechecked under the new producer")
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

// Keep this producer stable across conversion and repair. Changing the compiler
// after fix exercises conversion freshness instead of declaration recovery.
function cleanOracleCompiler(f) {
  put(f.root, "tool/compiler.cjs", text(f.root, "tool/compiler.cjs")
    .replace(/^if \(pkg === "(?:core|app|consumer)".*$/gm, ""))
}

test("one-pass repair restores a module with an unproven stock declaration baseline", async () => {
  const corpus = readJson(fileURLToPath(new URL("./corpus/t3code-onepass-stock-declaration.json", import.meta.url)))
  const f = await fixture()
  try {
    cleanOracleCompiler(f)
    await onePassStep("plan", { run: f.run, scope: f.scope })
    await onePassStep("rename", { run: f.run })
    await onePassStep("fix", { run: f.run, jobs: 1 })
    const p = paths(f.run)
    const unproven = corpus.unproven
    writeJson(p.compile("01"), { batch: "01" })
    writeJson(p.verify("01"), { ok: false, declarationOracle: { unproven: [unproven] } })
    await (await import("../lib/steps.mjs")).repair({ run: f.run, batch: "01" })
    assert.equal(existsSync(join(f.target, unproven.file)), false)
    assert.equal(existsSync(join(f.target, "core/src/index.ts")), true)
    assert.equal(existsSync(join(f.target, "app/src/index.vibe")), true, "keep the healthy importer")
    assert.match(text(f.target, "app/src/index.vibe"), /core\/src\/index\.js/)
    const causes = readJson(join(p.batch("01"), "settle-causes.json"))
    assert.deepEqual(causes[unproven.file].codes, ["STOCK_DECL"])
    assert.match(causes[unproven.file].diagnostics[0].message, /index\.d\.ts/)
    assert.equal(readJson(p.verify("01")).ok, false, "restoration does not certify verification")
    assert.deepEqual(nextStep(f.run), { step: "verify", batch: "01" })

    // A retry reads the same failed receipt after the module has been restored.
    await (await import("../lib/steps.mjs")).repair({ run: f.run, batch: "01" })
    assert.equal(existsSync(join(f.target, "app/src/index.vibe")), true)
    assert.deepEqual(readJson(join(p.batch("01"), "settle-causes.json"))[unproven.file].codes, ["STOCK_DECL"])
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("property: one-pass oracle recovery restores only live batch modules and never trusts an old verdict", async () => {
  const corpus = readJson(fileURLToPath(new URL("./corpus/t3code-onepass-stock-declaration.json", import.meta.url)))
  const scenario = fc.record({
    files: fc.subarray(corpus.modules, { minLength: 1 }),
    duplicate: fc.boolean(),
    passed: fc.boolean()
  })
  await fc.assert(fc.asyncProperty(scenario, async ({ files, duplicate, passed }) => {
    const f = await fixture()
    try {
      cleanOracleCompiler(f)
      await onePassStep("plan", { run: f.run, scope: f.scope })
      await onePassStep("rename", { run: f.run })
      await onePassStep("fix", { run: f.run, jobs: 1 })
      const p = paths(f.run)
      const entries = files.map(file => ({ ...corpus.unproven, file }))
      writeJson(p.verify("01"), {
        ok: passed,
        declarationOracle: { unproven: [...entries, ...(duplicate ? entries : []), { ...corpus.unproven, file: "entry.vibe" }] }
      })
      const repair = (await import("../lib/steps.mjs")).repair
      await repair({ run: f.run, batch: "01" })
      await repair({ run: f.run, batch: "01" })
      for (const file of corpus.modules) {
        const returned = !passed && files.includes(file)
        assert.equal(existsSync(join(f.target, file)), !returned, file)
        assert.equal(existsSync(join(f.target, file.replace(/\.vibe$/, ".ts"))), returned, file)
      }
      assert.equal(existsSync(join(f.target, "entry.vibe")), true, "ignore a module outside the batch")
      assert.equal(readJson(p.verify("01")).ok, passed, "repair must not fabricate a new verification verdict")
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }), {
    seed: 101,
    numRuns: 8,
    examples: [
      [{ files: [corpus.modules[0]], duplicate: true, passed: false }],
      [{ files: corpus.modules, duplicate: true, passed: false }],
      [{ files: corpus.modules, duplicate: false, passed: true }]
    ]
  })
})
