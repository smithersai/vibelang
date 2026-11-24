import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { buildInventory } from "../lib/inventory.mjs"
import { candidates } from "../lib/plan.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

const effect = 'import { Effect } from "effect"\nexport const x = Effect.void\n'
const inventoryOf = (files) => {
  const root = mkdtempSync(join(tmpdir(), "migrate-named-"))
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    return buildInventory({ root, packages: [{ dir: "pkg", sources: ["."] }] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// alchemy's packages/alchemy/src/Alchemist/Entrypoint.ts and examples/*/alchemy.run.ts, minimized.
const corpus = JSON.parse(readFileSync(new URL("corpus/alchemy-default-entrypoint.json", import.meta.url), "utf8"))
test("corpus alchemy-default-entrypoint: the default entrypoint stays .ts, its neighbour moves", () => {
  assert.deepEqual(candidates(inventoryOf(corpus.files)).map((f) => f.path), corpus.candidates)
})

const name = fc.constantFrom("alchemy.run", "stack.main", "entry", "worker")
const quote = fc.constantFrom('"', "'", "`")
const writer = fc.constantFrom("source", "test", "fixture", "path", "none")

test("a module is held back exactly when non-test code writes its bare file name", () => {
  fc.assert(fc.property(name, quote, writer, (base, q, who) => {
    const literal = { source: `${base}.ts`, test: `${base}.ts`, fixture: `${base}.ts`, path: `./x/${base}.ts`, none: "other.txt" }[who]
    const importer = who === "test" ? "pkg/test/cli.test.ts" : who === "fixture" ? "pkg/fixtures/cli.ts" : "pkg/cli.ts"
    const inventory = inventoryOf({ [`pkg/app/${base}.ts`]: effect, [importer]: `export const entry = ${q}${literal}${q}\n`, "pkg/lib.ts": effect })
    const paths = candidates(inventory).map((f) => f.path)
    assert.equal(paths.includes(`pkg/app/${base}.ts`), who !== "source")
    assert.ok(paths.includes("pkg/lib.ts"))
  }), { seed: 360036, numRuns: 300 })
})

test("issue 530: directory and module resolution, and an index file's name, do not pin index files", () => {
  const files = { "pkg/src/a/index.ts": effect, "pkg/cli.ts": "import \"index.ts\"; import \"./src/a\";\n" }
  assert.deepEqual(candidates(inventoryOf(files)).map(f => f.path), ["pkg/src/a/index.ts"])
  files["pkg/cli.ts"] = "export const entry = \"index.ts\"\nexport const match = (file: string) => file.endsWith(\"index.mts\")\n"
  assert.deepEqual(candidates(inventoryOf(files)).map(f => f.path), ["pkg/src/a/index.ts"])
})

const inventoryOfPackages = (files, packages) => {
  const root = mkdtempSync(join(tmpdir(), "migrate-named-"))
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    return buildInventory({ root, packages: packages.map(dir => ({ dir, sources: ["."] })) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("issue 530: a name pins files its writer's package or a dependent package can reach, or the directory it joins", () => {
  const files = {
    "tool/package.json": '{"name":"tool"}', "tool/cli.ts": 'export const entry = "types.ts"\n', "tool/types.ts": effect,
    "app/package.json": '{"name":"app","devDependencies":{"tool":"*"}}', "app/src/types.ts": effect,
    "other/package.json": '{"name":"other"}', "other/src/types.ts": effect
  }
  assert.deepEqual(candidates(inventoryOfPackages(files, ["tool", "app", "other"])).map(f => f.path), ["other/src/types.ts"])
  const joined = { "pkg/cli.ts": 'import { join } from "node:path"\nexport const worker = join(import.meta.dirname, "jobs", "worker.ts")\n', "pkg/jobs/worker.ts": effect, "pkg/worker.ts": effect }
  assert.deepEqual(candidates(inventoryOfPackages(joined, ["pkg"])).map(f => f.path), ["pkg/worker.ts"])
})
test("comments, embedded code strings, regexes and type-only filename literals are not lookups", () => {
  for (const source of ["// \"worker.ts\"\nexport const text = \"not a filename\"", "export const text = 'code: \"worker.ts\"'", "export const pattern = /\"worker.ts\"/", "export type Name = \"worker.ts\"", "export { name } from \"worker.ts\"", "export const module = import(\"worker.ts\")"]) assert.deepEqual(candidates(inventoryOf({ "pkg/worker.ts": effect, "pkg/cli.ts": source })).map(f => f.path), ["pkg/worker.ts"], source)
})

test("escaped filenames and filenames with spaces retain their source modules", () => {
  assert.deepEqual(candidates(inventoryOf({ "pkg/worker.ts": effect, "pkg/cli.ts": "export const entry = \"worker\\u002ets\"" })).map(f => f.path), [])
  assert.deepEqual(candidates(inventoryOf({ "pkg/my stack.ts": effect, "pkg/cli.ts": "export const entry = \"my stack.ts\"" })).map(f => f.path), [])
})
