// run-seconds: 180 (three stock TypeScript programs in this process)
// Chapter 004: independent TypeScript 5.9.3 / Effect 4.1.0 type and Exit control.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { compareApiIdentity, formatResult } from "../../../scripts/api-identity.mjs"
import { referenceModules } from "./vip7-reference.mjs"

// VIP-27 permits an emitted @throws {never} contract absent from the stock
// twin. The shared comparison still checks every exported type and authored doc.
export function assertReferenceTypes(ts, dir, modules, sources = { before: "typescript/out", after: "out" }) {
  // Both declaration trees are checked in the reference toolchain. Resolving
  // one against the runtime pin and the other against the stock pin would
  // compare different ambient environments. The case harness separately
  // checks both source APIs against the runtime's pin before this runner.
  const layout = fs.mkdtempSync(path.join(os.tmpdir(), "cov-ch004-api-"))
  try {
    fs.writeFileSync(path.join(layout, "package.json"), '{"type":"module"}')
    if (modules) fs.symlinkSync(modules, path.join(layout, "node_modules"), "dir")
    for (const [side, source] of Object.entries(sources)) {
      assert.ok(side === "before" || side === "after", "unknown declaration side")
      const input = path.join(dir, source)
      if (fs.statSync(input).isFile()) {
        fs.mkdirSync(path.join(layout, side), { recursive: true })
        fs.copyFileSync(input, path.join(layout, side, "main.d.ts"))
      } else {
        fs.cpSync(input, path.join(layout, side), {
          recursive: true,
          filter: file => fs.statSync(file).isDirectory() || /\.d\.[cm]?ts$/.test(file)
        })
      }
    }
    const result = compareApiIdentity(ts, path.join(layout, "before"), path.join(layout, "after"),
      modules ? { moduleRoots: [modules] } : {})
    assert.equal(result.comparisonComplete, true, formatResult(result))
    assert.equal(result.identical, true, formatResult(result))
  } finally { fs.rmSync(layout, { recursive: true, force: true }) }
}
export async function compare(dir, Effect, expected) {
  const modules = referenceModules(process.env.VIBELANG_MATCH_REFERENCE_NODE_MODULES)
  const require = createRequire(path.join(modules, "package.json"))
  const ts = require("typescript")
  assert.equal(ts.version, "5.9.3")
  assert.equal(require("effect/package.json").version, "4.1.0")
  const localModules = path.join(dir, "typescript/node_modules")
  fs.mkdirSync(localModules, { recursive: true })
  const localEffect = path.join(localModules, "effect")
  try { fs.unlinkSync(localEffect) } catch (error) { if (error.code !== "ENOENT") throw error }
  fs.symlinkSync(path.join(modules, "effect"), localEffect)
  const configFile = ts.readConfigFile(path.join(dir, "typescript/tsconfig.json"), ts.sys.readFile)
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.join(dir, "typescript"))
  const program = ts.createProgram(config.fileNames, config.options)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: x => x, getCurrentDirectory: () => dir, getNewLine: () => "\n"
  }))
  program.emit()
  assertReferenceTypes(ts, dir, modules)
  const vibe = await import(pathToFileURL(path.join(dir, "out/main.js")))
  const twin = await import(pathToFileURL(path.join(dir, "typescript/out/main.js")))
  const twinEffect = await import(pathToFileURL(require.resolve("effect/Effect")))
  const actual = await Effect.runPromiseExit(vibe.main())
  const reference = await twinEffect.runPromiseExit(twin.main())
  assert.equal(reference._tag, "Success")
  assert.deepEqual(reference.value, expected)
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(reference)))
  console.log("types and Exit agree")
}
