import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import fc from "fast-check"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const runner = join(here, "bun-cwd-build.mjs")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-bun-compiler-root.json", import.meta.url), "utf8"))
const rule = "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."

test("Bun entry roots quote the source interoperability contract", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(rule))
})

function fixture(t, { name = "leaf", value = 42, decoy = -19, kind = "vibe", project = "tsconfig.json" } = {}) {
  const root = mkdtempSync(join(here, ".fixtures", "bun-cwd-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cwd = join(root, "app with spaces")
  mkdirSync(cwd)
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, project), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
      strict: true, types: [], skipLibCheck: true, rewriteRelativeImportExtensions: true },
    include: ["**/*.vibe", "**/*.ts"]
  }))
  const entry = name + "." + kind
  writeFileSync(join(root, entry), `export const answer: number = ${decoy}\n`)
  writeFileSync(join(cwd, entry), `export const answer: number = ${value}\n`)
  return { root, cwd, entry }
}

function run(cwd, entry, options = {}) {
  const result = spawnSync("bun", [runner, JSON.stringify({ entrypoints: [entry], options })], {
    cwd, encoding: "utf8", timeout: 120000,
    env: { ...process.env, VIBELANG_CACHE_DIR: join(cwd, ".cache"), VIBELANG_UNPLUGIN_DEBUG: "1" }
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1))
  assert.equal(parsed.cwdUnchanged, true)
  assert.equal(parsed.ok, true)
  return parsed
}

test(corpus.key, t => {
  const f = fixture(t, corpus)
  assert.equal(run(f.cwd, "./" + f.entry, { root: f.root }).answer, corpus.value)
})

test("an absolute Bun native entry retains its project root", t => {
  const f = fixture(t)
  assert.equal(run(f.cwd, join(f.cwd, f.entry), { root: f.root }).answer, 42)
})

test("a native TypeScript Bun entry retains the caller directory", t => {
  const f = fixture(t, { kind: "ts" })
  assert.equal(run(f.cwd, "./" + f.entry, { root: f.root }).answer, 42)
})

test("Bun's default compiler root remains the caller directory", t => {
  const f = fixture(t)
  assert.equal(run(f.cwd, "./" + f.entry).answer, 42)
})

test("a relative Bun entry uses the explicit custom compiler project", t => {
  const f = fixture(t, { project: "tsconfig.bundle.json" })
  assert.equal(run(f.cwd, "./" + f.entry, { root: f.root, project: "tsconfig.bundle.json" }).answer, 42)
})

test("generated Bun entry names and compiler roots preserve the selected graph", t => {
  fc.assert(fc.property(fc.record({
    name: fc.constantFrom("leaf", "leaf space", "leaf-雪", "x+y"),
    value: fc.integer({ min: 0, max: 10000 }),
    absolute: fc.boolean(), dotted: fc.boolean(),
    project: fc.constantFrom("tsconfig.json", "tsconfig.bundle.json")
  }), input => {
    const f = fixture(t, input)
    const root = input.dotted ? join(f.root, "app with spaces", "..") + "/." : f.root
    const entry = input.absolute ? join(f.cwd, f.entry) : "./" + f.entry
    assert.equal(run(f.cwd, entry, { root, project: input.project }).answer, input.value)
  }), { seed: 20261105, numRuns: 12 })
})
