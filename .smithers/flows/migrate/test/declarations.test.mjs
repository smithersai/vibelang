import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { canonicalize, compareDeclarations, lineDiff, listDeclarations, loadTypeScript } from "../lib/declarations.mjs"

// The runtime package's TypeScript (bun install in packages/runtime) has the compiler API.
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])

test("canonical text ignores comments, union order, property order and parentheses around a type argument", () => {
  const a = canonicalize(ts, `/** doc */\nexport declare const f: (x: "a" | "b") => Option<(string | number)>;\nexport interface I { b: string; a: number; m(): void }\n`)
  const b = canonicalize(ts, `export declare const f: (x: "b" | "a") => Option<number | string>;\nexport interface I {\n  a: number;\n  b: string;\n  m(): void\n}\n`)
  assert.equal(a, b)
})

test("canonical text keeps real changes: a type, an optional member, method order", () => {
  const base = canonicalize(ts, "export interface I { a: number; m(): void; n(): void }\n")
  assert.notEqual(base, canonicalize(ts, "export interface I { a: string; m(): void; n(): void }\n"))
  assert.notEqual(base, canonicalize(ts, "export interface I { a?: number; m(): void; n(): void }\n"))
  assert.notEqual(base, canonicalize(ts, "export interface I { a: number; n(): void; m(): void }\n"))
})

test("canonical text treats a relative ./x.ts and ./x.js as one module, wherever a declaration names one", () => {
  const forms = (ext) => [
    `export * from "./leaf${ext}";`,
    `export { a } from "../up/leaf${ext}";`,
    `import { b } from "./leaf${ext}";`,
    `import c = require("./leaf${ext}");`,
    `export declare const d: import("./leaf${ext}").T;`,
    `declare module "./leaf${ext}" {\n}`
  ]
  const ts_ = forms(".ts")
  const js = forms(".js")
  for (let i = 0; i < ts_.length; i++) assert.equal(canonicalize(ts, ts_[i]), canonicalize(ts, js[i]))
})

test("canonical text keeps every other .ts: a declaration file, a package, a string type, a value", () => {
  for (const [a, b] of [
    [`export * from "./leaf.d.ts";`, `export * from "./leaf.d.js";`],
    [`export * from "leaf.ts";`, `export * from "leaf.js";`],
    [`export * from "pkg/leaf.ts";`, `export * from "pkg/leaf.js";`],
    [`export declare const path: "./leaf.ts";`, `export declare const path: "./leaf.js";`],
    [`export type Path = "./leaf.ts" | "./other.ts";`, `export type Path = "./leaf.js" | "./other.js";`],
    [`export declare enum E { A = "./leaf.ts" }`, `export declare enum E { A = "./leaf.js" }`]
  ]) assert.notEqual(canonicalize(ts, a), canonicalize(ts, b), a)
})

test("compareDeclarations calls a module renamed to .vibe unchanged when its importer's declaration spells it .js", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-dts-"))
  try {
    for (const [dir, index] of [["ts", `export * from "./leaf.ts";\n`], ["vibe", `export * from "./leaf.js";\n`]]) {
      mkdirSync(join(root, dir))
      writeFileSync(join(root, dir, "index.d.ts"), index)
      writeFileSync(join(root, dir, "leaf.d.ts"), "export declare const value = 1;\n")
    }
    assert.equal(compareDeclarations(ts, join(root, "ts"), join(root, "vibe")).identical, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("compareDeclarations reports changed, added and removed files", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-dts-"))
  try {
    for (const [dir, files] of Object.entries({
      before: { "a.d.ts": "export type A = 1 | 2;\n", "b.d.ts": "export type B = string;\n", "gone.d.ts": "export {};\n" },
      after: { "a.d.ts": "// same\nexport type A = 2 | 1;\n", "b.d.ts": "export type B = number;\n", "new/c.d.ts": "export {};\n" }
    })) {
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(join(root, dir, file, ".."), { recursive: true })
        writeFileSync(join(root, dir, file), text)
      }
    }
    assert.deepEqual(listDeclarations(join(root, "after")), ["a.d.ts", "b.d.ts", "new/c.d.ts"])
    const result = compareDeclarations(ts, join(root, "before"), join(root, "after"))
    assert.equal(result.identical, false)
    assert.deepEqual(result.changed.map((c) => c.file), ["b.d.ts"])
    assert.deepEqual(result.added, ["new/c.d.ts"])
    assert.deepEqual(result.removed, ["gone.d.ts"])
    assert.deepEqual(result.changed[0].diff, ["-1: export type B = string;", "+1: export type B = number;"])
    assert.equal(compareDeclarations(ts, join(root, "before"), join(root, "before")).identical, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("lineDiff stops at its limit", () => {
  assert.equal(lineDiff("a\nb\nc", "x\ny\nz", 2).length, 2)
})
