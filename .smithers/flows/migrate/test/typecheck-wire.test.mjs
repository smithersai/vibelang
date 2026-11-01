import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { typecheckPlan, wireTypecheckBuild } from "../lib/typecheck-build.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-single-typecheck-build.json", import.meta.url), "utf8"))

test("alchemy: retire the serial prepass and combine the original root and frontend test project", () => {
  const plan = typecheckPlan(corpus.script, { retire: corpus.retire })
  assert.deepEqual(plan, {
    before: ["pnpm ensure:built"], after: [],
    projects: [{ path: "tsconfig.json" }, { path: "packages/frontend-frameworks/tsconfig.test.json", noEmit: true }],
    retired: ["node scripts/check-vibe.mjs"]
  })
})

test("typecheck command parser preserves quoted projects and refuses dynamic or interleaved commands", () => {
  assert.deepEqual(typecheckPlan("echo prepare && tsgo -b 'project with spaces/tsconfig.json' && pnpm exec tsc -p test.json --noEmit && echo done"),
    { before: ["echo prepare"], after: ["echo done"], retired: [], projects: [{ path: "project with spaces/tsconfig.json" }, { path: "test.json", noEmit: true }] })
  for (const command of ["tsc -b && echo between && tsc -p test.json", "cd pkg && tsc -b", "tsc -b $PROJECT", "tsc -b --watch", "tsc -b || true", 'tsc -p "$(echo tsconfig.json)"']) {
    assert.throws(() => typecheckPlan(command), /manual|literal|dynamic|explicit|unsupported/)
  }
  assert.equal(typecheckPlan("pnpm test"), null)
})

test("property: compiler wrappers preserve project ownership and noEmit intent", () => {
  fc.assert(fc.property(
    fc.constantFrom("tsc", "tsgo", "tsrs", "vibelang"),
    fc.constantFrom("", "pnpm exec ", "npx ", "bun x "),
    fc.array(fc.constantFrom("a/tsconfig.json", "project with spaces/tsconfig.json", "tsconfig.test.json"), { minLength: 1, maxLength: 6 }),
    (compiler, wrapper, projects) => {
      const command = projects.map((path, i) => wrapper + compiler + (i ? " --noEmit -p " : " -b ") + "'" + path + "'").join(" && ")
      assert.deepEqual(typecheckPlan(command).projects, projects.map((path, i) => ({ path, ...(i ? { noEmit: true } : {}) })))
    }), { seed: 55057, numRuns: 150 })
})

