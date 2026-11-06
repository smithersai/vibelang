import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { warningExitAdviceProblems, userWarningExitProblems } from "./warning-exit-claims.mjs"

const advice = (claim: string, code = "EK38xx") =>
  "Configuration maps `" + code + "` to warning or error. " + claim + "."
const own = "VibeLang's own warnings keep exit status zero"

test("the exit-policy oracle quotes the accepted imported warning rule", () => {
  const vip = readFileSync(new URL("../design/vips/0038-effect-lint-built-in.md", import.meta.url), "utf8")
  assert.ok(vip.includes("imported warnings affect both by default."))
})

test("configuration advice rejects the original blanket zero-exit promise", () => {
  assert.equal(warningExitAdviceProblems(advice("Warnings keep exit status zero")).length, 1)
  assert.equal(warningExitAdviceProblems(advice("Warnings leave the exit status at 0")).length, 1)
})

test("own warning guarantees and standalone lint guidance retain their scope", () => {
  assert.deepEqual(warningExitAdviceProblems(advice(own)), [])
  assert.deepEqual(warningExitAdviceProblems("Standalone `vibelang lint` exits zero for warnings alone."), [])
  assert.deepEqual(warningExitAdviceProblems("Warnings keep exit status zero."), [])
  assert.deepEqual(warningExitAdviceProblems("```text\n" + advice("Warnings keep exit status zero") + "\n```"), [])
})

test("published advice qualifies zero-exit warnings beside imported codes", () => {
  assert.deepEqual(userWarningExitProblems(), [])
})

test("generated imported-code advice keeps the same own-warning boundary", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 250 }),
    fc.constantFrom("keep", "leave"),
    fc.constantFrom("zero", "0"),
    fc.constantFrom(" ", "\n", " \t "),
    (ordinal, verb, zero, space) => {
      const claim = ("Warnings " + verb + " exit status " + zero).replaceAll(" ", space)
      const code = "EK38" + String(ordinal).padStart(2, "0")
      assert.equal(warningExitAdviceProblems(advice(claim, code)).length, 1)
      assert.deepEqual(warningExitAdviceProblems(advice("VibeLang's own " + claim.toLowerCase(), code)), [])
    }
  ), { seed: 381106, numRuns: 200 })
})
