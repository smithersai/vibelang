import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// Loop round 3, OPUS-1 (decided detail 245): the runtime duplicate rule stops
// at one top-level pattern; across patterns a name repeats as a let would.
test("chapter 4 and VIP-7 limit the duplicate rule to one top-level pattern", () => {
  const match = chapter("004-match")
  assert.ok(match.includes("The pinned duplicate-initialization rules and their `or` replacement exception apply within one top-level pattern."))
  assert.ok(match.includes("Two top-level patterns that bind one name in the same lexical home are a redeclaration"))
  assert.ok(match.includes("`TS2451` beside another lexical declaration, `TS2300` beside a parameter ([VIP-7](../vips/0007-match.md#binding-homes-and-redeclarations))"))
  // TypeScript reports TS2451 on both declarations, so the example expects it in its header.
  assert.ok(match.includes("if (b is { id: let id }) return id // TS2451 on both bindings, as for two let declarations: id is already declared in this block"))
  assert.ok(match.includes("The diagnostic offers to rename the later binding and its uses."))
  const vip = read("docs/design/vips/0007-match.md")
  assert.ok(vip.includes("**Amended 2026-10-31: one name per home.**"))
})

test("a native let reports the codes the rule names", async () => {
  const { default: ts } = await import("typescript")
  const codes = (source) => {
    const options = { noEmit: true, types: [], target: ts.ScriptTarget.ESNext, noLib: true }
    const host = ts.createCompilerHost(options)
    const getSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (name, version) => name === "t.ts" ? ts.createSourceFile(name, source, version) : getSourceFile(name, version)
    const program = ts.createProgram(["t.ts"], options, host)
    return [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()].filter(d => d.file?.fileName === "t.ts").map(d => d.code)
  }
  assert.ok(codes("function f() { let n = 1; let n = 2 }").includes(2451))
  assert.ok(codes("function f(n: number) { let n = 1 }").includes(2300))
})
