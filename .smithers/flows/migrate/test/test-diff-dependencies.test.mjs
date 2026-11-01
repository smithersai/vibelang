import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { verifyTestDiff, testDiffMarkdown } from "../lib/test-diff.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const manifest = dependencies => JSON.stringify({ dependencies })
const check = (a, b, extra = {}) => {
  const scratch = mkdtempSync(join(tmpdir(), "dependency-proof-"))
  try { return verifyTestDiff({ ts,
    before: { "package.json": manifest({ effect: "4.1.0" }), "test/x.test.ts": a },
    after: { "package.json": manifest({ effect: "4.1.0", "vibelang-runtime": "0.0.12" }), "test/x.test.ts": b },
    renames: [], scratch, ...extra }) } finally { rmSync(scratch, { recursive: true, force: true }) }
}
const pairs = [
  ['expect(Object.keys(pkg.dependencies)).toEqual(["effect"])', 'expect(Object.keys(pkg.dependencies)).toEqual(["effect", "vibelang-runtime"])'],
  ['expect(pkg.dependencies).toStrictEqual({effect: "4.1.0"})', 'expect(pkg.dependencies).toStrictEqual({effect: "4.1.0", "vibelang-runtime": "0.0.12"})'],
  ['assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["effect"])', 'assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["effect", "vibelang-runtime"])'],
  ['const deps = pkg.dependencies; expect(deps).toEqual({effect: "4.1.0"})', 'const deps = pkg.dependencies; expect(deps).toEqual({effect: "4.1.0", "vibelang-runtime": "0.0.12"})'],
  ['expect(pkg).toEqual({name: "app", dependencies: {effect: "4.1.0"}})', 'expect(pkg).toEqual({name: "app", dependencies: {effect: "4.1.0", "vibelang-runtime": "0.0.12"}})']
]
for (const [a, b] of pairs) test("one dependency assertion addition: " + a, () => {
  const r = check(a, b)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.files[0].hunks[0].kind, "assertion")
  assert.equal(r.files[0].hunks[0].package, "package.json")
  const md = testDiffMarkdown(r)
  assert.match(md, /#### assertion edits/)
  assert.match(md, /test\/x.test.ts/)
})
const [a, b] = pairs[0]
for (const [name, next] of [
  ["second entry", b.replace('"vibelang-runtime"', '"vibelang-runtime", "other"')],
  ["removed entry", b.replace('"effect", ', '')],
  ["other name", b.replace("vibelang-runtime", "vibelang")],
  ["duplicate runtime", b.replace('"vibelang-runtime"', '"vibelang-runtime", "vibelang-runtime"')],
  ["other assertion change", b + '; expect(1).toBe(2)']
]) test("rejects dependency assertion " + name, () => {
  assert.equal(check(a + (name === "other assertion change" ? '; expect(1).toBe(1)' : ''), next).ok, false)
})
test("rejects no dependency gain, preexisting runtime, dev-only gain and another package", () => {
  for (const dependencies of [{ effect: "4.1.0" }, { effect: "4.1.0", "vibelang-runtime": "0.0.12" }]) {
    assert.equal(check(a, b, { before: { "package.json": manifest(dependencies), "test/x.test.ts": a },
      after: { "package.json": manifest(dependencies), "test/x.test.ts": b } }).ok, false)
  }
  assert.equal(check(a, b, { after: { "package.json": JSON.stringify({ devDependencies: { "vibelang-runtime": "0.0.12" } }), "test/x.test.ts": b } }).ok, false)
  assert.equal(check(a, b, { before: { "package.json": "{}", "packages/a/package.json": "{}", "packages/a/test/x.test.ts": a },
    after: { "package.json": manifest({ "vibelang-runtime": "0.0.12" }), "packages/a/package.json": "{}", "packages/a/test/x.test.ts": b } }).ok, false)
})
test("dependency context cannot bless an ordinary list, embedded config or version change", () => {
  for (const [old, next] of [
    ['expect(names).toEqual(["effect"])', 'expect(names).toEqual(["effect", "vibelang-runtime"])'],
    ['const config = {dependencies: ["effect"]}', 'const config = {dependencies: ["effect", "vibelang-runtime"]}'],
    [pairs[1][0], pairs[1][1].replace('"4.1.0"', '"4.2.0"')],
    [pairs[1][0], pairs[1][1].replace('"0.0.12"', '"wrong"')],
    [pairs[4][0], pairs[4][1].replace('name: "app"', 'name: "different"')],
    ['expect(pkg.devDependencies).toEqual(["effect"])', 'expect(pkg.devDependencies).toEqual(["effect", "vibelang-runtime"])']
  ]) assert.equal(check(old, next).ok, false)
})
test("property: fifth addendum accepts exactly one actual runtime dependency addition", () => {
  // Detail 272: "may gain exactly one ... entry, only in a package that gained
  // that dependency, only in a list or object of dependencies".
  fc.assert(fc.property(
    fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 8 }),
    fc.constantFrom("allowed", "extra", "drop", "wrong", "no-gain", "other-assertion"),
    fc.boolean(), (names, mode, object) => {
      const deps = Object.fromEntries(names.map(name => [name, "1"]))
      const next = { ...deps, "vibelang-runtime": "0.0.12" }
      if (mode === "extra") next["another-package"] = "1"
      if (mode === "drop") delete next[names[0]]
      if (mode === "wrong") { delete next["vibelang-runtime"]; next["vibelang"] = "1" }
      const render = d => object ? JSON.stringify(d) : JSON.stringify(Object.keys(d))
      const source = d => 'expect(' + (object ? 'pkg.dependencies' : 'Object.keys(pkg.dependencies)') + ').toEqual(' + render(d) + '); expect(1).toBe(1)'
      const old = source(deps), after = source(next).replace("toBe(1)", mode === "other-assertion" ? "toBe(2)" : "toBe(1)")
      assert.equal(check(old, after, {
        before: { "package.json": manifest(deps), "test/x.test.ts": old },
        after: { "package.json": manifest(mode === "no-gain" ? deps : { ...deps, "vibelang-runtime": "0.0.12" }), "test/x.test.ts": after }
      }).ok, mode === "allowed")
    }), { numRuns: 300, seed: 27225 })
})
test("negated, shadowed and comment-changing assertions are never the exception", () => {
  for (const [old, next] of [
    [a.replace(".toEqual", ".not.toEqual"), b.replace(".toEqual", ".not.toEqual")],
    ["function expect(x) { return {toEqual(y) {}} }; " + a, "function expect(x) { return {toEqual(y) {}} }; " + b],
    [a.replace('["effect"]', '[/*original*/ "effect"]'), b.replace('["effect",', '[/*changed*/ "effect",')]
  ]) assert.equal(check(old, next).ok, false)
})
test("property: allowed module, path, selector and dependency edits cannot hide a forbidden hunk", () => {
  fc.assert(fc.property(fc.array(fc.record({ kind: fc.constantFrom("specifier", "path", "selector", "dependency"),
    forbidden: fc.boolean(), n: fc.nat(9999) }), { minLength: 1, maxLength: 12 }), rows => {
      const render = (r, i, after) => {
        const body = {
          specifier: 'import "../src/X.' + (after ? "vibe" : "ts") + '"',
          path: 'const file' + i + ' = "../src/X.' + (after ? "vibe" : "ts") + '"',
          selector: 'const files' + i + ' = readdirSync("src").filter(n => ' +
            (after ? '(n.endsWith(".ts") || n.endsWith(".vibe")) && !n.endsWith(".d.vibe.ts")' : 'n.endsWith(".ts")') + ')',
          dependency: after ? b : a
        }[r.kind]
        return body + "; expect(1).toBe(" + (after && r.forbidden ? 2 : 1) + "); // " + r.n
      }
      const old = rows.map((r, i) => render(r, i, false)).join("\n")
      const next = rows.map((r, i) => render(r, i, true)).join("\n")
      assert.equal(check(old, next, {
        before: { "package.json": manifest({effect: "4.1.0"}), "src/X.ts": "", "test/x.test.ts": old },
        after: { "package.json": manifest({effect: "4.1.0", "vibelang-runtime": "0.0.12"}), "src/X.vibe": "", "src/X.d.vibe.ts": "", "test/x.test.ts": next },
        renames: [{from: "src/X.ts", to: "src/X.vibe"}]
      }).ok, rows.every(r => !r.forbidden))
    }), { numRuns: 300, seed: 27226 })
})
