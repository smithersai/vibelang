import assert from "node:assert/strict"
import test from "node:test"
import fc from "fast-check"
import ts from "typescript"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("is bindings have a home in every head and initializer, and reads before assignment are checked", () => {
  const match = chapter("004-match")
  for (const text of [
    "These bindings take part in TypeScript's definite-assignment and use-before-declaration checks",
    "because short-circuiting skipped it or the pattern failed before reaching it, follows TypeScript’s definite-assignment checks (`TS2454`)",
    "a read before the binding's position in its scope is `TS2448`",
    "// @ts-expect-error: TS2454, short-circuiting skipped the binding's initialization",
    "// @ts-expect-error: TS2454, the successful condition skipped initialization",
    "Its direct reads precede the binding, so they are `TS2448`",
    "CreatePerIterationEnvironment copies a `let` binding into each iteration",
    "A binding from `test` or `update` is a fresh, uninitialized cell",
    "is copied into each iteration's binding environment; a skipped binding is copied uninitialized",
    "In a concise arrow body, a binding belongs to the arrow body's scope",
    "a binding belongs to that initializer's own scope",
  ]) assert.ok(match.includes(text), text)
  assert.ok(!match.includes("} // Die(ReferenceError): short-circuiting skipped"))
  assert.match(read("docs/design/vips/0007-match.md"), /the other binding homes, and use before assignment/)
  const guide = read("docs/user/src/vibelang-features/116-match-and-is.md")
  assert.ok(match.includes("An `enum` member initializer has no lexical home in ECMAScript or the pinned explainer, so a binding introduced there is `EK0705`"))
  const ek0705 = read("docs/design/src/900-appendices.md").split("\n").find(line => line.startsWith("| `EK0705` |")) ?? ""
  assert.ok(ek0705.includes("also a binding in an `enum` member initializer, which has no lexical home"))
  assert.ok(read("docs/design/vips/0007-match.md").includes("an `enum` member initializer has no home, so a binding there is `EK0705`"))
  assert.ok(guide.includes("copied into each iteration as a `let` declared there is"))
  assert.ok(guide.includes("may not have run follows TypeScript's definite-assignment checks (`TS2454`)"))
  assert.ok(!guide.includes("Reading it before then throws `ReferenceError`."))
  const result = run(read("docs/tools/fixtures/is-loop-homes.ts") + `
import { Exit } from "effect"
if (!Exit.isSuccess(loopHomesExit) || JSON.stringify(loopHomesExit.value) !== "[[1,2,3],[3,2,1],[1,2]]") throw new Error("loop homes")
`)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

// Accepted VIP-7 and the Nov3 TypeScript ruling retain type-dependent
// definite-assignment exemptions; they do not erase runtime lexical TDZ.
function exemptionParagraph(text) {
  const paragraph = text.split("\n").find(line => line.startsWith("These bindings take part") || line.startsWith("`is` may bind names in any expression."))
  assert.ok(paragraph, "definite-assignment paragraph")
  return paragraph
}
function checkExemptions(text) {
  const paragraph = exemptionParagraph(text)
  for (const type of ["`any`", "`unknown`", "`void`", "`undefined`"]) assert.ok(paragraph.includes(type), type)
  assert.ok(paragraph.includes("exempt"))
  assert.ok(paragraph.includes("`TS2448`"))
  assert.ok(paragraph.includes("`ReferenceError`"))
}
test("binding-home docs retain every native definite-assignment exemption", () => {
  const sources = [chapter("004-match"), read("docs/user/src/vibelang-features/116-match-and-is.md")]
  for (const text of sources) checkExemptions(text)
  fc.assert(fc.property(fc.integer({ min: 0, max: 1 }), fc.constantFrom("`any`", "`unknown`", "`void`", "`undefined`"), (index, type) => {
    assert.throws(() => checkExemptions(exemptionParagraph(sources[index]).replaceAll(type, "[removed]")))
  }), { seed: 1104113, numRuns: 160 })
})

test("exemption checks select binding homes after an unrelated match introduction", () => {
  const introduction = "TypeScript reports `TS2454` when its definite-assignment checks find an uninitialized read."
  for (const source of [chapter("004-match"), read("docs/user/src/vibelang-features/116-match-and-is.md")]) {
    checkExemptions(introduction + "\n" + source)
  }
})

test("fast-check: native TypeScript keeps the same TS2454 exemptions", () => {
  const types = [["any", false], ["unknown", false], ["void", false], ["undefined", false],
    ["number | undefined", false], ["string | undefined", false],
    ["number", true], ["string", true], ["object", true], ["number | null", true]]
  fc.assert(fc.property(fc.constantFrom(...types), fc.integer({ min: 0, max: 9999 }), ([type, warned], n) => {
    const file = "/binding-home.ts"
    const source = "type T" + n + " = " + type + "; function probe" + n + "() { let value: T" + n + "; return value }"
    const options = { strict: true, noLib: true, noEmit: true, target: ts.ScriptTarget.ESNext }
    const host = ts.createCompilerHost(options)
    host.getSourceFile = path => path === file ? ts.createSourceFile(file, source, options.target, true) : undefined
    host.fileExists = path => path === file
    host.readFile = path => path === file ? source : undefined
    const program = ts.createProgram([file], options, host)
    const diagnostics = program.getSemanticDiagnostics()
    assert.equal(diagnostics.some(d => d.code === 2454), warned, source)
  }), { seed: 1104111, numRuns: 150 })
})

test("generated native loop cells preserve iteration and closure identity", () => {
  const inputs = fc.sample(fc.array(fc.integer({ min: -20, max: 20 }), { maxLength: 20 }), { seed: 1104112, numRuns: 100 })
  const source = read("docs/tools/fixtures/is-loop-homes.ts") +
    '\nimport assert from "node:assert/strict"\nfor (const values of ' + JSON.stringify(inputs) + ') { assert.deepEqual(drain(values[Symbol.iterator]()), values); assert.deepEqual(ids(values.map(id => ({ id }))), values); const n = values.length; assert.deepEqual(countdown({ n }), Array.from({length:n}, (_, i) => n-i)) }\n'
  const result = run(source)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

function checkBindingGuide(text) {
  const paragraphs = text.split("\n").filter(line => line.startsWith("`is` may bind names in any expression."))
  assert.equal(paragraphs.length, 1, "one binding-home paragraph")
  const paragraph = paragraphs[0]
  for (const rule of [
    "An `is` binding that needs an unbraced statement body as its lexical home reports `EK0705`",
    "A collision with a local `const` also reports `TS2451`",
    "a collision with a parameter reports `TS2300`",
    "Both declarations are reported",
    "Assignments written in the source keep their ordinary type and immutability checks",
    "Neither home exports the binding after the loop",
    "a skipped `init` binding stays in the runtime temporal dead zone",
  ]) assert.ok(paragraph.includes(rule), rule)
  checkExemptions(paragraph)
}

test("the binding guide combines native redeclarations with current binding homes once", () => {
  checkBindingGuide(read("docs/user/src/vibelang-features/116-match-and-is.md"))
})

test("fast-check: duplicate or stale binding-home paragraphs fail the guide check", () => {
  const guide = read("docs/user/src/vibelang-features/116-match-and-is.md")
  const paragraph = guide.split("\n").find(line => line.startsWith("`is` may bind names in any expression."))
  const obsoleteRules = [
    ["a collision with a parameter reports `TS2300`", "a collision with a parameter is allowed"],
    ["reports `EK0705`", "is implicitly a block"],
    ["Neither home exports the binding after the loop", "Bindings escape the loop"],
    ["a skipped `init` binding stays in the runtime temporal dead zone", "a skipped `init` binding reads `undefined`"],
    ["`any`", "[removed]"],
  ]
  fc.assert(fc.property(fc.boolean(), fc.nat(), fc.constantFrom(...obsoleteRules), (duplicate, position, [before, after]) => {
    const lines = guide.split("\n")
    if (duplicate) lines.splice(position % (lines.length + 1), 0, paragraph.replace(before, after))
    else {
      assert.ok(paragraph.includes(before), before)
      lines[lines.indexOf(paragraph)] = paragraph.replace(before, after)
    }
    assert.throws(() => checkBindingGuide(lines.join("\n")))
  }), { seed: 1104251, numRuns: 160 })
})
