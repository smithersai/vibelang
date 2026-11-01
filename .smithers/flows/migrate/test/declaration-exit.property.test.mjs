import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { makeConfig, paths, verify, report } from "../lib/steps.mjs"
import { emitErrorsIn } from "../lib/declarations.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"
import * as Jj from "../lib/jj.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-ui-declaration-exit.json", import.meta.url)))

async function check(code, diagnostic) {
  const root = mkdtempSync(join(tmpdir(), "foldkit-declaration-exit-"))
  try {
    const target = join(root, "repo"), run = join(root, "run")
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(target, "node_modules/typescript"))
    writeJson(join(target, "package.json"), { name: "foldkit-exit-fixture", types: "./main.d.ts" })
    writeJson(join(target, "tsconfig.json"), { compilerOptions: { rootDir: "." }, include: ["*.vibe"] })
    writeFileSync(join(target, "main.vibe"), "export const value: number = 1\n")
    const declaration = "export declare const value: number;\n"
    writeFileSync(join(target, "node_modules/.bin/vibelang"), [
      "#!/usr/bin/env node",
      "const fs = require('node:fs'), path = require('node:path');",
      "const i = process.argv.indexOf('--outDir');",
      "if (i >= 0) { const out = process.argv[i+1]; fs.mkdirSync(out, { recursive: true });",
      "fs.writeFileSync(path.join(out, 'main.d.ts'), " + JSON.stringify(declaration) + ");",
      "if (" + JSON.stringify(diagnostic) + ") console.log(" + JSON.stringify(diagnostic) + "); process.exit(" + code + "); }",
    ].join("\n"), { mode: 0o755 })
    writeFileSync(join(target, ".gitignore"), "node_modules/\n")
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await Jj.commit(target, "original declaration input")
    const p = paths(run)
    writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    writeJson(p.plan, { batches: [{ files: ["main.ts"] }] })
    writeJson(join(p.baseline, "tests.json"), { code: 0, tests: {}, total: 0, passed: 0, failed: [], skipped: 0 })
    writeJson(join(p.baseline, "compile-" + slug(".") + ".json"), [])

    // This fixture isolates emit/format certification with a known matching stock baseline.
    writeJson(join(p.baseline, "declaration-oracle.json"), { ".": { compiler: "fixture-stock", files: [], missing: [], extra: [], changed: [] } })
    const baseline = join(p.baseline, "dts", slug("."))
    mkdirSync(baseline, { recursive: true })
    writeFileSync(join(baseline, "main.d.ts"), declaration)
    writeJson(join(baseline, "public-surface.json"), { roots: ["main.d.ts"], reachable: ["main.d.ts"], unresolved: [] })
    if (code && !diagnostic) {
      await assert.rejects(verify({ run, batch: "01" }), /compiler did not finish/)
      return
    }
    const result = await verify({ run, batch: "01" })
    assert.equal(result.checks.declarations, true, "the raw files intentionally match")
    assert.equal(result.checks.declarationEmit, code === 0 && !diagnostic)
    assert.equal(result.ok, code === 0 && !diagnostic)
    if (code) assert.ok(result.compile.emitErrors.length, JSON.stringify(result))
    await report({ run })
    const summary = readFileSync(p.report, "utf8")
    if (code) assert.match(summary, /EMIT FAILED/)
    else assert.doesNotMatch(summary, /EMIT FAILED/)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("foldkit-103 verifier: identical files cannot hide option diagnostics or failed emit exits", async () => {
  for (const diagnostic of [corpus.diagnostic, "", "other.ts(1,1): error TS2304: Cannot find name 'missing'."]) await check(2, diagnostic)
  await check(0, "")
})

test("generated emit exits and diagnostic locations always retain failure evidence", () => {
  // 007-tooling: "configuration errors retain their ordinary exit and emit consequences."
  // Matching artifacts cannot certify a failed declaration command.
  fc.assert(fc.property(fc.integer({ min: 0, max: 255 }), fc.array(fc.record({
    category: fc.constantFrom("error", "warning"), file: fc.constantFrom(null, undefined, "main.vibe", "other.ts"),
    code: fc.constantFrom("TS5051", "TS2304"), message: fc.string({ maxLength: 30 })
  }), { maxLength: 8 }), (code, diagnostics) => {
    const errors = emitErrorsIn(diagnostics, ["main.vibe"], { code, log: "dts.log" })
    const relevant = diagnostics.filter(d => d.category === "error" && (!d.file || d.file === "main.vibe"))
    assert.ok(relevant.every(d => errors.includes(d)))
    assert.equal(errors.length > 0, code !== 0 || relevant.length > 0)
  }), { seed: 1035051, numRuns: 600 })
})

test("generated real verifier commands refuse every nonzero emit status", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 127 }), fc.constantFrom("", corpus.diagnostic,
    "tsconfig.json(1,1): error TS5023: Unknown compiler option 'broken'."), async (code, diagnostic) => check(code, diagnostic)),
    { seed: 103103, numRuns: 20 })
})
