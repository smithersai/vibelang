import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { parseDiagnostics } from "../lib/diagnostics.mjs"
import { platformGlobalsFromCauses, splitPlatform, splitPlatformToModule } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-prelude-collision.json", import.meta.url), "utf8"))
const note = name => "The global " + name + " is platform code, which lives in a .ts file."
const causes = diagnostic => platformGlobalsFromCauses([{ "src/Reply.vibe": { diagnostics: [diagnostic] } }])

test("the platform collision handoff follows the platform split rule", () => {
  const spec = readFileSync(new URL("../../../../docs/design/src/005-services.md", import.meta.url), "utf8")
  assert.ok(spec.includes("Move the code to a TypeScript boundary"))
  const messages = readFileSync(new URL("../../../../typescript/tsc/internal/vibelang/prelude_collision_diagnostic.go", import.meta.url), "utf8")
  assert.ok(messages.includes("The global {0} is platform code, which lives in a .ts file."))
  assert.ok(messages.includes("The global {0} has {0}.{1}, and it is platform code, which lives in a .ts file."))
})

test("compiler platform notes survive diagnostic parsing and reach the split", () => {
  const text = "src/Reply.vibe(1,42): error TS2351: " + corpus.diagnostic.message + "\n" +
    corpus.diagnostic.notes.map(n => "  " + n).join("\n")
  const [diagnostic] = parseDiagnostics(text)
  const globalsOf = causes(diagnostic)
  assert.deepEqual(globalsOf("src/Reply.ts"), ["Response"])
  assert.deepEqual(globalsOf("src/Reply.mts"), ["Response"])
  assert.deepEqual(globalsOf("src/Elsewhere.ts"), [])
})

test("the saved constructor pattern keeps the platform body verbatim and unrelated code native", () => {
  const globalsOf = causes(corpus.diagnostic)
  const result = splitPlatformToModule(corpus.source, corpus.file, ts, { globals: globalsOf(corpus.file) })
  assert.ok(result && !result.refused, JSON.stringify(result))
  assert.deepEqual(result.moved, corpus.moved)
  assert.deepEqual(result.kept, corpus.retained)
  assert.ok(result.module.includes(corpus.source.split("\n")[0]))
  assert.match(result.module, /export const label = 1;/)
})

test("type errors without an exact platform note do not select a global", () => {
  for (const notes of [[], ["For the global Response, write globalThis.Response."], ["Response is Effect's Response module."], ["not " + note("Response")], [note("Response") + " unrelated suffix"]]) {
    assert.deepEqual(causes({ code: "TS2351", message: corpus.diagnostic.message, notes })("src/Reply.ts"), [])
  }
  for (const code of ["EK0107", "EK4401", "INVALID", undefined]) {
    assert.deepEqual(causes({ code, message: "unrelated", notes: [note("Response")] })("src/Reply.ts"), [])
  }
})

test("platform member notes name only their matching global", () => {
  for (const notes of [["The global Response has Response.json, and it is platform code, which lives in a .ts file."], "other diagnostic detail. " + note("Response")]) {
    assert.deepEqual(causes({ code: "TS2339", message: "Property is missing.", notes })("src/Reply.ts"), ["Response"])
  }
  assert.deepEqual(causes({ code: "TS2339", message: "Property is missing.", notes: ["The global Response has Request.json, and it is platform code, which lives in a .ts file."] })("src/Reply.ts"), [])
})

test("a stale global note cannot move an imported or locally declared binding", () => {
  for (const prefix of ["import { Response } from './foreign.ts';\n", "declare const Response: new (body: string) => unknown;\n"]) {
    const source = prefix + "export function reply(body: string): unknown { return new Response(body) }\n"
    assert.equal(splitPlatform(source, corpus.file, ts, { globals: causes(corpus.diagnostic)(corpus.file) }), null)
  }
})

test("platform notes preserve module attribution across diagnostic and receipt shapes", () => {
  const site = fc.record({
    file: fc.constantFrom("src/a", "src/b", "lib/c"),
    global: fc.constantFrom("Response", "Request", "Worker", "Headers"),
    code: fc.constantFrom("TS2351", "TS2359", "TS2339", "EK4401"),
    valid: fc.boolean(),
    compact: fc.boolean(),
    shape: fc.constantFrom("settle", "reverted"),
  })
  fc.assert(fc.property(fc.array(site, { maxLength: 16 }), sites => {
    const settle = {}, reverted = []
    for (const s of sites) {
      const text = note(s.global) + (s.valid ? "" : " unrelated suffix")
      const notes = s.compact ? "earlier diagnostic detail. " + text : [text]
      if (s.shape === "settle") (settle[s.file + ".vibe"] ??= { diagnostics: [] }).diagnostics.push({ code: s.code, message: "type mismatch", notes })
      else reverted.push({ file: s.file + ".vibe", reason: "compile error: " + s.code + ": type mismatch", notes })
    }
    const globalsOf = platformGlobalsFromCauses([settle, reverted])
    for (const file of ["src/a", "src/b", "lib/c"]) {
      const expected = [...new Set(sites.filter(s => s.file === file && s.valid && s.code.startsWith("TS")).map(s => s.global))].sort()
      assert.deepEqual(globalsOf(file + ".ts"), expected)
      assert.deepEqual(globalsOf(file + ".mts"), expected)
    }
  }), { numRuns: 300, seed: 23512359 })
})
