import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { bareRunnerDeferrals, scriptEntries } from "../lib/bare-runners.mjs"
import { buildInventory } from "../lib/inventory.mjs"
import { candidates, draftPlan, validatePlan } from "../lib/plan.mjs"
import { planScope } from "../lib/onepass.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-bare-runners.json", import.meta.url)))

function repository(files) {
  const root = mkdtempSync(join(tmpdir(), "bare-runners-"))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}
const sources = files => Object.keys(files).filter(file => /\.(?:ts|vibe)$/.test(file))
const packages = ["pkg", "tools", "app", "served", "ops"].map(name => ({ dir: "packages/" + name, sources: ["src", "scripts", "e2e"] }))

test("each runner with no loader keeps what it reaches TypeScript, by name, and only that", () => {
  const root = repository(corpus.files)
  try {
    const { deferred, entries } = bareRunnerDeferrals(root, sources(corpus.files))
    const files = deferred.map(d => d.file)
    for (const file of corpus.deferred) assert.ok(files.includes(file), file + " must stay TypeScript; deferred: " + files.join(", "))
    for (const file of corpus.migrates) assert.ok(!files.includes(file), file + " has no bare runner: " + JSON.stringify(deferred.find(d => d.file === file)))
    const reason = file => deferred.find(d => d.file === file).reason
    assert.match(reason("packages/pkg/src/Manifest.ts"), /node runs packages\/pkg\/src\/cli\/bin\.ts \(packages\/pkg\/package\.json bin pkg\)/)
    assert.match(reason("packages/tools/src/e2e/Target.ts"), /bun runs packages\/tools\/src\/e2e\/Cli\.ts \(packages\/app\/package\.json scripts\.dev\)/)
    assert.match(reason("packages/tools/src/e2e/Vite.ts"), /playwright runs/)
    assert.match(reason("packages/served/scripts/sync.ts"), /no step rewrites a script's path/)
    assert.ok(entries.some(e => e.runner === "playwright" && e.entry === "packages/app/playwright.config.ts"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a plan defers those modules, names why, and refuses to select one", () => {
  const root = repository(corpus.files)
  try {
    const inventory = buildInventory({ root, packages })
    assert.ok(inventory.bareRunners.entries.length > 0)
    const manifest = inventory.files.find(f => f.path === "packages/pkg/src/Manifest.ts")
    assert.match(manifest.bareRunReason, /stays TypeScript/)
    assert.ok(!candidates(inventory).some(f => f.path === manifest.path))
    assert.ok(candidates(inventory).some(f => f.path === "packages/pkg/src/Elsewhere.ts"))
    const draft = draftPlan(inventory)
    assert.ok(draft.deferred.some(d => d.file === manifest.path && /bin pkg/.test(d.reason)))
    const { errors } = validatePlan({ batches: [{ files: [manifest.path], reason: "x" }] }, inventory)
    assert.ok(errors.some(error => error.includes(manifest.path) && error.includes("stays TypeScript")), errors.join("\n"))
    const scope = planScope(root, [manifest.path, "packages/pkg/src/Elsewhere.ts"])
    assert.deepEqual(scope.batches[0].files, ["packages/pkg/src/Elsewhere.ts"])
    assert.ok(scope.deferred.some(d => d.file === manifest.path && /stays TypeScript/.test(d.reason)))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a module already .vibe under a bare runner is found", () => {
  const files = { ...corpus.files }
  files["packages/pkg/src/Manifest.vibe"] = files["packages/pkg/src/Manifest.ts"]
  delete files["packages/pkg/src/Manifest.ts"]
  const root = repository(files)
  try {
    const inventory = buildInventory({ root, packages })
    assert.ok(inventory.bareRunners.modules.includes("packages/pkg/src/Manifest.vibe"), inventory.bareRunners.modules.join(", "))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const file = fc.constantFrom("a.ts", "./scripts/b.ts", "../tools/src/C.mts", "scripts/d.js", "cli.cjs")
const env = fc.array(fc.constantFrom("CI=1", "NODE_ENV=test", "A_B=c"), { maxLength: 2 })
const cwd = fc.option(fc.constantFrom("packages/x", "../y"), { nil: undefined })
const prefix = fc.constantFrom("", "pnpm exec ", "npx ", "cross-env ")
const glue = fc.constantFrom(" && ", " ; ", " || ")
const before = fc.constantFrom("", "vibelang -b", "rm -rf dist")

test("a script's entry is found through its environment, directory and wrappers, and a loader marks it wired", () => {
  fc.assert(fc.property(env, cwd, prefix, glue, before, fc.constantFrom("node", "bun", "bun run", "tsx"), file, fc.boolean(), (vars, dir, wrap, join_, first, runner, entry, wired) => {
    const flag = !wired ? "" : runner.startsWith("bun") ? "--preload vibelang/bun " : "--import vibelang/register "
    const command = [...vars, wrap + runner + " " + flag + entry].join(" ")
    const script = [first, dir && "cd " + dir, command].filter(Boolean).join(join_)
    const found = scriptEntries(script)
    assert.equal(found.length, 1, script)
    assert.equal(found[0].file, entry, script)
    assert.equal(found[0].runner, runner.split(" ")[0], script)
    assert.equal(found[0].wired, wired, script)
    assert.equal(found[0].cwd, dir ?? ".", script)
  }))
})

test("what no bare runner loads stays out", () => {
  for (const script of ["bun test ./test", "bun install", "bun build src/a.ts", "bun run build", "bun alchemy deploy", "node --test", "node -e 'x'", "vitest run a.ts", "tsc -b", "bun x playwright test", "echo node a.ts ."]) {
    assert.deepEqual(scriptEntries(script), [], script)
  }
})

test("a type-only import, an emitted boundary or a served package reach nothing", () => {
  const files = {
    "package.json": JSON.stringify({ private: true, workspaces: ["a", "b", "c"] }),
    "a/package.json": JSON.stringify({ name: "a", bin: "./cli.ts", exports: { "./built": "./dist/built.js" } }),
    "a/cli.ts": 'import type { T } from "./types.ts"\nimport { built } from "b/built"\nexport type { T }\nexport { built }\n',
    "a/types.ts": 'import { Effect } from "effect"\nexport type T = Effect.Effect<1>\nexport const t = Effect.void\n',
    "b/package.json": JSON.stringify({ name: "b", exports: { "./built": "./dist/built.js" } }),
    "b/src/built.ts": 'import { Effect } from "effect"\nexport const built = Effect.void\n',
    "c/package.json": JSON.stringify({ name: "c", bin: "./cli.ts" }),
    "c/cli.ts": '#!/usr/bin/env bun\nimport { x } from "./x.ts"\nexport { x }\n',
    "c/x.ts": 'import { Effect } from "effect"\nexport const x = Effect.void\n',
    "c/bunfig.toml": 'preload = ["vibelang/bun"]\n',
  }
  const root = repository(files)
  try {
    const { deferred } = bareRunnerDeferrals(root, sources(files))
    assert.deepEqual(deferred.map(d => d.file), ["a/cli.ts"])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
