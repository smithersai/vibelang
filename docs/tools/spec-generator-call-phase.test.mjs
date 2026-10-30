import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"

const failures = readFileSync(process.env.SPEC_FAILURES ?? new URL("../design/src/003-failures.md", import.meta.url), "utf8")

test("generator call contracts separate eager parameters from suspended bodies", () => {
  assert.ok(/generator declarations, expressions and methods/.test(failures), "cover generator declarations, expressions and methods")
  assert.ok(/parameter initialization.*synchronous thrown type/.test(failures), "track only eager generator initialization at the call")
  assert.ok(/suspended body.*do not contribute/.test(failures), "exclude the suspended generator body from call throws")
})

test("the documented generator call phases have the stated Effect Exits", async () => {
  const block = [...failures.matchAll(/```ts effect\n([\s\S]*?)```/g)]
    .map((m) => m[1]).find((s) => s.includes("const constructed ="))
  assert.ok(block, "chapter 003 needs the executable lazy/eager generator contrast")
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
