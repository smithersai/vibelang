import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"
import { vibeDprintConfig } from "../lib/steps.mjs"
import { jsonc } from "../templates/typecheck.mjs"

const plugin = "npm:vibelang/dprint-plugin.json"
const pinned = "https://plugins.dprint.dev/typescript-0.93.4.wasm@" + "a".repeat(64)
const specsFor = () => ({ vibelang: "0.0.13" })
function fixture(t, entries) {
  const root = mkdtempSync(join(tmpdir(), "formatter-configs-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries({ "package.json": '{"scripts":{"format":"prettier --check .","fmt":"dprint check"}}', ...entries })) {
    mkdirSync(join(root, file, ".."), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return { root, read: file => readFileSync(join(root, file), "utf8"), wire: () => wireDeveloperTools({ root, specsFor }) }
}

test("setup completes with located warnings for YAML Prettier and checksum-pinned JSONC dprint", t => {
  const yaml = "semi: false\n"
  const dprint = '{\n  // authored plugins\n  "plugins": [' + JSON.stringify(pinned) + ',], /* keep */\n  "typescript": { "quoteStyle": "alwaysSingle", },\n}\n'
  const f = fixture(t, { ".prettierrc": yaml, "dprint.json": dprint })
  const first = f.wire()
  assert.equal(f.read(".prettierrc"), yaml)
  assert.equal(first.warnings.length, 2)
  assert.ok(first.warnings.includes(".prettierrc: add the vibelang/prettier plugin by hand"))
  assert.match(first.warnings.find(w => w.includes("pins every plugin")), /dprint\.json/)
  assert.match(f.read("dprint.json"), /\/\/ authored plugins/)
  assert.match(f.read("dprint.json"), /\/\* keep \*\//)
  assert.deepEqual(jsonc(f.read("dprint.json")).plugins, [pinned])
  assert.match(JSON.parse(f.read("package.json")).scripts.fmt, /vibelang-format --check/)
  assert.deepEqual(f.wire().changed, [])
})

test("setup leaves unsupported Prettier data unchanged and reports each file", t => {
  for (const file of [".prettierrc", ".prettierrc.json", "prettier.config.json", "packages/app/.prettierrc"]) {
    for (const text of ["semi: false\n", "{broken", "null", "[]", '"shared-config"', '{"plugins":42}', '{"plugins":{}}']) {
      const f = fixture(t, { [file]: text })
      assert.ok(f.wire().warnings.includes(file + ": add the vibelang/prettier plugin by hand"))
      assert.equal(f.read(file), text)
      assert.deepEqual(f.wire().changed, [])
    }
  }
})

test("an unsupported package Prettier plugin list warns while other scripts are wired", t => {
  for (const prettier of [{ plugins: 42 }, { plugins: {} }, []]) {
    const f = fixture(t, { "package.json": JSON.stringify({ prettier, scripts: { format: "prettier --check ." } }) })
    assert.ok(f.wire().warnings.includes("package.json: add the vibelang/prettier plugin by hand"))
    assert.deepEqual(JSON.parse(f.read("package.json")).prettier, prettier)
    assert.match(JSON.parse(f.read("package.json")).scripts.format, /--plugin vibelang\/prettier/)
  }
})

test("dprint JSONC wiring and formatter discovery share comments and trailing-comma support", t => {
  for (const name of ["dprint.json", ".dprint.json", "dprint.jsonc", ".dprint.jsonc"]) {
    const text = '\uFEFF{/* header */"plugins": ["https://plugins.dprint.dev/typescript-0.93.4.wasm", // inline\n], "typescript": {"quoteStyle":"alwaysSingle",}, "note": "https://example.invalid/a//b/*c*/,}\\\"end",}'
    const file = "packages/app/" + name
    const f = fixture(t, { [file]: text })
    assert.deepEqual(f.wire().warnings, [])
    const after = f.read(file)
    assert.match(after, /\/\* header \*\//)
    assert.match(after, /\/\/ inline/)
    assert.equal(jsonc(after).note, jsonc(text).note)
    assert.ok(jsonc(after).plugins.includes(plugin))
    assert.equal(vibeDprintConfig(f.root, "packages/app/src/main.vibe"), file)
    assert.deepEqual(f.wire().changed, [])
  }
})

test("malformed dprint data warns without preventing valid sibling configurations", t => {
  for (const text of ["{broken", "null", "[]", '{"plugins":42}', '{"plugins":[{}]}', '{"includes":{}}', '{"excludes":"src"}', '{/* unterminated']) {
    const f = fixture(t, { "dprint.json": text, "packages/app/dprint.json": '{"plugins":["npm:other/plugin.json"]}' })
    const result = f.wire()
    assert.ok(result.warnings.some(w => w.startsWith("dprint.json:") && w.includes("by hand")))
    assert.equal(f.read("dprint.json"), text)
    assert.ok(jsonc(f.read("packages/app/dprint.json")).plugins.includes(plugin))
    assert.equal(vibeDprintConfig(f.root, "src/main.vibe"), null)
    assert.deepEqual(f.wire().changed, [])
  }
})

test("removing an old unpinned dprint plugin preserves comments around each element", t => {
  for (const plugins of [
    JSON.stringify(plugin) + ', /* first */ ' + JSON.stringify(pinned),
    JSON.stringify(pinned) + ', /* last */ ' + JSON.stringify(plugin),
    JSON.stringify(plugin) + ', /* duplicate */ ' + JSON.stringify(plugin) + ', /* pin */ ' + JSON.stringify(pinned) + ','
  ]) {
    const text = '{ "plugins": [' + plugins + '], "typescript": {"lineWidth":91} }'
    const f = fixture(t, { "dprint.json": text })
    f.wire()
    const after = f.read("dprint.json")
    assert.deepEqual(jsonc(after).plugins, [pinned])
    for (const comment of text.match(/\/\*.*?\*\//g) ?? []) assert.ok(after.includes(comment))
    assert.equal(jsonc(after).typescript.lineWidth, 91)
    assert.deepEqual(f.wire().changed, [])
  }
})

test("dprint edits keep comments beside null lists, duplicate keys and trailing file comments", t => {
  for (const text of [
    '{/*empty*/}\n// tail',
    '{"plugins":null/*plugins*/,"includes":null/*includes*/,"excludes":null/*excludes*/}',
    '{"plugins":[],"plugins":["npm:other/plugin.json"],"nested":[[],{"excludes":["x"]}],/*end*/}\n// tail',
    '{"plugins":["npm:vibelang/dprint-plugin.json",/*a*/"npm:vibelang/dprint-plugin.json",/*b*/]}',
    '{"plugins":["npm:other/plugin.json"],"includes":["**/\\u0061.ts",/*include*/],"excludes":[]}'
  ]) {
    const f = fixture(t, { "dprint.json": text })
    f.wire()
    const after = f.read("dprint.json")
    const before = jsonc(text), parsed = jsonc(after)
    for (const comment of ["/*empty*/", "/*plugins*/", "/*includes*/", "/*excludes*/", "/*end*/", "// tail", "/*a*/", "/*b*/", "/*include*/"]) {
      if (text.includes(comment)) assert.ok(after.includes(comment), comment)
    }
    assert.deepEqual(parsed.nested, before.nested)
    if (text.includes("\\u0061")) assert.ok(after.includes("\\u0061"))
    assert.deepEqual(f.wire().changed, [])
  }
})


test("JSONC line comments end at carriage returns and preserve later fields", t => {
  const ts = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("typescript")
  for (const newline of ["\r", "\n"]) {
    const text = '{// head\r"plugins":["npm:other/plugin.json"],' + newline +
      '"includes":["src/**"], // sources\r"excludes":["vendor/**"],' + newline + '}'
    const expected = ts.parseConfigFileTextToJson("dprint.json", text).config
    assert.deepEqual(jsonc(text), expected)
    const f = fixture(t, { "dprint.json": text })
    assert.deepEqual(f.wire().warnings, [])
    const after = ts.parseConfigFileTextToJson("dprint.json", f.read("dprint.json")).config
    assert.ok(after.plugins.includes("npm:other/plugin.json"))
    assert.ok(after.plugins.includes(plugin))
    assert.ok(after.includes.includes("src/**"))
    assert.ok(after.excludes.includes("vendor/**"))
    if (newline === "\r") assert.ok(!f.read("dprint.json").includes("\n"))
    assert.deepEqual(f.wire().changed, [])
  }
})

test("Prettier plugin-array data is retained while commented dprint configurations are wired", t => {
  const options = { semi: false, plugins: [{ languages: [{ name: "Custom", parsers: ["babel"], extensions: [".custom"] }] }] }
  const f = fixture(t, {
    "package.json": JSON.stringify({ prettier: options, scripts: { fmt: "dprint check", pretty: "prettier --check ." } }),
    ".prettierrc.json": JSON.stringify(options),
    "dprint.json": '{/* config */"plugins":["npm:other/plugin.json"]}'
  })
  assert.deepEqual(f.wire().warnings, [])
  for (const config of [JSON.parse(f.read(".prettierrc.json")), JSON.parse(f.read("package.json")).prettier]) {
    assert.deepEqual(config.plugins[0], options.plugins[0])
    assert.equal(config.plugins[1], "vibelang/prettier")
  }
  assert.ok(jsonc(f.read("dprint.json")).plugins.includes(plugin))
  assert.deepEqual(f.wire().changed, [])
})
