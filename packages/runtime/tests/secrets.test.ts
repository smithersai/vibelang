import { expect, test } from "bun:test"
import { ConfigProvider, Effect, Exit, Layer, Option, Redacted, Stream } from "effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Secrets from "../src/experimental/Secrets.js"

// The test's own upstream: records every request it is sent, as the host
// would see it, and answers with what the test asks for.
interface Seen {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: string
  readonly redirect: string | undefined
}

const upstream = (answer: (seen: Seen) => Response = () => new Response("ok")) => {
  const seen: Array<Seen> = []
  const client = HttpClient.make((request, url) =>
    Effect.gen(function*() {
      const init = yield* Effect.serviceOption(FetchHttpClient.RequestInit)
      const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
      const entry: Seen = {
        method: request.method,
        url: url.href,
        headers: { ...request.headers },
        body,
        redirect: Option.getOrUndefined(init)?.redirect
      }
      seen.push(entry)
      return HttpClientResponse.fromWeb(request, answer(entry))
    })
  )
  return { seen, layer: Layer.succeed(HttpClient.HttpClient)(client) }
}

const VALUE = "sk_live_0123456789abcdef"
const OTHER = "ghp_ABCDEFGHIJKLMNOPQRST"

const audited = () => {
  const entries: Array<Secrets.Entry> = []
  const layer = Layer.succeed(Secrets.Audit)({
    record: (entry) => Effect.sync(() => void entries.push(entry))
  })
  return { entries, layer }
}

const bindings: ReadonlyArray<Secrets.Binding> = [
  { name: "STRIPE_KEY", hosts: ["api.stripe.com"], methods: ["GET", "POST"] },
  { name: "GITHUB_TOKEN", hosts: ["api.github.com"] }
]

const run = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient | Secrets.Egress>,
  options: {
    readonly answer?: (seen: Seen) => Response
    readonly vault?: Layer.Layer<never>
    readonly egress?: Secrets.EgressOptions
    readonly bindings?: ReadonlyArray<Secrets.Binding>
  } = {}
) => {
  const host = upstream(options.answer)
  const audit = audited()
  const below = Layer.mergeAll(
    host.layer,
    audit.layer,
    options.vault ?? Secrets.fixtures({ STRIPE_KEY: VALUE, GITHUB_TOKEN: OTHER })
  )
  const layer = Secrets.egress(options.bindings ?? bindings, options.egress).pipe(Layer.provide(below))
  return Effect.runPromiseExit(Effect.provide(effect, layer)).then((exit) => ({
    exit,
    seen: host.seen,
    entries: audit.entries
  }))
}

const bodyText = (response: HttpClientResponse.HttpClientResponse) => response.text

const failureCode = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return undefined
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  const found = error === undefined ? Option.none() : Secrets.refusal((error as { error: unknown }).error)
  return Option.isSome(found) ? found.value.code : undefined
}

test("VIP-68 rule 1: the value replaces the placeholder only for a bound host over HTTPS", async () => {
  const { exit, seen, entries } = await run(Effect.gen(function*() {
    const key = yield* Secrets.placeholder("STRIPE_KEY")
    expect(Secrets.isPlaceholder(key)).toBe(true)
    expect(key.startsWith(Secrets.prefix)).toBe(true)
    const http = yield* HttpClient.HttpClient
    const response = yield* http.get("https://api.stripe.com/v1/charges", {
      headers: { authorization: `Bearer ${key}` }
    })
    return { key, status: response.status, body: yield* bodyText(response) }
  }))
  expect(Exit.isSuccess(exit)).toBe(true)
  if (!Exit.isSuccess(exit)) return
  expect(seen).toHaveLength(1)
  expect(seen[0]!.headers["authorization"]).toBe(`Bearer ${VALUE}`)
  expect(seen[0]!.redirect).toBe("manual")
  expect(exit.value.body).toBe("ok")
  expect(entries).toEqual([{ host: "api.stripe.com", method: "GET", outcome: "forwarded", secrets: ["STRIPE_KEY"] }])
})

test("VIP-68 rule 2: a placeholder in the URL or the body reaches the host as the placeholder", async () => {
  let key = ""
  const { exit, seen } = await run(Effect.gen(function*() {
    key = yield* Secrets.placeholder("STRIPE_KEY")
    const http = yield* HttpClient.HttpClient
    const request = HttpClientRequest.post(`https://api.stripe.com/v1/charges?k=${key}`).pipe(
      HttpClientRequest.bodyText(`{"key":"${key}"}`, "application/json")
    )
    return yield* http.execute(request)
  }))
  expect(Exit.isSuccess(exit)).toBe(true)
  expect(seen[0]!.url).toContain(key)
  expect(seen[0]!.url).not.toContain(VALUE)
  expect(seen[0]!.body).toContain(key)
  expect(seen[0]!.body).not.toContain(VALUE)
})

