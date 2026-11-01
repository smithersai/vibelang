import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { emitDeclarations } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const compiler = process.env.VIBELANG ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-ui-declaration-inline-sources.json", import.meta.url)))
const contract = "Declaration-only snapshots disable `sourceMap`, `inlineSourceMap`, `inlineSources` and `declarationMap` together"

// Oracle: the flow README promises declaration-only snapshots without changing
// target configs. Compare actual native-compiler output bytes, not normalized gold.
async function check({ maps = { sourceMap: true, inlineSources: true }, inherited = false, declarationMap = false, value = 1 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foldkit-ui-declaration-maps-"))
  try {
    const options = { ...corpus.compilerOptions, sourceMap: false, inlineSources: false, ...maps, declarationMap }
    const config = { compilerOptions: options, include: corpus.include }
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
    writeFileSync(join(root, "main.vibe"), corpus.source.replace("1", String(value)))
    if (inherited) {
      writeFileSync(join(root, "base.json"), JSON.stringify({ compilerOptions: options }))
      config.compilerOptions = {}
      config.extends = "./base.json"
    }
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config))
    const inputs = ["main.vibe", "tsconfig.json", ...(inherited ? ["base.json"] : [])]
    const originals = inputs.map(file => readFileSync(join(root, file), "utf8"))
    const normal = spawnSync(compiler, ["-p", "tsconfig.json"], { cwd: root, encoding: "utf8", timeout: 30000 })
    assert.equal(normal.status, 0, normal.stdout + normal.stderr)
    const original = readFileSync(join(root, "dist/main.d.ts"), "utf8")
    // Declaration maps append a mapping comment; compare against an independent
    // valid declaration-only invocation with the maps explicitly turned off.
    const control = spawnSync(compiler, ["-p", "tsconfig.json", "--emitDeclarationOnly", "--declarationMap", "false",
      "--sourceMap", "false", "--inlineSourceMap", "false", "--inlineSources", "false", "--outDir", "control"],
      { cwd: root, encoding: "utf8", timeout: 30000 })
    assert.equal(control.status, 0, control.stdout + control.stderr)
    const expected = readFileSync(join(root, "control/main.d.ts"), "utf8")
    if (!declarationMap) assert.equal(expected, original)
    const result = await emitDeclarations({ compiler, tsconfig: "tsconfig.json", cwd: root, outDir: join(root, "snapshot") })
    assert.equal(result.code, 0, JSON.stringify(result.diagnostics))
    assert.deepEqual(result.diagnostics.filter(d => d.category === "error"), [])
    assert.equal(result.files, 1)
    assert.equal(readFileSync(join(root, "snapshot/main.d.ts"), "utf8"), expected)
    assert.deepEqual(readdirSync(join(root, "snapshot")).filter(file => /\.(?:[cm]?js|map)$/.test(file)), [])
    assert.deepEqual(inputs.map(file => readFileSync(join(root, file), "utf8")), originals)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("foldkit-103: declaration snapshots accept the valid inlineSources UI corpus", async () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(contract))
  await check()
})

test("foldkit-103: native declaration emit preserves valid local and extended map-option combinations", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    maps: fc.constantFrom({}, { sourceMap: true }, { sourceMap: true, inlineSources: true },
      { inlineSourceMap: true }, { inlineSourceMap: true, inlineSources: true }),
    inherited: fc.boolean(), declarationMap: fc.boolean(), value: fc.integer({ min: -999, max: 999 })
  }), check), { seed: 1035051, numRuns: 40,
    examples: [[{ maps: { sourceMap: true, inlineSources: true }, inherited: true, declarationMap: true, value: 1 }],
      [{ maps: { inlineSourceMap: true, inlineSources: true }, inherited: true, declarationMap: false, value: 2 }]] })
})
