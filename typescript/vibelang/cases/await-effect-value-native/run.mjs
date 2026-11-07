import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import * as reference from "./out/reference.js"

async function observe(module, kind) {
  const input = kind === "effect" ? module.make()
    : kind === "promise" ? Promise.resolve(7)
    : { then(resolve) { resolve(7) } }
  const expectedValue = kind === "effect" ? input : 7
  const events = []
  const pending = module.value(input).then((held) => {
    events.push("value")
    assert.equal(held, expectedValue)
  })
  queueMicrotask(() => {
    events.push("tick1")
    queueMicrotask(() => {
      events.push("tick2")
      queueMicrotask(() => events.push("tick3"))
    })
  })
  await pending
  for (let i = 0; i < 5; i++) await Promise.resolve()
  const iterator = module.values(input)
  const first = await iterator.next()
  assert.equal(first.value, expectedValue)
  assert.equal(first.done, false)
  assert.equal((await iterator.next()).done, true)
  assert.equal(module.started(), 0)
  return events
}
for (const kind of ["effect", "promise", "thenable"]) {
  assert.deepEqual(await observe(actual, kind), await observe(reference, kind), kind)
}
console.log("unrun Effect identity and native suspension preserved")
