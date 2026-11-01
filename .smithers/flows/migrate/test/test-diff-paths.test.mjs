import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { verifyTestDiff, testDiffMarkdown } from "../lib/test-diff.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const check = (a, b = a.replaceAll("X.ts", "X.vibe"), extra = {}) => {
  const scratch = mkdtempSync(join(tmpdir(), "path-proof-"))
  try { return verifyTestDiff({ ts, before: { "src/X.ts": "", "test/x.test.ts": a },
    after: { "src/X.vibe": "", "test/x.test.ts": b }, renames: [{ from: "src/X.ts", to: "src/X.vibe" }],
    scratch, ...extra }) } finally { rmSync(scratch, { recursive: true, force: true }) }
}
const paths = [
  'const file = "../src/X.ts"',
  'const file = "src/X.ts"',
  'const file = "/src/X.ts"',
  'readFileSync("../src/X.ts", "utf8")',
  'const file = path.join(__dirname, "../src", "X.ts")',
  'const file = join(import.meta.dirname, "../src/X.ts")',
  'const repoRoot = path.resolve(__dirname, ".."); const file = path.resolve(repoRoot, "src/X.ts")',
  'const repoRoot = "."; const file = path.join(repoRoot, "src", "X.ts")',
  'const file = new URL("../src/X.ts", import.meta.url)',
  'import { join as p } from "node:path"; const file = p(__dirname, "../src/X.ts")'
]
for (const a of paths) test("migrated path resolves: " + a, () => {
  const r = check(a)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.files[0].hunks[0].kind, "path")
  assert.equal(r.files[0].hunks[0].resolved.to, "src/X.vibe")
  assert.match(testDiffMarkdown(r), /path/)
})
for (const a of [
  'const file = "../else/X.ts"',
  'const file = path.join(dynamicRoot, "X.ts")',
  'const file = path.resolve(getRoot(), "X.ts")',
  'const file = new URL("X.ts", dynamicUrl)',
  'const file = "../src/X.ts"; expect(1).toBe(1)'
]) test("rejects wrong or dynamic path: " + a, () => {
  const b = a.replaceAll("X.ts", "X.vibe").replace("toBe(1)", "toBe(2)")
  const r = check(a, b)
  assert.equal(r.ok, false)
  if (a.includes("dynamic") || a.includes("getRoot")) assert.match(JSON.stringify(r), /not statically resolvable/)
})
const reads = [
  'expect(readFileSync("../src/X.ts", "utf8")).toContain("hello")',
  'const text = fs.readFileSync("../src/X.ts", "utf8"); expect(text).toMatch(/hello/)',
  'const text = await fs.promises.readFile("../src/X.ts", "utf8"); const lines = text.split("\\n"); assert.equal(lines.length, 2)',
  'const file = "../src/X.ts"; const text = await readFile(file, "utf8"); const alias = text; expect(alias).toBe("hello")',
  'const text = await Bun.file("../src/X.ts").text(); expect(text).toContain("hello")',
  'const text = readFileSync(path.join(__dirname, "../src", "X.ts"), "utf8"); expect(text.length).toBe(2)',
  'import { readFileSync as read } from "node:fs"; const text = read("../src/X.ts", "utf8"); expect(text).toBe("hello")',
  'readFile("../src/X.ts", "utf8", (error, text) => { expect(text).toBe("hello") })',
  'const text = readFileSync("../src/X.ts", "utf8"); checkSourceShape(text)',
  'const file = "../src/X.ts"; expect(file).toBe("../src/X.ts")'
]
for (const a of reads) test("source text or path assertion stays TypeScript: " + a, () => {
  const r = check(a)
  assert.equal(r.ok, false, JSON.stringify(r))
  assert.match(JSON.stringify(r), /keep .*ts.*, send to migfix/)
})
test("a read of the migrated file elsewhere still prevents the path edit", () => {
  const a = 'const file = "../src/X.ts"; const other = readFileSync("src/X.ts", "utf8"); expect(other).toBe("text")'
  assert.equal(check(a, a.replace('file = "../src/X.ts"', 'file = "../src/X.vibe"')).ok, false)
})
test("path resolution rejects an ambiguous basename and a changed path", () => {
  const a = 'const file = "src/X.ts"'
  assert.equal(check(a, undefined, { before: { "src/X.ts": "", "test/src/X.ts": "", "test/x.test.ts": a } }).ok, false)
  assert.equal(check('const file = "../src/X.ts"', 'const file = "../other/X.vibe"').ok, false)
})
test("property: fourth addendum permits only resolved paths without assertion edits", () => {
  // Detail 272: "when the flow checks that the new path resolves to the migrated file,
  // nothing else in the test changes". Source-text assertions keep the module .ts.
  fc.assert(fc.property(fc.array(fc.record({ form: fc.integer({ min: 0, max: paths.length - 1 }),
    mode: fc.constantFrom("allowed", "assertion", "elsewhere", "text"), n: fc.integer() }),
    { minLength: 1, maxLength: 8 }), rows => {
      const render = (r, i, after) => {
        let p = paths[r.form].replaceAll("file", "file" + i).replaceAll("repoRoot", "repoRoot" + i)
        if (after) p = p.replaceAll("X.ts", r.mode === "elsewhere" ? "Y.vibe" : "X.vibe")
        p += "; expect(1).toBe(" + (after && r.mode === "assertion" ? 2 : 1) + "); // " + r.n
        if (r.mode === "text") p += '\nconst text' + i + ' = readFileSync("../src/X.' + (after ? "vibe" : "ts") + '", "utf8"); expect(text' + i + ').toBe("text")'
        return p
      }
      assert.equal(check(rows.map((r, i) => render(r, i, false)).join("\n"),
        rows.map((r, i) => render(r, i, true)).join("\n")).ok, rows.every(r => r.mode === "allowed"))
    }), { numRuns: 300, seed: 27224 })
})
test("source text passed through a promise callback keeps the module TypeScript", () => {
  for (const a of [
    'fs.promises.readFile("../src/X.ts", "utf8").then(text => expect(text).toBe("hello"))',
    'const promise = fs.promises.readFile("../src/X.ts", "utf8"); promise.then(text => assert.equal(text.length, 2))'
  ]) assert.equal(check(a).ok, false)
})
test("static path builders cannot clamp an escape back into the repository", () => {
  for (const a of [
    'const file = path.join(__dirname, "../../../src/X.ts")',
    'const file = path.resolve(import.meta.dirname, "../../../src/X.ts")',
    'const file = new URL("../../../src/X.ts", import.meta.url)'
  ]) assert.equal(check(a).ok, false)
})
test("mutable path aliases cannot hide a read that feeds an assertion", () => {
  for (const a of [
    'let file = "../src/X.ts"; expect(readFileSync(file, "utf8")).toBe("text")',
    'let file; file = "../src/X.ts"; const text = fs.readFileSync(file, "utf8"); expect(text).toBe("text")',
    'let file = "../src/X.ts"; const alias = file; const text = readFileSync(alias, "utf8"); assert.equal(text.length, 2)'
  ]) assert.equal(check(a).ok, false, a)
})
test("mutable callback path aliases cannot conceal source-text assertions", () => {
  const a = 'let file = "../src/X.ts"; readFile(file, "utf8", (error, text) => { expect(text).toBe("hello") })'
  assert.equal(check(a).ok, false)
})
test("TSX filesystem paths resolve to the migrated vibex file", () => {
  const old = 'const file = "../src/X.tsx"', next = 'const file = "../src/X.vibex"'
  assert.equal(check(old, next, { before: { "src/X.tsx": "", "test/x.test.ts": old },
    after: { "src/X.vibex": "", "test/x.test.ts": next },
    renames: [{ from: "src/X.tsx", to: "src/X.vibex" }] }).ok, true)
})
test("property: mutable read aliases preserve the source-text oracle", () => {
  // Fourth addendum: "A test that asserts on the file's text ... keeps that
  // module .ts". Mutable path aliases and read callbacks cannot hide that use.
  fc.assert(fc.property(fc.stringMatching(/^[a-z]{1,8}$/), fc.boolean(),
    fc.constantFrom("sync", "callback", "promise", "bun"), (name, assigned, kind) => {
      const prefix = assigned ? 'let file; file = "../src/' : 'let file = "../src/'
      const oldPrefix = prefix + name + '.ts"; const alias = file; '
      const read = {
        sync: 'const text = readFileSync(alias, "utf8"); expect(text).toBe("hello")',
        callback: 'fs.readFile(alias, "utf8", (error, text) => expect(text).toBe("hello"))',
        promise: 'fs.promises.readFile(alias, "utf8").then(text => assert.equal(text.length, 2))',
        bun: 'const text = await Bun.file(alias).text(); expect(text).toBe("hello")'
      }[kind]
      const old = oldPrefix + read, next = old.replaceAll(name + ".ts", name + ".vibe")
      const common = { renames: [{ from: "src/" + name + ".ts", to: "src/" + name + ".vibe" }] }
      const trees = (a, b) => ({ ...common, before: { ["src/" + name + ".ts"]: "", "test/x.test.ts": a },
        after: { ["src/" + name + ".vibe"]: "", "test/x.test.ts": b } })
      assert.equal(check(old, next, trees(old, next)).ok, false)
      const control = oldPrefix + "load(alias)", controlNext = control.replaceAll(name + ".ts", name + ".vibe")
      assert.equal(check(control, controlNext, trees(control, controlNext)).ok, true)
    }), { numRuns: 150, seed: 27227 })
})
