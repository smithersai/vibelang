import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { canonicalize, compareDeclarations, emitDeclarations, lineDiff, listDeclarations, loadTypeScript } from "../lib/declarations.mjs"

// The runtime package's TypeScript (bun install in packages/runtime) has the compiler API.
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])

test("canonical text ignores comments, union order, property order and parentheses around a type argument", () => {
  const a = canonicalize(ts, `/** doc */\nexport declare const f: (x: "a" | "b") => Option<(string | number)>;\nexport interface I { b: string; a: number; m(): void }\n`)
  const b = canonicalize(ts, `export declare const f: (x: "b" | "a") => Option<number | string>;\nexport interface I {\n  a: number;\n  b: string;\n  m(): void\n}\n`)
  assert.equal(a, b)
})

test("canonical text ignores redundant type parentheses and keeps the ones precedence needs", () => {
  // foldkit-13: vibelang-format drops the parentheses around an explicit return type (html/lazy.d.ts).
  for (const [a, b] of [
    ["export declare const make: () => (<A>(value: A) => A);", "export declare const make: () => <A>(value: A) => A;"],
    ["export declare const x: (string);", "export declare const x: string;"],
    ["export type T = ((A | B)) | C;", "export type T = A | B | C;"],
    ["export declare function f(): (readonly string[]);", "export declare function f(): readonly string[];"]
  ]) assert.equal(canonicalize(ts, a), canonicalize(ts, b), a)
  for (const [a, b] of [
    ["export type T = (A | B)[];", "export type T = A | B[];"],
    ["export type T = (() => void) | string;", "export type T = () => void | string;"],
    ["export type T = keyof (A | B);", "export type T = keyof A | B;"],
    ["export type T = (A & B) | C;", "export type T = A & (B | C);"],
    ["export type F = (new () => A)[];", "export type F = new () => A[];"],
    ["export declare const make: () => (<A>(value: A) => A);", "export declare const make: () => <A>(value: A) => B;"]
  ]) assert.notEqual(canonicalize(ts, a), canonicalize(ts, b), a)
})

test("property: a type means the same with every redundant parenthesis written, and different types stay different", () => {
  // foldkit-13's neighbourhood: seeded random types over the operators whose precedence parentheses change.
  let seed = 13
  const next = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n)
  const gen = (depth) => {
    const k = depth <= 0 ? 0 : next(7)
    if (k === 0) return { k: "ref", name: ["A", "B", "C", "string"][next(4)] }
    if (k === 1 || k === 2) return { k: k === 1 ? "union" : "and", parts: [gen(depth - 1), gen(depth - 1)] }
    if (k === 3) return { k: "array", of: gen(depth - 1) }
    if (k === 4) return { k: "keyof", of: gen(depth - 1) }
    if (k === 5) return { k: "fn", ret: gen(depth - 1) }
    return { k: "generic", ret: gen(depth - 1) }
  }
  const f = ts.factory
  const node = (t) => {
    switch (t.k) {
      case "ref": return t.name === "string" ? f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword) : f.createTypeReferenceNode(t.name)
      case "union": return f.createUnionTypeNode(t.parts.map(node))
      case "and": return f.createIntersectionTypeNode(t.parts.map(node))
      case "array": return f.createArrayTypeNode(node(t.of))
      case "keyof": return f.createTypeOperatorNode(ts.SyntaxKind.KeyOfKeyword, node(t.of))
      case "fn": return f.createFunctionTypeNode(undefined, [], node(t.ret))
      case "generic": return f.createFunctionTypeNode([f.createTypeParameterDeclaration(undefined, "X")], [], node(t.ret))
    }
  }
  const full = (t) => {
    switch (t.k) {
      case "ref": return t.name
      case "union": return `(${t.parts.map(full).join(" | ")})`
      case "and": return `(${t.parts.map(full).join(" & ")})`
      case "array": return `(${full(t.of)}[])`
      case "keyof": return `(keyof ${full(t.of)})`
      case "fn": return `(() => ${full(t.ret)})`
      case "generic": return `(<X>() => ${full(t.ret)})`
    }
  }
  const printer = ts.createPrinter()
  const source = ts.createSourceFile("t.d.ts", "", ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const minimal = (t) => printer.printNode(ts.EmitHint.Unspecified, node(t), source)
  const seen = new Map()
  for (let i = 0; i < 300; i++) {
    const t = gen(4)
    const a = canonicalize(ts, `export type T = ${minimal(t)};`)
    assert.equal(a, canonicalize(ts, `export type T = ${full(t)};`), full(t))
    assert.equal(a, canonicalize(ts, a), "canonical text is a fixed point")
    // Two types whose minimal printings differ only by parentheses must not collapse: drop each needed pair and compare.
    const printed = minimal(t)
    if (printed.includes("(") && !seen.has(printed)) {
      seen.set(printed, true)
      const stripped = printed.replace(/\(([^()]*\|[^()]*)\)\[\]/, "$1[]")
      if (stripped !== printed) assert.notEqual(a, canonicalize(ts, `export type T = ${stripped};`), printed)
    }
  }
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

test("canonical text sorts an import or export list, and keeps what the list holds", () => {
  const a = canonicalize(ts, `import { ThreadId, type ScopedThreadRef } from "@t3tools/contracts";\nexport { b, a } from "./x.js";\n`)
  const b = canonicalize(ts, `import { type ScopedThreadRef, ThreadId } from "@t3tools/contracts";\nexport { a, b } from "./x.js";\n`)
  assert.equal(a, b)
  assert.notEqual(canonicalize(ts, `import { a } from "m";\n`), canonicalize(ts, `import { a, b } from "m";\n`))
  assert.notEqual(canonicalize(ts, `import { a } from "m";\n`), canonicalize(ts, `import { type a } from "m";\n`))
  assert.notEqual(canonicalize(ts, `import { a } from "m";\nimport { b } from "n";\n`), canonicalize(ts, `import { b } from "n";\nimport { a } from "m";\n`))
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

test("emitDeclarations removes what the compiler wrote outside outDir and keeps what it wrote inside", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-dts-"))
  try {
    // tsc writes a file outside rootDir beside its source and reports TS6059.
    const compiler = join(root, "vibelang")
    const stray = join(root, "lib/l.d.ts")
    mkdirSync(join(root, "lib"))
    writeFileSync(compiler, `#!/bin/sh
while [ $# -gt 0 ]; do [ "$1" = "--outDir" ] && out="$2"; shift; done
echo "export {};" > "$out/a.d.ts"
echo "export {};" > ${stray}
echo "error TS6059: File is not under rootDir."
echo "TSFILE: $out/a.d.ts"
echo "TSFILE: ${stray}"
exit 2
`, { mode: 0o755 })
    const emitted = await emitDeclarations({ compiler, tsconfig: "tsconfig.json", cwd: root, outDir: join(root, "out") })
    assert.deepEqual(emitted, { code: 2, files: 1 })
    assert.equal(existsSync(stray), false)
    assert.deepEqual(listDeclarations(join(root, "out")), ["a.d.ts"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
