import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import fc from "fast-check"
import { Effect } from "effect"

const failures = readFileSync(process.env.SPEC_FAILURES ?? new URL("../design/src/003-failures.md", import.meta.url), "utf8")

// VIP-4, amended 2026-10-31: a .vibe generator never throws; a plain generator's body and parameters are
// synchronous code outside effect code (EK0401), and an async generator's body throws reject its resumption.
test("a .vibe generator never throws; an async generator's body rejects", () => {
  const plain = failures.slice(failures.indexOf("### Plain code never throws"), failures.indexOf("## Throw expressions"))
  assert.ok(plain.includes("plain generators"), "a plain generator is synchronous code outside effect code")
  assert.match(failures, /\| an `async` function, arrow or method, its parameter list included, an `async` generator's body, or an `async match` \| JavaScript's `throw`: the returned Promise rejects with `e` \|/)
  assert.doesNotMatch(failures, /parameter initialization alone contributes to the call's synchronous thrown type/)
})

test("the retained native generator call phases have the stated Effect Exits", async () => {
  const block = readFileSync(new URL("./fixtures/generator-call-phase.ts", import.meta.url), "utf8")
  const code = block.replace('from "effect"', "from " + JSON.stringify(import.meta.resolve("effect")))
  const module = await import("data:text/javascript;base64," + Buffer.from(
    code + "\nexport { constructed, resumed, defaulted, resumedAsync, defaultedAsync }"
  ).toString("base64"))
  assert.deepEqual(Effect.runSyncExit(module.constructed).toJSON(), { _id: "Exit", _tag: "Success", value: "not started" })
  for (const [program, error] of [[module.resumed, "body"], [module.defaulted, "default"], [module.defaultedAsync, "default"]]) {
    const result = Effect.runSyncExit(program)
    assert.equal(result._tag, "Failure")
    assert.deepEqual(result.cause.reasons.map((r) => [r._tag, r.error]), [["Fail", error]])
  }
  const asyncResult = await Effect.runPromiseExit(module.resumedAsync)
  assert.equal(asyncResult._tag, "Failure")
  assert.deepEqual(asyncResult.cause.reasons.map((r) => [r._tag, r.error]), [["Fail", "async body"]])
})

test("native parameter initialization is eager for every generator callable form", async () => {
  const fail = () => { throw "default" }
  function* declared(value = fail()) { throw "body" }
  const expression = function* (value = fail()) { throw "body" }
  const method = { *run(value = fail()) { throw "body" } }.run
  async function* declaredAsync(value = fail()) { throw "async body" }
  const expressionAsync = async function* (value = fail()) { throw "async body" }
  const methodAsync = { async *run(value = fail()) { throw "async body" } }.run
  for (const create of [declared, expression, method, declaredAsync, expressionAsync, methodAsync]) {
    assert.throws(() => create(), error => error === "default")
    assert.doesNotThrow(() => create(0))
  }
  function* destructured({ id }) { yield id }
  async function* destructuredAsync({ id }) { yield id }
  assert.throws(() => destructured(undefined), TypeError)
  assert.throws(() => destructuredAsync(undefined), TypeError)
  async function ordinary(value = fail()) { return value }
  await assert.rejects(ordinary(), error => error === "default")
})

test("the Effect parameter example returns a dying Effect instead of throwing at construction", () => {
  assert.doesNotMatch(failures, /c\(\) from untyped JS throws TypeError at the call/)
  assert.match(failures, /c\(\) from untyped JS gives an Effect that dies with TypeError/)
})

test("fast-check: all native generator forms initialize before their bodies resume", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 5 }), fc.string(), fc.string(), async (form, parameterReason, bodyReason) => {
    const trace = []
    const fail = () => { trace.push("parameter"); throw parameterReason }
    const body = () => { trace.push("body"); throw bodyReason }
    const forms = [
      function* declared(value = fail()) { body(); yield value },
      function* (value = fail()) { body(); yield value },
      { *method(value = fail()) { body(); yield value } }.method,
      async function* declared(value = fail()) { body(); yield value },
      async function* (value = fail()) { body(); yield value },
      { async *method(value = fail()) { body(); yield value } }.method,
    ]
    assert.throws(() => forms[form](), reason => reason === parameterReason)
    assert.deepEqual(trace, ["parameter"])
    trace.length = 0
    const iterator = forms[form](1)
    assert.deepEqual(trace, [])
    if (form < 3) assert.throws(() => iterator.next(), reason => reason === bodyReason)
    else await assert.rejects(iterator.next(), reason => reason === bodyReason)
    assert.deepEqual(trace, ["body"])
  }), { seed: 40032, numRuns: 180 })
})
