// run-seconds: 900
// rule-evidence: docs/design/vips/README.md#692b32295aeb086e
// rule-evidence: docs/design/vips/README.md#vibelang-improvement-proposals | [retirement-fixes.json](../retirement-fixes.json) registers diagnostic codes and input/expected-output case directories; the offline gate checks compiler severity changes and new or changed `.fail` error cases, runs the quick fix, compares its output and compiles again.
// Every registered witness goes through the gate's own verifyWitness with this
// build's compiler: the input reproduces its code, --fix applies that quick fix
// and writes exactly the registered output, and the output compiles again.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, "../../../..")
const { verifyWitness } = await import(path.join(repo, "docs/tools/retirement-gate.mjs"))
const compiler = process.env.VIBELANG_BINARY || path.join(repo, "typescript/built/local/tsc")
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "docs/design/retirement-fixes.json"), "utf8"))
// The gate links effect, @effect and the runtime from these paths under its root.
const root = fs.mkdtempSync(path.join(here, ".cache-root-"))
const modules = process.env.EFFECT_NODE_MODULES || path.join(repo, "experiments/node_modules")
fs.mkdirSync(path.join(root, "docs/tools/node_modules"), { recursive: true })
fs.mkdirSync(path.join(root, "packages"), { recursive: true })
for (const name of ["effect", "@effect"])
  if (fs.existsSync(path.join(modules, name))) fs.symlinkSync(path.join(modules, name), path.join(root, "docs/tools/node_modules", name))
fs.symlinkSync(process.env.VIBELANG_RUNTIME || path.join(repo, "packages/runtime"), path.join(root, "packages/runtime"))
const files = dir => fs.readdirSync(path.join(repo, dir), { recursive: true, withFileTypes: true })
  .filter(e => e.isFile()).map(e => path.relative(repo, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
  // Untracked declaration sidecars stay out, as the gate's jj snapshot leaves them out.
  .filter(p => !/\/(?:out|node_modules|\.cache[^/]*)\//.test(p) && !/\.d\.vibex?\.ts$/.test(p) && !/\.vibex?\..+\.d\.ts$/.test(p))
const failures = []
let witnesses = 0
try {
  for (const entry of manifest) {
    assert.match(entry.code, /^(?:EK|TS)\d{4,}$/)
    assert.ok(entry.cases.length > 0, entry.code)
    for (const witness of entry.cases) {
      const paths = [...files(witness.input), ...files(witness.output)].sort()
      const snapshot = { paths, read: p => fs.readFileSync(path.join(repo, p), "utf8") }
      witnesses++
      try { verifyWitness(entry.code, witness, snapshot, root, compiler) }
      catch (e) { failures.push(witness.input + ": " + e.message) }
    }
  }
} finally { fs.rmSync(root, { recursive: true, force: true }) }
assert.deepEqual(failures, [], failures.join("\n"))
assert.ok(witnesses >= 1)
console.log("every registered retirement witness reproduces its code, fixes to its registered output and compiles again")
