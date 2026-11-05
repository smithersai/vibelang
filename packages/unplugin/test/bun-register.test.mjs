import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const here = fileURLToPath(new URL(".", import.meta.url))
const preload = process.env.VIBELANG_TEST_BUN_PRELOAD || "vibelang-unplugin/bun/register"
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-test-owned-bun-build.json", import.meta.url), "utf8"))

function fixture(t, files = {}) {
  const root = mkdtempSync(join(here, ".fixtures", "bun-register-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sources = {
    "package.json": '{"type":"module"}',
    "tsconfig.json": JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
        types: [], skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true },
      include: ["src/**/*"]
    }),
    "bunfig.toml": `preload = ["${preload}"]\n[test]\npreload = ["${preload}"]\n`,
    "src/leaf.vibe": "export const answer: number = 42\n",
    "src/entry.ts": 'export { answer } from "./leaf.vibe"\n',
    ...files
  }
  for (const [path, contents] of Object.entries(sources)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }
  return root
}

function run(root, args, extraEnv = {}) {
  const result = spawnSync("bun", args, { cwd: root, encoding: "utf8", timeout: 120000,
    env: { ...process.env, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), ...extraEnv } })
  assert.ifError(result.error)
  return result
}
function green(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
}

const execute = `
async function answer(options) {
  const result = await Bun.build({ entrypoints: ["./src/entry.ts"], target: "bun", ...options })
  if (!result.success) throw new Error(result.logs.map(String).join("\\n"))
  const file = "./out-" + Math.random().toString(36).slice(2) + ".mjs"
  await Bun.write(file, result.outputs[0])
  return (await import(file)).answer
}
`

test("bunfig preload loads runtime imports and unchanged test-owned Bun.build graphs", (t) => {
  const root = fixture(t, {
    ...corpus.files,
    "run.ts": 'import { answer } from "./src/leaf.vibe"; console.log(answer)\n',
    "bundle.test.ts": `import { expect, test } from "bun:test"
import { answer as runtimeAnswer } from "./src/leaf.vibe"
${execute}
test("native source in a test-owned graph", async () => {
  expect(runtimeAnswer).toBe(42)
  expect(await answer({})).toBe(42)
})\n`
  })
  green(run(root, ["run", "run.ts"]))
  const tested = run(root, ["test", "./bundle.test.ts", "--timeout", "60000"])
  green(tested)
  assert.match(tested.stderr + tested.stdout, /1 pass/)
})

test("Bun build preload keeps caller plugins, options and explicit VibeLang configuration", (t) => {
  const root = fixture(t, {
    "build.ts": `import assert from "node:assert/strict"
import vibelang from "vibelang-unplugin/bun"
${execute}
let setups = 0
const custom = { name: "custom", setup(build) { setups++; build.onLoad({ filter: /entry\\.ts$/ }, () => ({ contents: "export { answer } from './leaf.vibe'", loader: "ts" })) } }
const plugins = Object.freeze([custom])
const options = Object.freeze({ plugins, conditions: Object.freeze(["custom"]), minify: true })
assert.equal(await answer(options), 42)
assert.equal(setups, 1)
assert.equal(options.plugins, plugins)
assert.deepEqual(options.conditions, ["custom"])
const explicit = vibelang({ root: process.cwd() })
const original = explicit.setup
let explicitSetups = 0
explicit.setup = function(...args) { explicitSetups++; return original.apply(this, args) }
assert.equal(await answer({ plugins: [explicit, custom] }), 42)
assert.equal(explicitSetups, 1)
console.log("preserved")
`
  })
  const result = run(root, ["run", "build.ts"])
  green(result)
  assert.match(result.stdout, /preserved/)
})

