import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import vm from "node:vm"
import { test } from "node:test"
import { addNodeSourceHook } from "../lib/node-hooks.mjs"
import { wireDeveloperTools } from "../lib/tooling.mjs"
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-node-source-hooks.json", import.meta.url), "utf8"))
const mainControl = process.env.VIBELANG_HOOK_MAIN_CONTROL
const setup = mainControl ? (await import(mainControl)).wireDeveloperTools : wireDeveloperTools

test("alchemy: the existing setup API registers native hooks last, after the Oxc loader", () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-node-hooks-"))
  try {
    mkdirSync(join(root, "bin"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
    writeFileSync(join(root, corpus.file), corpus.source)
    const args = { root, ts, specsFor: () => ({ vibelang: "0.0.11" }) }
    setup(args)
    const after = readFileSync(join(root, corpus.file), "utf8")
    assert.match(after, /await import\("vibelang\/register"\)/)
    assert.ok(after.indexOf('await import("vibelang/register")') > after.indexOf("registerOxc({"))
    assert.deepEqual(setup(args).changed, [])
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).devDependencies.vibelang, "0.0.11")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("Node hook order: migrated source compiles before the repository's raw-TypeScript hook receives it", () => {
  const native = resolve(repo, "packages/compiler/native/vibelang")
  assert.ok(existsSync(native), "build the native compiler before this loader regression")
  const root = mkdtempSync(join(tmpdir(), "alchemy-hook-runtime-"))
  try {
    for (const dir of ["bin", "src", "node_modules"]) mkdirSync(join(root, dir))
    symlinkSync(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"), "dir")
    symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"), "dir")
    symlinkSync(realpathSync(join(repo, "experiments/node_modules/effect")), join(root, "node_modules/effect"), "dir")
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true }, include: ["src/**/*"] }))
    writeFileSync(join(root, corpus.file), corpus.source)
    writeFileSync(join(root, "bin/register-oxc.mjs"), 'import { registerHooks } from "node:module";\nexport function registerOxc() { registerHooks({ load(url, context, nextLoad) { if (url.endsWith(".vibe")) throw new Error("REPO_HOOK_SAW_RAW_VIBE"); return nextLoad(url, context) } }) }\n')
    writeFileSync(join(root, "src/value.vibe"), "export const value: number = 42;\n")
    writeFileSync(join(root, "main.mjs"), 'import { value } from "./src/value.vibe"; console.log(value);\n')
    const run = () => spawnSync(process.execPath, ["--import", "./bin/register-dev-mode.js", "main.mjs"], {
      cwd: root, encoding: "utf8", timeout: 30000,
      env: { ...process.env, VIBELANG_BINARY: native, VIBELANG_RUNTIME: join(repo, "packages/runtime"), VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache/vibelang") }
    })
    const before = run()
    assert.notEqual(before.status, 0)
    assert.match(before.stderr, /REPO_HOOK_SAW_RAW_VIBE/)
    setup({ root, ts, specsFor: () => ({ vibelang: "0.0.11" }) })
    const after = run()
    assert.equal(after.status, 0, after.stderr)
    assert.equal(after.stdout.trim(), "42")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("property: aliases, repeated hooks and old preloads retain repository order and register native hooks last exactly once", async () => {
  const quote = "ESM source-loader entries register `vibelang/register` after the repository's own Node hooks."
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  await fc.assert(fc.asyncProperty(fc.constantFrom("named", "namespace", "default", "dynamic", "destructured"),
    fc.integer({ min: 1, max: 5 }), fc.constantFrom("none", "static", "dynamic", "last"), fc.integer({ min: 0, max: 4 }),
    async (style, count, prior, blankLines) => {
      let head, call
      if (style === "named") { head = 'import { registerHooks as install } from "node:module";'; call = "install" }
      if (style === "namespace") { head = 'import * as nodeModule from "node:module";'; call = "nodeModule.registerHooks" }
      if (style === "default") { head = 'import nodeModule from "node:module";'; call = "nodeModule.registerHooks" }
      if (style === "dynamic") { head = 'const nodeModule = await import("node:module");'; call = "nodeModule.registerHooks" }
      if (style === "destructured") { head = 'const { registerHooks: install } = await import("node:module");'; call = "install" }
      const old = prior === "static" ? 'import "vibelang/register";\n' : prior === "dynamic" ? 'await import("vibelang/register");\n' : ""
      const calls = Array.from({ length: count }, (_, i) => call + '({ name: "hook' + i + '" });').join("\n")
      const source = "\n".repeat(blankLines) + old + head + "\n" + calls + "\n" + (prior === "last" ? 'await import("vibelang/register");\n' : "")
      const result = addNodeSourceHook(source, ts)
      assert.deepEqual(result.refusals, [], source)
      assert.equal(result.usesHook, true, source)
      assert.equal(addNodeSourceHook(result.text, ts).text, result.text)
      const events = [], module = { registerHooks: h => events.push(h.name) }
      const compiled = ts.transpileModule(result.text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
      await vm.runInNewContext("(async () => {" + compiled + "\n})()", { exports: {}, require: name => {
        if (name === "node:module") return { ...module, default: module }
        if (name === "vibelang/register") { events.push("native"); return {} }
        throw new Error("unexpected import " + name)
      } })
      assert.deepEqual(events, [...Array.from({ length: count }, (_, i) => "hook" + i), "native"])
    }), { seed: 470047, numRuns: 200 })
})

test("lexical shadows and unrelated methods do not register native hooks", () => {
  for (const source of [
    'import { registerHooks } from "node:module"; function run(registerHooks) { registerHooks({}) }',
    'import * as Module from "node:module"; { const Module = { registerHooks() {} }; Module.registerHooks({}) }',
    'import * as Module from "node:module"; function run({Module}) { Module.registerHooks({}) }',
    'const Module = { registerHooks() {} }; Module.registerHooks({})',
    'import type { registerHooks } from "node:module"; registerHooks({})',
  ]) {
    const result = addNodeSourceHook(source, ts)
    assert.equal(result.text, source)
    assert.equal(result.usesHook, false)
    assert.deepEqual(result.refusals, [])
  }
})
test("deferred, conditional, generated and CommonJS registrations get located warnings", () => {
  for (const [file, type, source] of [
    ["register.mjs", "module", 'import { registerHooks } from "node:module";\nfunction run() { registerHooks({}) }'],
    ["register.mjs", "module", 'import { registerHooks } from "node:module";\nif (enabled) registerHooks({})'],
    ["register.mjs", "module", 'import { registerHooks } from "node:module"; const native = await import("vibelang/register"); registerHooks({})'],
    ["register.mjs", "module", '// @generated\nimport { registerHooks } from "node:module"; registerHooks({})'],
    ["register.cjs", "commonjs", 'const { registerHooks } = require("node:module"); registerHooks({})'],
    ["register.js", "commonjs", 'import { registerHooks } from "node:module"; registerHooks({})'],
  ]) {
    const result = addNodeSourceHook(source, ts, { file, type })
    assert.equal(result.text, source)
    assert.equal(result.usesHook, false)
    assert.ok(result.refusals.length > 0, source)
    assert.ok(result.refusals.every(r => r.line > 0))
  }
})
test("test fixtures, test-only helpers and foreign registrations stay byte-identical", () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-node-hook-ownership-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
    for (const [file, text] of Object.entries({
      "test/register.test.mjs": 'import "../helper.mjs";\n' + corpus.source,
      "fixtures/register.mjs": corpus.source,
      "helper.mjs": corpus.source,
      "vendor/package.json": '{"type":"module"}',
      "vendor/register.mjs": corpus.source,
    })) {
      mkdirSync(join(root, file, ".."), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const before = Object.fromEntries(["test/register.test.mjs","fixtures/register.mjs","helper.mjs","vendor/register.mjs"].map(f => [f, readFileSync(join(root, f), "utf8")]))
    const result = setup({ root, ts, specsFor: () => ({ vibelang: "0.0.11" }) })
    for (const [file, text] of Object.entries(before)) assert.equal(readFileSync(join(root, file), "utf8"), text)
    assert.deepEqual(result.changed, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("an awaited direct namespace import registers the native loader", () => {
  const source = '(await import("node:module")).registerHooks({});'
  const result = addNodeSourceHook(source, ts)
  assert.deepEqual(result.refusals, [])
  assert.equal(result.usesHook, true)
  assert.ok(result.text.endsWith("await import(\"vibelang/register\");\n"))
})

test("setup edits source registrations and leaves configured emitted output alone", () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-node-hook-output-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { outDir: "lib" }, include: ["src/**/*"] }))
    for (const dir of ["src", "lib"]) mkdirSync(join(root, dir))
    const source = 'import { registerHooks } from "node:module"; registerHooks({});\n'
    writeFileSync(join(root, "src/register.ts"), source)
    writeFileSync(join(root, "lib/register.js"), source)
    const result = setup({ root, ts, specsFor: () => ({ vibelang: "0.0.11" }) })
    assert.equal(readFileSync(join(root, "lib/register.js"), "utf8"), source)
    assert.ok(result.changed.includes("src/register.ts"))
    assert.ok(!result.changed.includes("lib/register.js"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("property: inherited output roots protect every emitted registration copy", () => {
  fc.assert(fc.property(fc.constantFrom("lib", "generated output", "out/nested", "build"), fc.boolean(),
    (output, inherited) => {
      const root = mkdtempSync(join(tmpdir(), "alchemy-node-output-property-"))
      try {
        writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
        mkdirSync(join(root, "src"), { recursive: true })
        mkdirSync(join(root, output), { recursive: true })
        const source = 'import { registerHooks as install } from "node:module"; install({});\n'
        writeFileSync(join(root, "src/register.ts"), source)
        writeFileSync(join(root, output, "register.js"), source)
        if (inherited) {
          mkdirSync(join(root, "config"))
          writeFileSync(join(root, "config/base.json"), JSON.stringify({ compilerOptions: { outDir: "../" + output } }))
        }
        writeFileSync(join(root, "tsconfig.json"), JSON.stringify(inherited
          ? { extends: "./config/base.json", include: ["src/**/*"] }
          : { compilerOptions: { outDir: output }, include: ["src/**/*"] }))
        const result = setup({ root, ts, specsFor: () => ({ vibelang: "0.0.11" }) })
        assert.equal(readFileSync(join(root, output, "register.js"), "utf8"), source)
        assert.ok(result.changed.includes("src/register.ts"))
        assert.ok(!result.changed.includes(output + "/register.js"))
      } finally { rmSync(root, { recursive: true, force: true }) }
    }), { seed: 470048, numRuns: 50 })
})

test("generated banners after shebangs and multiline comments never wire source hooks", () => {
  fc.assert(fc.property(fc.boolean(), fc.constantFrom("@generated by generator", "DO NOT EDIT", "This file is generated"), fc.boolean(),
    (shebang, marker, block) => {
      const header = (shebang ? "#!/usr/bin/env node\n" : "") + (block ? "/**\n * " + marker + "\n */\n" : "// " + marker + "\n")
      const source = header + 'import {registerHooks} from "node:module"; registerHooks({});'
      const result = addNodeSourceHook(source, ts)
      assert.equal(result.text, source)
      assert.equal(result.usesHook, false)
      assert.ok(result.refusals.some(r => r.reason.includes("generated")))
    }), { seed: 470048, numRuns: 60 })
})
