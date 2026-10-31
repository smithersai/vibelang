import assert from "node:assert/strict"
import test from "node:test"
import { chapter } from "./spec-witness.mjs"

// EK4833 warns on a written Effect.Effect<A, E, R> in .vibe source, so a .vibe
// example writes A!E!R or marks the warning it gets.
function writtenEffectTypes(text) {
  const found = []
  for (const m of text.matchAll(/```(vibe[^\n]*)\n([\s\S]*?)```/g)) {
    for (const line of m[2].split("\n")) {
      if (line.trimStart().startsWith("//")) continue
      if (line.includes("Effect.Effect<") && !line.includes("EK4833")) found.push(line.trim())
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
