import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { repairPrompt } from "../lib/repair.mjs"
import { createRequire } from "node:module"
import { join, matchesGlob } from "node:path"
import { test } from "node:test"
import { restoreSourceLiterals, rewriteSourceLiterals as rewriteActual } from "../lib/source-paths.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const rewriteSourceLiterals = (ts, text, file, renames, options = {}) => rewriteActual(ts, text, file, renames, { inventory: renames.map(r => r.from), ...options })

test("foldkit-67: source references and globs move; assertion expectations and test names stay", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes("Assertions, expected values, test names and\ntype literals stay as written."))

  const original = [
    'const source = readFileSync("src/main.ts", "utf8")',
    'const pages = import.meta.glob("../page/**/*.ts")',
    'test("src/main.ts", () => expect(source).toEqual("src/main.ts"))',
    'assert.equal(source, "src/main.ts")',
    '// readFileSync("src/main.ts")',
    'type Contract = "src/main.ts"',
    ''
  ].join("\n")
  const result = rewriteSourceLiterals(ts, original, "src/test.ts", [{ from:"src/main.ts", to:"src/main.vibe" }, { from:"page/demo.ts", to:"page/demo.vibe" }])
  assert.ok(result.text.includes('readFileSync("src/main.vibe"'))
  assert.ok(result.text.includes('test("src/main.ts"'))
  assert.ok(result.text.includes('toEqual("src/main.ts")'))
  assert.ok(result.text.includes('assert.equal(source, "src/main.ts")'))
  assert.ok(result.text.includes('// readFileSync("src/main.ts")'))
  assert.ok(result.text.includes('type Contract = "src/main.ts"'))
  assert.ok(result.text.includes('../page/**/!(*.d.vibe).{ts,vibe}'))
})

test("foldkit-67: generated path/glob neighbours retain TS coverage and exclude native sidecars", () => {
  fc.assert(fc.property(
    fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/), fc.constantFrom(".ts", ".mts", ".cts"), fc.constantFrom("'", '"'),
    (name, ext, q) => {
      const from = "src/" + name + ext, to = "src/" + name + ".vibe"
      const original = "const path = " + q + from + q + "; const glob = import.meta.glob(" + q + "src/**/*" + ext + q + ")"
      const result = rewriteSourceLiterals(ts, original, "test/unit.ts", [{ from, to }])
      const source = ts.createSourceFile("unit.ts", result.text, ts.ScriptTarget.Latest, true)
      const path = source.statements[0].declarationList.declarations[0].initializer.text
      const glob = source.statements[1].declarationList.declarations[0].initializer.arguments[0].text
      assert.equal(path, to)
      assert.equal(matchesGlob(from, glob), true)
      assert.equal(matchesGlob(to, glob), true)
      assert.equal(matchesGlob("src/" + name + ".d.vibe.ts", glob), false)
      assert.equal(matchesGlob("src/other" + ext, glob), true)
      assert.equal(rewriteSourceLiterals(ts, result.text, "test/unit.ts", [{ from, to }]).text, result.text)
    }
  ), { seed: 6733167, numRuns: 250 })
})

test("foldkit-67: guarded extension lists add native sources without admitting sidecars", () => {
  fc.assert(fc.property(fc.boolean(), fc.constantFrom("'", '"'), (set, q) => {
    const list = "[" + q + ".ts" + q + ", " + q + ".js" + q + "]"
    const body = "function collect(file) { const extensions = " + (set ? "new Set(" + list + ")" : list) + "; return !file.endsWith(" + q + ".d.vibe.ts" + q + ") && extensions." + (set ? "has" : "includes") + "(file.slice(file.lastIndexOf('.'))) }"
    const result = rewriteSourceLiterals(ts, body, "collector.ts", [{from:"src/main.ts",to:"src/main.vibe"}])
    assert.equal(result.edits.length, 1)
    const collect = new Function(result.text + "; return collect")()
    assert.equal(collect("src/main.ts"), true)
    assert.equal(collect("src/main.vibe"), true)
    assert.equal(collect("src/main.d.vibe.ts"), false)
    assert.equal(collect("src/other.js"), true)
    assert.equal(rewriteSourceLiterals(ts, result.text, "collector.ts", [{from:"src/main.ts",to:"src/main.vibe"}]).edits.length, 0)
  }), { seed: 6733168, numRuns: 100 })
})

test("foldkit-67: package export maps and TypeScript config globs keep their own wiring dialect", () => {
  const renames = [{ from:"src/main.ts", to:"src/main.vibe" }]
  for (const [file, text] of [
    ["package.json", '{"exports":{"./*":"./src/*.ts"},"imports":{"#*":"./src/*.ts"}}'],
    ["tsconfig.build.json", '{"include":["src/**/*.ts","src/**/*.vibe"]}']
  ]) assert.equal(rewriteSourceLiterals(ts,text,file,renames).text,text)
  const source = "function glob(pattern) { return pattern }\nconst selected = glob('src/**/*.ts')"
  const result = rewriteSourceLiterals(ts,source,"custom.ts",renames)
  assert.equal(result.text,source)
  assert.equal(result.warnings.length,1)
  const imported = "import { glob as collect } from 'node:fs'\nconst selected = collect('src/**/*.ts')"
  assert.equal(rewriteSourceLiterals(ts,imported,"collector.ts",renames).edits.length,1)
})

test("foldkit-67: repair exposes source selector diffs and unresolved dialects", () => {
  const prompt = repairPrompt({
    context: "context", run: "/run", batch: "01", target: "/repo", packages: ["."], test: "test", files: ["src/main.vibe"], step: "step",
    codemod: { fix: { byFile: {}, refused: [] }, referenceEdits: [{ file:"test/source.test.ts", line:2, kind:"source-reference", from:"src/main.ts", to:"src/main.vibe" }], referenceWarnings: ["collector.ts:3: unguarded extension selector"] },
    compile: { diagnostics: [], newErrors: [] }
  })
  assert.ok(prompt.includes("test/source.test.ts:2 [source-reference]"))
  assert.ok(prompt.includes("src/main.ts") && prompt.includes("src/main.vibe"))
  assert.ok(prompt.includes("collector.ts:3: unguarded extension selector"))
  assert.ok(prompt.includes("test assertions, expected values, budgets, skips and names"))
})

test("foldkit-67: escaped and Unicode source literals round-trip in their original spelling", () => {
  const segment = fc.constantFrom("plain", "space dir", "quote'part", '"double"', "braces{a}", "brackets[x]", "cash$" + "{x}", "emoji-💡", "back\\slash")
  fc.assert(fc.property(segment, segment, fc.boolean(), (directory, name, single) => {
    const from = "src/" + directory + "/" + name + "-source.ts", to = from.replace(/\.ts$/, ".vibe")
    const literal = single ? "'" + from.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'" : JSON.stringify(from)
    const original = "const filename = fs.readFileSync(" + literal + ")\n"
    const root = mkdtempSync(join(tmpdir(), "foldkit-literal-roundtrip-"))
    try {
      const result = rewriteSourceLiterals(ts, original, "reader.ts", [{ from, to }])
      assert.equal(result.edits.length, 1)
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, "reader.ts"), result.text)
      restoreSourceLiterals(ts, root, result.edits, from, [{from,to}])
      assert.equal(readFileSync(join(root,"reader.ts"),"utf8"), original)
    } finally { rmSync(root, { recursive:true, force:true }) }
  }), { seed: 6733169, numRuns: 120 })
})
