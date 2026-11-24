import "./helpers/jj-config.mjs"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"
import { vibeDprintConfig } from "../lib/steps.mjs"
import { jsonc } from "../templates/typecheck.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
const shipped = "npm:vibelang/dprint-plugin.json"
const pin = "https://plugins.dprint.dev/typescript-0.93.4.wasm@" + "a".repeat(64)
const contract = "preserving comments and unrelated settings"

function wire(entries, check) {
  const root = mkdtempSync(join(tmpdir(), "formatter-config-property-"))
  try {
    writeFileSync(join(root, "package.json"), '{"scripts":{"format":"dprint check","pretty":"prettier --check ."}}')
    for (const [file, text] of Object.entries(entries)) writeFileSync(join(root, file), text)
    const setup = () => wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.13" }) })
    check({ root, setup, read: file => readFileSync(join(root, file), "utf8") }, setup())
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("property: dprint JSONC edits preserve authored comments, unrelated data and rerun stability", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(contract))
  fc.assert(fc.property(fc.record({
    plugins: fc.array(fc.constantFrom(pin, shipped, "npm:other/plugin.json", "https://plugins.dprint.dev/json-0.20.0.wasm"), { maxLength: 5 }),
    includes: fc.array(fc.string({ maxLength: 30 }), { maxLength: 4 }),
    excludes: fc.array(fc.string({ maxLength: 30 }), { maxLength: 4 }),
    note: fc.jsonValue(),
    newline: fc.constantFrom("\n", "\r\n", "\r"),
    trailing: fc.boolean(), missing: fc.boolean(), escapedKey: fc.boolean(),
    name: fc.constantFrom("dprint.json", ".dprint.json", "dprint.jsonc", ".dprint.jsonc")
  }), input => {
    const { newline, trailing, missing, name } = input
    const comments = []
    const comment = label => { const text = "/* keep " + label + " */"; comments.push(text); return text }
    const array = (name, values) => "[" + comment(name + " head") + values.map((value, i) => JSON.stringify(value) + comment(name + i)).join(",") + (values.length && trailing ? "," : "") + "]"
    const entries = [
      (input.escapedKey ? '"plu\\u0067ins"' : '"plugins"') + ":" + comment("plugins key") + array("plugins", input.plugins),
      '"note":' + JSON.stringify(input.note),
      '"nested":{"plugins":[],"includes":[],"excludes":[]}'
    ]
    if (!missing) entries.push('"includes":' + array("includes", input.includes), '"excludes":' + array("excludes", input.excludes))
    const text = "\uFEFF{" + comment("header") + newline + entries.join("," + newline) + (trailing ? "," : "") + newline + "// keep footer" + newline + "}" + newline
    wire({ [name]: text, ".prettierrc": "semi: false\n" }, (f, first) => {
      const result = f.read(name), parsed = jsonc(result)
      const pinned = input.plugins.filter(p => p !== shipped).every(p => /@[0-9a-f]{64}$/.test(p))
      assert.equal(first.warnings.length, pinned ? 2 : 1)
      assert.deepEqual(parsed.note, input.note)
      assert.deepEqual(parsed.nested, { plugins: [], includes: [], excludes: [] })
      for (const comment of comments) assert.ok(result.includes(comment), comment)
      assert.ok(result.includes("// keep footer" + newline))
      if (newline === "\r\n") assert.ok(!result.replaceAll("\r\n", "").includes("\n"))
      if (newline === "\r") assert.ok(!result.includes("\n"))
      for (const value of missing ? [] : input.excludes) assert.ok(parsed.excludes.includes(value))
      if (pinned) {
        assert.ok(!parsed.plugins.includes(shipped))
        assert.deepEqual(parsed.plugins, input.plugins.filter(p => p !== shipped).length ? input.plugins.filter(p => p !== shipped) : [pin.replace(/a{64}$/, "cdbf74066391bdb11ddaef9ea95299636a97d637f5a9bf7f121d584875647c7a")])
        assert.equal(vibeDprintConfig(f.root, "src/main.vibe"), null)
      } else {
        assert.ok(parsed.plugins.includes(shipped))
        for (const plugin of input.plugins) assert.ok(parsed.plugins.includes(plugin))
        for (const value of missing ? ["**/*"] : input.includes) assert.ok(parsed.includes.includes(value))
        assert.ok(parsed.includes.includes("**/*.vibe"))
        assert.equal(vibeDprintConfig(f.root, "src/main.vibe"), name)
      }
      assert.equal(f.read(".prettierrc"), "semi: false\n")
      assert.deepEqual(f.setup().changed, [])
    })
  }), { numRuns: 150, seed: 533 })
})

test("property: Prettier shape checks retain plugin arrays and warn on unsupported containers", () => {
  const values = fc.oneof(fc.jsonValue(), fc.record({
    plugins: fc.oneof(fc.array(fc.jsonValue(), { maxLength: 4 }), fc.jsonValue()), semi: fc.boolean()
  }))
  fc.assert(fc.property(values, value => {
    const valid = value !== null && typeof value === "object" && !Array.isArray(value) &&
      (value.plugins == null || Array.isArray(value.plugins))
    const text = JSON.stringify(value)
    wire({ ".prettierrc": text }, (f, first) => {
      if (valid) {
        assert.deepEqual(first.warnings, [])
        const plugins = JSON.parse(f.read(".prettierrc")).plugins
        assert.ok(plugins.includes("vibelang/prettier"))
        for (const original of JSON.parse(text).plugins ?? []) {
          assert.ok(plugins.some(item => JSON.stringify(item) === JSON.stringify(original)), "retain authored plugin-array entries")
        }
      } else {
        assert.deepEqual(first.warnings, [".prettierrc: add the vibelang/prettier plugin by hand"])
        assert.equal(f.read(".prettierrc"), text)
      }
      assert.deepEqual(f.setup().changed, [])
    })
  }), { numRuns: 100, seed: 534 })
})
