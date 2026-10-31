import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chapter, read, tools } from "./spec-witness.mjs"

const ts = createRequire(import.meta.url)("typescript")
const appendix = () => chapter("900-appendices")

// The 1xxx grammar codes TypeScript reports for a script, so module code's own reservation of `await` stays out.
function syntax(source) {
  const directory = mkdtempSync(join(tools, ".spec-names-"))
  try {
    const file = join(directory, "witness.ts")
    writeFileSync(file, source + "\n")
    const options = { noEmit: true, types: [], target: ts.ScriptTarget.ES2022, moduleDetection: ts.ModuleDetectionKind.Legacy }
    return ts.getPreEmitDiagnostics(ts.createProgram([file], options)).filter(d => d.file?.fileName === file && d.code < 2000).map(d => d.code)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test("Appendix A defines the Name and ReturnType its function productions use", () => {
  const text = appendix()
  const uses = ["EffectFunction", "EffectFunctionOverload", "Producer"].map(name => text.match(new RegExp(`^${name} = .*$`, "m"))?.[0])
  for (const use of uses) assert.match(use, /Name\? TypeParameters\? Params ReturnType\?/)
  assert.match(text, /^Name = BindingIdentifier   \(an expression's own name: the parameters of its body, \[\+Effect\] included, and \[\+Yield\] for a Producer; a declaration's or overload signature's: the enclosing context's\)$/m)
  assert.match(text, /^ReturnType = ":" Type   \(TypeScript's return-type annotation/m)
})

test("an Effect function expression's own name is reserved as an async expression's is", () => {
  const section = appendix().split("### The `[Effect]` parameter")[1].split("Under `[+Effect]`:")[0]
  assert.match(section, /An `effect` function or producer expression's own \[Name\]\(#name\) parses with the parameters of its body, `\[\+Effect\]` included/)
  assert.match(section, /So `fork` or `join` as that name is `EK1702`, as `\(async function await\(\) \{ \}\)` is a SyntaxError/)
  assert.match(section, /A declaration's name and an overload signature's take the enclosing context/)
  assert.match(read("docs/design/vips/0017-fork.md"), /\*\*Amended 2026-10-31: an Effect function expression's own name\.\*\* .*`\(effect function join\(\) \{ \}\)` is `EK1702`/)
  // TypeScript's own parse is the counterpart: the expression name is reserved, the declaration name and a method name are not.
  assert.ok(syntax("const f = (async function await() { })").length > 0, "async expression named await")
  assert.deepEqual(syntax("async function await() { }"), [], "async declaration named await in a script")
  assert.deepEqual(syntax("const o = { async await() { } }"), [], "async method named await")
})
