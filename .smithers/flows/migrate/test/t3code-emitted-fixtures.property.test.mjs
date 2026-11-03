import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { verifyTestDiff } from "../lib/test-diff.mjs"
import { withPackingScope } from "../lib/pack-policy.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-emitted-fixture.json", import.meta.url)))
const proof = (file, text) => ({ file, sha256: createHash("sha256").update(text).digest("hex") })

test("t3code: exact emitted fixture receipts pass, real fixtures and changed output fail", () => {
  const scratch = mkdtempSync(join(tmpdir(), "t3code-emitted-fixture-"))
  try {
    const check = (before, after, generatedFiles) => verifyTestDiff({ ts, before, after, generatedFiles, renames: [], scratch })
    fc.assert(fc.property(fc.constantFrom(...corpus.files), fc.integer(), (file, n) => {
      const text = corpus.text.replace("1", String(n))
      const journal = JSON.parse(JSON.stringify(withPackingScope({ batch: "01", emittedJs: [{ generatedFiles: [proof(file, text)] }] }, [{ generatedFiles: [proof(file, text)] }])))
      assert.equal(check({}, { [file]: text }, journal.generatedFiles).ok, true)
      assert.equal(check({}, { [file]: text }, []).ok, false, "the path alone proves nothing")
      assert.equal(check({}, { [file]: text + "// edited" }, journal.generatedFiles).ok, false)
      assert.equal(check({ [file]: "// real fixture" }, { [file]: text }, journal.generatedFiles).ok, false)
      assert.equal(check({}, { [file + ".fixture.js"]: text }, journal.generatedFiles).ok, false)
      const updated = withPackingScope(journal, [{ generatedFiles: [proof(file, text + "// re-emitted")] }])
      assert.equal(check({}, { [file]: text }, updated.generatedFiles).ok, false)
      assert.equal(check({}, { [file]: text + "// re-emitted" }, updated.generatedFiles).ok, true)
      const restarted = JSON.parse(JSON.stringify(withPackingScope(updated, [])))
      assert.deepEqual(restarted.generatedFiles, updated.generatedFiles, "historical emit rows must not overwrite the latest digest after restart")
    }), { seed: 31104, numRuns: 100 })
  } finally { rmSync(scratch, { recursive: true, force: true }) }
})

test("emitter receipts survive the journal and verify actual pinned repository output", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs")
  const { dirname } = await import("node:path")
  const { emitPackageJs } = await import("../lib/declarations.mjs")
  const { testEdits, paths } = await import("../lib/steps.mjs")
  const { must } = await import("../lib/util.mjs")
  const root = mkdtempSync(join(tmpdir(), "t3code-emitted-repo-"))
  const target = join(root, "repo"), scratch = join(root, "run")
  mkdirSync(join(target, "src"), { recursive: true })
  try {
    writeFileSync(join(target, "package.json"), '{"private":true}\n')
    writeFileSync(join(target, ".gitignore"), "node_modules/\n")
    writeFileSync(join(target, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", skipLibCheck: true }, include: ["src/*.ts"] }))
    writeFileSync(join(target, "src/probeResponses.fixture.ts"), corpus.text)
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost && jj commit -m source", { cwd: target })
    const result = await emitPackageJs({ compiler: require.resolve("typescript/bin/tsc"), tsconfigs: ["tsconfig.json"], packageDir: target, root: target, log: join(scratch, "emit.log") })
    assert.equal(result.code, 0)
    assert.equal(result.generatedFiles.length, 1)
    const journal = JSON.parse(JSON.stringify(withPackingScope({ batch: "01" }, [result])))
    const p = paths(scratch)
    mkdirSync(dirname(p.codemod("01")), { recursive: true })
    writeFileSync(p.codemod("01"), JSON.stringify(journal))
    const config = { target, packages: [{ dir: "." }], test: { cwd: "." } }
    const plan = { batches: [{ files: ["src/probeResponses.fixture.ts"] }] }
    const check = () => testEdits(config, p, plan, "01", ts)
    assert.equal((await check()).ok, true)
    const file = join(target, result.generatedFiles[0].file)
    writeFileSync(file, readFileSync(file, "utf8") + "// tampered\n")
    assert.equal((await check()).ok, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
