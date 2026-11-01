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
// A renamed module's runtime target: its source for the loaders, its emitted
// JavaScript for consumers without one (opencode-32).
const runtime = (name, vibe) => vibe ? { "vibelang-source": "./src/" + name + ".vibe", default: "./.vibelang/js/src/" + name + ".js" } : "./src/" + name + ".ts"
const shapes = [
  (name, vibe) => vibe ? { types: "./src/" + name + ".d.vibe.ts", ...runtime(name, true) } : "./src/" + name + ".ts",
  (name, vibe) => ({ types: "./dist/" + name + ".d.ts", bun: runtime(name, vibe), default: "./dist/" + name + ".js" }),
  (name, vibe) => ({ import: { types: "./dist/" + name + ".d.ts", default: runtime(name, vibe) }, require: [runtime(name, vibe), "./fallback/" + name + ".cjs"] }),
  (name, vibe) => [runtime(name, vibe), { default: "./fallback/" + name + ".js" }],
  (name, vibe) => ({ types: "./src/" + name + (vibe ? ".d.vibe.ts" : ".ts"), import: runtime(name, vibe) })
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
  for (const file of ["opencode-export-pattern.json", "t3code-types-condition.json"]) {
    const corpus = JSON.parse(readFileSync(new URL("./corpus/" + file, import.meta.url), "utf8"))
    check(corpus.field, corpus.stem, shapes[corpus.shape], corpus)
  }
  fc.assert(fc.property(fc.constantFrom("exports", "imports"), stem,
    fc.integer({ min: 0, max: shapes.length - 1 }), (field, name, shape) => check(field, name, shapes[shape])),
    { seed: 350103, numRuns: 250 })
})

// Existing emitted-import aliases select source explicitly. That leaf must
// stay a string, including inside arrays, rather than acquire another condition.
// Spec: detail272 optionB keeps the native tool's default and source identity.
test("source conditions stay scalar and original defaults survive rename and revert", () => {
  fc.assert(fc.property(stem, fc.boolean(), fc.boolean(), (name, array, nested) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-source-condition-"))
    try {
      const source = "./src/" + name + ".ts"
      const before = {
        types: array ? [source, "./fallback.d.ts"] : source,
        "vibelang-source": array ? [source, "./fallback.vibe"] : source,
        default: "./dist/" + name + ".js"
      }
      const target = nested ? { development: before, default: "./unchanged.js" } : before
      const pkg = { name: "source-condition-repro", imports: { "#rule": target } }
      writeFileSync(join(root, "package.json"), JSON.stringify(pkg))
      const renames = [{ from: "src/" + name + ".ts", to: "src/" + name + ".vibe" }]
      const edits = rewriteExports(root, renames)
      const expected = {
        types: array ? ["./src/" + name + ".d.vibe.ts", "./fallback.d.ts"] : "./src/" + name + ".d.vibe.ts",
        "vibelang-source": array ? ["./src/" + name + ".vibe", "./fallback.vibe"] : "./src/" + name + ".vibe",
        default: "./dist/" + name + ".js"
      }
      const actual = JSON.parse(readFileSync(join(root, "package.json"))).imports["#rule"]
      assert.deepEqual(actual, nested ? { development: expected, default: "./unchanged.js" } : expected)
      const once = readFileSync(join(root, "package.json"), "utf8")
      rewriteExports(root, renames)
      assert.equal(readFileSync(join(root, "package.json"), "utf8"), once)
      restoreExports(root, edits, renames[0].from)
      assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"))), pkg)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 320069, numRuns: 100 })
})
