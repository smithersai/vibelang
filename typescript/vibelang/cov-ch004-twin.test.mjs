// Chapter 004 reference twin: the TypeScript 5.9.3 / Effect 4.1.0 cache install.
import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { installReference, assertReferenceTypes } from "./test/cov-ch004-twin.mjs"
import { loadTypeScript } from "../../scripts/api-identity.mjs"

function fakeInstall(prefix) {
  fs.mkdirSync(path.join(prefix, "node_modules/typescript"), { recursive: true })
  fs.writeFileSync(path.join(prefix, "node_modules/typescript/package.json"), '{"version":"5.9.3"}')
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cov-ch004-reference-test-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, cache: path.join(root, "cov-ch004-reference") }
}

test("a reference cache left without node_modules by an interrupted install is replaced", t => {
  const { root, cache } = fixture(t)
  fs.mkdirSync(cache)
  fs.writeFileSync(path.join(cache, "package.json"), "{}")
  let installs = 0
  assert.equal(installReference(cache, prefix => { installs++; fakeInstall(prefix) }), path.join(cache, "node_modules"))
  assert.equal(installs, 1)
  assert.ok(fs.existsSync(path.join(cache, "node_modules/typescript/package.json")))
  assert.deepEqual(fs.readdirSync(root), ["cov-ch004-reference"], "no staging copy stays behind")
})

test("an installed reference cache is reused without installing", t => {
  const { cache } = fixture(t)
  fakeInstall(cache)
  let installs = 0
  assert.equal(installReference(cache, () => { installs++ }), path.join(cache, "node_modules"))
  assert.equal(installs, 0)
})

test("a failing install leaves no staging copy and no cache", t => {
  const { root, cache } = fixture(t)
  assert.throws(() => installReference(cache, () => { throw new Error("npm failed") }), /npm failed/)
  assert.deepEqual(fs.readdirSync(root), [])
})


// VIP-27: "Compare the ordinary stock-`tsc` twin without adding generated
// tags to it." Only generated never contracts may be added to the output.
function declarations(t, before, after) {
  const { root } = fixture(t)
  for (const [side, source] of [["typescript/out", before], ["out", after]]) {
    fs.mkdirSync(path.join(root, side), { recursive: true })
    fs.writeFileSync(path.join(root, side, "main.d.ts"), source)
  }
  return root
}
test("chapter 004 comparison follows the current declaration identity rule", () => {
  const spec = fs.readFileSync(new URL("../../docs/design/src/001-functions.md", import.meta.url), "utf8")
  assert.ok(spec.includes("Compare the ordinary stock-`tsc` twin without adding generated tags to it."))
  assert.ok(spec.includes("the emitted declaration may add VIP-27’s generated `@throws {never}` contract where the twin has no authored throw contract"))
})
test("collection reference accepts generated contracts and rejects changed types or authored docs", t => {
  const ts = loadTypeScript()
  const signature = "export declare function read(s: Map<string, number>): Map<string, number>;"
  const native = "/** Reads the map. */\n" + signature
  const generated = "/** Reads the map.\n * @throws {never} */\n" + signature
  assert.doesNotThrow(() => assertReferenceTypes(ts, declarations(t, native, generated)))
  for (const changed of [
    generated.replaceAll("Map<string, number>", "Map<unknown, unknown>"),
    generated.replace("Reads the map.", "Different documentation."),
    generated.replace("@throws {never}", "@throws {unknown}"),
    generated.replace("@throws {never}", "@throws {never}\n * @deprecated added"),
  ]) {
    assert.throws(() => assertReferenceTypes(ts, declarations(t, native, changed)), /differences/)
  }
  assert.throws(() => assertReferenceTypes(ts, declarations(t,
    "/** @throws {unknown} */\n" + signature, "/** @throws {never} */\n" + signature)), /Doc-comment differences/)
})
test("collection reference property retains specialization under generated throw metadata", t => {
  const ts = loadTypeScript()
  const require = createRequire(new URL("../../docs/tools/package.json", import.meta.url))
  const fc = require("fast-check")
  fc.assert(fc.property(
    fc.constantFrom("Map<string, number>", "Map<number, string>", "Set<boolean>", "Set<string>"),
    fc.boolean(),
    (type, documented) => {
      const prose = documented ? "Reads this collection." : ""
      const before = (prose ? "/** " + prose + " */\n" : "") +
        "export declare function read(s: " + type + "): " + type + ";"
      const after = "/** " + prose + "\n * @throws {never} */\n" +
        "export declare function read(s: " + type + "): " + type + ";"
      assertReferenceTypes(ts, declarations(t, before, after))
      const erased = after.replaceAll(type, type.startsWith("Map") ? "Map<unknown, unknown>" : "Set<unknown>")
      assert.throws(() => assertReferenceTypes(ts, declarations(t, before, erased)), /Type differences/)
    }
  ), { numRuns: 8, seed: 70427 })
})

test("reference declaration comparison uses one pinned dependency environment", t => {
  const ts = loadTypeScript()
  const source = 'import type { Value } from "collection-reference"; export declare function read(): Value;'
  const dir = declarations(t, source, source.replace("export declare function", "/** @throws {never} */\nexport declare function"))
  const modules = path.join(dir, "reference/node_modules")
  function dependency(parent, version, property) {
    const root = path.join(parent, "collection-reference")
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(path.join(root, "package.json"),
      JSON.stringify({ name: "collection-reference", version, types: "index.d.ts" }))
    fs.writeFileSync(path.join(root, "index.d.ts"),
      "export interface Value { value: string }\ndeclare global { interface ReferenceAmbient { " + property + ": string } }")
  }
  dependency(modules, "1.0.0", "stock")
  dependency(path.join(dir, "node_modules"), "1.1.0", "runtime")
  dependency(path.join(dir, "typescript/node_modules"), "1.0.0", "stock")
  assert.doesNotThrow(() => assertReferenceTypes(ts, dir, modules))
})