test("VIP-68 rule 3: a redirect returns to the step with its Location scrubbed", async () => {
  const { exit, seen } = await run(Effect.gen(function*() {
    const key = yield* Secrets.placeholder("STRIPE_KEY")
    const http = yield* HttpClient.HttpClient
    const response = yield* http.get("https://api.stripe.com/v1/charges", { headers: { authorization: `Bearer ${key}` } })
    return { status: response.status, location: response.headers["location"], key }
  }), {
    answer: (entry) =>
      new Response(null, {
        status: 302,
        headers: { location: `https://evil.example/steal?k=${encodeURIComponent(entry.headers["authorization"]!)}` }
      })
  })
  expect(Exit.isSuccess(exit)).toBe(true)
  if (!Exit.isSuccess(exit)) return
  expect(seen).toHaveLength(1)
  expect(exit.value.status).toBe(302)
  expect(exit.value.location).not.toContain(encodeURIComponent(VALUE))
  expect(exit.value.location).toContain(exit.value.key)
})

test("VIP-68 rule 4: every value is scrubbed from every answer, in its encodings", async () => {
  const echo = [
    VALUE,
    encodeURIComponent(VALUE),
    JSON.stringify({ token: OTHER }),
    btoa(`user:${VALUE}`)
  ].join("\n")
  const { exit } = await run(Effect.gen(function*() {
    const http = yield* HttpClient.HttpClient
    const response = yield* http.get("https://api.github.com/user")
    return { body: yield* bodyText(response), header: response.headers["x-echo"] }
  }), {
    answer: () => new Response(echo, { headers: { "x-echo": VALUE, "content-encoding": "identity" } })
  })
  expect(Exit.isSuccess(exit)).toBe(true)
  if (!Exit.isSuccess(exit)) return
  expect(exit.value.body).not.toContain(VALUE)
  expect(exit.value.body).not.toContain(OTHER)
  expect(exit.value.body).not.toContain(btoa(`user:${VALUE}`).slice(8, 24))
  expect(exit.value.header).not.toContain(VALUE)
})

test("VIP-68 rule 4: scrubbing a stream finds a value split across chunks", async () => {
  const target = [{ value: VALUE, replacement: "<P>" }]
  const scrubber = await import("../src/experimental/internal/secrets.js").then((m) => m.scrubber(target))
  const text = `before ${VALUE} after ${VALUE}`
  const bytes = new TextEncoder().encode(text)
  const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]))
  const out = await Effect.runPromise(Stream.runCollect(scrubber.stream(Stream.fromIterable(chunks))))
  const joined = new TextDecoder().decode(Uint8Array.from(Array.from(out).flatMap((chunk) => Array.from(chunk))))
  expect(joined).toBe("before <P> after <P>")
})

test("VIP-68 rule 5: a request the audit cannot record is not sent, and no entry holds a value", async () => {
  const host = upstream()
  const layer = Secrets.egress(bindings).pipe(Layer.provide(Layer.mergeAll(
    host.layer,
    Secrets.fixtures({ STRIPE_KEY: VALUE, GITHUB_TOKEN: OTHER }),
    Layer.succeed(Secrets.Audit)({ record: () => Effect.fail(new Secrets.AuditUnavailable()) })
  )))
  const exit = await Effect.runPromiseExit(Effect.provide(Effect.gen(function*() {
    const key = yield* Secrets.placeholder("STRIPE_KEY")
    const http = yield* HttpClient.HttpClient
    return yield* http.get("https://api.stripe.com/v1/charges", { headers: { authorization: `Bearer ${key}` } })
  }), layer))
  expect(failureCode(exit)).toBe("audit")
  expect(host.seen).toHaveLength(0)
  expect(JSON.stringify(exit)).not.toContain(VALUE)
})

