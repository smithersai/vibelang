import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { fixToFixedPoint, keepMutableMembers, mergeFixes, parseFixOutput, renameBatch, rewriteImports, rewriteSpecifier, rewriteTotals, vibePath } from "../lib/codemod.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"

test("vibePath renames only .ts modules", () => {
  assert.equal(vibePath("src/a.ts"), "src/a.vibe")
  assert.throws(() => vibePath("src/a.d.ts"))
  assert.throws(() => vibePath("src/a.tsx"))
})

test("a .vibe importer names local modules by their source names", () => {
  assert.equal(rewriteSpecifier("src/a.vibe", "./b.js", "src/b.vibe"), "./b.vibe")
  assert.equal(rewriteSpecifier("src/a.vibe", "./c.js", "src/c.ts"), "./c.ts")
  assert.equal(rewriteSpecifier("src/a.vibe", "../d/index.js", "d/index.ts"), "../d/index.ts")
  assert.equal(rewriteSpecifier("src/a.vibe", "./e", "src/e.ts"), "./e.ts")
  assert.equal(rewriteSpecifier("src/a.vibe", "./dir", "src/dir/index.vibe"), "./dir/index.vibe")
  assert.equal(rewriteSpecifier("src/a.vibe", "./b.vibe", "src/b.vibe"), "./b.vibe")
})

test("a .ts importer names a .vibe module by its source name, which stock TypeScript resolves to its sidecar", () => {
  assert.equal(rewriteSpecifier("src/a.ts", "./b.js", "src/b.vibe"), "./b.vibe")
  assert.equal(rewriteSpecifier("src/a.ts", "./b.ts", "src/b.vibe"), "./b.vibe")
  // An extensionless specifier stays: its declaration would name ./b.js.
  assert.equal(rewriteSpecifier("src/a.ts", "./b", "src/b.vibe"), "./b")
  assert.equal(rewriteSpecifier("src/a.ts", "./c.js", "src/c.ts"), "./c.js")
  // After revert returns b to .ts, the codemod's .vibe specifier names it again.
  assert.equal(rewriteSpecifier("src/a.ts", "./b.vibe", "src/b.ts"), "./b.ts")
})

