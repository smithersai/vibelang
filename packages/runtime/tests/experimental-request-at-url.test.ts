import { expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Cause from "effect/Cause"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import fc from "fast-check"
import { readFileSync } from "node:fs"

const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-native-request-at-url.json", import.meta.url), "utf8"))
const load = () => import("../src/experimental/Request.js")
type Model = { url: string; method: "GET" | "POST"; body: "none" | "text" | "stream"; cache: RequestCache; credentials: RequestCredentials; redirect: RequestRedirect; used: boolean; aborted: boolean; afterAbort: boolean; tag: string }
const base: Model = { url: "https://target.invalid/b", method: "POST", body: "text", cache: "no-store", credentials: "include", redirect: "manual", used: false, aborted: false, afterAbort: false, tag: "value" }
async function frame(model: Model) {
  const controller = new AbortController(), reason = new Error("native-abort")
  const init: RequestInit & { duplex?: "half" } = { method: model.method, cache: model.cache, credentials: model.credentials, redirect: model.redirect, referrer: "https://referrer.invalid/", integrity: "sha256-example", headers: { "x-probe": model.tag }, signal: controller.signal }
  if (model.method === "POST" && model.body === "text") init.body = model.tag
  if (model.method === "POST" && model.body === "stream") {
    init.body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(model.tag)); c.close() } }); init.duplex = "half"
  }
  const input = new Request("https://original.invalid/a", init)
  if (model.used && input.body) await input.text()
  if (model.aborted) controller.abort(reason)
  return { input, controller, reason }
}
async function observe(model: Model, copy: (url: string, input: Request) => Promise<{ value?: Request; error?: unknown }>) {
  const f = await frame(model)
  try {
    const result = await copy(model.url, f.input)
    if (result.error !== undefined) {
      const error = result.error as Error
      return { failure: { name: error.name, message: error.message }, sourceUsed: f.input.bodyUsed, sourceUrl: f.input.url }
    }
    const request = result.value!
    const before = { url: request.url, method: request.method, cache: request.cache, credentials: request.credentials, redirect: request.redirect, referrer: request.referrer, integrity: request.integrity, headers: [...request.headers], bodySame: request.body === f.input.body, headersSame: request.headers === f.input.headers, signalSame: request.signal === f.input.signal, sourceUsed: f.input.bodyUsed }
    if (model.afterAbort) f.controller.abort(f.reason)
    const aborted = request.signal.aborted, reasonSame = !aborted || request.signal.reason === f.reason
    let body: { text: string } | { error: { name: string; message: string } }
    try { body = { text: await request.text() } } catch (error) { const e = error as Error; body = { error: { name: e.name, message: e.message } } }
    return { before, aborted, reasonSame, body, sourceUrl: f.input.url, sourceUsedAfter: f.input.bodyUsed }
  } finally {
    if (f.input.body && !f.input.bodyUsed && !f.input.body.locked) await f.input.body.cancel()
  }
}
const native = async (url: string, input: Request) => { try { return { value: new Request(url, input) } } catch (error) { return { error } } }
it("defers the injected constructor and passes the exact source/URL", async () => {
  const api = await load(), input = new Request("https://original.invalid/a"), calls: Array<unknown> = []
  const requests = api.make({ atUrl(url, source) { calls.push([url, source]); return source } })
  const effect = requests.atUrl("https://target.invalid/b", input)
  expect(calls).toEqual([])
  expect(await Effect.runPromise(effect)).toBe(input)
  expect(calls).toEqual([["https://target.invalid/b", input]])
})
it("preserves native body/headers/signal metadata and consumption behavior", async () => {
  const api = await load(), requests = api.make({ atUrl: (url, input) => new Request(url, input) })
  const copy = async (url: string, input: Request) => { const result = await Effect.runPromiseExit(requests.atUrl(url, input)); return Exit.isSuccess(result) ? { value: result.value } : { error: Cause.squash(result.cause) } }
  for (const body of ["none", "text", "stream"] as const) for (const aborted of [false, true]) {
    const model = { ...base, body, aborted, afterAbort: !aborted }
    expect(await observe(model, copy)).toEqual(await observe(model, native))
  }
})
it("keeps constructor exceptions as defects with the original value", async () => {
  const api = await load(), input = new Request("https://original.invalid/a"), error = new TypeError("native-constructor")
  const result = await Effect.runPromiseExit(api.make({ atUrl: () => { throw error } }).atUrl("invalid", input))
  expect(Exit.isFailure(result)).toBe(true)
  if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBe(error)
})
it("provides an explicit fake without a host constructor", async () => {
  const api = await load(), input = new Request("https://original.invalid/a")
  const program = Effect.flatMap(api.Request, requests => requests.atUrl("https://target.invalid/b", input))
  expect(await Effect.runPromise(Effect.provide(program, api.layerTest({ atUrl: () => Effect.succeed(input) })))).toBe(input)
})
it("rejects a structurally similar HTTP-model reconstruction", async () => {
  const input = new Request("https://original.invalid/a", { cache: "no-store", credentials: "include", redirect: "manual", referrer: "https://referrer.invalid/", integrity: "sha256-example" })
  const expected = new Request(base.url, input)
  const reconstructed = await Effect.runPromise(HttpClientRequest.toWeb(HttpClientRequest.setUrl(HttpClientRequest.fromWeb(input), base.url), { signal: input.signal }))
  expect([reconstructed.cache, reconstructed.credentials, reconstructed.redirect, reconstructed.referrer, reconstructed.integrity]).not.toEqual([expected.cache, expected.credentials, expected.redirect, expected.referrer, expected.integrity])
})
it("matches the native constructor across 500 keyed metadata/body/URL schedules", async () => {
  const api = await load(), requests = api.make({ atUrl: (url, input) => new Request(url, input) })
  const copy = async (url: string, input: Request) => { const result = await Effect.runPromiseExit(requests.atUrl(url, input)); return Exit.isSuccess(result) ? { value: result.value } : { error: Cause.squash(result.cause) } }
  await fc.assert(fc.asyncProperty(fc.record({
    url: fc.constantFrom(...corpus.urls as Array<string>), method: fc.constantFrom("GET" as const, "POST" as const), body: fc.constantFrom("none" as const, "text" as const, "stream" as const),
    cache: fc.constantFrom("default" as const, "no-store" as const, "reload" as const), credentials: fc.constantFrom("omit" as const, "same-origin" as const, "include" as const), redirect: fc.constantFrom("follow" as const, "manual" as const, "error" as const),
    used: fc.boolean(), aborted: fc.boolean(), afterAbort: fc.boolean(), tag: fc.stringMatching(/^[a-z0-9]{0,12}$/)
  }), async model => expect(await observe(model, copy)).toEqual(await observe(model, native))), { seed: 531166, numRuns: 500 })
})

it("uses all three platform providers with late constructor lookup in Node and Bun", async () => {
  await load()
  const { spawnSync } = await import("node:child_process")
  const { fileURLToPath } = await import("node:url")
  const file = fileURLToPath(new URL("./fixtures/request-at-url-host.mjs", import.meta.url))
  for (const executable of ["node", "bun"]) {
    const result = spawnSync(executable, [file], { encoding: "utf8", timeout: 30000 })
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0)
    const line = result.stdout.split("\n").find(line => line.startsWith("REQUEST-AT-URL "))
    expect(line).toBeDefined()
    expect(JSON.parse(line!.slice("REQUEST-AT-URL ".length))).toEqual({ host: executable, layers: 3, lateConstructorLookup: true, metadata: true, followingSignal: true })
  }
}, 65000)
