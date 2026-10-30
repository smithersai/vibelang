import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repo = process.env.SPEC_WORKSPACE ?? fileURLToPath(new URL("../../", import.meta.url))
const read = (chapter) => readFileSync(repo + "/docs/design/src/" + chapter + ".md", "utf8")
const ts = createRequire(repo + "/experiments/package.json")("typescript")

test("EffectArrow separates the bare head from the decorated parenthesized head", () => {
  const grammar = read("900-appendices").split("#### EffectArrow\n")[1].split("#### EffectMethod")[0]
  const branches = grammar.match(/```text\n([\s\S]*?)```/)[1].trim().split("\n")
  assert.equal(branches.length, 2, "async arrows have two head shapes")
  const bare = branches.find(line => line.includes("BindingIdentifier"))
  assert.ok(bare, "the simple identifier is its own branch")
  assert.doesNotMatch(bare, /TypeParameters|ReturnType|ArrowParams/)
  assert.match(branches.find(line => !line.includes("BindingIdentifier")), /TypeParameters\? ArrowParams ReturnType\?/)
  const params = read("900-appendices").split("#### ArrowParams\n")[1].split("#### Modifiers")[0]
  assert.match(params, /ArrowParams = "\(" FormalParameters "\)"/)
})

test("all five printed effect-arrow heads agree with the native TypeScript syntax oracle", () => {
  const section = read("001-functions").split("// Arrow-head syntax controls")[1]?.split("```")[0]
  assert.ok(section, "retain the two rejection witnesses and three accepted controls")
  const lines = section.trim().split("\n").filter(line => line.startsWith("const "))
  assert.equal(lines.length, 5)
  for (const line of lines) {
    const native = line.replaceAll("number!!", "Promise<number>").replace(/\beffect\b/g, "async")
    const source = ts.createSourceFile("witness.ts", native, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    assert.equal(source.parseDiagnostics.length > 0, line.includes("// syntax error"), line)
  }
})
