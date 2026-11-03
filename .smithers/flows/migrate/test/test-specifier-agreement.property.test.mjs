import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { rewriteImports } from "../lib/codemod.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
import { verifyTestDiff } from "../lib/test-diff.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-examples-extensionless-test.json", import.meta.url), "utf8"))

/** Runs the codemod over files, returning what it wrote and its edits. */
function rewrite(files, moved) {
  const root = mkdtempSync(join(tmpdir(), "migrate-test-specifier-"))
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const edits = rewriteImports(root, Object.keys(files), moved)
    return { edits, files: Object.fromEntries(Object.keys(files).map((file) => [file, readFileSync(join(root, file), "utf8")])) }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("foldkit-155: the codemod and the test-diff agree on a test's extensionless import", () => {
  const scratch = mkdtempSync(join(tmpdir(), "migrate-test-specifier-"))
  try {
    const files = { "src/main.vibe": corpus.module, "src/scene.test.ts": corpus.test }
    const { edits, files: after } = rewrite(files, ["src/main.vibe"])
    assert.deepEqual(edits, [], "detail 272: extensionless specifiers need no edit")
    assert.equal(after["src/scene.test.ts"], corpus.test)
    const before = { "src/main.ts": corpus.module, "src/scene.test.ts": corpus.test }
    const verdict = verifyTestDiff({ ts, before, after, renames: [{ from: "src/main.ts", to: "src/main.vibe" }], scratch })
    assert.equal(verdict.ok, true)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
})

const shape = fc.constantFrom(
  (s) => `import { a } from ${s}\n`,
  (s) => `export { a } from ${s}\n`,
  (s) => `import ${s}\n`,
  (s) => `const m = await import(${s})\n`,
  (s) => `vi.mock(${s})\n`,
)
const place = fc.constantFrom(["src/a.test.ts", "./target"], ["test/a.ts", "../src/target"], ["src/__tests__/a.ts", "../target"], ["src/fixtures/a.ts", "../target"], ["src/snapshots/a.ts", "../target"])

test("no protected file's extensionless specifier changes, whatever its form", () => {
  fc.assert(fc.property(shape, place, fc.constantFrom('"', "'"), (write, [file, specifier], quote) => {
    const text = write(quote + specifier + quote)
    const { edits, files } = rewrite({ "src/target.vibe": "export const a = 1\n", [file]: text }, ["src/target.vibe"])
    assert.deepEqual(edits, [], text)
    assert.equal(files[file], text)
  }), { seed: 155155, numRuns: 150 })
})

test("a protected file's written extension still takes the allowed rename", () => {
  for (const [from, to] of [["./target.ts", "./target.vibe"], ["./target.js", "./target.vibe"]]) {
    const { edits } = rewrite({ "src/target.vibe": "export const a = 1\n", "src/a.test.ts": `import { a } from "${from}"\n` }, ["src/target.vibe"])
    assert.deepEqual(edits, [{ file: "src/a.test.ts", from, to }])
  }
})

test("a source file's extensionless import is still rewritten for stock TypeScript", () => {
  const { edits } = rewrite({ "src/target.vibe": "export const a = 1\n", "src/use.ts": 'import { a } from "./target"\n' }, ["src/target.vibe"])
  assert.deepEqual(edits, [{ file: "src/use.ts", from: "./target", to: "./target.vibe" }])
})

test("Bun's mock.module keeps its rewrite, so the verifier refuses it instead of the mock silently not applying", () => {
  const scratch = mkdtempSync(join(tmpdir(), "migrate-test-specifier-"))
  try {
    const test = 'import { mock } from "bun:test"\nmock.module("./target", () => ({}))\n'
    const { edits, files } = rewrite({ "src/target.vibe": "export const a = 1\n", "src/a.test.ts": test }, ["src/target.vibe"])
    assert.deepEqual(edits, [{ file: "src/a.test.ts", from: "./target", to: "./target.vibe" }])
    const verdict = verifyTestDiff({ ts, before: { "src/target.ts": "export const a = 1\n", "src/a.test.ts": test }, after: files, renames: [{ from: "src/target.ts", to: "src/target.vibe" }], scratch })
    assert.equal(verdict.ok, false)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
})
