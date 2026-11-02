import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { wireTestProjects } from "../lib/test-projects.mjs"
import { makeConfig, paths, setup, testEdits } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"
import corpus from "./corpus/foldkit-external-test-project.json" with { type: "json" }
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
function fixture(input = {}) {
  const root = mkdtempSync(join(tmpdir(), "migrate-external-test-config-"))
  const dir = input.dir ?? "test", project = input.project ?? "tsconfig.test.json"
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  put("package.json", '{"private":true,"type":"module"}')
  const main = structuredClone(corpus.main)
  main.compilerOptions.resolveJsonModule = input.resolveJson ?? true
  put("tsconfig.json", JSON.stringify(main))
  const tests = structuredClone(corpus.tests); tests.include = ["src", dir]
  put(project, JSON.stringify(tests))
  put("src/relay.vibe", "export const program = 1\n")
  put("src/relay.d.vibe.ts", corpus.sidecar)
  const file = dir + "/relay" + (input.nested ? "/nested" : "") + ".test." + (input.ext ?? "ts")
  const relative = input.nested ? "../../" : "../"
  put(file, corpus.testSource.replace("../src/", relative + "src/"))
  return { root, dir, project, file, put, packages: [{ dir: ".", sources: ["src"] }] }
}
function nearestProgram(f) {
  const config = ts.findConfigFile(dirname(join(f.root, f.file)), ts.sys.fileExists)
  const read = ts.readConfigFile(config, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(config), {}, config)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  return { config, parsed, program, file: program.getSourceFile(join(f.root, f.file)) }
}
function check(input) {
  const f = fixture(input)
  try {
    const protectedBytes = readFileSync(join(f.root, f.file))
    assert.equal(nearestProgram(f).file, undefined, "the unchanged main project omits these tests")
    const result = wireTestProjects({ ...f, ts })
    assert.deepEqual(result.changed, [f.dir + "/tsconfig.json"])
    assert.deepEqual(JSON.parse(readFileSync(join(f.root, f.dir, "tsconfig.json"))), { extends: "../" + f.project })
    const after = nearestProgram(f)
    assert.ok(after.file, "typed lint must discover an actual project containing the original test")
    assert.equal(after.parsed.options.strict, true)
    assert.equal(after.parsed.options.skipLibCheck, true)
    assert.equal(after.parsed.options.resolveJsonModule, input?.resolveJson ?? true)
    assert.equal(after.parsed.options.allowArbitraryExtensions, true)
    assert.equal(after.parsed.options.moduleResolution, ts.ModuleResolutionKind.Bundler)
    assert.equal(after.parsed.options.module, ts.ModuleKind.ESNext)
    assert.deepEqual(after.parsed.fileNames.map(file => file.slice(f.root.length + 1)).sort(), ["src/relay.d.vibe.ts", f.file].sort())
    assert.match(result.projects[0].optionsHash, /^[a-f0-9]{64}$/)
    assert.match(result.projects[0].programHash, /^[a-f0-9]{64}$/)
    const diagnostics = ts.getPreEmitDiagnostics(after.program).filter(d => d.file?.fileName === join(f.root, f.file))
    assert.deepEqual(diagnostics.map(d => [d.code, ts.flattenDiagnosticMessageText(d.messageText, "\n")]), [])
    const name = after.file.statements[0].importClause.namedBindings.elements[0].name
    assert.equal(after.program.getTypeChecker().typeToString(after.program.getTypeChecker().getTypeAtLocation(name)), "number")
    assert.deepEqual(readFileSync(join(f.root, f.file)), protectedBytes)
    assert.deepEqual(wireTestProjects({ ...f, ts }).changed, [], "setup replay is idempotent")
    assert.ok(result.projects[0].previous.every(item => item.config === "tsconfig.json"))
    assert.ok(result.projects[0].programFiles.includes(f.file))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
}
test("foldkit MCP: typed lint discovers the existing external test project and native sidecar", () => check())
test("test directory, nested test and existing project spellings preserve original checks", () => {
  // Detail 272: "run the actual original checks on both prepared trees".
  fc.assert(fc.property(fc.record({ dir: fc.constantFrom("test", "tests", "__tests__"), nested: fc.boolean(), ext: fc.constantFrom("ts", "mts", "tsx"), resolveJson: fc.boolean(),
    project: fc.constantFrom("tsconfig.test.json", "tsconfig.tests.json", "tsconfig.spec.json") }), check), { seed: 330033, numRuns: 100 })
})
test("existing local configs, absent covering projects and vendored packages are preserved and diagnosed", () => {
  for (const mode of ["existing", "missing", "nested-owner", "ambiguous", "submodule"]) {
    const f = fixture()
    try {
      if (mode === "existing") f.put("test/tsconfig.json", '{"extends":"../tsconfig.json"}\n')
      if (mode === "missing") rmSync(join(f.root, f.project))
      if (mode === "ambiguous") f.put("tsconfig.spec.json", JSON.stringify({ ...corpus.tests, compilerOptions: { strict: false } }))
      if (mode === "submodule") f.put(".gitmodules", "[submodule \"tests\"]\n  path = test\n")
      if (mode === "nested-owner") f.put("test/package.json", '{"name":"vendored"}')
      const before = mode === "existing" ? readFileSync(join(f.root, "test/tsconfig.json")) : null
      const result = wireTestProjects({ ...f, ts })
      assert.deepEqual(result.changed, [], mode)
      if (before) assert.deepEqual(readFileSync(join(f.root, "test/tsconfig.json")), before)
      if (!["nested-owner", "submodule"].includes(mode)) assert.equal(result.warnings.length, 1)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }
})

test("foldkit MCP: actual setup records the external test-project bridge without changing tests", async () => {
  const f = fixture(), run = join(f.root, "migration-run")
  try {
    f.put(".gitignore", "node_modules/\nmigration-run/\n")
    mkdirSync(join(f.root, "node_modules/.bin"), { recursive: true })
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(f.root, "node_modules/typescript"))
    f.put("node_modules/.bin/vibelang", "#!/usr/bin/env node\nconst fs = require(\"node:fs\"), path = require(\"node:path\");\nif (process.argv.includes(\"--version\")) console.log(\"0.0.11\");\nconst i = process.argv.indexOf(\"--outDir\");\nif (i >= 0) { const dir = path.join(process.argv[i + 1], \"src\"); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, \"relay.d.ts\"), \"export declare const program: number\\n\"); }\n")
    f.put("node_modules/.bin/vibelang-format", "#!/bin/sh\nexit 0\n")
    chmodSync(join(f.root, "node_modules/.bin/vibelang"), 0o755)
    chmodSync(join(f.root, "node_modules/.bin/vibelang-format"), 0o755)
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: f.root })
    const base = await Jj.commit(f.root, "original")
    const p = paths(run), config = makeConfig({ target: f.root, test: "true", install: "true", vibelangVersion: "0.0.11" })
    writeJson(p.config, config)
    writeJson(p.upgrade, { jj: { commit: base, baseCommit: base, base: base, bookmark: "vibe", initialized: true }, changed: [], effect: { from: "4.1.0", to: "4.1.0" } })
    writeJson(join(p.baseline, "upgraded-tests.json"), { code: 0, tests: {} })
    const protectedBytes = readFileSync(join(f.root, f.file))
    const result = await setup({ run })
    assert.ok(nearestProgram(f).file, "setup must restore an actual containing project for the unchanged test")
    assert.ok(result.wired.changed.includes("test/tsconfig.json"))
    const stages = readFileSync(join(p.baseline, "logs/test-projects.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
    assert.deepEqual(stages.at(-1).changed, ["test/tsconfig.json"])
    assert.ok(stages.at(-1).projects[0].programFiles.includes(f.file))
    assert.ok(stages.at(-1).projects[0].optionsHash)
    assert.deepEqual(readFileSync(join(f.root, f.file)), protectedBytes)
    assert.ok(JSON.parse(readFileSync(p.setup)).wired.changed.includes("test/tsconfig.json"))
    // Verify diffs tests from before setup (detail 272): the bridge setup wrote is not a test edit.
    const diff = await testEdits(JSON.parse(readFileSync(p.config)), p, undefined, "01", ts)
    assert.equal(diff.ok, true, JSON.stringify(diff.files))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("setup parses each project once across a large external test directory", () => {
  const f = fixture()
  try {
    for (let i = 0; i < 150; i++) f.put("test/extra" + i + ".test.ts", "export const checked = 1\\n")
    let parses = 0
    const api = { ...ts, parseJsonConfigFileContent(...args) { parses++; return ts.parseJsonConfigFileContent(...args) } }
    const result = wireTestProjects({ ...f, ts: api })
    assert.deepEqual(result.changed, ["test/tsconfig.json"])
    assert.equal(result.projects[0].files.length, 151)
    assert.ok(parses <= 4, "project parsing must scale with configurations, not test files; got " + parses)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
