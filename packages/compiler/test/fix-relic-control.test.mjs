import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const baseline = process.env.VIBELANG_RELIC_BASELINE_BINARY
const stockModules = process.env.RELIC_REFERENCE_NODE_MODULES
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const missing = [native, join(modules, "effect"), join(repo, "packages/runtime/dist/index.js")].find(p => !existsSync(p))
const skip = missing && `build compiler/runtime first: missing ${missing}`
const source = `import { Effect } from "effect"
control Ask { ask(x: number): number!! }
export effect function probe(): Effect.Effect<number> {
  try { return try Ask.ask(4) } handle Ask.ask(x) { return try resume(x + 2) }
}
`

function project(t, text, effectModules = modules, extension = "vibe") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relic-control-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(effectModules, "effect")), join(root, "node_modules/effect"))
  symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", strict: true, skipLibCheck: true, types: [], declaration: true, outDir: "dist" }, files: [`main.${extension}`] }))
  writeFileSync(join(root, `main.${extension}`), text)
  return root
}
function command(bin, args, cwd) {
  const r = spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 120000 })
  assert.equal(r.status, 0, `${r.error || ""}\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}
function compile(bin, root, ...flags) { return command(bin, ["-p", "tsconfig.json", "--pretty", "false", ...flags], root) }
function serviceKey(root) {
  const js = readFileSync(join(root, "dist/main.js"), "utf8")
  const match = js.match(/[$]service[(](".*?")/)
  assert.ok(match, "emitted service key missing")
  return JSON.parse(match[1])
}
function run(root) {
  writeFileSync(join(root, "run.mjs"), `import { Effect } from "effect"; import { probe } from "./dist/main.js"; const results = []; for (let i=0;i<3;i++) results.push(await Effect.runPromiseExit(probe())); console.log(JSON.stringify(results))`)
  return JSON.parse(command(process.execPath, ["run.mjs"], root))
}

test("--fix migrates a private tail resume and reaches a fixed point", { skip }, t => {
  const root = project(t, source)
  compile(native, root, "--fix", "--fix-vip-only")
  const fixed = readFileSync(join(root, "main.vibe"), "utf8")
  assert.match(fixed, /service\s+Ask/)
  assert.match(fixed, /provide Ask/)
  assert.doesNotMatch(fixed, /\bcontrol\s+(?:class\s+)?Ask\b|\bhandle\s+Ask[.]|\bresume\s*[(]/)
  assert.match(compile(native, root, "--fix", "--fix-vip-only"), /0 fixes in 0 files/)
})


test("--fix default mode migrates the supported service pattern", { skip }, t => {
  const root = project(t, source.replace('import { Effect } from "effect"\n', "").replace("Effect.Effect<number>", "number!!"))
  compile(native, root, "--fix")
  const fixed = readFileSync(join(root, "main.vibe"), "utf8")
  assert.match(fixed, /service\s+Ask/)
  assert.match(fixed, /provide Ask/)
  assert.doesNotMatch(fixed, /\bcontrol\s+(?:class\s+)?Ask\b|\bhandle\s+Ask[.]|\bresume\s*[(]/)
  assert.match(compile(native, root, "--fix"), /0 fixes in 0 files/)
})


test("--fix refuses the prototype operation without changing its source", { skip }, t => {
  const original = source.replaceAll("ask", "__proto__")
  const root = project(t, original)
  const result = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false", "--fix", "--fix-vip-only"], { cwd: root, encoding: "utf8", timeout: 120000 })
  assert.equal(result.error, undefined)
  const output = result.stdout + result.stderr
  if (result.status !== 0) assert.match(output, /error EK3501/)
  assert.match(output, /prototype behavior/)
  assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), original)
})

test("service migration preserves original declaration bytes and repeated Exit; stock TS 5.9.3 / Effect 4.1.0 twin", {
  skip: skip || (!baseline || !stockModules) && "set VIBELANG_RELIC_BASELINE_BINARY and RELIC_REFERENCE_NODE_MODULES for the required saved-base/reference proof"
}, t => {
  assert.equal(JSON.parse(readFileSync(join(stockModules, "typescript/package.json"))).version, "5.9.3")
  assert.equal(JSON.parse(readFileSync(join(stockModules, "effect/package.json"))).version, "4.1.0")
  for (const proof of [
    { params: "", bindings: "", result: "number", args: "", value: "6", expected: 6 },
    { params: "x: number", bindings: "x", result: "number", args: "4", value: "x + 2", expected: 6, legacyClass: true },
    { params: "x: number", bindings: "x", result: "number", args: "4", value: "x + 2", expected: 6 },
    { params: "x: string", bindings: "x", result: "boolean", args: '"deploy"', value: "true", expected: true },
    { params: "x: number, y: number", bindings: "x, y", result: "number", args: "4, 2", value: "x + y", expected: 6 },
    { params: "x: string", bindings: "x", result: "string", args: '"request"', value: "x", expected: "request" }
  ]) {
    const original = `import { Effect } from "effect"
control${proof.legacyClass ? " class" : ""} Ask { ask(${proof.params}): ${proof.result}!! }
export effect function probe(): Effect.Effect<${proof.result}> {
  try { return try Ask.ask(${proof.args}) } handle Ask.ask(${proof.bindings}) { return try resume(${proof.value}) }
}
`
    const root = project(t, original)
    compile(baseline, root)
    const beforeDts = readFileSync(join(root, "dist/main.d.ts"), "utf8")
    const beforeKey = serviceKey(root)
    const beforeExit = run(root)
    compile(native, root, "--fix", "--fix-vip-only")
    const migrated = readFileSync(join(root, "main.vibe"), "utf8")
    assert.match(migrated, /service\s+Ask/)
    assert.match(migrated, /provide Ask/)
    assert.doesNotMatch(migrated, /\bcontrol\s+(?:class\s+)?Ask\b|\bhandle\s+Ask[.]|\bresume\s*[(]/)
    assert.equal(serviceKey(root), beforeKey)
    assert.equal(readFileSync(join(root, "dist/main.d.ts"), "utf8"), beforeDts)
    assert.deepEqual(run(root), beforeExit)
    const twin = project(t, `import { Context, Effect } from "effect"
class Ask extends Context.Service<Ask, { ask(${proof.params}): Effect.Effect<${proof.result}> }>()("Ask") {}
export function probe(): Effect.Effect<${proof.result}> {
  return Effect.provideService(Effect.gen(function* () { return yield* (yield* Ask).ask(${proof.args}) }), Ask, { ask: (${proof.bindings}) => Effect.succeed(${proof.value}) })
}
`, stockModules, "ts")
    command(process.execPath, [join(stockModules, "typescript/bin/tsc"), "-p", "tsconfig.json"], twin)
    assert.equal(readFileSync(join(twin, "dist/main.d.ts"), "utf8"), beforeDts)
    assert.deepEqual(run(twin), beforeExit)
    assert.equal(beforeExit[0]._tag, "Success")
    assert.equal(beforeExit[0].value, proof.expected)
  }
})