test("renameBatch and rewriteImports update a small package", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-codemod-"))
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src/a.ts"), "import { b } from './b.js'\nimport { c } from './c.js'\nexport const a = b + c\n")
    writeFileSync(join(root, "src/b.ts"), "export const b = 1\n")
    writeFileSync(join(root, "src/c.ts"), "import { a } from './a.js'\nexport const c = 2\n")
    writeFileSync(join(root, "src/d.vibe"), "import { a } from './a.ts'\n")
    const renames = renameBatch(root, ["src/a.ts"])
    assert.deepEqual(renames, [{ from: "src/a.ts", to: "src/a.vibe" }])
    assert.throws(() => renameBatch(root, ["src/a.ts"]), /does not exist/)
    const edits = rewriteImports(root, ["src/a.vibe", "src/b.ts", "src/c.ts", "src/d.vibe"])
    assert.deepEqual(edits, [
      { file: "src/a.vibe", from: "./b.js", to: "./b.ts" },
      { file: "src/a.vibe", from: "./c.js", to: "./c.ts" },
      { file: "src/c.ts", from: "./a.js", to: "./a.vibe" },
      { file: "src/d.vibe", from: "./a.ts", to: "./a.vibe" }
    ])
    assert.equal(readFileSync(join(root, "src/a.vibe"), "utf8"), "import { b } from './b.ts'\nimport { c } from './c.ts'\nexport const a = b + c\n")
    assert.equal(readFileSync(join(root, "src/c.ts"), "utf8"), "import { a } from './a.vibe'\nexport const c = 2\n")
    assert.equal(existsSync(join(root, "src/a.ts")), false)
    assert.deepEqual(rewriteImports(root, ["src/a.vibe", "src/b.ts", "src/c.ts", "src/d.vibe"]), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("parseFixOutput reads applied rewrites, refusals and the total", () => {
  const output = [
    "vibelang --fix: src/users.vibe: 4 fixes (EK4830 ×1, EK4831 ×1, EK4833 ×1, prelude import ×1)",
    "vibelang --fix: src/one.vibe: 1 fix (EK4834 ×1)",
    "vibelang --fix: src/users.vibe:12: EK4835 not fixed: the fixed program would report TS2322: Type 'unknown' is not assignable",
    "vibelang --fix: 5 fixes in 2 files; 1 fix refused.",
    "src/users.vibe(8,60): error EK1002: Effect.gen expects a JavaScript generator"
  ].join("\n")
  const parsed = parseFixOutput(output, { cwd: "/repo/packages/p", root: "/repo" })
  assert.equal(parsed.total, 5)
  assert.deepEqual(parsed.files, {
    "packages/p/src/users.vibe": { EK4830: 1, EK4831: 1, EK4833: 1, "prelude import": 1 },
    "packages/p/src/one.vibe": { EK4834: 1 }
  })
  assert.deepEqual(parsed.refused, [{ file: "packages/p/src/users.vibe", line: 12, code: "EK4835", error: "TS2322: Type 'unknown' is not assignable" }])
  assert.deepEqual(parseFixOutput("vibelang --fix: 0 fixes in 0 files.\n"), { total: 0, files: {}, refused: [] })
})

test("mergeFixes and rewriteTotals add rounds and files", () => {
  const merged = mergeFixes(mergeFixes({}, { a: { EK4830: 1 } }), { a: { EK4830: 2, "prelude import": 1 }, b: { EK4833: 1 } })
  assert.deepEqual(merged, { a: { EK4830: 3, "prelude import": 1 }, b: { EK4833: 1 } })
  assert.deepEqual(rewriteTotals(merged), { EK4830: 3, "prelude import": 1, EK4833: 1 })
})

test("keepMutableMembers marks the members TypeScript declares writable mutable, so the .vibe file declares the same types", () => {
  // The runtime package's TypeScript (bun install in packages/runtime) has the compiler API.
  const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
  const root = mkdtempSync(join(tmpdir(), "migrate-mutable-"))
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src/types.ts"), [
      "export interface SendOptions {",
      "  /** json or text */",
      "  contentType?: \"json\" | \"text\"",
      "  readonly id: string",
      "  [key: string]: unknown",
      "}",
      "export const retry = <E extends { _tag: string }>(error: E) => error",
      "export type Info = Readonly<{ path: string }>",
      "export class SendError extends Data.TaggedError(\"SendError\")<{ message: string }> {}",
      "export class Box { value: number = 1 }",
      ""
    ].join("\n"))
    writeFileSync(join(root, "src/plain.ts"), "export const one = 1\n")
    assert.deepEqual(keepMutableMembers(ts, root, ["src/types.ts", "src/plain.ts"]), [{ file: "src/types.ts", count: 3 }])
    assert.equal(readFileSync(join(root, "src/types.ts"), "utf8"), [
      "export interface SendOptions {",
      "  /** json or text */",
      "  mutable contentType?: \"json\" | \"text\"",
      "  readonly id: string",
      "  mutable [key: string]: unknown",
      "}",
      "export const retry = <E extends { mutable _tag: string }>(error: E) => error",
      "export type Info = Readonly<{ path: string }>",
      "export class SendError extends Data.TaggedError(\"SendError\")<{ message: string }> {}",
      "export class Box { value: number = 1 }",
      ""
    ].join("\n"))
    assert.equal(readFileSync(join(root, "src/plain.ts"), "utf8"), "export const one = 1\n")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("fixToFixedPoint keeps the rewrites of the batch's files only, and an earlier batch's file stays as committed", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-fix-scope-"))
  try {
    mkdirSync(join(root, "pkg/src"), { recursive: true })
    writeFileSync(join(root, "pkg/src/batch.vibe"), "export const a = 1\n")
    writeFileSync(join(root, "pkg/src/earlier.vibe"), "import * as DateTime from \"effect/DateTime\"\n")
    // A compiler whose --fix rewrites every .vibe file of the project it has not rewritten yet, as vibelang does.
    const compiler = join(root, "fake-vibelang")
    writeFileSync(compiler, `#!/usr/bin/env node
const fs = require("node:fs")
let n = 0
for (const file of ["src/batch.vibe", "src/earlier.vibe"]) {
  const text = fs.readFileSync(file, "utf8")
  if (text.includes("// fixed")) continue
  fs.writeFileSync(file, text + "// fixed\\n")
  console.log("vibelang --fix: " + file + ": 1 fix (prelude import ×1)")
  n++
}
console.log("vibelang --fix: " + n + " fixes in " + n + " files.")
`)
    chmodSync(compiler, 0o755)
    const result = await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: join(root, "pkg"), root, only: ["pkg/src/batch.vibe"] })
    assert.equal(readFileSync(join(root, "pkg/src/earlier.vibe"), "utf8"), "import * as DateTime from \"effect/DateTime\"\n")
    assert.equal(readFileSync(join(root, "pkg/src/batch.vibe"), "utf8"), "export const a = 1\n// fixed\n")
    assert.deepEqual(Object.keys(result.byFile), ["pkg/src/batch.vibe"])
    assert.equal(result.settled, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
