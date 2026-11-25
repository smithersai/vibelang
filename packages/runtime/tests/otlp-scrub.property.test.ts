import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, Layer, Logger, Metric } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as Otlp from "../src/experimental/Otlp.js"
import * as transport from "../src/experimental/internal/otlpTransport.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const command = "bun test tests/otlp-scrub.property.test.ts"

const alnum = (min: number, max: number) =>
  fc.string({ unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"), minLength: min, maxLength: max })
const upperDigits = (length: number) =>
  fc.string({ unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"), minLength: length, maxLength: length })

// Credentials whose whole secret part the rules must remove. Each answers
// the text to embed and the secret that must not survive.
const credential = fc.oneof(
  alnum(20, 40).map((secret) => ({ text: `ghp_${secret}`, secret })),
  alnum(8, 30).map((secret) => ({ text: `sk-${secret}`, secret })),
  upperDigits(16).map((secret) => ({ text: `AKIA${secret}`, secret })),
  alnum(10, 30).map((secret) => ({ text: `xoxb-${secret}`, secret })),
  alnum(8, 40).map((secret) => ({ text: `Bearer ${secret}`, secret })),
  alnum(8, 30).map((secret) => ({ text: `password=${secret}`, secret })),
  alnum(8, 30).map((secret) => ({ text: `"api_key": "${secret}"`, secret })),
  alnum(8, 30).map((secret) => ({ text: `https://deploy:${secret}@git.example.com/repo`, secret })),
  fc.tuple(alnum(12, 30), alnum(8, 20), alnum(8, 20)).map(([a, b, c]) => {
    const secret = `eyJ${a}.${b}.${c}`
    return { text: secret, secret }
  }),
  alnum(16, 40).map((secret) => ({ text: `-----BEGIN RSA PRIVATE KEY-----\n${secret}\n-----END RSA PRIVATE KEY-----`, secret }))
)

// Text around a credential: words and punctuation that end a token.
const separator = fc.constantFrom(" ", "\n", ", ", "; ", " | ")
const prose = fc.string({ unit: fc.constantFrom(..."the quick brown fox jumps over a lazy dog 0123456789 .:/-"), maxLength: 30 })

test("VIP-72 rule 2: no credential shape survives redaction, wherever it sits in a log line", async () => {
  await checkProperty(fc, {
    name: "otlp-redact-credentials",
    rule: "VIP-72 rule 2: a value shaped like a credential becomes [REDACTED] before export",
    command,
    arbitrary: fc.array(fc.record({ before: prose, sep: separator, credential, after: separator }), { minLength: 1, maxLength: 4 }),
    numRuns: 800,
    check: async (parts: Array<{ before: string; sep: string; credential: { text: string; secret: string }; after: string }>) => {
      const line = parts.map((part) => `${part.before}${part.sep}${part.credential.text}${part.after}`).join("")
      const redacted = Otlp.redact(line)
      for (const part of parts) expect(redacted.includes(part.credential.secret)).toBe(false)
      expect(redacted).toContain("[REDACTED")
    }
  })
})

test("VIP-72 rule 2: redaction reaches a fixed point", async () => {
  await checkProperty(fc, {
    name: "otlp-redact-fixed-point",
    rule: "VIP-72 rule 2: redacting redacted text changes nothing, so a replayed export is stable",
    command,
    arbitrary: fc.array(fc.oneof(fc.string({ unit: "grapheme", maxLength: 40 }), credential.map((item) => item.text), prose), {
      maxLength: 6
    }).map((pieces) => pieces.join(" ")),
    numRuns: 800,
    check: async (text: string) => {
      const once = Otlp.redact(text)
      expect(Otlp.redact(once)).toBe(once)
    }
  })
})

const sensitiveKey = fc.constantFrom("password", "api_key", "x-api-key", "authorization", "session", "client_secret", "accessToken", "db.connection_string")
const plainKey = fc.constantFrom("note", "http.method", "tokenizer", "idempotencyKey", "count", "gen_ai.usage.output_tokens")
const contentKey = fc.constantFrom("gen_ai.prompt", "gen_ai.completion", "gen_ai.input.messages", "gen_ai.tool.call.result", "vibe.content.shell")

test("VIP-72 rules 2 and 8: an OTLP payload loses every credential attribute and, by default, every content attribute", async () => {
  await checkProperty(fc, {
    name: "otlp-scrub-payload",
    rule: "VIP-72 rules 2 and 8: credential-named attributes are replaced and content attributes removed before export",
    command,
    arbitrary: fc.record({
      attributes: fc.array(fc.record({
        kind: fc.constantFrom("sensitive", "plain", "content"),
        sensitive: sensitiveKey,
        plain: plainKey,
        content: contentKey,
        value: alnum(10, 30),
        count: fc.nat()
      }), { minLength: 1, maxLength: 8 }),
      content: fc.boolean()
    }),
    numRuns: 500,
    check: async ({ attributes, content }: {
      attributes: Array<{ kind: string; sensitive: string; plain: string; content: string; value: string; count: number }>
      content: boolean
    }) => {
      const keyValues = attributes.map((item) => {
        const key = item.kind === "sensitive" ? item.sensitive : item.kind === "plain" ? item.plain : item.content
        const value = key.endsWith("_tokens") ? { intValue: item.count } : { stringValue: `v${item.value}` }
        return { key, value, item }
      })
      const payload = {
        resourceSpans: [{
          scopeSpans: [{ spans: [{ name: "step", attributes: keyValues.map(({ key, value }) => ({ key, value })) }] }]
        }]
      }
      const scrubbed = JSON.stringify(Otlp.scrubPayload(payload, { content }))
      for (const { key, value, item } of keyValues) {
        const text = "stringValue" in value ? value.stringValue : undefined
        if (item.kind === "sensitive" && text !== undefined) expect(scrubbed.includes(text)).toBe(false)
        if (item.kind === "content" && !content) {
          expect(scrubbed.includes(`"${key}"`)).toBe(false)
          if (text !== undefined) expect(scrubbed.includes(text)).toBe(false)
        }
        if (item.kind === "content" && content && text !== undefined) expect(scrubbed.includes(text)).toBe(true)
        if (item.kind === "plain" && text !== undefined) expect(scrubbed.includes(text)).toBe(true)
        if (key.endsWith("_tokens")) expect(scrubbed).toContain(`"intValue":${item.count}`)
      }
    }
  })
})

test("VIP-72 rule 4: the transport sends a scrubbed batch exactly when it fits the cap, and counts every other", async () => {
  await checkProperty(fc, {
    name: "otlp-transport-bound",
    rule: "VIP-72 rule 4: no request over the cap leaves the process; each discarded batch is counted once",
    command,
    arbitrary: fc.record({
      limit: fc.integer({ min: 16, max: 4096 }),
      batches: fc.array(fc.record({ pad: fc.nat({ max: 6000 }), secret: fc.boolean() }), { minLength: 1, maxLength: 6 })
    }),
    numRuns: 150,
    check: async ({ limit, batches }: { limit: number; batches: Array<{ pad: number; secret: boolean }> }) => {
      const sizes: Array<number> = []
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          sizes.push(request.body._tag === "Uint8Array" ? request.body.body.length : -1)
          return HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }))
        })
      )
      const layer = transport.layer({ maxRequestBytes: limit, content: false }).pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient)(client)),
        // The discard warning is asserted in otlp.test.ts; here it is noise.
        Layer.provide(Logger.layer([]))
      )
      const bodies = batches.map(({ pad, secret }) =>
        JSON.stringify({ body: { stringValue: `${secret ? "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWX " : ""}${"x".repeat(pad)}` } })
      )
      const before = (await Effect.runPromise(Metric.value(Otlp.dropped))).count
      await Effect.runPromise(Effect.provide(
        Effect.forEach(bodies, (body) =>
          Effect.flatMap(Effect.service(HttpClient.HttpClient), (http) =>
            http.execute(HttpClientRequest.post("http://localhost:4318/v1/logs").pipe(
              HttpClientRequest.bodyUint8Array(new TextEncoder().encode(body), "application/json")
            )))),
        layer
      ))
      const after = (await Effect.runPromise(Metric.value(Otlp.dropped))).count
      for (const size of sizes) expect(size).toBeLessThanOrEqual(limit)
      const scrubbedSizes = bodies.map((body) => transport.scrubBody(new TextEncoder().encode(body), false).length)
      const fits = scrubbedSizes.filter((size) => size <= limit).length
      expect(sizes.length).toBe(fits)
      expect(after - before).toBe(bodies.length - fits)
    }
  })
})
