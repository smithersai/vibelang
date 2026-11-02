// flowsync-t3code 13:20Z: fixToFixedPoint put an earlier batch's .vibe module
import { fakeProjectFiles } from "./helpers/fake-project-files.mjs"
// back only when --fix reported rewriting it. A write it did not report, or
// one a killed or failing compiler left behind, stayed in the target, so the
// batch's commit carried a change to a module an earlier batch had migrated.
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

const witness = JSON.parse(readFileSync(new URL("./corpus/t3code-protected-batch-write.json", import.meta.url), "utf8"))
const batch = "src/b.vibe"
const original = (file) => `// ${file}\nexport const v = 1\n`

/**
 * A target with the batch's module and `others`, earlier batches' modules,
 * and a fake compiler that applies `acts` ({ file, act }: "write" or
 * "delete"), reports `reported` of them, and then ends as `end` says.
 */
function target(t, others, acts, reported, end) {
  const root = mkdtempSync(join(tmpdir(), "migrate-protected-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "src"), { recursive: true })
  for (const file of [batch, ...others]) writeFileSync(join(root, file), original(file))
  const compiler = join(root, "fake-vibelang")
  writeFileSync(compiler, `#!/usr/bin/env node
${fakeProjectFiles(root)}const fs = require("node:fs")
fs.writeFileSync(${JSON.stringify(batch)}, "// fixed\\n")
for (const { file, act } of ${JSON.stringify(acts)}) act === "delete" ? fs.rmSync(file) : fs.writeFileSync(file, "half written")
for (const file of ${JSON.stringify(reported)}) console.log("vibelang --fix: " + file + ": 1 fix (EK4837 ×1)")
const end = ${JSON.stringify(end)}
if (end === "killed") process.kill(process.pid, "SIGKILL")
if (end === "crash") { console.error("panic: runtime error: index out of range"); process.exit(2) }
console.log("vibelang --fix: 0 fixes in 0 files.")
`)
  chmodSync(compiler, 0o755)
  return { root, run: () => fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: root, root, only: [batch] }) }
}

const assertOthersAsCommitted = (root, others) => {
  for (const file of others) assert.equal(existsSync(join(root, file)) && readFileSync(join(root, file), "utf8"), original(file), file)
}

test("an earlier batch's module --fix rewrote without reporting it gets its bytes back", async (t) => {
  const { root, run } = target(t, witness.others, witness.acts, witness.reported, witness.end)
  const result = await run()
  assertOthersAsCommitted(root, ["src/old.vibe"])
  assert.deepEqual(result.restored, ["src/old.vibe"])
  assert.equal(readFileSync(join(root, batch), "utf8"), "// fixed\n", "the batch's own module keeps its rewrite")
})

test("an earlier batch's module a killed compiler left half written gets its bytes back", async (t) => {
  const { root, run } = target(t, ["src/old.vibe"], [{ file: "src/old.vibe", act: "write" }], [], "killed")
  await assert.rejects(run(), /did not finish \(killed by SIGKILL/)
  assertOthersAsCommitted(root, ["src/old.vibe"])
})

test("an earlier batch's module a compiler deleted before it crashed comes back", async (t) => {
  const { root, run } = target(t, ["src/old.vibe"], [{ file: "src/old.vibe", act: "delete" }], [], "crash")
  await assert.rejects(run(), /did not finish \(exit 2/)
  assertOthersAsCommitted(root, ["src/old.vibe"])
})

test("however --fix ends, every earlier batch's module is as committed and the batch's module keeps its rewrite", async (t) => {
  const others = ["src/o1.vibe", "src/o2.vibe", "src/o3.vibe"]
  await fc.assert(fc.asyncProperty(
    fc.subarray(others), fc.subarray(others), fc.boolean(), fc.constantFrom("ok", "killed", "crash"),
    async (touched, reported, deletes, end) => {
      const acts = touched.map((file, i) => ({ file, act: deletes && i === 0 ? "delete" : "write" }))
      const { root, run } = target(t, others, acts, reported, end)
      if (end === "ok") {
        const result = await run()
        assert.deepEqual(result.restored, [...touched].sort())
        assert.deepEqual(result.byFile, {})
      } else await assert.rejects(run(), /did not finish/)
      assertOthersAsCommitted(root, others)
      assert.equal(readFileSync(join(root, batch), "utf8"), "// fixed\n")
    }
  ), { seed: 1101, numRuns: 30 })
})
