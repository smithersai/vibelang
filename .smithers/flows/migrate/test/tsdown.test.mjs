import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-tsdown-config-factory.json", import.meta.url), "utf8"))

test("alchemy: setup wires every tsdown config, including the local worker factory", () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-tsdown-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, scripts: { build: "tsdown" } }))
    writeFileSync(join(root, corpus.file), corpus.source)
    const config = { root, ts, specsFor: () => ({ vibelang: "0.0.11", "vibelang-unplugin": "0.0.11" }) }
    wireDeveloperTools(config)
    const after = readFileSync(join(root, corpus.file), "utf8")
    assert.match(after, /vibelang-unplugin\/rolldown/)
    assert.equal((after.match(/vibelang\(\)/g) ?? []).length, corpus.configs)
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).devDependencies["vibelang-unplugin"], "0.0.11")
    assert.deepEqual(wireDeveloperTools(config).changed, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("setup keeps test and fixture configs unchanged and retains a runtime dependency's field", () => {
  const root = mkdtempSync(join(tmpdir(), "tsdown-owned-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { "vibelang-unplugin": "old" } }))
    writeFileSync(join(root, "tsdown.config.ts"), corpus.source)
    for (const dir of ["test", "fixtures", "test-fixtures"]) {
      mkdirSync(join(root, dir))
      writeFileSync(join(root, dir, "tsdown.config.ts"), corpus.source)
    }
    const result = wireDeveloperTools({ root, ts, specsFor: () => ({ "vibelang-unplugin": "0.0.11" }) })
    assert.ok(result.changed.includes("tsdown.config.ts"))
    const manifest = JSON.parse(readFileSync(join(root, "package.json")))
    assert.equal(manifest.dependencies["vibelang-unplugin"], "0.0.11")
    assert.equal(manifest.devDependencies, undefined)
    for (const dir of ["test", "fixtures", "test-fixtures"]) assert.equal(readFileSync(join(root, dir, "tsdown.config.ts"), "utf8"), corpus.source)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