test("VIP-68 rule 6 and the closed refusal list", async () => {
  const cases: ReadonlyArray<{ readonly url: string; readonly method?: string; readonly code: Secrets.Refusal; readonly header?: (key: string) => string }> = [
    { url: "https://evil.example/x", code: "host_not_allowed" },
    { url: "http://api.stripe.com/x", code: "insecure_scheme" },
    { url: "https://api.stripe.com:8443/x", code: "port_not_allowed" },
    { url: "https://user:pw@api.stripe.com/x", code: "invalid_url" },
    { url: "https://api.stripe.com/x", method: "DELETE", code: "secret_not_allowed" },
    { url: "https://api.github.com/x", code: "secret_not_allowed" },
    { url: "https://api.stripe.com/x", code: "unknown_placeholder", header: () => `Bearer ${Secrets.prefix}${"a".repeat(64)}` },
    {
      url: "https://api.stripe.com/x",
      code: "too_many_placeholders",
      header: () => Array.from({ length: 17 }, (_, index) => `${Secrets.prefix}${index.toString(16).padStart(64, "0")}`).join(" ")
    }
  ]
  for (const item of cases) {
    const { exit, seen, entries } = await run(Effect.gen(function*() {
      const key = yield* Secrets.placeholder("STRIPE_KEY")
      const http = yield* HttpClient.HttpClient
      const request = HttpClientRequest.make((item.method ?? "GET") as "GET")(item.url).pipe(
        HttpClientRequest.setHeader("authorization", item.header?.(key) ?? `Bearer ${key}`)
      )
      return yield* http.execute(request)
    }))
    expect([item.url, failureCode(exit)]).toEqual([item.url, item.code])
    expect(seen).toHaveLength(0)
    expect(entries.map((entry) => entry.outcome)).toEqual([item.code])
    expect(JSON.stringify(entries)).not.toContain(VALUE)
  }
})

test("VIP-68 rule 6: allow lets a request with no secret reach another host", async () => {
  const { exit, seen } = await run(Effect.gen(function*() {
    const http = yield* HttpClient.HttpClient
    return (yield* http.get("https://registry.npmjs.org/effect")).status
  }), { egress: { allow: ["registry.npmjs.org"] } })
  expect(Exit.isSuccess(exit)).toBe(true)
  expect(seen).toHaveLength(1)
})

test("VIP-68 rule 7: headers over 64 KiB after substitution are refused", async () => {
  const big = "x".repeat(16 * 1024)
  const { exit, seen } = await run(Effect.gen(function*() {
    const key = yield* Secrets.placeholder("STRIPE_KEY")
    const http = yield* HttpClient.HttpClient
    const headers: Record<string, string> = { authorization: `Bearer ${key}` }
    for (let index = 0; index < 4; index++) headers[`x-pad-${index}`] = big
    return yield* http.get("https://api.stripe.com/x", { headers })
  }))
  expect(failureCode(exit)).toBe("headers_too_large")
  expect(seen).toHaveLength(0)
})

test("VIP-68 rule 7: a stored value with a control character is never put in a header", async () => {
  const { exit, seen } = await run(Effect.gen(function*() {
    const key = yield* Secrets.placeholder("STRIPE_KEY")
    const http = yield* HttpClient.HttpClient
    return yield* http.get("https://api.stripe.com/x", { headers: { authorization: `Bearer ${key}` } })
  }), { vault: Secrets.fixtures({ STRIPE_KEY: "abcdefgh\r\nx-evil: 1", GITHUB_TOKEN: OTHER }) })
  expect(failureCode(exit)).toBe("value")
  expect(seen).toHaveLength(0)
})

test("VIP-68 rule 8: placeholders are derived from key, scope and name", async () => {
  const provider = ConfigProvider.layer(ConfigProvider.fromUnknown({ SECRETS_PLACEHOLDER_KEY: "k".repeat(40) }))
  const derive = (scope: string) =>
    Effect.runPromise(Effect.provide(
      Secrets.placeholder("STRIPE_KEY"),
      Secrets.egress(bindings, { scope }).pipe(Layer.provide(Layer.mergeAll(upstream().layer, provider)))
    ))
  const first = await derive("run-1")
  expect(await derive("run-1")).toBe(first)
  expect(await derive("run-2")).not.toBe(first)

  // An earlier scope's placeholder is refused as unknown.
  const { exit } = await run(Effect.gen(function*() {
    const http = yield* HttpClient.HttpClient
    return yield* http.get("https://api.stripe.com/x", { headers: { authorization: `Bearer ${first}` } })
  }), { egress: { scope: "run-3" } })
  expect(failureCode(exit)).toBe("unknown_placeholder")
})

test("VIP-68 rule 8: a configured key under 32 characters fails the layer", async () => {
  const provider = ConfigProvider.layer(ConfigProvider.fromUnknown({ SECRETS_PLACEHOLDER_KEY: "short" }))
  const exit = await Effect.runPromiseExit(Effect.provide(
    Secrets.placeholder("STRIPE_KEY"),
    Secrets.egress(bindings).pipe(Layer.provide(Layer.mergeAll(upstream().layer, provider)))
  ))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(JSON.stringify(exit)).toContain("SecretKeyTooShort")
})