test("the generated runner is idempotent and a seeded orphan .vibe type error fails its single build", () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-typecheck-seed-"))
  const binary = resolve(new URL("../../../../packages/compiler/native/vibelang", import.meta.url).pathname)
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof text === "string" ? text : JSON.stringify(text)) }
  try {
    put("package.json", { private: true, type: "module", scripts: { typecheck: "tsrs -b" } })
    for (const [name, text] of Object.entries(corpus.files)) put(name, text)
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
    symlinkSync(binary, join(root, "node_modules/.bin/tsrs"))
    const env = { ...process.env, VIBELANG_BINARY: binary, PATH: join(root, "node_modules/.bin") + ":" + process.env.PATH }
    const before = spawnSync("sh", ["-c", JSON.parse(readFileSync(join(root, "package.json"))).scripts.typecheck], { cwd: root, env, encoding: "utf8" })
    assert.equal(before.status, 0, before.stdout + before.stderr)
    const result = wireTypecheckBuild({ target: root })
    assert.ok(result.changed.includes(".vibelang/typecheck.mjs"))
    assert.deepEqual(wireTypecheckBuild({ target: root }).changed, [])
    const command = JSON.parse(readFileSync(join(root, "package.json"))).scripts.typecheck
    const after = spawnSync("sh", ["-c", command], { cwd: root, env, encoding: "utf8" })
    assert.notEqual(after.status, 0, after.stdout + after.stderr)
    assert.match(after.stdout + after.stderr, /TS2322/)
    const receipt = JSON.parse(readFileSync(join(root, ".cache/vibelang-typecheck.json")))
    assert.deepEqual(receipt.graph, ["packages/a/tsconfig.json", "packages/b/tsconfig.json", "tsconfig.json"])
    assert.match(after.stdout, /one compiler build/)
    put("packages/b/src/main.vibe", "export const n: number = 2\n")
    const restored = spawnSync("sh", ["-c", command], { cwd: root, env, encoding: "utf8" })
    assert.equal(restored.status, 0, restored.stdout + restored.stderr)
    assert.equal(existsSync(join(root, "packages/b/lib/main.js")), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("alchemy's old prepass checks projects repeatedly; the shared command invokes one full build", () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-check-count-"))
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof text === "string" ? text : JSON.stringify(text)) }
  try {
    put("package.json", { private: true, scripts: { typecheck: corpus.miniScript } })
    for (const [name, text] of Object.entries(corpus.files)) put(name, text)
    put("tools/tsrs.cjs", [
      "#!/usr/bin/env node",
      'const fs=require("node:fs"),p=require("node:path"), args=process.argv.slice(2)',
      'fs.appendFileSync(p.join(process.cwd(),"trace.jsonl"),JSON.stringify(args)+"\\n")',
      'if(args.includes("--showConfig")){const f=p.relative(process.cwd(),args[args.indexOf("-p")+1]);console.log(JSON.stringify(f==="tsconfig.json"?{files:[],references:[{path:"packages/a"}]}:{files:["src/main.vibe"]}))}'
    ].join("\n") + "\n")
    put("scripts/check-vibe.mjs", [
      'import { spawnSync } from "node:child_process"',
      'for(const p of ["packages/a/tsconfig.json","packages/b/tsconfig.json"]) {',
      ' const r=spawnSync("tsrs",["-p",p,"--noEmit"],{stdio:"inherit"});if(r.status)process.exit(r.status)',
      '}'
    ].join("\n") + "\n")
    // A real executable, recording the CLI boundary rather than replacing the runner.
    const fake = join(root, "tools/tsrs.cjs")
    require("node:fs").chmodSync(fake, 0o755)
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
    symlinkSync(fake, join(root, "node_modules/.bin/tsrs"))
    const env = { ...process.env, VIBELANG_BINARY: fake, PATH: join(root, "node_modules/.bin") + ":" + process.env.PATH }
    const run = () => spawnSync("sh", ["-c", JSON.parse(readFileSync(join(root, "package.json"))).scripts.typecheck], { cwd: root, env, encoding: "utf8" })
    assert.equal(run().status, 0)
    const trace = () => readFileSync(join(root, "trace.jsonl"), "utf8").trim().split("\n").map(JSON.parse).filter(args => !args.includes("--showConfig"))
    assert.equal(trace().length, 4)
    wireTypecheckBuild({ target: root, typecheckRetire: corpus.retire })
    writeFileSync(join(root, "trace.jsonl"), "")
    const result = run()
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(trace().length, 1)
    assert.equal(trace()[0][0], "--build")
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).scripts.typecheck.includes("scripts/check-vibe.mjs"), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("an uncovered composite project's check keeps its original default rootDir and reference build", () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-composite-owner-"))
  const binary = resolve(new URL("../../../../packages/compiler/native/vibelang", import.meta.url).pathname)
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof text === "string" ? text : JSON.stringify(text)) }
  try {
    put("package.json", { private: true, type: "module", scripts: { typecheck: "vibelang -b" } })
    put("tsconfig.json", { files: ["main.ts"] })
    put("main.ts", "export const ok = 1\n")
    const options = { compilerOptions: { target: "ESNext", module: "ESNext", skipLibCheck: true, composite: true, outDir: "out" }, include: ["src/**/*.vibe"] }
    put("a/tsconfig.json", options)
    put("a/src/a.vibe", "export const a: number = 1\n")
    put("b/tsconfig.json", { ...options, references: [{ path: "../a" }] })
    put("b/src/b.vibe", "export const b = 2\n")
    wireTypecheckBuild({ target: root })
    const result = spawnSync("node", [".vibelang/typecheck.mjs"], { cwd: root, env: { ...process.env, VIBELANG_BINARY: binary }, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const receipt = JSON.parse(readFileSync(join(root, ".cache/vibelang-typecheck.json")))
    assert.deepEqual(receipt.graph, ["a/tsconfig.json", "b/tsconfig.json", "tsconfig.json"])
    assert.equal(existsSync(join(root, "b/out/src/b.js")), false)
    // Build mode retains the dependency's authored output, as the original reference graph does.
    assert.equal(existsSync(join(root, "a/out/src/a.js")), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("retiring a known serial script normalizes both command and option paths", () => {
  for (const prefix of ["", "./", "./scripts/../"]) {
    const script = prefix + "scripts/check-vibe.mjs"
    assert.deepEqual(typecheckPlan("node ./scripts/check-vibe.mjs && vibelang -b", { retire: [script] }).retired, ["node ./scripts/check-vibe.mjs"])
  }
})

test("Alchemy's uncovered projects resolve ambient, scoped and subpath type libraries from their own directory", () => {
  const fixture = JSON.parse(readFileSync(new URL("./corpus/alchemy-typecheck-project-context.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "alchemy-typecheck-libraries-"))
  const binary = resolve(new URL("../../../../packages/compiler/native/vibelang", import.meta.url).pathname)
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof text === "string" ? text : JSON.stringify(text)) }
  try {
    put("package.json", { private: true, type: "module", scripts: { typecheck: "vibelang -b" } })
    put("tsconfig.json", { files: ["main.ts"] })
    put("main.ts", "export const ok = 1")
    for (const [i, library] of fixture.libraries.entries()) {
      const dir = "project" + i
      put(dir + "/tsconfig.json", { compilerOptions: { target: "ESNext", module: "ESNext", types: [library.name], composite: !!(i % 2), outDir: "out" }, include: ["src/**/*.vibe"] })
      put(dir + "/" + library.file, fixture.declaration)
      put(dir + "/src/main.vibe", fixture.source)
      const control = spawnSync(binary, ["--noEmit", "-p", dir + "/tsconfig.json"], { cwd: root, encoding: "utf8" })
      assert.equal(control.status, 0, control.stdout + control.stderr)
    }
    wireTypecheckBuild({ target: root })
    const result = spawnSync("node", [".vibelang/typecheck.mjs"], { cwd: root, env: { ...process.env, VIBELANG_BINARY: binary }, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
