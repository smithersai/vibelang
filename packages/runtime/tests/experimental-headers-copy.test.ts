import { expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Cause from "effect/Cause"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import fc from "fast-check"
import { readFileSync } from "node:fs"

const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-native-response-headers.json", import.meta.url), "utf8"))
const load = () => import("../src/experimental/Headers.js")
it("defers construction and passes the exact native source", async () => {
  const api = await load(), input = new Headers(corpus.pairs), calls: unknown[] = []
  const headers = api.make({ copy(source) { calls.push(source); return source } })
  const operation = headers.copy(input)
  expect(calls).toEqual([])
  expect(await Effect.runPromise(operation)).toBe(input)
  expect(calls).toEqual([input])
})
it("preserves duplicate Set-Cookie and independent mutable copies", async () => {
  const api = await load(), input = new Headers(corpus.pairs)
  const copy = await Effect.runPromise(api.make({ copy: source => new Headers(source) }).copy(input))
  expect(copy).not.toBe(input)
  expect(copy.getSetCookie()).toEqual(input.getSetCookie())
  expect(copy.getSetCookie()).toHaveLength(2)
  copy.delete("set-cookie"); copy.set("x-foldkit", "changed")
  expect(input.getSetCookie()).toHaveLength(2)
  expect(input.get("x-foldkit")).toBe("native")
})
it("copies response headers into an independently mutable native object", async () => {
  const api = await load(), input = Response.redirect("https://redirect.invalid/").headers
  const before = [...input]
  const copy = await Effect.runPromise(api.make({ copy: source => new Headers(source) }).copy(input))
  copy.set("x-probe", "a")
  expect(copy.get("x-probe")).toBe("a")
  expect([...input]).toEqual(before)
})
it("keeps native constructor exceptions as defects with identity", async () => {
  const api = await load(), input = new Headers(), error = new TypeError("native-headers")
  const result = await Effect.runPromiseExit(api.make({ copy: () => { throw error } }).copy(input))
  expect(Exit.isFailure(result)).toBe(true)
  if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBe(error)
})
it("provides a required explicit fake without constructing a host object", async () => {
  const api = await load(), input = new Headers()
  const operation = Effect.flatMap(api.Headers, headers => headers.copy(input))
  expect(await Effect.runPromise(Effect.provide(operation, api.layerTest({ copy: () => Effect.succeed(input) })))).toBe(input)
})
it("rejects response-model cookie normalization as a native copy", () => {
  const input = new Headers(corpus.pairs)
  const converted = HttpServerResponse.toWeb(HttpServerResponse.fromWeb(new Response(null, { headers: input }))).headers
  expect(converted.getSetCookie()).not.toEqual(new Headers(input).getSetCookie())
})
it("matches the native constructor across 500 keyed mutation schedules", async () => {
  const api = await load(), service = api.make({ copy: source => new Headers(source) })
  const observe = async (pairs: string[][], changes: Array<{ key: string; value: string; remove: boolean }>, copy: (h: Headers) => Promise<Headers>) => {
    const input = new Headers([...corpus.pairs, ...pairs]), before = [...input], cookies = input.getSetCookie()
    const out = await copy(input), initial = [...out], initialCookies = out.getSetCookie()
    for (const change of changes) {
      if (change.remove) out.delete(change.key)
      else out.append(change.key, change.value)
    }
    input.append("x-source-only", "after")
    return { independent: out !== input, before, cookies, initial, initialCookies, after: [...out], afterCookies: out.getSetCookie(), source: [...input], sourceCookies: input.getSetCookie() }
  }
  const key = fc.constantFrom("x-foldkit", "X-Other", "set-cookie", "accept")
  const value = fc.stringMatching(/^[a-z0-9 =;\/-]{0,24}$/)
  await fc.assert(fc.asyncProperty(fc.array(fc.tuple(key, value), { maxLength: 10 }), fc.array(fc.record({ key, value, remove: fc.boolean() }), { maxLength: 12 }), async (pairs, changes) => {
    expect(await observe(pairs, changes, h => Effect.runPromise(service.copy(h)))).toEqual(await observe(pairs, changes, async h => new Headers(h)))
  }), { seed: 531167, numRuns: 500 })
})

it("uses all platform providers with late native constructor lookup in Node and Bun", async () => {
  await load()
  const { spawnSync } = await import("node:child_process")
  const { fileURLToPath } = await import("node:url")
  const file = fileURLToPath(new URL("./fixtures/headers-copy-host.mjs", import.meta.url))
  for (const executable of ["node", "bun"]) {
    const result = spawnSync(executable, [file], { encoding: "utf8", timeout: 30000 })
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0)
    const line = result.stdout.split("\n").find(line => line.startsWith("HEADERS-COPY "))
    expect(line).toBeDefined()
    expect(JSON.parse(line!.slice("HEADERS-COPY ".length))).toEqual({ host: executable, layers: 3, lateConstructorLookup: true, duplicateCookies: true, independent: true })
  }
}, 65000)
