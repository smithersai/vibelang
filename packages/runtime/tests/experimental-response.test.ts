import { expect, test } from "bun:test"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Effect from "effect/Effect"
import { Headers, Response } from "vibelang-runtime/experimental"
import { ExperimentalBrowserResponse } from "vibelang-runtime/experimental/platform-browser"
import { ExperimentalNodeHeaders, ExperimentalNodeResponse } from "vibelang-runtime/experimental/platform-node"
import { ExperimentalBunResponse } from "vibelang-runtime/experimental/platform-bun"

for (const [name, layer] of Object.entries({
  browser: ExperimentalBrowserResponse.layer,
  node: ExperimentalNodeResponse.layer,
  bun: ExperimentalBunResponse.layer
})) {
  test(name + " returns a native response with independent headers and the supplied body", async () => {
    const source = new globalThis.Headers([["set-cookie", "a=1"], ["set-cookie", "b=2"]])
    const headers = Effect.runSync(Effect.provide(Headers.Headers, ExperimentalNodeHeaders.layer))
    const copy = Effect.runSync(headers.copy(source))
    const responses = Effect.runSync(Effect.provide(Response.Response, layer))
    const response: globalThis.Response = Effect.runSync(responses.create("ok", { status: 201, statusText: "Created", headers: copy }))
    copy.delete("set-cookie")
    expect(response).toBeInstanceOf(globalThis.Response)
    expect(response.status).toBe(201)
    expect(response.statusText).toBe("Created")
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"])
    expect(await response.text()).toBe("ok")
    expect(Effect.runSync(responses.create()).body).toBeNull()
  })
}

test("defers host construction and preserves native errors as defects", () => {
  let calls = 0
  const failure = new TypeError("constructor failed")
  const responses = Response.make({ create() {
    calls++
    throw failure
  } })
  const invalid = responses.create()
  expect(calls).toBe(0)
  const exit = Effect.runSyncExit(invalid)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(failure)
  expect(calls).toBe(1)
})
