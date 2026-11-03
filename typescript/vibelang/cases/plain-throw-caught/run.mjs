import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Effect, Exit } from "effect"
import { Invalid, clamp, passesThrough, parseOr, pick, validate } from "./out/a.js"
import { failure } from "./out/fixtures.js"
// Plain functions return values: the throws their catches handle stay inside.
assert.equal(clamp(5), 5)
assert.equal(clamp(500), 3)
assert.equal(passesThrough(-1), -1)
assert.equal(passesThrough(4), 4)
assert.equal(passesThrough(0), -1)
assert.equal(parseOr("x"), "x")
assert.equal(parseOr(""), "syntax")
// Effect contracts fail with the typed failure.
assert.equal(Effect.runSync(pick("a")), 1)
for (const [f, input] of [[pick, "z"], [validate, ""]]) {
  const exit = Effect.runSyncExit(f(input))
  assert(Exit.isFailure(exit))
  assert.deepEqual(exit.cause.reasons.map((r) => r._tag), ["Fail"])
  assert(exit.cause.reasons[0].error instanceof Invalid)
}
assert.equal(Effect.runSync(validate("ok")), "ok")
const dts = readFileSync(new URL("./out/a.d.ts", import.meta.url), "utf8")
assert.match(dts, /clamp: \(n: number\) => number;/)
assert.match(dts, /passesThrough: \(n: number\) => number;/)
assert.match(dts, /parseOr: \(text: string\) => string;/)
console.log("ok")
