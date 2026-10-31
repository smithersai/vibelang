import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as fc from "fast-check"
import { BrowserInfo } from "vibelang-runtime/experimental"
import { ExperimentalBrowserInfo } from "vibelang-runtime/experimental/platform-browser"

const read = Effect.flatMap(Effect.service(BrowserInfo.BrowserInfo), (info) => Effect.all([info.crossOriginIsolated, info.userAgent]))

test("BrowserInfo: each fact is the host's, read when it runs", async () => {
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.string(), async (isolated, agent) => {
    const host = { crossOriginIsolated: () => isolated, userAgent: () => agent }
    const service = BrowserInfo.make(host)
    expect(await Effect.runPromise(Effect.all([service.crossOriginIsolated, service.userAgent]))).toEqual([isolated, agent])
  }))
})

test("BrowserInfo: the browser layer treats a host without crossOriginIsolated as not isolated", async () => {
  const host = globalThis as { crossOriginIsolated?: unknown }
  const agent = globalThis.navigator.userAgent
  expect(await Effect.runPromise(Effect.provide(read, ExperimentalBrowserInfo.layer))).toEqual([false, agent])
  host.crossOriginIsolated = true
  try {
    expect(await Effect.runPromise(Effect.provide(read, ExperimentalBrowserInfo.layer))).toEqual([true, agent])
  } finally {
    delete host.crossOriginIsolated
  }
})

test("BrowserInfo: layerTest is a plain page, and takes the members a test needs", async () => {
  expect(await Effect.runPromise(Effect.provide(read, BrowserInfo.layerTest()))).toEqual([false, "vibelang-test"])
  const isolated = BrowserInfo.layerTest({ crossOriginIsolated: Effect.succeed(true) })
  expect(await Effect.runPromise(Effect.provide(read, isolated))).toEqual([true, "vibelang-test"])
})
