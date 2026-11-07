// rule-evidence: docs/design/src/007-tooling.md#transitional-diagnostics | | `EK4857` | Error | An immediate written `infer` channel belongs to the [legacy return-slot set](001-functions.md#legacy-written-infer-return-slots) | Write checker-proved channel types; only on an explicitly `effect`-marked callable with every channel `infer`, omit the annotation if preservation is proved (VIP-3). |
// EK4857 is an error on each qualifying annotation. --fix writes the
// checker's channel types, and removes the whole annotation only from the
// effect-marked callable whose channels are all infer; the unmarked all-infer
// function keeps an annotation. The repaired project compiles. The unmarked
// all-infer function is checked in its own project for the kept annotation
// only: the types its repair writes are a separate defect.
// run-seconds: 300
import assert from "node:assert/strict"
import { project, check } from "../../tests/coverage-tooling.mjs"

const source = [
  "export function unmarkedOne(): Effect.Effect<number, infer E> { return Effect.succeed(1) }",
  "export effect function markedOne(): Effect.Effect<number, infer E> { return 3 }",
  "export effect function markedAll(): Effect.Effect<infer A, infer E, infer R> { return 4 }",
  "export function plain(): number { return 5 }",
  "",
].join("\n")
const p = project(import.meta.url, "repair", { "main.vibe": source }, { compilerOptions: { noEmit: false, declaration: true } })
const before = check(p)
assert.notEqual(before.status, 0, "EK4857 is an error:\n" + before.output)
const reported = [...before.output.matchAll(/main\.vibe\((\d+),\d+\): (error|warning) (EK4857|TS1338)/g)].map((m) => m[1] + " " + m[2] + " " + m[3])
assert.deepEqual(reported, ["1 error EK4857", "2 error EK4857", "3 error EK4857"], before.output)

check(p, ["--fix"])
const fixed = p.read("main.vibe").split("\n")
console.log(fixed.join("\n").trim())
assert.doesNotMatch(fixed.join("\n"), /\binfer\b/, "every infer channel is repaired")
assert.match(fixed[0], /unmarkedOne\(\): [^{]+\{/, "the unmarked function keeps an annotation")
assert.match(fixed[1], /markedOne\(\): [^{]+\{/, "the effect-marked function with a written channel keeps an annotation")
assert.match(fixed[2], /markedAll\(\) \{/, "the effect-marked all-infer function loses its annotation")
assert.equal(fixed[3], source.split("\n")[3])
const after = check(p)
assert.equal(after.status, 0, after.output)

const unmarked = project(import.meta.url, "unmarked-all", { "main.vibe": "export function unmarkedAll(): Effect.Effect<infer A, infer E, infer R> { return Effect.succeed(2) }\n" })
const reportedAll = check(unmarked)
assert.notEqual(reportedAll.status, 0)
assert.match(reportedAll.output, /main\.vibe\(1,\d+\): error EK4857/)
check(unmarked, ["--fix"])
const kept = unmarked.read("main.vibe")
assert.doesNotMatch(kept, /\binfer\b/)
assert.match(kept, /unmarkedAll\(\): [^{]+\{/, "the unmarked all-infer function keeps an annotation:\n" + kept)
console.log("unmarked all-infer: annotation kept")
// Stable rule id: docs/design/src/007-tooling.md#3b41045b2da5a2df
