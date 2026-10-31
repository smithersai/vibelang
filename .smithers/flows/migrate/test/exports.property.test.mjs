import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { restoreExports, rewriteExports } from "../lib/codemod.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const quote = "points each package's `exports`, `imports`, `main`, `module` and `types` at the renamed modules"
const part = fc.stringMatching(/^[a-z][a-z0-9_-]{0,10}$/)
const stem = fc.array(part, { minLength: 1, maxLength: 3 }).map((parts) => "m-" + parts.join("/"))

// Describe the expected mappings directly; the oracle does not implement the
// codemod's recursive walk or wildcard matching algorithm.
const shapes = [
  (name, vibe) => "./src/" + name + (vibe ? ".vibe" : ".ts"),
  (name, vibe) => ({ types: "./dist/" + name + ".d.ts", bun: "./src/" + name + (vibe ? ".vibe" : ".ts"), default: "./dist/" + name + ".js" }),
  (name, vibe) => ({ import: { types: "./dist/" + name + ".d.ts", default: "./src/" + name + (vibe ? ".vibe" : ".ts") }, require: ["./src/" + name + (vibe ? ".vibe" : ".ts"), "./fallback/" + name + ".cjs"] }),
  (name, vibe) => ["./src/" + name + (vibe ? ".vibe" : ".ts"), { default: "./fallback/" + name + ".js" }]
]

function check(field, name, shape, corpus) {
  const root = mkdtempSync(join(tmpdir(), "migrate-exports-property-"))
  const packageDir = join(root, "packages", "sample")
  mkdirSync(packageDir, { recursive: true })
  const manifestFile = join(packageDir, "package.json")
  const pattern = field === "exports" ? "./*" : "#*"
  const exact = field === "exports" ? "./" + name : "#" + name
  const original = corpus?.manifest ?? { name: "sample", [field]: { [pattern]: shape("*", false) }, main: "./src/" + name + ".ts" }
  writeFileSync(manifestFile, JSON.stringify(original) + "\n")
  const from = corpus ? "packages/sample/" + corpus.renames[0].from : "packages/sample/src/" + name + ".ts"
  const to = corpus ? "packages/sample/" + corpus.renames[0].to : "packages/sample/src/" + name + ".vibe"
  try {
    const edits = rewriteExports(root, [{ from, to }])
    const after = JSON.parse(readFileSync(manifestFile, "utf8"))
    assert.deepEqual(after[field][exact], shape(name, true))
    assert.deepEqual(after[field][pattern], original[field][pattern], "unmigrated modules keep the original wildcard")
    assert.equal(after.main, original.main === undefined ? undefined : "./src/" + name + ".vibe")
    assert.deepEqual(rewriteExports(root, [{ from, to }]), [], "repeating the same migration is stable")
    restoreExports(root, edits, from)
    assert.deepEqual(JSON.parse(readFileSync(manifestFile, "utf8")), original, "reverting restores the original package map")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("opencode-3: migrating a wildcard export keeps package resolution and revert intact", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote), "update the quoted codemod contract")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-export-pattern.json", import.meta.url), "utf8"))
  check(corpus.field, corpus.stem, shapes[corpus.shape], corpus)
  fc.assert(fc.property(fc.constantFrom("exports", "imports"), stem,
    fc.integer({ min: 0, max: shapes.length - 1 }), (field, name, shape) => check(field, name, shapes[shape])),
    { seed: 350103, numRuns: 250 })
})
