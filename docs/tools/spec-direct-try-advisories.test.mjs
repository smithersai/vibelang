import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { test } from "node:test"
import { read } from "./spec-witness.mjs"

// Loop round 5, OPUS-4 (decided detail 254): EK4834, EK4835 and EK4836 said
// "explicitly run" without a definition, and 002's own EK0505 quick fix,
// fork Effect.catch(e, h), read as an EK4835 with no repair. The rows now
// name one consumer: the direct operand of bare try in effect code.

const codes = ["EK4834", "EK4835", "EK4836"]
const direct = "as the direct operand of bare `try` in effect code"

test("the three rows in 007 and Appendix B name the direct try operand", () => {
  for (const file of ["docs/design/src/007-tooling.md", "docs/design/src/900-appendices.md"]) {
    const lines = read(file).split("\n")
    for (const code of codes) {
      const row = lines.find(l => l.startsWith(`| \`${code}\` |`))
      assert.ok(row, `${file} ${code}`)
      assert.ok(row.includes(direct), `${file} ${code}: ${row}`)
    }
  }
})

test("007 lists the consumers that do not warn and ties fork Effect.catch to 002", () => {
  const text = read("docs/design/src/007-tooling.md")
  assert.ok(text.includes("In the `EK4834`, `EK4835` and `EK4836` rows, the call is the direct operand of bare `try` in effect code."))
  assert.ok(text.includes("An operand of `fork` in any form, of `join`, of `try.all`, `try.race`, `try.any` or `try.allSettled` or one of its elements, an argument of an Effect API, the head of a `catch`, and a stored or returned Effect are not direct operands, and these rows do not warn on them"))
  assert.ok(text.includes("`fork Effect.catch(e, h)` keeps recovery in the child ([`fork` and `join`](002-running.md#fork-and-join))"))
  assert.match(text, /const child = fork Effect\.catch\(e, h\) +\/\/ no EK4835/)
  // 002's EK0505 quick fix is the form the rows exempt.
  assert.ok(read("docs/design/src/002-running.md").includes("`fork Effect.catch(e, h)`"))
})

const pages = dir => readdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true }).filter(f => f.endsWith(".md")).map(f => `${dir}/${f}`)

test("no chapter or user page keeps the undefined words", () => {
  const hits = []
  // The release notes quote the old words to say what changed.
  for (const file of [...pages("docs/design/src"), ...pages("docs/user/src")].filter(f => !f.endsWith("release-notes.md"))) {
    if (read(file).includes("explicitly run")) hits.push(file)
  }
  assert.deepEqual(hits, [])
})

test("the user guide's EK4835 and EK4836 sources are direct try operands", () => {
  const lines = read("docs/user/src/getting-started/012-devtools.md").split("\n")
  for (const code of codes) {
    const row = lines.find(l => l.startsWith(`| ${code} |`) || l.startsWith(`| \`${code}\` |`))
    const source = row.split("|")[2]
    // Detail 254 governs these calls; another span in a row, such as
    // EK4836's Effect.withSpan, follows its own trigger.
    const governed = source.match(/`[^`]+`/g).filter(span => /Effect\.(succeed|fail|catch|catchTag|catchTags|provide|provideService)\(/.test(span))
    assert.ok(governed.length > 0, `${code}: ${row}`)
    for (const span of governed) assert.match(span, /^`(return )?try Effect\./, `${code}: ${span}`)
  }
})
