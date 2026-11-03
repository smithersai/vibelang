import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { counterpart, lintObjectPatternCounterpart } from "./spec-object-pattern-counterpart.mjs"

const text = readFileSync(new URL("../design/src/004-match.md", import.meta.url), "utf8")
const before = 'typeof x === "object" && x !== null'
const after = '(typeof x === "object" || typeof x === "function") && x !== null'
const fixed = text.replace(before, after)
const defective = fixed.replace(after, before)

test("the published counterpart includes callable objects under VIP-7", () => {
  assert.ok(text.includes("functions are objects too"))
  assert.deepEqual(lintObjectPatternCounterpart(text), [])
})

test("the executable guard rejects the frozen defect and accepts its repair", () => {
  assert.notEqual(defective, fixed)
  assert.equal(lintObjectPatternCounterpart(defective).length, 5)
  assert.deepEqual(lintObjectPatternCounterpart(fixed), [])
})

test("generated counterpart subjects preserve own/inherited values and reads", () => {
  const run = counterpart(fixed).run
  fc.assert(fc.property(
    fc.array(fc.record({
      kind: fc.integer({ min: 0, max: 6 }),
      value: fc.jsonValue(),
      present: fc.boolean(),
      inherited: fc.boolean(),
      getter: fc.boolean(),
      enumerable: fc.boolean()
    }), { maxLength: 30 }),
    rows => {
      let reads = 0
      const subjects = rows.map(r => {
        const subject = [
          () => 0, async () => 0, function* () {}, class Subject {},
          (() => 0).bind(null), {}, Object.create(null)
        ][r.kind]
        if (r.present) {
          const target = r.inherited ? Object.create(Object.getPrototypeOf(subject)) : subject
          Object.defineProperty(target, "id", r.getter
            ? { enumerable: r.enumerable, get() { reads++; return r.value } }
            : { enumerable: r.enumerable, value: r.value })
          if (r.inherited) Object.setPrototypeOf(subject, target)
        }
        return subject
      })
      assert.deepEqual(run([null, undefined, 0, "id", true, ...subjects]), rows.filter(r => r.present).map(r => r.value))
      assert.equal(reads, rows.filter(r => r.present && r.getter).length)
    }
  ), { seed: 19001, numRuns: 300 })
})

test("callable proxies keep presence before read and propagate the original throw", () => {
  const run = counterpart(fixed).run
  const events = []
  const sentinel = { reason: "getter" }
  const subject = new Proxy(() => 0, {
    has(_target, key) { events.push("has:" + String(key)); return true },
    get(_target, key) { events.push("get:" + String(key)); throw sentinel }
  })
  assert.throws(() => run([subject]), error => error === sentinel)
  assert.deepEqual(events, ["has:id", "get:id"])
})
