import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { runChild } from "./child.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

test("Bun bundler routes retain the published native source contract", async () => {
  const spec = await readFile(SpecPath("007-tooling.md"), "utf8")
  assert.ok(spec.includes("Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."))
})

const bunVersion = spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout?.trim() ?? ""
const [major, minor, patch] = bunVersion.split(".").map(Number)
const supported = major > 1 || major === 1 && (minor > 4 || minor === 4 && patch >= 4)
const skip = !supported && "literal bundler import preloads need Bun 1.4.4 or later"

const here = fileURLToPath(new URL(".", import.meta.url))
const runner = join(here, "preload-build.mjs")
const corpora = await Promise.all(["alchemy-test-owned-rolldown", "opencode-test-owned-esbuild"].map(async name =>
  JSON.parse(await readFile(new URL("./property-regressions/" + name + ".json", import.meta.url), "utf8"))))

async function fixture(t, bundler, value = 42) {
  const root = await mkdtemp(join(here, ".fixtures", "bun-bundler-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "src"))
  await writeFile(join(root, "package.json"), '{"type":"module","private":true}')
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
      strict: true, skipLibCheck: true, types: [], rootDir: ".", outDir: "dist", rewriteRelativeImportExtensions: true },
    include: ["src/*.vibe", "src/*.ts"]
  }))
  const item = corpora.find(item => item.bundler === bundler)
  await writeFile(join(root, "src/entry.ts"), item.entry)
  await writeFile(join(root, "src/leaf.vibe"), item.source.replace("42", String(value)))
  return root
}

async function run(root, bundler, config = {}, { native = true, staticImport = false, runtimeFirst = false, both = false } = {}) {
  const driver = join(root, "driver.mjs")
  await writeFile(driver, [
    ...(staticImport ? [`import * as api from "${bundler}"; globalThis.__preloadTestAPI = api;`] : []),
    // A matching ordinary string remains unchanged by the source import route.
    `if ("${bundler}" !== ${JSON.stringify(bundler.slice(0, 2))} + ${JSON.stringify(bundler.slice(2))}) throw new Error("string changed");`,
    `await import(${JSON.stringify(runner)});`
  ].join("\n"))
  const args = [
    ...(runtimeFirst ? ["--preload", "vibelang/bun"] : []),
    "--preload", native ? `vibelang-unplugin/${bundler}/register` : "vibelang/bun",
    ...(both ? ["--preload", `vibelang-unplugin/${bundler === "rolldown" ? "esbuild" : "rolldown"}/register`] : []),
    driver, JSON.stringify({ root, bundler, ...config })
  ]
  const result = await runChild("bun", args, { cwd: root, env: { ...process.env, VIBELANG_UNPLUGIN_DEBUG: "1" } })
  const line = result.stdout.trim().split("\n").at(-1)
  assert.ok(line?.startsWith("{"), result.output)
  return { ...JSON.parse(line), code: result.code, trace: result.stderr }
}

function succeeded(result, expected = [42]) {
  assert.equal(result.code, 0, result.trace + "\n" + result.message)
  assert.deepEqual(result.answers, expected)
  assert.equal(result.callerIntact, true)
  assert.ok(result.calls > 0)
}

for (const bundler of ["rolldown", "esbuild"]) {
  test(`Bun ${bundler}: unchanged literal import fails with only the runtime loader and passes with the preload`, { skip }, async t => {
    const root = await fixture(t, bundler)
    const before = await run(root, bundler, {}, { native: false })
    assert.equal(before.ok, false)
    assert.match(before.message, /parse|loader|Unexpected|Expected|PARSE_ERROR/i)
    succeeded(await run(root, bundler))
  })
  test(`Bun ${bundler}: static namespace imports and explicit plugins retain caller behavior`, { skip }, async t => {
    const root = await fixture(t, bundler)
    succeeded(await run(root, bundler, { explicit: true }, { staticImport: true }))
  })
  test(`Bun ${bundler}: routes coexist with the existing runtime loader and both preloads`, { skip }, async t => {
    const root = await fixture(t, bundler)
    succeeded(await run(root, bundler, {}, { runtimeFirst: true, both: true }))
  })
  test(`Bun ${bundler}: diagnostic recovery preserves native compilation`, { skip }, async t => {
    const root = await fixture(t, bundler)
    succeeded(await run(root, bundler, { mode: "recovery" }), [99])
  })
}

test("property: Bun literal source imports retain values across bundlers and preload order", { skip }, async t => {
  await fc.assert(fc.asyncProperty(fc.record({
    bundler: fc.constantFrom("rolldown", "esbuild"), value: fc.integer({ min: 0, max: 100000 }),
    staticImport: fc.boolean(), runtimeFirst: fc.boolean(), both: fc.boolean(), explicit: fc.boolean()
  }), async input => {
    const root = await fixture(t, input.bundler, input.value)
    succeeded(await run(root, input.bundler, { explicit: input.explicit }, input), [input.value])
  }), { seed: 110527, numRuns: 24, endOnFailure: true })
})

test("Bun esbuild context rebuilds native sources after edits", { skip }, async t => {
  const root = await fixture(t, "esbuild")
  succeeded(await run(root, "esbuild", { mode: "context", access: "default" }), [42, 99])
})

test("Bun Rolldown keeps the synchronous watch API", { skip }, async t => {
  const root = await fixture(t, "rolldown")
  succeeded(await run(root, "rolldown", { mode: "watch" }))
})

test("Bun bundler registration reports unsupported runtimes before loading the caller", async t => {
  const root = await fixture(t, "rolldown")
  if (supported) succeeded(await run(root, "rolldown"))
  else await assert.rejects(run(root, "rolldown"), /Bundler register preloads need Bun 1\.4\.4 or later/)
})
