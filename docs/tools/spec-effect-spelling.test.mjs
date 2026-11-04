import assert from "node:assert/strict"
import test from "node:test"
import fc from "fast-check"
import { chapter } from "./spec-witness.mjs"

// EK4833 warns on a written Effect.Effect<A, E, R> in .vibe source, so a .vibe
// example writes A!E!R or marks the warning it gets. VIP-3 also documents
// the immediate legacy infer return slot as EK4857 rather than TS1338.
function legacyInferDiagnostic(line) {
  return /^\s*effect function \w+\([^)]*\): Effect\.Effect<[^>]*\binfer \w+[^>]*>\s*\{[^}]*\}\s*\/\/ EK4857, not TS1338\s*$/.test(line)
}
function writtenEffectTypes(text) {
  const found = []
  for (const m of text.matchAll(/```(vibe[^\n]*)\n([\s\S]*?)```/g)) {
    for (const line of m[2].split("\n")) {
      if (line.trimStart().startsWith("//")) continue
      if (line.includes("Effect.Effect<") && !line.includes("EK4833") && !legacyInferDiagnostic(line)) found.push(line.trim())
    }
  }
  return found
}

test("a .vibe example in chapters 000, 001 and 900 spells an Effect type A!E!R or marks EK4833", () => {
  for (const name of ["000-intro", "001-functions", "900-appendices"]) {
    assert.deepEqual(writtenEffectTypes(chapter(name)), [], name)
  }
})

test("the written return type uses the shorthand the declared Effect type equals", () => {
  assert.match(chapter("001-functions"), /effect function load\(id: string\): User!NotFound!Users \{ return try fetchUser\(id\) \} +\/\/ written/)
})

test("legacy infer diagnostic exception cannot hide ordinary Effect type spellings", () => {
  fc.assert(fc.property(fc.constantFrom("number", "string", "boolean"), fc.constantFrom("E", "ErrorType", "_"), (value, name) => {
    const line = "effect function f(): Effect.Effect<" + value + ", infer " + name + ", never> { return 1 } // EK4857, not TS1338"
    const block = line => "```vibe\n" + line + "\n```"
    assert.deepEqual(writtenEffectTypes(block(line)), [])
    for (const invalid of [
      line.replace("infer " + name, name),
      line.replace("EK4857", "EK4834"),
      line.replace("effect function f(): ", "const x: "),
      "const value: Effect.Effect<" + value + ", infer " + name + ", never> = input // EK4857, not TS1338",
    ]) assert.deepEqual(writtenEffectTypes(block(invalid)), [invalid])
    assert.deepEqual(writtenEffectTypes(block(line.replace("infer " + name, name).replace("EK4857, not TS1338", "EK4833"))), [])
  }), { seed: 1104118, numRuns: 180 })
})
