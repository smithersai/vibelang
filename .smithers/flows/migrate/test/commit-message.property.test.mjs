import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { wrapMessage } from "../lib/jj.mjs"
import { batchSubject } from "../lib/steps.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-batch-commit-body.json", import.meta.url), "utf8"))

// foldkit's scripts/check-commit-message-line-length.sh: a line longer than the
// limit with a space after the limit fails; an unbreakable line is exempt.
const gate = (message, limit) => message.split("\n").filter((line) => line.length > limit && /\s/.test(line.slice(limit)))
const words = (text) => text.split(/\s+/).filter(Boolean)

test("foldkit-143: a real batch commit passes foldkit's 80-column gate", () => {
  assert.ok(gate(corpus.message, 80).length > 0, "the original fails")
  const wrapped = wrapMessage(corpus.message)
  assert.deepEqual(gate(wrapped, 80), [])
  assert.deepEqual(words(wrapped), words(corpus.message))
  assert.match(wrapped, /\n- packages\/create-foldkit-app\/src\/rendering\.ts stays \.ts: foldkit-16:\n/)
  assert.match(wrapped, /\n  native data cannot retain the original TaggedEnum/)
})

const word = fc.oneof(fc.stringMatching(/^[a-zA-Z0-9./>:()-]{1,12}$/), fc.stringMatching(/^[a-zA-Z0-9./]{60,120}$/))
const line = fc.tuple(fc.constantFrom("", "- "), fc.array(word, { maxLength: 40 })).map(([bullet, parts]) => bullet + parts.join(" "))
const message = fc.tuple(fc.stringMatching(/^[a-z(): ]{1,120}$/), fc.array(line, { maxLength: 8 })).map(([subject, body]) => [subject, ...body].join("\n"))

test("wrapping keeps every word and the subject, passes the gate and is stable", () => {
  fc.assert(fc.property(message, (text) => {
    const wrapped = wrapMessage(text)
    assert.equal(wrapped.split("\n")[0], text.split("\n")[0])
    assert.deepEqual(gate(wrapped.split("\n").slice(1).join("\n"), 72), [])
    assert.deepEqual(words(wrapped), words(text))
    assert.equal(wrapMessage(wrapped), wrapped)
  }), { seed: 143143, numRuns: 400 })
})

test("short lines, blank lines and paragraph breaks do not move", () => {
  const text = "subject\n\n- short\n\nTokens: 1 -> 2.\n   indented stays"
  assert.equal(wrapMessage(text), text)
})

test("a batch subject fits the gate and only long lists shorten", () => {
  assert.equal(batchSubject("01", ["create.vibe", "files.vibe"]), "migrate(vibelang): batch 01: create.vibe, files.vibe")
  assert.equal(batchSubject("02", []), "migrate(vibelang): batch 02: no file migrated")
  fc.assert(fc.property(fc.array(fc.stringMatching(/^[a-zA-Z]{1,30}\.vibe$/), { maxLength: 60 }), (names) => {
    const subject = batchSubject("07", names)
    assert.ok(subject.length <= 72, subject)
    const count = /, and (\d+) more$/.exec(subject)?.[1]
    if (count) assert.equal(subject.split(": ").at(-1).split(", ").length - 1 + Number(count), names.length)
  }), { seed: 143144, numRuns: 300 })
  assert.equal(batchSubject("03", ["a".repeat(80) + ".vibe", "b.vibe"]), "migrate(vibelang): batch 03: 2 files")
})
