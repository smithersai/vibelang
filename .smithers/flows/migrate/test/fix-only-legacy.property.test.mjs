import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { fixToFixedPoint } from "../lib/codemod.mjs"
import { fakeProjectFiles } from "./helpers/fake-project-files.mjs"

// alchemy-migration-legacy-fix-flags: a repository pinned to VibeLang 0.0.11
// migrates with a compiler older than --only. It rejects the flag (TS5023)
// and fixes nothing, and the round read as settled with no repairs, so every
// batch's ordinary fixes were lost. The round now reruns without --only; the
// defensive snapshot already puts back every nonselected source.

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-legacy-fix-only.json", import.meta.url), "utf8"))

test("TestFixOnlyLegacyQuoted", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes("further limits ordinary repairs"))
})

// A compiler that behaves as the pinned one: with legacy, --only is TS5023 and
// fixes nothing; otherwise it limits the run to the listed files. --fix
// rewrites each file it may touch that it has not rewritten yet.
function compiler(root, files, { legacy = true, rejects = "--only" } = {}) {
  const path = join(root, "fake-vibelang")
  writeFileSync(path, `#!/usr/bin/env node
${fakeProjectFiles(root)}const fs = require("node:fs"), nodePath = require("node:path")
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(join(root, "calls.log"))}, JSON.stringify(args) + "\\n")
const rejected = ${JSON.stringify(rejects)}
if (args.includes(rejected) && (rejected !== "--only" || ${legacy})) { console.log(${JSON.stringify(corpus.rejection)}.replace("--only", rejected)); process.exit(1) }
const at = args.indexOf("--only")
const only = at >= 0 ? new Set(fs.readFileSync(args[at + 1].slice(1), "utf8").split("\\n").filter(Boolean)) : null
let n = 0
for (const file of ${JSON.stringify(files)}) {
  if (only && !only.has(fs.realpathSync(nodePath.resolve(file)))) continue
  const text = fs.readFileSync(file, "utf8")
  if (text.includes("// fixed")) continue
  fs.writeFileSync(file, text + "// fixed\\n")
  console.log("vibelang --fix: " + file + ": 1 fix (prelude import ×1)")
  n++
}
console.log("vibelang --fix: " + n + " fixes in " + n + " files.")
`)
  chmodSync(path, 0o755)
  return path
}
const calls = (root) => readFileSync(join(root, "calls.log"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((args) => !args.includes("--listFilesOnly"))

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-fix-only-legacy-"))
  mkdirSync(join(root, "pkg/src"), { recursive: true })
  mkdirSync(join(root, "logs"))
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, "pkg", file), text)
  return root
}

test("a compiler without --only still repairs the batch's files only", async () => {
  const root = project(corpus.files)
  try {
    const files = Object.keys(corpus.files)
    const log = join(root, "logs/fix")
    const result = await fixToFixedPoint({ compiler: compiler(root, files), tsconfig: "tsconfig.json", cwd: join(root, "pkg"), root, only: corpus.selected.map((f) => "pkg/" + f), log })
    for (const file of files) {
      const text = readFileSync(join(root, "pkg", file), "utf8")
      if (corpus.selected.includes(file)) assert.equal(text, corpus.files[file] + "// fixed\n", file)
      else assert.equal(text, corpus.files[file], file + " stays as committed")
    }
    assert.deepEqual(Object.keys(result.byFile).sort(), corpus.selected.map((f) => "pkg/" + f).sort())
    assert.equal(result.settled, true)
    assert.equal(result.onlyUnsupported, true)
    const invocations = calls(root)
    assert.ok(invocations[0].includes("--only"), "the first run asks for the selection")
    assert.ok(invocations.slice(1).every((args) => !args.includes("--only")), "later runs leave out the flag the compiler rejected")
    assert.match(readFileSync(log + ".1.only-unsupported.log", "utf8"), /TS5023: Unknown compiler option '--only'/)
    assert.match(readFileSync(log + ".scope.log", "utf8"), /"stage":"only-unsupported"/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a compiler with --only runs with it every round and never reruns a round", async () => {
  const root = project(corpus.files)
  try {
    const files = Object.keys(corpus.files)
    const result = await fixToFixedPoint({ compiler: compiler(root, files, { legacy: false }), tsconfig: "tsconfig.json", cwd: join(root, "pkg"), root, only: corpus.selected.map((f) => "pkg/" + f) })
    assert.equal(result.onlyUnsupported, undefined)
    const invocations = calls(root)
    assert.equal(invocations.length, result.rounds.length)
    assert.ok(invocations.every((args) => args.includes("--only")))
    for (const file of corpus.selected) assert.equal(readFileSync(join(root, "pkg", file), "utf8"), corpus.files[file] + "// fixed\n")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("another rejected option is not read as a missing --only", async () => {
  const root = project(corpus.files)
  try {
    const files = Object.keys(corpus.files)
    const result = await fixToFixedPoint({ compiler: compiler(root, files, { rejects: "--singleThreaded" }), tsconfig: "tsconfig.json", cwd: join(root, "pkg"), root, only: corpus.selected.map((f) => "pkg/" + f) })
    assert.equal(result.onlyUnsupported, undefined)
    assert.equal(calls(root).length, result.rounds.length, "no rerun")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("without --only, any selection keeps every other source byte for byte", async () => {
  await fc.assert(fc.asyncProperty(
    fc.uniqueArray(fc.constantFrom("a", "b", "c", "d", "e"), { minLength: 1, maxLength: 5 }),
    fc.integer({ min: 1, max: 5 }),
    async (names, picked) => {
      const files = Object.fromEntries(names.map((name, i) => ["src/" + name + ".vibe", "export const " + name + " = " + i + "\n"]))
      const selected = names.slice(0, Math.min(picked, names.length)).map((name) => "src/" + name + ".vibe")
      const root = project(files)
      try {
        const result = await fixToFixedPoint({ compiler: compiler(root, Object.keys(files)), tsconfig: "tsconfig.json", cwd: join(root, "pkg"), root, only: selected.map((f) => "pkg/" + f) })
        for (const [file, text] of Object.entries(files)) {
          assert.equal(readFileSync(join(root, "pkg", file), "utf8"), selected.includes(file) ? text + "// fixed\n" : text, file)
        }
        assert.deepEqual(Object.keys(result.byFile).sort(), selected.map((f) => "pkg/" + f).sort())
        assert.deepEqual(result.restored, Object.keys(files).filter((f) => !selected.includes(f)).map((f) => "pkg/" + f).sort())
      } finally { rmSync(root, { recursive: true, force: true }) }
    }), { numRuns: 12, seed: 5023011 })
})
