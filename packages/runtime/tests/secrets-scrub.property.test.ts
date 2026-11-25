import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, Layer, Stream } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as Secrets from "../src/experimental/Secrets.js"
import * as internal from "../src/experimental/internal/secrets.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const command = "bun test tests/secrets-scrub.property.test.ts"

// A value the vault may hold: 8 to 40 characters of text with no control
// character. Full Unicode is allowed; lone surrogates are not text.
const value = fc.string({ unit: "grapheme", minLength: 8, maxLength: 40 })
  .filter((candidate) => internal.valueProblem(candidate) === undefined)

const noise = fc.string({ unit: "grapheme", maxLength: 40 })

// No form of a value holds U+0001, so no form can straddle a replacement.
const REPLACEMENT = "\u0001"

const splitAt = (bytes: Uint8Array, cuts: ReadonlyArray<number>): Array<Uint8Array> => {
  const points = [...new Set(cuts.map((cut) => cut % (bytes.length + 1)))].sort((a, b) => a - b)
  const chunks: Array<Uint8Array> = []
  let start = 0
  for (const point of points) {
    chunks.push(bytes.slice(start, point))
    start = point
  }
  chunks.push(bytes.slice(start))
  return chunks
}

const collect = async (stream: Stream.Stream<Uint8Array>) => {
  const chunks = await Effect.runPromise(Stream.runCollect(stream))
  return new TextDecoder().decode(internal.concat(Array.from(chunks)))
}

test("VIP-68 rule 4: no form of a value survives scrubbing, however the body is chunked", async () => {
  await checkProperty(fc, {
    name: "secrets-scrub-forms-chunked",
    rule: "VIP-68 rule 4: the value and its percent, JSON and base64 encodings are scrubbed across chunk boundaries",
    command,
    arbitrary: fc.record({
      value,
      pieces: fc.array(fc.record({ before: noise, form: fc.nat(), after: noise }), { minLength: 1, maxLength: 4 }),
      cuts: fc.array(fc.nat(), { maxLength: 12 })
    }),
    numRuns: 400,
    check: async ({ value, pieces, cuts }: {
      value: string
      pieces: Array<{ before: string; form: number; after: string }>
      cuts: Array<number>
    }) => {
      const forms = internal.forms(value)
      const text = pieces.map((piece) => piece.before + forms[piece.form % forms.length]! + piece.after).join("")
      const scrubber = internal.scrubber([{ value, replacement: REPLACEMENT }])
      const whole = scrubber.text(text)
      for (const form of forms) expect(whole.includes(form)).toBe(false)
      const streamed = await collect(scrubber.stream(Stream.fromIterable(splitAt(new TextEncoder().encode(text), cuts))))
      expect(streamed).toBe(whole)
    }
  })
})

test("VIP-68 rule 4: a value inside a longer base64 string is found at every alignment", async () => {
  await checkProperty(fc, {
    name: "secrets-scrub-base64-embedded",
    rule: "VIP-68 rule 4: a base64 echo of a value inside other bytes, such as Basic user:value, is scrubbed",
    command,
    arbitrary: fc.record({ value, before: noise, after: noise, url: fc.boolean() }),
    numRuns: 300,
    check: async ({ value, before, after, url }: { value: string; before: string; after: string; url: boolean }) => {
      const encoded = internal.base64(internal.utf8(before + value + after), url ? "url" : "standard", true)
      const scrubbed = internal.scrubber([{ value, replacement: REPLACEMENT }]).text(encoded)
      expect(scrubbed.includes(REPLACEMENT)).toBe(true)
      for (const form of internal.forms(value)) expect(scrubbed.includes(form)).toBe(false)
    }
  })
})

test("VIP-68 rule 4: text holding no form of any value is unchanged", async () => {
  await checkProperty(fc, {
    name: "secrets-scrub-identity",
    rule: "VIP-68 rule 4: scrubbing rewrites only echoes",
    command,
    arbitrary: fc.record({ value, text: noise, cuts: fc.array(fc.nat(), { maxLength: 8 }) }),
    numRuns: 300,
    check: async ({ value, text, cuts }: { value: string; text: string; cuts: Array<number> }) => {
      fc.pre(internal.forms(value).every((form) => !text.includes(form)))
      const scrubber = internal.scrubber([{ value, replacement: REPLACEMENT }])
      expect(scrubber.text(text)).toBe(text)
      expect(await collect(scrubber.stream(Stream.fromIterable(splitAt(new TextEncoder().encode(text), cuts))))).toBe(text)
    }
  })
})

const hosts = ["api.stripe.com", "api.github.com", "evil.example", "a.b.c.example.org"] as const
const schemes = ["https:", "http:", "ftp:"] as const
const ports = ["", ":443", ":8443", ":80"] as const

