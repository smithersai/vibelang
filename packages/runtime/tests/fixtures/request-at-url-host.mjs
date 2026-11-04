import assert from "node:assert/strict"
import * as Effect from "effect/Effect"
import * as RequestService from "../../dist/experimental/Request.js"
import { ExperimentalNodeRequest } from "../../dist/experimental/platform-node/index.js"
import { ExperimentalBunRequest } from "../../dist/experimental/platform-bun/index.js"
import { ExperimentalBrowserRequest } from "../../dist/experimental/platform-browser/index.js"
const NativeRequest = globalThis.Request
for (const layer of [ExperimentalNodeRequest.layer, ExperimentalBunRequest.layer, ExperimentalBrowserRequest.layer]) {
  const requests = await Effect.runPromise(Effect.provide(RequestService.Request, layer))
  const controller = new AbortController(), reason = new Error("native-abort")
  const input = new NativeRequest("https://original.invalid/a", { cache: "no-store", credentials: "include", redirect: "manual", referrer: "https://referrer.invalid/", integrity: "sha256-example", signal: controller.signal })
  let calls = 0
  globalThis.Request = new Proxy(NativeRequest, { construct(target, args) { calls++; return Reflect.construct(target, args, target) } })
  try {
    const effect = requests.atUrl("https://target.invalid/b", input)
    assert.equal(calls, 0)
    const result = await Effect.runPromise(effect)
    assert.equal(calls, 1)
    for (const field of ["cache", "credentials", "redirect", "referrer", "integrity"]) assert.equal(result[field], input[field])
    controller.abort(reason); assert.equal(result.signal.reason, reason)
    assert.equal(input.url, "https://original.invalid/a")
    assert.equal(result.url, "https://target.invalid/b")
  } finally { globalThis.Request = NativeRequest }
}
console.log("REQUEST-AT-URL " + JSON.stringify({ host: process.versions.bun ? "bun" : "node", layers: 3, lateConstructorLookup: true, metadata: true, followingSignal: true }))
