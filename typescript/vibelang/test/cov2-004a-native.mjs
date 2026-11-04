// Independently run this lane's TypeScript / Effect controls, including pending cases.
// node typescript/vibelang/test/cov2-004a-native.mjs
import assert from "node:assert/strict"
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { referenceModules } from "./cov-ch004-twin.mjs"

const cases = fileURLToPath(new URL("../cases/", import.meta.url))
const modules = referenceModules()
const require = createRequire(path.join(modules, "package.json"))
const ts = require("typescript")
const Effect = await import(pathToFileURL(require.resolve("effect/Effect")))
assert.equal(ts.version, "5.9.3")
assert.equal(require("effect/package.json").version, "4.1.0")
for (const name of readdirSync(cases).filter(name => name.startsWith("cov2-004a-")).sort()) {
  const dir = path.join(cases, name, "typescript")
  mkdirSync(path.join(dir, "node_modules"), { recursive: true })
  const local = path.join(dir, "node_modules/effect")
  rmSync(local, { recursive: true, force: true })
  symlinkSync(path.join(modules, "effect"), local)
  const config = ts.readConfigFile(path.join(dir, "tsconfig.json"), ts.sys.readFile)
  assert.equal(config.error, undefined, name)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dir)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, name + ": " + ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: x => x, getCurrentDirectory: () => dir, getNewLine: () => "\n"
  }))
  assert.equal(program.emit().emitSkipped, false, name)
  const runner = readFileSync(path.join(cases, name, "run.mjs"), "utf8")
  const literal = /, Effect, ([\s\S]+)\)\s*$/.exec(runner)
  assert.ok(literal, name + " must state a literal expected value")
  const expected = JSON.parse(literal[1])
  const twin = await import(pathToFileURL(path.join(dir, "out/main.js")))
  const exit = await Effect.runPromiseExit(twin.main())
  assert.equal(exit._tag, "Success", name)
  assert.deepEqual(exit.value, expected, name)
  console.log("native-control PASS", name)
}
