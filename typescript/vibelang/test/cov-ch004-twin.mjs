// Chapter 004: independent TypeScript 5.9.3 / Effect 4.1.0 type and Exit control.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
export function referenceModules() {
  if (process.env.VIBELANG_MATCH_REFERENCE_NODE_MODULES) return process.env.VIBELANG_MATCH_REFERENCE_NODE_MODULES
  const cache = path.resolve(fileURLToPath(new URL("../../.cache/cov-ch004-reference/", import.meta.url)))
  if (!fs.existsSync(path.join(cache, "node_modules/typescript/package.json"))) {
    fs.mkdirSync(path.dirname(cache), { recursive: true })
    const staging = fs.mkdtempSync(cache + "-")
    try {
      execFileSync("npm", ["install", "--prefix", staging, "--ignore-scripts", "--no-audit", "--no-fund",
        "--save-exact", "typescript@5.9.3", "effect@4.1.0"], { stdio: "pipe", timeout: 120_000 })
      try { fs.renameSync(staging, cache) } catch (error) {
        if (!fs.existsSync(path.join(cache, "node_modules/typescript/package.json"))) throw error
      }
    } finally { fs.rmSync(staging, { recursive: true, force: true }) }
  }
  return path.join(cache, "node_modules")
}
export async function compare(dir, Effect, expected) {
  const modules = referenceModules()
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
  assert.equal(fs.readFileSync(path.join(dir, "out/main.d.ts"), "utf8"),
    fs.readFileSync(path.join(dir, "typescript/out/main.d.ts"), "utf8"))
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
