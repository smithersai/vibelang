import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { verifyTestDiff, testDiffMarkdown } from "../lib/test-diff.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const compiler = fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const parseVibe = (text, file) => {
  const child = spawnSync(compiler, ["--estree", file], {input: text, encoding: "utf8"})
  assert.equal(child.status, 0, child.stderr)
  const {ast, error} = JSON.parse(child.stdout)
  if (error) throw new Error(error.message)
  return ast
}
const check = (a, b, file = "src/x.test.vibe", parser = parseVibe) => verifyTestDiff({ts,
  before: {[file]: a}, after: {[file]: b}, renames: [], parseVibe: parser})
const accepted = [
  ["whitespace", "effect function check(){return try load()}", "effect function check() {\n  return try load()\n}\n"],
  ["trailing commas", "const x = {a: [1, 2]}; f(x)", "const x = {a: [1, 2,],}; f(x,)"],
  ["removed terminators", "const x = 1;\nf(x);\nfunction f(x) { return x; }", "const x = 1\nf(x)\nfunction f(x) { return x }"],
  ["added terminators", "const x = 1\nf(x)\n", "const x = 1;\nf(x);\n"],
  ["comment reindentation", "// @ts-ignore\nf()\n/* keep this comment */\ng()", "  //   @ts-ignore\n  f()\n  /* keep   this\n comment */\n  g()"],
  ["regex and templates", "const r = /a[,;]b/g;\nconst t = `a${f()}b`;", "const r = /a[,;]b/g\nconst t = `a${f()}b`\n"],
  ["for body terminator only", "for (let i=0; i<2; i++) { f(); }", "for (let i=0; i<2; i++) { f() }"]
]
// docs/design/src/900-appendices.md#3dec61c09fc04468 — Chapter 900: formatter may change statement terminators with equal AST.
for (const [name, a, b] of accepted) test("formatter-only accepts " + name, () => {
  const result = check(a, b)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.files[0].hunks[0].kind, "formatter-only")
  assert.deepEqual(result.files[0].hunks[0].proof, {ast: true, tokens: true})
  assert.match(testDiffMarkdown(result), /#### formatter-only/)
  assert.match(testDiffMarkdown(result), /src\/x.test.vibe/)
})
const rejected = [
  ["added parentheses", "effect function f(){ return try load() }", "effect function f(){ return (try load()) }"],
  ["removed parentheses", "effect function f(){ return (try load()) }", "effect function f(){ return try load() }"],
  ["assertion token", "expect(1).toBe(1)", "expect(1).toBe(2)"],
  ["dropped expect-error", "// @ts-expect-error\nf()", "f()"],
  ["dropped ignore", "// @ts-ignore\nf()", "f()"],
  ["moved directive", "// @ts-ignore\nf()\ng()", "f()\n// @ts-ignore\ng()"],
  ["edited comment text", "// coverage matters\nf()", "// coverage removed\nf()"],
  ["comment kind", "/* keep */\nf()", "// keep\nf()"],
  ["for-head semicolon", "for (let i=0; i<2; i++) f()", "for (let i=0 i<2; i++) f()"],
  ["removed empty statement", "f();;", "f();"],
  ["added empty statement", "f();", "f();;"],
  ["array hole", "const x = [1,,]", "const x = [1,]"],
  ["string whitespace", "const x = `keep  spaces`", "const x = `keep spaces`"],
  ["invalid after", "effect function f() { return try load() }", "effect function f( {"],
  ["invalid before", "effect function f( {", "effect function f() { return try load() }"],
  ["ASI changes AST", "function f(){return x}", "function f(){return\nx}"]
]
// docs/design/src/900-appendices.md#ab9c3fe61ba616c2 — Chapter 900: directives, for-head semicolons and empty statements retain meaning.
// docs/design/src/900-appendices.md#c490698ac5b8e08c — Chapter 900: directives, for-head semicolons and empty statements retain meaning.
for (const [name, a, b] of rejected) test("formatter-only rejects " + name, () => assert.equal(check(a,b).ok, false))
test("formatter allowance is only for baseline VibeLang tests", () => {
  for (const file of ["src/x.test.ts", "fixtures/x.vibe", "test/config.json"]) assert.equal(check("f();", "f()", file).ok, false)
  assert.equal(verifyTestDiff({ts, before: {"src/x.test.ts": "f();"}, after: {"src/x.test.vibe": "f()"}, renames: [] ,parseVibe}).ok, false)
})
test("formatter proof fails closed without a working parser", () => {
  for (const parser of [undefined, () => {throw new Error("parse failed")}, () => ({type:"Program"})]) {
    const result = verifyTestDiff({ts, before: {"x.test.vibe": "f();"}, after: {"x.test.vibe": "f()"}, renames: [], parseVibe: parser})
    assert.equal(result.ok, false)
  }
})
test("property: formatter AST and tokens accept exactly permitted trivia changes", () => {
  // Detail 272 sixth addendum: "parsed AST is identical" AND "only whitespace,
  // trailing commas and statement-terminating semicolons may differ".
  fc.assert(fc.property(fc.integer({min: 0,max:9999}), fc.integer({min:1,max:8}),
    fc.constantFrom("allowed", "parens", "token", "drop-comment", "move-comment", "edit-comment", "empty-statement", "hole"),
    (n, indent, mode) => {
      const a = "// @ts-ignore\nconst x = [" + n + "];\nf(x);\n"
      let b = " ".repeat(indent) + "//   @ts-ignore\nconst x = [ " + n + ", ]\nf(x)\n"
      if(mode === "parens") b = b.replace("f(x)", "f((x))")
      if(mode === "token") b = b.replace(String(n), String(n+1))
      if(mode === "drop-comment") b = b.slice(b.indexOf("\n")+1)
      if(mode === "move-comment") b = b.slice(b.indexOf("\n")+1) + "// @ts-ignore\n"
      if(mode === "edit-comment") b = b.replace("@ts-ignore", "@ts-expect-error")
      if(mode === "empty-statement") b += ";;"
      if(mode === "hole") b = b.replace(", ]", ",, ]")
      assert.equal(check(a,b).ok, mode === "allowed", mode)
    }), {numRuns:300,seed:27226})
})
