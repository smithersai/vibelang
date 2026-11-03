import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { batchSidecarLocator } from "../lib/steps.mjs"
import { pairedSidecar, verifyTestDiff } from "../lib/test-diff.mjs"
import { foreignChanges } from "../lib/touched.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-examples-sidecardir-batch.json", import.meta.url), "utf8"))
const scratch = mkdtempSync(join(tmpdir(), "migrate-sidecardir-"))
test.after(() => rmSync(scratch, { recursive: true, force: true }))
const located = (sidecar) => ({ files: corpus.files, codemod: corpus.codemod, sidecar })
const relocate = (path) => path.endsWith(".vibe") ? path.replace("src/", ".vibe/declarations/src/").replace(/\.vibe$/, ".d.vibe.ts") : null

test("foldkit-154: the batch's sidecar and its rewritten importer's are in scope under vibe.sidecarDir", () => {
  assert.deepEqual(foreignChanges(corpus.changed, located(relocate)), [])
  // Without the package's location both are foreign, as the receipt shows.
  assert.deepEqual(foreignChanges(corpus.changed, located(() => null)).map((c) => c.path).sort(), corpus.foreignWithoutLocation)
})

test("foldkit-154: setup relocating a fixture's sidecar is not a fixture rename", () => {
  const source = "export const a = 1\n"
  const before = { "e/src/main.fixture.vibe": source, "e/src/main.fixture.d.vibe.ts": "export declare const a = 1;\n" }
  const after = { "e/src/main.fixture.vibe": source, "e/.vibe/declarations/src/main.fixture.d.vibe.ts": "export declare const a = 1;\n" }
  const result = verifyTestDiff({ ts, before, after, renames: [], scratch })
  assert.deepEqual(result.files, [])
  assert.equal(result.ok, true)
})

test("an orphan sidecar is authored TypeScript, so a fixture keeps its protection", () => {
  for (const [before, after] of [
    [{ "e/fixtures/x.d.vibe.ts": "export {}\n" }, {}],
    [{}, { "e/fixtures/x.d.vibe.ts": "export {}\n" }],
    [{ "e/fixtures/x.d.vibe.ts": "export {}\n" }, { "e/fixtures/x.d.vibe.ts": "export declare const a: 1;\n" }],
  ]) {
    const result = verifyTestDiff({ ts, before, after, renames: [], scratch })
    assert.equal(result.ok, false, JSON.stringify(after))
  }
})

test("the fixture's source and every other fixture stay protected", () => {
  const before = { "e/src/main.fixture.vibe": "export const a = 1\n", "e/fixtures/data.json": "{}\n" }
  const after = { "e/src/main.fixture.vibe": "export const a = 2\n", "e/src/main.fixture.d.vibe.ts": "export declare const a = 2;\n", "e/fixtures/data.json": "{}\n" }
  const result = verifyTestDiff({ ts, before, after, renames: [], scratch })
  assert.equal(result.ok, false)
  assert.deepEqual(result.files.map((f) => f.file), ["e/src/main.fixture.vibe"])
})

const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,6}$/)
const stem = fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/") + ".fixture")

test("a sidecar is paired exactly when its source exists beside it or above its sidecar directory", () => {
  fc.assert(fc.property(fc.array(segment, { maxLength: 2 }), fc.constantFrom(".vibe/declarations", "types", "gen/types"), stem, fc.boolean(), (home, directory, name, exists) => {
    const root = home.length ? home.join("/") + "/" : ""
    const source = root + name + ".vibe"
    const tree = exists ? { [source]: null } : { [root + name + "-other.vibe"]: null }
    assert.equal(pairedSidecar(root + name + ".d.vibe.ts", tree), exists)
    assert.equal(pairedSidecar(root + directory + "/" + name + ".d.vibe.ts", tree), exists)
  }), { seed: 154154, numRuns: 300 })
  assert.equal(pairedSidecar("a/main.test.ts", { "a/main.test.vibe": null }), false)
})

test("foreign changes stay foreign under any sidecar location", () => {
  fc.assert(fc.property(stem, (name) => {
    const other = { status: "M", path: `.vibe/declarations/other/${name}.d.vibe.ts` }
    const batch = { files: [{ planned: "src/a.ts", path: "src/a.vibe" }], codemod: {}, sidecar: relocate }
    assert.deepEqual(foreignChanges([other], batch), [other])
  }), { seed: 154155, numRuns: 100 })
})

test("the locator reads each package's vibe.sidecarDir, and a package without one has none", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-sidecardir-"))
  try {
    mkdirSync(join(root, "a/src"), { recursive: true })
    mkdirSync(join(root, "b/src"), { recursive: true })
    mkdirSync(join(root, "node_modules"))
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(root, "node_modules/typescript"))
    writeFileSync(join(root, "a/tsconfig.json"), JSON.stringify({ vibe: { sidecarDir: ".vibe/declarations" } }))
    writeFileSync(join(root, "b/tsconfig.json"), "{}")
    const locate = batchSidecarLocator({ target: root, packages: [{ dir: "." }, { dir: "a" }, { dir: "b" }] })
    assert.equal(locate("a/src/main.vibe"), "a/.vibe/declarations/src/main.d.vibe.ts")
    assert.equal(locate("b/src/main.vibe"), "b/src/main.d.vibe.ts")
    assert.equal(locate("a/src/main.ts"), "a/.vibe/declarations/src/main.d.vibe.ts")
    assert.equal(locate("a/src/main.d.ts"), null)
    assert.equal(locate("a/package.json"), null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
