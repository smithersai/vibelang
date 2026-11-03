import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const stock = process.env.EFFECT_TSGO_BINARY
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [binary, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing && `build the native compiler and runtime first: ${missing}`
const witness = readFileSync(new URL("./fixtures/smithers-promise-success-warning.ts", import.meta.url), "utf8")

function project(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-imported-exit-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  mkdirSync(join(root, "src"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  return root
}

function check(root, { severity, ignore, mode, includeSuggestions = true, salt = 0, pluginEntry = true }, source = witness) {
  const category = { warning: "Warnings", error: "Errors", suggestion: "Suggestions", off: "Warnings" }[severity]
  const plugin = {
    name: "@effect/language-service",
    diagnosticSeverity: { promiseInEffectSuccess: severity },
    ["ignoreEffect" + category + "InTscExitCode"]: ignore,
    includeSuggestionsInTsc: includeSuggestions
  }
  const options = {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
    strict: true, skipLibCheck: true, types: [], rootDir: "src", outDir: "out",
    plugins: [plugin], ...(mode === "check" ? { noEmit: true } : {}),
    ...(mode === "noEmitOnError" ? { noEmitOnError: true } : {})
  }
  writeFileSync(join(root, "tsconfig-stock.json"), JSON.stringify({ compilerOptions: { ...options, plugins: pluginEntry ? [plugin] : [{
    name: "@effect/language-service", diagnosticSeverity: { promiseInEffectSuccess: severity }
  }] }, include: ["src"] }))
  const ownOptions = { ...options }
  if (!pluginEntry) delete ownOptions.plugins
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: ownOptions, include: ["src"],
    ...(!pluginEntry ? { vibe: { severities: { EK3897: severity } } } : {})
  }))
  writeFileSync(join(root, "src/a.ts"), source.replaceAll("setWindow", "setWindow" + salt))
  const run = (exe, config = ".") => {
    rmSync(join(root, "out"), { recursive: true, force: true })
    const result = spawnSync(exe, ["-p", config, "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
    assert.ifError(result.error)
    return { status: result.status, emitted: existsSync(join(root, "out/a.js")), output: result.stdout + result.stderr }
  }
  const ours = run(binary)
  const visible = severity !== "off" && (severity !== "suggestion" || !pluginEntry || includeSuggestions)
  const ignored = pluginEntry ? ignore : severity === "suggestion"
  const fails = visible && !ignored
  const expected = { status: fails ? mode === "noEmitOnError" ? 1 : 2 : 0, emitted: mode !== "check" && !(mode === "noEmitOnError" && fails) }
  assert.deepEqual({ status: ours.status, emitted: ours.emitted }, expected, JSON.stringify({ severity, ignore, mode, includeSuggestions, pluginEntry, output: ours.output }))
  if (visible) assert.match(ours.output, /EK3897/)
  if (stock) {
    const native = run(stock, "tsconfig-stock.json")
    assert.deepEqual({ status: ours.status, emitted: ours.emitted }, { status: native.status, emitted: native.emitted }, JSON.stringify({ severity, ignore, mode, includeSuggestions, pluginEntry, ours, native }))
  }
}

test("the minimized Smithers promise warning respects compiler exit and emit options", { skip, timeout: 120000 }, (t) => {
  const root = project(t)
  for (const severity of ["warning", "error", "suggestion", "off"]) {
    for (const ignore of [false, true]) {
      for (const mode of ["check", "emit", "noEmitOnError"]) {
        check(root, { severity, ignore, mode })
        if (!ignore) check(root, { severity, ignore, mode, pluginEntry: false })
      }
    }
  }
})

test("imported categories, ignored exits and hidden suggestions compose across source mutations", { skip, timeout: 120000 }, (t) => {
  const root = project(t)
  fc.assert(fc.property(fc.record({
    severity: fc.constantFrom("warning", "error", "suggestion", "off"),
    ignore: fc.boolean(), mode: fc.constantFrom("check", "emit", "noEmitOnError"),
    includeSuggestions: fc.boolean(), pluginEntry: fc.boolean(), salt: fc.integer({ min: 0, max: 100000 })
  }), (input) => check(root, input)), { seed: 7113897, numRuns: 32 })
})

test("ignoring Effect diagnostics does not ignore native type errors", { skip }, (t) => {
  const root = project(t)
  writeFileSync(join(root, "src/a.ts"), witness + '\nexport const broken: number = "bad"\n')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], noEmit: true,
    plugins: [{ name: "@effect/language-service", ignoreEffectErrorsInTscExitCode: true, ignoreEffectWarningsInTscExitCode: true }]
  }, include: ["src"] }))
  const result = spawnSync(binary, ["-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8" })
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /TS2322/)
})

test("own VibeLang warnings remain non-failing under noEmitOnError", { skip }, (t) => {
  const root = project(t)
  writeFileSync(join(root, "src/a.vibe"), 'function step(n: number) { return n + 1 }\nexport effect function f() { return Effect.succeed(step(1)) catch () => 0 }\n')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [],
    rootDir: "src", outDir: "out", noEmitOnError: true
  }, include: ["src"] }))
  const result = spawnSync(binary, ["-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /warning EK9204/)
  assert.ok(existsSync(join(root, "out/a.js")), result.stdout + result.stderr)
})

test("lint category status is independent of compiler exit ignores across mutations", { skip, timeout: 120000 }, (t) => {
  const root = project(t)
  fc.assert(fc.property(fc.record({
    severity: fc.constantFrom("warning", "error", "suggestion", "off"),
    ignore: fc.boolean(), includeSuggestions: fc.boolean(), salt: fc.nat({ max: 100000 })
  }), ({ severity, ignore, includeSuggestions, salt }) => {
    writeFileSync(join(root, "src/a.ts"), witness.replaceAll("setWindow", "setWindow" + salt))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [],
      plugins: [{ name: "@effect/language-service", diagnosticSeverity: { promiseInEffectSuccess: severity },
        ignoreEffectErrorsInTscExitCode: ignore, ignoreEffectWarningsInTscExitCode: ignore,
        ignoreEffectSuggestionsInTscExitCode: ignore, includeSuggestionsInTsc: includeSuggestions }]
    }, include: ["src"] }))
    const result = spawnSync(binary, ["lint", "-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
    assert.ifError(result.error)
    assert.equal(result.status, severity === "error" ? 1 : 0, result.stdout + result.stderr)
  }), { seed: 3493897, numRuns: 32 })
})
