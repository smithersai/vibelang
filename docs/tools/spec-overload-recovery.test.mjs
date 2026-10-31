import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { block, chapter, read, tools } from "./spec-witness.mjs"

const ts = createRequire(import.meta.url)("typescript")
const vip1 = () => read("docs/design/vips/0001-effect-and-async-functions.md")
const vip3 = () => read("docs/design/vips/0003-effect-type-shorthand.md")

// Type-checks one file beside docs/tools, so `effect` resolves, and returns its diagnostic codes.
function codes(source) {
  const directory = mkdtempSync(join(tools, ".spec-overload-"))
  try {
    const file = join(directory, "witness.ts")
    writeFileSync(file, source + "\nexport {}\n")
    const options = { strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }
    return ts.getPreEmitDiagnostics(ts.createProgram([file], options)).filter(d => d.file?.fileName === file).map(d => d.code)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

// The `async` spelling of one witness line, so TypeScript itself says where the modifier is recognized.
const native = line => line.split("//")[0]
  .replaceAll("number!!", "Promise<number>")
  .replaceAll("Stream.Stream<number>", "AsyncGenerator<number>")
  .replace(/\beffect\b/g, "async")

test("the keyword table recognizes effect on interface and type literal members, where EK0108 reports it", () => {
  const row = chapter("900-appendices").split("\n").find(line => line.startsWith("| `effect` |"))
  assert.ok(row, "keyword table row for effect")
  assert.doesNotMatch(row, /in a class or object literal only/)
  assert.match(row, /on an `interface` or type literal member: a member name or `\[`/)
  assert.match(row, /`EK0108`/)
  assert.match(vip1(), /on an `interface` or type literal member before a member name or `\[`/)
})

test("each forbidden-position witness is a position where TypeScript parses the async modifier", () => {
  const witnesses = chapter("001-functions").split("The forbidden modifier positions have their own code")[1].split("```")[1].trim().split("\n").slice(1)
  const forbidden = witnesses.filter(line => line.includes("// EK0108"))
  assert.ok(forbidden.some(line => line.startsWith("interface")) && forbidden.some(line => line.startsWith("type")), "type member witnesses")
  for (const line of forbidden) {
    const found = codes(native(line))
    assert.ok(found.some(code => [1040, 1070, 1071, 1243].includes(code)), line + " gives " + found)
  }
  for (const line of witnesses.filter(line => line.includes("a method named effect"))) {
    assert.ok(!codes(native(line)).some(code => [1040, 1042, 1070, 1071, 1243].includes(code)), line)
  }
  const starred = witnesses.find(line => line.includes("// TS1222"))
  assert.ok(starred, "starred overload witness")
  assert.ok(codes(native(starred)).includes(1222), starred)
})

test("each rejected overload form has one stated code", () => {
  const functions = chapter("001-functions")
  assert.doesNotMatch(functions, /are rejected as their `async` counterparts are/)
  for (const text of [functions, chapter("900-appendices"), vip1()]) {
    assert.match(text, /`TS1222`/)
    assert.match(text, /`TS7010` under `noImplicitAny`/)
  }
  assert.match(chapter("900-appendices"), /the other two are `EK0108`/)
  const producer = chapter("900-appendices").split("#### Producer\n")[1].split("#### Params")[0]
  assert.match(producer, /ReturnType\? ";"\s+\(function declarations only; parses, then TypeScript's TS1222 rejects it\)/)
  assert.match(producer, /ReturnType\? \(Block \| ";"\)\s+\(in a class, where ";" parses, then TypeScript's TS1222 rejects it/)
})

test("an unannotated overload signature exposes any, with TS7010 under strict checking", () => {
  const counterpart = block(chapter("001-functions"), "Unannotated overload counterpart")
  assert.deepEqual(codes(counterpart), [])
  assert.deepEqual(codes(counterpart.replace(/^\/\/ @ts-expect-error.*\n/m, "")), [7010])
  assert.match(block(chapter("001-functions"), "effect function untyped", "vibe es"), /TS7010 under noImplicitAny/)
})

test("a complete optional-R parse includes automatic semicolon insertion", () => {
  const appendix = chapter("900-appendices")
  assert.match(appendix, /A complete source parse includes TypeScript’s automatic semicolon insertion/)
  assert.match(vip3(), /A complete parse includes TypeScript’s automatic semicolon insertion/)
  assert.match(block(appendix, "function lineBreak", "vibe"), /x as number!!as\n  B \/\/ a second statement/)
  const statements = source => ts.createSourceFile("a.ts", source, ts.ScriptTarget.Latest, true).statements.length
  assert.equal(statements("x as Effect.Effect<number, never, as>\nB"), 2, "present R completes by ASI")
  assert.equal(statements("x as Effect.Effect<number> as\nB"), 1, "the chained assertion also completes")
  assert.equal(statements("x as Effect.Effect<number> as B"), 1, "on one line only the chained assertion completes")
  assert.deepEqual(codes(block(appendix, "function lineBreak")), [])
})
