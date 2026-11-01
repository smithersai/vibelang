import assert from "node:assert/strict"
import { symlinkSync, chmodSync, existsSync, readdirSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { rewriteReferences, restoreReferences } from "../lib/references.mjs"
import { renameBatch } from "../lib/codemod.mjs"
import { planScope, dependencyRoots, shardModules, onePassStep } from "../lib/onepass.mjs"
import { revertMany, paths, flowStep, nextStep } from "../lib/steps.mjs"
import { must, quote, run, writeJson, readJson } from "../lib/util.mjs"
import * as Jj from "../lib/jj.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
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
  put(target, "run.sh", "node core/src/index.ts\n")
  put(target, "PACKAGE.ts", 'const source = "core/src/index.ts"\n')
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
  await Jj.commit(target, "fixture")
  const compiler = join(tool, "compiler.cjs")
  put(root, "tool/toolchain.json", JSON.stringify({ compiler: "compiler.cjs" }))
  put(root, "tool/compiler.cjs", `#!/usr/bin/env node
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
  writeJson(paths(run).config, { target, packages: ["app", "consumer", "core"].map(dir => ({ dir, tsconfig: "tsconfig.json", sources: ["src"] })), toolchain: { kind: "staged", dir: tool } })
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
  assert.throws(() => shardModules([...chain.keys()], chain), /240|closure/)
})

test("three-package one-pass checks every project, reverts the root cause, and keeps its importer", async () => {
  const f = await fixture()
  try {
    await onePassStep("plan", { run: f.run, scope: f.scope })
    const renamed = await onePassStep("rename", { run: f.run, jobs: 2 })
    assert.equal(renamed.renames.length, 2)
    assert.match(text(f.target, "run.sh"), /core\/src\/index.vibe/)
    assert.match(text(f.target, "core/package.json"), /src\/index.vibe/)
    await onePassStep("fix", { run: f.run, jobs: 2, timeout: 10 })
    const settled = await onePassStep("settle", { run: f.run, jobs: 2 })
    assert.equal(settled.settled, true)
    assert.equal(existsSync(join(f.target, "core/src/index.vibe")), false)
    assert.equal(existsSync(join(f.target, "core/src/index.d.vibe.ts")), false)
    assert.equal(existsSync(join(f.target, "app/src/index.vibe")), true)
    assert.match(text(f.target, "app/src/index.vibe"), /core\/src\/index.ts/)
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
        writeFileSync(f.compiler, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(failure === "global" ? "error TS9998: global failure" : failure === "ts" ? "src/unrelated.ts(1,1): error TS9998: unrelated" : "panic: bad compiler")}); process.exitCode = 1\n`, { mode: 0o755 })
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
      }
      if (subset.includes("core")) {
        assert.match(text(f.target, "entry.vibe"), /index.ts/)
        assert.match(text(f.target, "run.sh"), /index.ts/)
        assert.match(text(f.target, "PACKAGE.ts"), /index.ts/)
        const app = subset.includes("app") ? "app/src/index.ts" : "app/src/index.vibe"
        assert.match(text(f.target, app), subset.includes("app") ? /index.js/ : /index.ts/)
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
    writeFileSync(f.compiler, before.replace('if (args.includes("--fix")) {', 'if (args.includes("--fix")) { console.log("src/index.vibe(1,1): error EK1002: still fixing"); setInterval(() => {}, 1000); return;'), { mode: 0o755 })
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
    writeFileSync(f.compiler, next, { mode: 0o755 })
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
    assert.match(text(f.target, "app/src/index.vibe"), /@core\/index.ts/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