test("VIP-68 rule 9: the default vault reads Config.Redacted, and a missing secret fails closed", async () => {
  const host = upstream()
  const provider = ConfigProvider.layer(ConfigProvider.fromUnknown({ STRIPE_KEY: VALUE }))
  const exit = await Effect.runPromiseExit(Effect.provide(Effect.gen(function*() {
    const key = yield* Secrets.placeholder("STRIPE_KEY")
    const http = yield* HttpClient.HttpClient
    return yield* http.get("https://api.stripe.com/x", { headers: { authorization: `Bearer ${key}` } })
  }), Secrets.egress(bindings).pipe(Layer.provide(Layer.mergeAll(host.layer, provider)))))
  // GITHUB_TOKEN is in the policy and missing, so nothing can be scrubbed for it: fail closed.
  expect(failureCode(exit)).toBe("secret")
  expect(host.seen).toHaveLength(0)

  const only = await Effect.runPromiseExit(Effect.provide(Effect.gen(function*() {
    const key = yield* Secrets.placeholder("STRIPE_KEY")
    const http = yield* HttpClient.HttpClient
    return (yield* http.get("https://api.stripe.com/x", { headers: { authorization: `Bearer ${key}` } })).status
  }), Secrets.egress([bindings[0]!]).pipe(Layer.provide(Layer.mergeAll(host.layer, provider)))))
  expect(Exit.isSuccess(only)).toBe(true)
  expect(host.seen[0]!.headers["authorization"]).toBe(`Bearer ${VALUE}`)
})

test("VIP-68: a Basic credential's placeholder is substituted inside the decoded pair", async () => {
  const { exit, seen } = await run(Effect.gen(function*() {
    const key = yield* Secrets.placeholder("GITHUB_TOKEN")
    const http = yield* HttpClient.HttpClient
    return yield* http.get("https://api.github.com/user", { headers: { authorization: `Basic ${btoa(`me:${key}`)}` } })
  }))
  expect(Exit.isSuccess(exit)).toBe(true)
  expect(seen[0]!.headers["authorization"]).toBe(`Basic ${btoa(`me:${OTHER}`)}`)
})

test("VIP-68: placeholder fails for a name the egress does not bind", async () => {
  const { exit } = await run(Secrets.placeholder("AWS_KEY"))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(JSON.stringify(exit)).toContain("SecretNotBound")
})

test("VIP-68: a binding outside the rules fails the layer", async () => {
  const bad: ReadonlyArray<ReadonlyArray<Secrets.Binding>> = [
    [{ name: "lower", hosts: ["api.stripe.com"] }],
    [{ name: "A", hosts: [] }],
    [{ name: "A", hosts: ["*.stripe.com"] }],
    [{ name: "A", hosts: ["10.0.0.1"] }],
    [{ name: "A", hosts: ["localhost"] }],
    [{ name: "A", hosts: ["API.stripe.com"] }],
    [{ name: "A", hosts: Array.from({ length: 17 }, (_, index) => `h${index}.example.com`) }],
    [{ name: "A", hosts: ["a.example.com"], methods: ["TRACE" as Secrets.Method] }],
    [{ name: "A", hosts: ["a.example.com"] }, { name: "A", hosts: ["b.example.com"] }]
  ]
  for (const item of bad) {
    const exit = await Effect.runPromiseExit(Effect.provide(
      Secrets.placeholder("A"),
      Secrets.egress(item).pipe(Layer.provide(upstream().layer))
    ))
    expect(JSON.stringify(exit)).toContain("SecretBindingInvalid")
  }
})

test("VIP-68: forward answers a sandbox's intercepted request, refusals as text with their status", async () => {
  const host = upstream(() => new Response(`echo ${VALUE}`))
  const layer = Secrets.egress(bindings, { scope: "sandbox" }).pipe(Layer.provide(Layer.mergeAll(
    host.layer,
    audited().layer,
    Secrets.fixtures({ STRIPE_KEY: VALUE, GITHUB_TOKEN: OTHER })
  )))
  const answer = async (url: string, header: (key: string) => string) =>
    Effect.runPromise(Effect.provide(Effect.gen(function*() {
      const key = yield* Secrets.placeholder("STRIPE_KEY")
      const request = HttpServerRequest.fromWeb(new Request(url, { headers: { authorization: header(key) } }))
      const response = yield* Secrets.forward(request)
      return HttpServerResponse.toWeb(response)
    }), layer)).then(async (web) => ({ status: web.status, body: await web.text() }))
  const ok = await answer("https://api.stripe.com/v1/charges", (key) => `Bearer ${key}`)
  expect(ok.status).toBe(200)
  expect(ok.body).not.toContain(VALUE)
  expect(host.seen[0]!.headers["authorization"]).toBe(`Bearer ${VALUE}`)
  const refused = await answer("https://evil.example/", (key) => `Bearer ${key}`)
  expect(refused).toEqual({ status: 403, body: "host_not_allowed" })
})

test("VIP-68: scrub replaces a value in text a step got another way", () => {
  const text = `token=${encodeURIComponent(VALUE)} raw=${VALUE}`
  expect(Secrets.scrub(text, [{ value: Redacted.make(VALUE), replacement: "[P]" }])).toBe("token=[P] raw=[P]")
})
