import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { renameBatch, rewriteImports } from "../lib/codemod.mjs"

const put = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

// Smithers swebench: .mjs scripts kept ../../../src/Monitor.ts after Monitor
// became .vibe, and swebench:lint failed import/no-unresolved.
test("smithers swebench: a JavaScript script's import of a renamed module's source follows it, and nothing else in it changes", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-mjs-importer.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "migrate-mjs-"))
  try {
    for (const [path, text] of Object.entries(corpus.files)) put(root, path, text)
    const renames = renameBatch(root, corpus.batch)
    const scope = Object.keys(corpus.files).map((f) => (corpus.batch.includes(f) ? f.replace(/\.ts$/, ".vibe") : f))
    const edits = rewriteImports(root, scope, renames.map((r) => r.to))
    assert.deepEqual(edits.map((e) => `${e.file}: ${e.from} -> ${e.to}`), corpus.expected)
    const script = readFileSync(join(root, "packages/swebench/scripts/eval/run.mjs"), "utf8")
    assert.equal(script, corpus.files["packages/swebench/scripts/eval/run.mjs"].replace("Monitor.ts", "Monitor.vibe"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a JavaScript importer keeps a .js, .mjs or extensionless specifier even where a .ts file of that name is renamed", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-mjs-"))
  try {
    const files = {
      "src/a.ts": "export const a = 1\n",
      "scripts/x.mjs": 'import { a } from "../src/a.js"\nimport b from "../src/a"\nconst c = await import("../src/a.ts")\nexport { a, b, c }\n',
      "scripts/y.ts": 'import { a } from "../src/a.js"\nexport { a }\n'
    }
    for (const [path, text] of Object.entries(files)) put(root, path, text)
    renameBatch(root, ["src/a.ts"])
    const edits = rewriteImports(root, ["src/a.vibe", "scripts/x.mjs", "scripts/y.ts"], ["src/a.vibe"])
    assert.deepEqual(edits.map((e) => `${e.file}: ${e.from} -> ${e.to}`), ["scripts/x.mjs: ../src/a.ts -> ../src/a.vibe", "scripts/y.ts: ../src/a.js -> ../src/a.vibe"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
