import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import { runChild } from "./child.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const runner = join(here, "preload-build.mjs")
const quote = "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."
const corpus = await Promise.all(["alchemy-test-owned-rolldown", "opencode-test-owned-esbuild"].map(async name =>
  JSON.parse(await readFile(new URL("./property-regressions/" + name + ".json", import.meta.url), "utf8"))))

test("bundler preloads retain the published native source contract", async () => {
  assert.ok((await readFile(SpecPath("007-tooling.md"), "utf8")).includes(quote))
})

async function fixture(t, item = corpus[0], value = item.answer) {
  const root = await mkdtemp(join(here, ".fixtures", "bundler-preload-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "src"))
  await writeFile(join(root, "package.json"), '{"type":"module","private":true}')
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
      strict: true, skipLibCheck: true, types: [], rootDir: ".", outDir: "dist", rewriteRelativeImportExtensions: true },
    include: ["src/*.vibe", "src/*.ts"]
  }))
  await writeFile(join(root, "src/entry.ts"), item.entry)
  await writeFile(join(root, "src/leaf.vibe"), item.source.replace("42", String(value)))
  return root
}

async function run(host, config, { preload = true, twice = false } = {}) {
  const flag = host === "bun" ? "--preload" : "--import"
  const entry = `vibelang-unplugin/${config.bundler}/register`
  const args = [...(preload ? [flag, entry] : []), ...(twice ? [flag, entry] : []), runner, JSON.stringify(config)]
  const result = await runChild(host === "bun" ? "bun" : process.execPath, args, {
    cwd: config.root, env: { ...process.env, VIBELANG_UNPLUGIN_DEBUG: "1" }
  })
  const line = result.stdout.trim().split("\n").at(-1)
  assert.ok(line?.startsWith("{"), result.output)
  return { ...JSON.parse(line), code: result.code, trace: result.stderr }
}

function succeeded(result, expected = [42]) {
  assert.equal(result.code, 0, result.trace + "\n" + result.message)
  assert.equal(result.ok, true)
  assert.deepEqual(result.answers, expected)
  assert.equal(result.callerIntact, true)
  assert.ok(result.calls >= 1, "the caller's plugin still ran")
}

for (const item of corpus) {
  for (const host of ["node"]) {
    test(item.key + ": unchanged " + host + " call fails before preload and passes after it", async t => {
      const root = await fixture(t, item)
      const without = await run(host, { root, bundler: item.bundler }, { preload: false })
      assert.equal(without.ok, false)
      assert.match(without.message, /parse|loader|Unexpected|Expected|PARSE_ERROR/i)
      succeeded(await run(host, { root, bundler: item.bundler }))
    })
    test(item.bundler + ": " + host + " retains an explicit native plugin and caller options", async t => {
      const root = await fixture(t, item)
      const result = await run(host, { root, bundler: item.bundler, explicit: true }, { twice: true })
      succeeded(result)
      assert.equal(result.calls, 1)
      assert.equal((result.trace.match(/registered .* source bundles/g) || []).length, 1)
    })
    test(item.bundler + ": " + host + " CommonJS require uses the native adapter", async t => {
      const root = await fixture(t, item)
      succeeded(await run(host, { root, bundler: item.bundler, access: "require" }))
    })
    test(item.bundler + ": " + host + " recovers after a source diagnostic", async t => {
      const root = await fixture(t, item)
      succeeded(await run(host, { root, bundler: item.bundler, mode: "recovery" }), [99])
    })
  }
}

test("Rolldown build() shortcut receives the native adapter", async t => {
  const root = await fixture(t)
  succeeded(await run("node", { root, bundler: "rolldown", mode: "shortcut" }))
})

test("Rolldown watch() retains its synchronous watcher API", async t => {
  const root = await fixture(t)
  succeeded(await run("node", { root, bundler: "rolldown", mode: "watch" }))
})

for (const host of ["node"]) {
  test("esbuild: " + host + " default import and rebuild context retain native loading", async t => {
    const root = await fixture(t)
    succeeded(await run(host, { root, bundler: "esbuild", access: "default", mode: "context" }), [42, 99])
  })
}

test("property: untouched bundle calls load native graphs across bundlers and APIs", async t => {
  await fc.assert(fc.asyncProperty(fc.record({
    bundler: fc.constantFrom("rolldown", "esbuild"),
    host: fc.constant("node"),
    access: fc.constantFrom("import", "require"),
    explicit: fc.boolean(), value: fc.integer({ min: 0, max: 100000 })
  }), async input => {
    const root = await fixture(t, corpus.find(item => item.bundler === input.bundler), input.value)
    succeeded(await run(input.host, { ...input, root }), [input.value])
  }), { seed: 110526, numRuns: 24, endOnFailure: true })
})
