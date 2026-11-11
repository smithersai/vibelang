import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import { runChild } from "./child.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const runner = join(here, "rolldown-cwd-build.mjs")
const corpus = JSON.parse(await readFile(new URL("./property-regressions/alchemy-rolldown-cwd.json", import.meta.url), "utf8"))
const rule = "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."

test("Rolldown cwd coverage quotes the source interoperability contract", async () => {
  assert.ok((await readFile(SpecPath("007-tooling.md"), "utf8")).includes(rule))
})

// Rolldown InputOptions.cwd: "The working directory to use when resolving
// relative paths in the configuration."
// https://rolldown.rs/reference/Interface.InputOptions#cwd
async function fixture(t, project = "tsconfig.json", value = 42) {
  const parent = await mkdtemp(join(here, ".fixtures", "rolldown-cwd-"))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const put = async (root, file, source) => {
    await mkdir(join(root, file, ".."), { recursive: true })
    await writeFile(join(root, file), source)
  }
  const config = {
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
      strict: true, skipLibCheck: true, types: [], rootDir: ".", outDir: "dist",
      rewriteRelativeImportExtensions: true },
    include: ["src/*.vibe", "src/*.ts"]
  }
  const root = join(parent, "app with spaces")
  const driver = join(parent, "driver")
  for (const [directory, answer] of [[root, value], [driver, -1]]) {
    await put(directory, "package.json", '{"private":true,"type":"module"}')
    await put(directory, project, JSON.stringify(config))
    await put(directory, "src/leaf.vibe", `export const answer: number = ${answer}\n`)
    await put(directory, "src/entry.ts", 'export { answer } from "./leaf.vibe"\n')
  }
  return { root, driver, put }
}

function request(root, driver, { kind = "vibe", shape = "string", project = "tsconfig.json", dottedCwd = false, options = {} } = {}) {
  const entry = kind === "vibe" ? "src/leaf.vibe" : "src/entry.ts"
  return {
    cwd: dottedCwd ? root + "/../app with spaces/." : root,
    input: shape === "array" ? [entry] : shape === "named" ? { named: entry } : entry,
    options: { ...(project === "tsconfig.json" ? {} : { project }), ...options }
  }
}

async function run(driver, requests) {
  const result = await runChild(process.execPath, [runner, JSON.stringify(requests)], {
    cwd: driver, env: { ...process.env, VIBELANG_UNPLUGIN_DEBUG: "1" }
  })
  assert.equal(result.code, 0, result.output)
  const response = JSON.parse(result.stdout.trim().split("\n").at(-1))
  assert.equal(response.cwdUnchanged, true)
  return response.results
}

function succeeds(result, root, value = 42) {
  assert.equal(result.ok, true, result.message)
  assert.equal(result.answer, value, "the bundle must use the selected source graph, not the caller's same-named entry")
  assert.ok(result.modules.includes(join(root, "src/leaf.vibe")), JSON.stringify(result.modules))
  const index = result.map.sources.findIndex(source => (source === "leaf.vibe" || source.endsWith("/leaf.vibe")))
  assert.ok(index >= 0, "source maps name the original native module")
  assert.equal(result.map.sourcesContent[index], `export const answer: number = ${value}\n`)
}

for (const kind of ["vibe", "ts"]) {
  for (const shape of ["string", "array", "named"]) {
    test(`Rolldown cwd resolves a relative ${kind} entry in a ${shape} input`, async t => {
      const { root, driver } = await fixture(t)
      const [result] = await run(driver, [request(root, driver, { kind, shape })])
      succeeds(result, root)
    })
  }
}

test(corpus.key, async t => {
  const { root, driver } = await fixture(t, corpus.input.project, corpus.input.value)
  const [result] = await run(driver, [request(root, driver, corpus.input)])
  succeeds(result, root, corpus.input.value)
})

test("Rolldown cwd compiles an absolute entry with its custom project", async t => {
  const project = "tsconfig.bundle.json"
  const { root, driver } = await fixture(t, project)
  const config = request(root, driver, { project })
  config.input = join(root, "src/leaf.vibe")
  succeeds((await run(driver, [config]))[0], root)
})

test("an explicit plugin root selects the project without changing Rolldown's entry base", async t => {
  const { root, driver, put } = await fixture(t)
  await put(root, "leaf.vibe", "export const answer: number = -19\n")
  const config = request(root, driver, { options: { root } })
  config.cwd = join(root, "src")
  config.input = "leaf.vibe"
  succeeds((await run(driver, [config]))[0], root)
})

test("Rolldown's default cwd remains the process directory", async t => {
  const { driver } = await fixture(t)
  const config = request(driver, driver)
  delete config.cwd
  succeeds((await run(driver, [config]))[0], driver, -1)
})

test("concurrent Rolldown builds retain independent roots", async t => {
  const first = await fixture(t, "tsconfig.bundle.json", 17)
  const second = await fixture(t, "tsconfig.bundle.json", 29)
  const results = await run(first.driver, [
    request(first.root, first.driver, { project: "tsconfig.bundle.json" }),
    request(second.root, first.driver, { project: "tsconfig.bundle.json", dottedCwd: true })
  ])
  succeeds(results[0], first.root, 17)
  succeeds(results[1], second.root, 29)
})

test("a custom project reports its source diagnostic rather than compiling the default project", async t => {
  const { root, driver, put } = await fixture(t, "tsconfig.bundle.json")
  await put(root, "tsconfig.json", JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: false, skipLibCheck: true, types: [] },
    include: ["src/*.vibe"]
  }))
  await put(root, "src/leaf.vibe", "export function answer(value) { return value }\n")
  const config = request(root, driver, { project: "tsconfig.bundle.json" })
  config.input = join(root, "src/leaf.vibe")
  const [result] = await run(driver, [config])
  assert.equal(result.ok, false)
  assert.match(result.message, /leaf\.vibe:1:\d+ - error TS7006/)
})

test("property: source graphs keep their cwd, entry shape, custom project and value", async t => {
  await fc.assert(fc.asyncProperty(fc.record({
    kind: fc.constantFrom("vibe", "ts"),
    shape: fc.constantFrom("string", "array", "named"),
    project: fc.constantFrom("tsconfig.json", "tsconfig.bundle.json"),
    dottedCwd: fc.boolean(),
    value: fc.integer({ min: 0, max: 100000 })
  }), async input => {
    const { root, driver } = await fixture(t, input.project, input.value)
    succeeds((await run(driver, [request(root, driver, input)]))[0], root, input.value)
  }), { seed: 20261105, numRuns: 24, endOnFailure: true })
})

// VIP-30: "In a directory, VibeLang reads the first that exists:
// `vibe.config.json`, then `tsconfig.json`, then `jsconfig.json`." With no
// project option the plugin selects the root's config in that order.
for (const name of ["vibe.config.json", "jsconfig.json"]) {
  test(`Rolldown selects the root's ${name} when no project option names one`, async t => {
    const { root, driver } = await fixture(t, name)
    const [result] = await run(driver, [{ ...request(root, driver), options: {} }])
    succeeds(result, root)
  })
}
