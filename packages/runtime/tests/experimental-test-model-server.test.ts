import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fc from "fast-check"
import { Effect, Layer, Schema, Stream } from "effect"
import { NodeFileSystem, NodeHttpServer } from "@effect/platform-node"
import { AiError, LanguageModel } from "effect/ai"
import { HttpServer } from "effect/http"
import { Test } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// Serves `fixture` on a free port for the duration of `use`.
const serving = <A>(fixture: Test.Fixture, use: (url: string) => Promise<A>): Promise<A> =>
  Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const context = yield* Layer.build(
      Test.modelServer({ fixture }).pipe(Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })))
    )
    const server = yield* Effect.provideContext(Effect.service(HttpServer.HttpServer), context)
    const address = server.address as { readonly port: number }
    return yield* Effect.promise(() => use(`http://127.0.0.1:${address.port}/v1/chat/completions`))
  })))

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

const answer = (prompt: string, text: string) => ({ request: { prompt }, response: [{ type: "text", text }] })

test("Test.modelServer answers a Chat Completions request from a recording, whatever model it names", async () => {
  const body = await serving({ calls: [answer("hello", "hi there")] }, async (url) =>
    (await post(url, { model: "any-model", messages: [{ role: "user", content: "hello" }] })).json())
  expect(body).toMatchObject({
    object: "chat.completion",
    model: "any-model",
    choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }]
  })
})

test("Test.modelServer answers 501 unrecorded for a request it does not hold, and claims each recording once", async () => {
  const statuses = await serving({ calls: [answer("hello", "hi")] }, async (url) => {
    const first = await post(url, { model: "m", messages: [{ role: "user", content: "hello" }] })
    const second = await post(url, { model: "m", messages: [{ role: "user", content: "hello" }] })
    const other = await post(url, { model: "m", messages: [{ role: "user", content: "bye" }] })
    return [first.status, second.status, (await second.json()).error.type, other.status]
  })
  expect(statuses).toEqual([200, 501, "unrecorded", 501])
})

test("Test.modelServer streams server-sent chunks when asked", async () => {
  const text = await serving({ calls: [answer("count", "one two")] }, async (url) =>
    (await post(url, { model: "m", stream: true, messages: [{ role: "user", content: "count" }] })).text())
  const events = text.split("\n\n").filter((e) => e.startsWith("data: ")).map((e) => e.slice(6))
  expect(events.at(-1)).toBe("[DONE]")
  const chunks = events.slice(0, -1).map((e) => JSON.parse(e))
  expect(chunks.map((c) => c.choices[0]?.delta?.content ?? "").join("")).toBe("one two")
  expect(chunks.at(-1).choices[0].finish_reason).toBe("stop")
})

test("Test.modelServer matches tools and answers recorded tool calls", async () => {
  const parameters = { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
  const fixture = {
    calls: [{
      request: { prompt: "find 7", tools: [{ name: "Lookup", description: "Find a record", parameters }] },
      response: [{ type: "tool-call", id: "c1", name: "Lookup", params: { id: "7" } }, { type: "finish", reason: "tool-calls" }]
    }]
  }
  const body = await serving(fixture, async (url) =>
    (await post(url, {
      model: "m",
      messages: [{ role: "user", content: "find 7" }],
      tools: [{ type: "function", function: { name: "Lookup", description: "Find a record", parameters } }]
    })).json())
  expect(body.choices[0]).toEqual({
    index: 0,
    message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "Lookup", arguments: `{"id":"7"}` } }] },
    finish_reason: "tool_calls"
  })
})

test("Test.modelServer answers a recorded provider failure with its status", async () => {
  const failure = Schema.encodeSync(AiError.AiError)(AiError.make({ module: "P", method: "generateText", reason: new AiError.RateLimitError({}) }))
  const status = await serving({ calls: [{ request: { prompt: "hello" }, failure }] }, async (url) =>
    (await post(url, { model: "m", messages: [{ role: "user", content: "hello" }] })).status)
  expect(status).toBe(429)
})

// A conversation recorded in this process through Test.record replays over
// HTTP: the server reads a Chat Completions body as the prompt Effect's
// LanguageModel sends a provider, so the recorded request matches.
test("property: what Test.record records in-process, Test.modelServer answers over HTTP", async () => {
  await checkProperty(fc, {
    name: "test-model-server-matches-record",
    rule: "VIP-71 rule 7: a model in another process is served over HTTP from a fixture",
    command: "bun test tests/experimental-test-model-server.test.ts",
    arbitrary: fc.record({
      system: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: undefined }),
      turns: fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 4 })
    }),
    numRuns: 30,
    check: async ({ system, turns }: { readonly system: string | undefined; readonly turns: ReadonlyArray<string> }) => {
      // user, assistant, user, ...: every other turn is the assistant's.
      const messages = [
        ...(system === undefined ? [] : [{ role: "system" as const, content: system }]),
        ...turns.map((text, i) => ({ role: i % 2 === 0 ? "user" as const : "assistant" as const, content: text }))
      ]
      if (messages.at(-1)!.role !== "user") messages.push({ role: "user", content: "next" })
      const dir = mkdtempSync(join(tmpdir(), "vibelang-model-server-"))
      try {
        const path = join(dir, "chat.json")
        const live = Layer.effect(
          LanguageModel.LanguageModel,
          LanguageModel.make({
            generateText: () => Effect.succeed([{ type: "text", text: "recorded answer" }]),
            streamText: () => Stream.empty
          })
        )
        await Effect.runPromise(
          LanguageModel.generateText({ prompt: messages }).pipe(
            Effect.provide(Test.record(path, { live }).pipe(Layer.provide(NodeFileSystem.layer)))
          )
        )
        const fixture = JSON.parse(readFileSync(path, "utf8"))
        const body = await serving(fixture, async (url) => (await post(url, { model: "other", messages })).json())
        expect(body.choices?.[0]?.message?.content).toBe("recorded answer")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })
}, 120000)