test("each Bun build observes edits and a failed compile does not poison the next build", (t) => {
  const root = fixture(t, {
    "build.ts": `import assert from "node:assert/strict"
${execute}
assert.equal(await answer({}), 42)
await Bun.write("src/leaf.vibe", 'export const answer: number = "bad"\\n')
await assert.rejects(() => answer({}), (error) => error instanceof AggregateError && error.errors.some((entry) => /leaf\\.vibe.*TS2322/.test(entry.message)))
await Bun.write("src/leaf.vibe", "export const answer: number = 43\\n")
assert.equal(await answer({}), 43)
console.log("fresh")
`
  })
  const result = run(root, ["run", "build.ts"])
  green(result)
  assert.match(result.stdout, /fresh/)
})

test("preload leaves native in-memory builds, asset imports, externals and errors intact", (t) => {
  const root = fixture(t, {
    "asset.txt": "hello",
    "native.ts": 'import asset from "./asset.txt" with { type: "file" }; export default asset\n',
    "external.ts": 'import value from "absent-package"; export default value\n',
    "build.ts": `import assert from "node:assert/strict"
const memory = await Bun.build({ entrypoints: ["virtual.ts"], files: { "virtual.ts": "export const value = 7" }, target: "bun" })
assert.equal(memory.success, true)
const asset = await Bun.build({ entrypoints: ["native.ts"], target: "bun" })
assert.equal(asset.success, true)
const external = await Bun.build({ entrypoints: ["external.ts"], target: "bun", packages: "external" })
assert.equal(external.success, true)
assert.match(await external.outputs[0].text(), /absent-package/)
await assert.rejects(() => Bun.build({ entrypoints: ["missing.ts"] }))
console.log("native")
`
  })
  const result = run(root, ["run", "build.ts"])
  green(result)
  assert.match(result.stdout, /native/)
})

test("repeated preloads and named build imports install one adapter per build", (t) => {
  const root = fixture(t, {
    "build.ts": `import assert from "node:assert/strict"
import { build } from "bun"
const registered = Bun.build
await import("vibelang-unplugin/bun/register")
const url = import.meta.resolve("vibelang-unplugin/bun/register")
await import(url + "?again")
assert.equal(Bun.build, registered)
assert.equal(build, registered)
const result = await build({ entrypoints: ["src/entry.ts"], target: "bun" })
assert.equal(result.success, true)
console.log("once")
`
  })
  const result = run(root, ["run", "build.ts"])
  green(result)
  assert.match(result.stdout, /once/)
})

test("generated Bun graphs preserve constants across import spellings and concurrent builds", (t) => {
  fc.assert(fc.property(fc.array(fc.record({
    name: fc.constantFrom("leaf", "leaf space", "leaf-雪", "x+y"),
    value: fc.integer({ min: -1000, max: 1000 }),
    suffix: fc.constantFrom(".vibe", ".js", "")
  }), { minLength: 3, maxLength: 6 }), (cells) => {
  const files = {}
  const entries = cells.map((cell, i) => {
    files[`src/case${i}/${cell.name}.vibe`] = `export const answer: number = ${cell.value}\n`
    files[`src/case${i}/entry.ts`] = `export { answer } from ${JSON.stringify("./" + cell.name + cell.suffix)}\n`
    return { path: `src/case${i}/entry.ts`, expected: cell.value }
  })
  files["build.ts"] = `import assert from "node:assert/strict"
const entries = ${JSON.stringify(entries)}
for (let offset = 0; offset < entries.length; offset += 3) {
  await Promise.all(entries.slice(offset, offset + 3).map(async ({ path, expected }, i) => {
    const built = await Bun.build({ entrypoints: [path], target: "bun" })
    assert.equal(built.success, true)
    const file = "./generated-" + offset + "-" + i + ".mjs"
    await Bun.write(file, built.outputs[0])
    assert.equal((await import(file)).answer, expected)
  }))
}
console.log("graphs:" + entries.length)
`
  const root = fixture(t, files)
  const result = run(root, ["run", "build.ts"])
  green(result)
  assert.match(result.stdout, new RegExp("graphs:" + cells.length))
  }), { seed: 11052026, numRuns: 6 })
})
