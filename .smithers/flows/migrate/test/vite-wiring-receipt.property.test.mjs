import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { makeConfig, paths, plan } from "../lib/steps.mjs"
import { buildInventory } from "../lib/inventory.mjs"
import { wireViteApps } from "../lib/wire.mjs"
import { writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-plan-vite-config.json", import.meta.url)))
async function check({ name = "vite.config", ext = "ts", launcher = "", nested = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "migrate-vite-wired-receipt-"))
  try {
    const target = join(root, "repo"), run = join(root, "run"), dir = "packages/website"
    const file = dir + "/" + name + "." + ext
    mkdirSync(join(target, dir, "src"), { recursive: true })
    writeJson(join(target, "package.json"), { private: true, workspaces: ["packages/*"] })
    writeJson(join(target, dir, "package.json"), { name: "website", private: true, type: "module", scripts: { build: launcher + "vite build --config " + name + "." + ext } })
    writeFileSync(join(target, file), 'import { Effect } from "effect"\nimport { leaf } from "./src/leaf.ts"\nexport default { leaf }\n')
    writeFileSync(join(target, dir, "src/leaf.ts"), "export const leaf = 1\n")
    const packages = [{ dir, sources: ["src", "."], tsconfig: "tsconfig.json" }]
    const apps = wireViteApps({ root: target, packages, ts, specsFor: () => ({ vibelang: "0.0.11", "vibelang-vite": "0.0.11" }) })
    assert.ok(apps.nativeConfigs.includes(file), "actual wiring must produce the proof")
    assert.match(JSON.parse(readFileSync(join(target, dir, "package.json"))).scripts.build, /--configLoader native/)
    const config = makeConfig({ target, packages: [dir], test: "true", vibelangVersion: "0.0.11" })
    writeJson(paths(run).config, config)
    // setup() serializes wireTarget() under wired; wireTarget maps apps.nativeConfigs.
    const proof = { nativeViteConfigs: apps.nativeConfigs }
    writeJson(paths(run).setup, nested ? { wired: proof } : proof)
    const inventory = buildInventory({ root: target, packages: [{ dir, sources: ["."] }] })
    writeJson(paths(run).inventory, inventory)
    const answer = join(root, "answer.json")
    writeJson(answer, { batches: [{ files: [file], reason: "the loader is wired" }] })
    const result = await plan({ run, accept: answer })
    assert.equal(result.accepted, true)
    assert.ok(JSON.parse(readFileSync(paths(run).planDraft)).batches.some(batch => batch.files.includes(file)))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("foldkit-78: planning consumes setup's nested result from real Vite wiring", async () => {
  assert.equal(corpus.path, "packages/website/vite.config.ts")
  await check()
})
test("wired receipt shape, config spelling and Vite launcher preserve planner eligibility", async () => {
  // foldkit-41/78: native config loading permits a config only after its loader is wired.
  await fc.assert(fc.asyncProperty(fc.constantFrom("vite.config", "vite.prod.config"), fc.constantFrom("ts", "mts"),
    fc.constantFrom("", "pnpm exec ", "npx ", "bunx "), fc.boolean(),
    async (name, ext, launcher, nested) => check({ name, ext, launcher, nested })), { seed: 780032, numRuns: 120 })
})
