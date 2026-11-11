import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// VibeLang makes throwing on purpose awkward but always possible, and always typed: a `module` block (VIP-40)
// keeps TypeScript inside the `.vibe` file, with `@throws {T}` on each function that throws. A separate `.ts`
// file is the fallback only where a tool needs one. Advice to move throwing code to TypeScript must name the
// `module` block as well, or agents and readers keep throwing code out of VibeLang.

const root = fileURLToPath(new URL("../..", import.meta.url))

const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : path.endsWith(".md") ? [path] : []
})

// Release notes record history: an old note may quote advice the current docs no longer give.
export const guidanceFiles = () => [
  "packages/compiler/skills/vibelang/SKILL.md",
  ".smithers/flows/migrate/rules.md",
  ".smithers/flows/migrate/README.md",
  ...walk(join(root, "docs/design/src")).map(p => relative(root, p)),
  ...walk(join(root, "docs/user/src")).map(p => relative(root, p)).filter(p => !p.endsWith("release-notes.md")),
].sort()

// A relocation: a verb that sends code somewhere, followed within the clause by a TypeScript destination.
const relocation = [
  /\b(?:move[sd]?|put|puts|keep|keeps|lives?|belongs?|goes|go|write)\b[^.;:]{0,80}?(?:`\.tsx?`|\bTypeScript file)/i,
  /\bstay(?:s|ed)? (?:as |in )?TypeScript\b/i,
]
const throwing = /\bthrow|EK0401/i

const sentences = text => text.split(/(?<=[.!?])\s+(?=[A-Z`*(])/)

// Each finding is `path:line: sentence` for a sentence that tells a reader to relocate throwing code to
// TypeScript without naming the `module` block. The throwing context is the sentence or the one before it.
export function moveToTsAdvice(path, text) {
  const findings = []
  const lines = text.split("\n")
  let fenced = false
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return }
    if (fenced) return
    const parts = sentences(line)
    parts.forEach((sentence, i) => {
      if (!relocation.some(r => r.test(sentence))) return
      const context = (i > 0 ? parts[i - 1] + " " : "") + sentence
      if (!throwing.test(context)) return
      if (/`module`|\bmodule (?:block|body|declaration)|VIP-40/.test(sentence)) return
      findings.push(`${path}:${index + 1}: ${sentence.trim()}`)
    })
  })
  return findings
}

test("moveToTsAdvice flags throwing advice that names only a .ts file", () => {
  assert.equal(moveToTsAdvice("x.md", "A `throw` there is `EK0401`. Make the function `effect`, or move the code to a `.ts` file.").length, 1)
  assert.equal(moveToTsAdvice("x.md", "Code that throws lives in a `.ts` file.").length, 1)
  assert.equal(moveToTsAdvice("x.md", "A throwing helper stays TypeScript when callers need it.").length, 1)
  assert.deepEqual(moveToTsAdvice("x.md", "Code that throws goes in a `module` block with `@throws`, or in a `.ts` file where a tool needs one."), [])
  assert.deepEqual(moveToTsAdvice("x.md", "Wrap a call to a `.ts` function that may throw with `Effect.try`."), [])
  assert.deepEqual(moveToTsAdvice("x.md", "```vibe\n// keep the throw in a `.ts` file\n```"), [])
})

test("no guidance tells readers to move throwing code to a .ts file without the module block", () => {
  const findings = guidanceFiles().flatMap(path => moveToTsAdvice(path, readFileSync(join(root, path), "utf8")))
  assert.deepEqual(findings, [])
})
