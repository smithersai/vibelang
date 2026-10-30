import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("../../", import.meta.url))
test("the shipped global throws inventory indexes overloads and input provenance", { timeout: 60000 }, async () => {
  const published = JSON.parse(readFileSync(new URL("../design/inventory/throws.json", import.meta.url), "utf8"))
  const { buildInventory } = await import("./throws-inventory.mjs")
  assert.deepEqual(published, buildInventory(root))
  assert.equal(published.coverage.effect_exports, false)
  assert.equal(published.effect_version, JSON.parse(readFileSync(new URL("../../packages/runtime/package.json", import.meta.url))).peerDependencies.effect)
  assert.ok(Object.keys(published.inputs.typescript_libs).length > 50)
  const parse = Object.values(published.modules.lib["JSON.parse"])
  assert.ok(parse.length >= 1)
  assert.equal(parse[0].own_throws, "SyntaxError")
  assert.ok(Object.keys(published.modules.lib["Array.reduce"]).length > 1)
  assert.ok(!JSON.stringify(published).includes(root))
})

test("unannotated signatures stay unknown and overloads keep their source provenance", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { buildInventory } = await import("./throws-inventory.mjs")
  const fixture = mkdtempSync(join(tmpdir(), "throws-inventory-"))
  try {
    const libs = join(fixture, "typescript/tsc/internal/bundled/libs")
    const table = join(fixture, "typescript/tsc/internal/vibelang")
    const runtime = join(fixture, "packages/runtime")
    for (const dir of [libs, table, runtime]) mkdirSync(dir, { recursive: true })
    writeFileSync(join(table, "globalthrows_table.go"), readFileSync(new URL("../../typescript/tsc/internal/vibelang/globalthrows_table.go", import.meta.url)))
    writeFileSync(join(runtime, "package.json"), JSON.stringify({ peerDependencies: { effect: "4.1.0" } }))
    const source = "interface JSON { parse(text: string): any; parse(text: number): any; make(): { (): number }; } declare function foreign(): void;"
    writeFileSync(join(libs, "lib.es5.d.ts"), source)
    const first = buildInventory(fixture)
    assert.equal(Object.keys(first.modules.lib["JSON.parse"]).length, 2)
    for (const record of Object.values(first.modules.lib["JSON.parse"])) {
      assert.equal(record.own_throws, "SyntaxError")
      assert.deepEqual(record.sources, ["lib.es5.d.ts"])
    }
    assert.equal(Object.values(first.modules.lib.foreign)[0].own_throws, "unknown")
    assert.ok(!("JSON.make()" in first.modules.lib))
    writeFileSync(join(libs, "lib.es5.d.ts"), source + "\n// changed upstream input\n")
    const edited = buildInventory(fixture)
    assert.deepEqual(first.modules, edited.modules)
    assert.notDeepEqual(first.inputs.typescript_libs, edited.inputs.typescript_libs)
    writeFileSync(join(runtime, "package.json"), JSON.stringify({ peerDependencies: { effect: "4.2.0" } }))
    assert.equal(buildInventory(fixture).effect_version, "4.2.0")
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("normal documentation generation and checking include the inventory", () => {
  const scripts = JSON.parse(readFileSync(new URL("../../.smithers/package.json", import.meta.url), "utf8")).scripts
  assert.ok(scripts["docs:generate"].includes("throws-inventory.mjs --write"))
  assert.ok(scripts["docs:check"].includes("throws-inventory.mjs --check"))
})
