import * as Effect from "effect/Effect"
import * as Api from "../../dist/experimental/Headers.js"
import * as NodeLayer from "../../dist/experimental/platform-node/ExperimentalNodeHeaders.js"
import * as BunLayer from "../../dist/experimental/platform-bun/ExperimentalBunHeaders.js"
import * as BrowserLayer from "../../dist/experimental/platform-browser/ExperimentalBrowserHeaders.js"
import assert from "node:assert/strict"
const Original = globalThis.Headers
// Node implements the redirect response's immutable header guard; Bun's native
// redirect headers differ. Exercise each host's actual constructor semantics.
if (typeof Bun === "undefined") {
  const immutable = Response.redirect("https://redirect.invalid/").headers
  assert.throws(() => immutable.set("x-probe", "value"), TypeError)
  const service = await Effect.runPromise(Effect.provide(Api.Headers, NodeLayer.layer))
  const mutable = await Effect.runPromise(service.copy(immutable))
  mutable.set("x-probe", "value")
  assert.equal(immutable.has("x-probe"), false)
}
let calls = 0
for (const layer of [NodeLayer.layer, BunLayer.layer, BrowserLayer.layer]) {
  const service = await Effect.runPromise(Effect.provide(Api.Headers, layer))
  const input = new Original([["set-cookie", "session=a; Path=/"], ["set-cookie", "session=b; Path=/other"]])
  globalThis.Headers = new Proxy(Original, { construct(target, args) { calls++; assert.equal(args[0], input); return Reflect.construct(target, args) } })
  try {
    const before = calls, operation = service.copy(input)
    assert.equal(calls, before)
    const result = await Effect.runPromise(operation)
    assert.equal(calls, before + 1)
    assert.notEqual(result, input)
    assert.deepEqual(result.getSetCookie(), input.getSetCookie())
    assert.equal(result.getSetCookie().length, 2)
    result.delete("set-cookie")
    assert.equal(input.getSetCookie().length, 2)
  } finally { globalThis.Headers = Original }
}
console.log("HEADERS-COPY " + JSON.stringify({ host: typeof Bun === "undefined" ? "node" : "bun", layers: 3, lateConstructorLookup: true, duplicateCookies: true, independent: true }))
