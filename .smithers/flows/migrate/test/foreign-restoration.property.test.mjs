import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-interrupted-foreign-restore.json", import.meta.url), "utf8"))
const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

async function check(input) {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
  const root = mkdtempSync(join(tmpdir(), "migrate-foreign-restoration-"))
  try {
    const selected = "selected/batch.vibe", original = "export const selected = 1\n"
    const files = { [selected]: original }
    for (let i = 0; i < input.count; i++) {
      const file = ["earlier", ...Array.from({ length: input.depth }, (_, n) => "d" + n), "source" + i + ".vibe"].join("/")
      files[file] = "// original " + i + "\nexport const retained" + i + " = " + i + "\n"
    }
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const compiler = join(root, "compiler")
    const reportForeign = input.outcome === "success" || input.outcome === "diagnostic" || input.report
    const program = [
      '#!/usr/bin/env node',
      'const fs = require("node:fs"), path = require("node:path")',
      'const root = ' + JSON.stringify(root),
      'if (process.argv.includes("--listFilesOnly")) { for (const file of ' + JSON.stringify(Object.keys(files)) + ') fs.writeSync(1, path.join(root, file) + String.fromCharCode(10)); process.exit(0) }',
      'for (const [file, text] of Object.entries(' + JSON.stringify(files) + ')) {',
      ' fs.writeFileSync(path.join(root, file), text + "// verified fix\\n")',
      ' if (file === ' + JSON.stringify(selected) + ' || ' + JSON.stringify(reportForeign) + ') fs.writeSync(1, "vibelang --fix: " + path.relative(process.cwd(), path.join(root,file)) + ": 1 fix (prelude import ×1)\\n")',
      '}',
      input.outcome === "diagnostic" ? 'fs.writeSync(1, "batch.vibe(1,1): error TS2322: Type mismatch.\\n"); process.exit(2)' :
      input.outcome === "interrupted" ? 'fs.writeSync(2, "interrupted; kept the fixes it verified\\n"); process.exit(3)' :
      input.outcome === "signal" ? 'process.kill(process.pid,"SIGTERM")' : 'process.exit(0)',
    ].join("\n") + "\n"
    writeFileSync(compiler, program)
    chmodSync(compiler, 0o755)
    let result, error
    try {
      result = await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: join(root, "selected"), root, only: [selected], maxRounds: 1 })
    } catch (caught) { error = caught }
    if (input.outcome === "success" || input.outcome === "diagnostic") {
      assert.equal(error, undefined)
      assert.ok(result)
      assert.deepEqual(Object.keys(result.byFile), [selected])
    } else {
      assert.ok(error, "the interrupted child outcome must be surfaced")
      assert.match(error.message, /the compiler did not finish/)
      if (input.outcome === "interrupted") assert.match(error.message, /exit 3/)
    }
    assert.equal(readFileSync(join(root, selected), "utf8"), original + "// verified fix\n", "retain the selected verified rewrite")
    for (const [file, text] of Object.entries(files)) {
      if (file === selected) continue
      const actual = readFileSync(join(root, file), "utf8")
      assert.equal(actual, text, "foldkit-112: nonselected source changed: " + file)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("foldkit-112: interruption surfaces the failure and restores every nonselected source", async () => {
  for (const input of corpus.inputs) await check(input)
})

test("foreign restoration spans exit outcomes, reported writes, source counts and nested packages", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    count: fc.integer({ min: 1, max: 4 }),
    depth: fc.integer({ min: 0, max: 3 }),
    report: fc.boolean(),
    outcome: fc.constantFrom("success", "diagnostic", "interrupted", "signal"),
  }), check), { seed: 112112, numRuns: 20, endOnFailure: true })
})