test("VIP-68 rules 1 and 6: decide allows a secret only for its own hosts, methods, port and HTTPS", async () => {
  await checkProperty(fc, {
    name: "secrets-decide-audience",
    rule: "VIP-68 rules 1, 6 and 7: an allowed request's every secret is bound to its host and method, over HTTPS, on the scheme's port",
    command,
    arbitrary: fc.record({
      secrets: fc.array(fc.record({
        hosts: fc.subarray([...hosts], { minLength: 1 }),
        methods: fc.option(fc.subarray([...internal.methods], { minLength: 1 }), { nil: undefined })
      }), { minLength: 1, maxLength: 4 }),
      allow: fc.subarray([...hosts]),
      scheme: fc.constantFrom(...schemes),
      host: fc.constantFrom(...hosts),
      port: fc.constantFrom(...ports),
      method: fc.constantFrom(...internal.methods),
      carried: fc.array(fc.nat(), { maxLength: 5 }),
      stranger: fc.boolean()
    }),
    numRuns: 1500,
    check: async (input: {
      secrets: Array<{ hosts: Array<string>; methods: Array<internal.Method> | undefined }>
      allow: Array<string>
      scheme: string
      host: string
      port: string
      method: internal.Method
      carried: Array<number>
      stranger: boolean
    }) => {
      const policy: internal.Policy = {
        allow: input.allow,
        secrets: input.secrets.map((secret, index) => ({
          name: `S${index}`,
          hosts: secret.hosts,
          methods: secret.methods,
          placeholder: `${internal.prefix}${index.toString(16).padStart(64, "0")}`
        }))
      }
      const carried = input.carried.map((index) => policy.secrets[index % policy.secrets.length]!.placeholder)
      if (input.stranger) carried.push(`${internal.prefix}${"f".repeat(64)}`)
      const url = `${input.scheme}//${input.host}${input.port}/path`
      const decision = internal.decide({
        method: input.method,
        url,
        headers: { authorization: carried.join(" ") }
      }, policy)
      if (decision._tag === "Denied") {
        expect(Object.keys(internal.refusals)).toContain(decision.code)
        return
      }
      const parsed = new URL(url)
      expect(parsed.protocol === "https:" || parsed.protocol === "http:").toBe(true)
      expect(parsed.port).toBe("")
      expect(input.stranger).toBe(false)
      const bound = policy.secrets.some((secret) => secret.hosts.includes(input.host))
      expect(bound || input.allow.includes(input.host)).toBe(true)
      expect(new Set(decision.used.map((secret) => secret.placeholder))).toEqual(new Set(carried))
      for (const secret of decision.used) {
        expect(secret.hosts).toContain(input.host)
        if (secret.methods !== undefined) expect(secret.methods).toContain(input.method)
        expect(parsed.protocol).toBe("https:")
      }
    }
  })
})

test("VIP-68: through the egress, no value of the policy reaches the step, whatever the host echoes", async () => {
  await checkProperty(fc, {
    name: "secrets-egress-echo",
    rule: "VIP-68 rule 4: every value in the policy is scrubbed from every answer's headers and body",
    command,
    arbitrary: fc.record({
      first: value,
      second: value,
      pieces: fc.array(fc.record({ before: noise, which: fc.boolean(), form: fc.nat() }), { minLength: 1, maxLength: 4 }),
      cuts: fc.array(fc.nat(), { maxLength: 8 })
    }),
    numRuns: 100,
    check: async ({ first, second, pieces, cuts }: {
      first: string
      second: string
      pieces: Array<{ before: string; which: boolean; form: number }>
      cuts: Array<number>
    }) => {
      fc.pre(!first.includes(second) && !second.includes(first))
      const echo = pieces.map((piece) => {
        const forms = internal.forms(piece.which ? first : second)
        return piece.before + forms[piece.form % forms.length]!
      }).join("")
      const bytes = new TextEncoder().encode(echo)
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          const chunks = splitAt(bytes, cuts)
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk)
              controller.close()
            }
          })
          return HttpClientResponse.fromWeb(request, new Response(body, { headers: { "x-echo": encodeURIComponent(first) } }))
        })
      )
      const layer = Secrets.egress([
        { name: "FIRST", hosts: ["api.example.com"] },
        { name: "SECOND", hosts: ["other.example.com"] }
      ]).pipe(Layer.provide(Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient)(client),
        Secrets.fixtures({ FIRST: first, SECOND: second }),
        Layer.succeed(Secrets.Audit)({ record: () => Effect.void })
      )))
      const answer = await Effect.runPromise(Effect.provide(Effect.gen(function*() {
        const key = yield* Secrets.placeholder("FIRST")
        const http = yield* HttpClient.HttpClient
        const response = yield* http.get("https://api.example.com/", { headers: { authorization: `Bearer ${key}` } })
        return { body: yield* response.text, header: response.headers["x-echo"] ?? "" }
      }), layer))
      for (const secret of [first, second]) {
        expect(answer.body.includes(secret)).toBe(false)
        expect(answer.header.includes(encodeURIComponent(secret))).toBe(false)
      }
    }
  })
})
