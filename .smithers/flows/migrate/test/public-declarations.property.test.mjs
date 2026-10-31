import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareDeclarations } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const quote = "Public declarations reachable from `exports` or `types` must remain byte-identical; unreachable new declarations pass as `addedPrivate`."

function compare(before, after, manifest) {
  const root = mkdtempSync(join(tmpdir(), "migrate-public-dts-"))
  try {
    for (const [dir, files] of Object.entries({ before, after })) {
      mkdirSync(join(root, dir))
      writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest))
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(join(root, dir, file, ".."), { recursive: true })
        writeFileSync(join(root, dir, file), text)
      }
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("foldkit-28: a private adapter declaration is admitted without weakening the public byte gate", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-private-adapter-declarations.json", import.meta.url)))
  const result = compare(corpus.before, corpus.after, corpus.manifest)
  assert.equal(result.identical, true)
  assert.deepEqual(result.addedPrivate, ["platform.d.ts"])
  assert.deepEqual(result.added, [])
  assert.equal(compare(corpus.before, { ...corpus.after, "main.d.ts": "// comment changes bytes\n" + corpus.before["main.d.ts"] }, corpus.manifest).identical, false)
  assert.equal(compare(corpus.before, { "platform.d.ts": corpus.after["platform.d.ts"] }, corpus.manifest).identical, false)
})

test("public declaration graph: imports, exports, import types, require and references expose transitive additions", () => {
  const forms = [
    p => `export * from "${p}";\n`,
    p => `import type { Item } from "${p}"; export type X = Item;\n`,
    p => `export type X = import("${p}").Item;\n`,
    p => `import X = require("${p}"); export = X;\n`,
    p => `/// <reference path="${p}" />\nexport {};\n`
  ]
  fc.assert(fc.property(fc.array(fc.nat(4), { minLength: 1, maxLength: 8 }), fc.boolean(), fc.constantFrom(".d.ts", ".d.mts", ".d.cts"), (edges, exposed, ext) => {
    const before = {}
    for (let i = 0; i < edges.length; i++) before[`n${i}${ext}`] = i + 1 < edges.length
      ? forms[edges[i]](`./n${i + 1}${ext}`) : exposed ? forms[edges[i]](`./new${ext}`) : "export {};\n"
    const result = compare(before, { ...before, [`new${ext}`]: "export interface Item {}\n" },
      { exports: { ".": { types: `./n0${ext}` } } })
    assert.equal(result.identical, !exposed)
    assert.deepEqual(exposed ? result.added : result.addedPrivate, [`new${ext}`])
  }), { seed: 280028, numRuns: 200 })
})

test("public roots include conditional and wildcard exports; unknown entry points fail closed", () => {
  for (const manifest of [
    { types: "./main.d.ts" },
    { exports: { ".": { import: { types: "./main.d.ts" } }, "./*": "./*.js" } },
    { exports: ["./main.js", { types: "./main.d.ts" }] },
    { exports: "./missing.js" }
  ]) {
    const result = compare({ "main.d.ts": "export {};\n" },
      { "main.d.ts": "export {};\n", "adapter.d.ts": "export {};\n" }, manifest)
    assert.equal(result.identical, Boolean(manifest.types || Array.isArray(manifest.exports)))
  }
})

test("setup snapshots source and dist entry points across project output directories", async () => {
  const { recordDeclarationSurface } = await import("../lib/declarations.mjs")
  for (const ext of [".ts", ".vibe", ".mts"]) {
    const root = mkdtempSync(join(tmpdir(), "migrate-public-alias-"))
    try {
      mkdirSync(join(root, "src"))
      mkdirSync(join(root, "snapshot"))
      writeFileSync(join(root, "src/main" + ext), "export const x = 1\n")
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist", declaration: true }, include: ["src/**/*"] }))
      const dts = ext === ".mts" ? "main.d.mts" : "main.d.ts"
      writeFileSync(join(root, "snapshot", dts), "export declare const x = 1;\n")
      for (const target of ["./src/main" + ext, "./dist/" + dts, "./dist/main" + (ext === ".mts" ? ".mjs" : ".js")]) {
        writeFileSync(join(root, "package.json"), JSON.stringify({ exports: { ".": { types: target } } }))
        const surface = recordDeclarationSurface(ts, join(root, "snapshot"), root, [{ tsconfig: "tsconfig.json", prefix: "." }])
        assert.deepEqual(surface.unresolved, [], ext + " " + target)
        assert.deepEqual(surface.reachable, [dts])
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test("package-private aliases and relative type references cannot hide a public addition", () => {
  for (const main of [
    'export type X = import("#adapter").Item;\n',
    '/// <reference types="./platform" />\nexport {};\n'
  ]) {
    const before = { "main.d.ts": main }
    const after = { ...before, "platform.d.ts": "export interface Item {}\n" }
    const manifest = { exports: { ".": { types: "./main.d.ts" } }, imports: { "#adapter": "./platform.d.ts" } }
    assert.equal(compare(before, after, manifest).identical, false)
  }
})

test("resolved package aliases expose their leaves while unrelated additions stay private", () => {
  for (const [name, imports] of [["#adapter", { "#adapter": "./leaf.d.ts" }], ["#local/adapter", { "#local/*": "./*.d.ts" }], ["sample/leaf", {}]]) {
    const leaf = name === "#local/adapter" ? "adapter.d.ts" : "leaf.d.ts"
    const manifest = { name: "sample", exports: { ".": "./main.d.ts", "./leaf": "./leaf.d.ts" }, imports }
    const before = { "main.d.ts": `export type X = import("${name}").Item;\n`, [leaf]: "export interface Item {}\n", "leaf.d.ts": "export interface Item {}\n" }
    const after = { ...before, "private.d.ts": "export {};\n" }
    assert.equal(compare(before, after, manifest).identical, true, name)
    assert.equal(compare(before, { ...after, [leaf]: "// public bytes changed\n" + before[leaf] }, manifest).identical, false, name)
  }
})
