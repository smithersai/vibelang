import { expect, test } from "bun:test"
import fc from "fast-check"
import { Cause, Effect, Exit, Schema, Stream } from "effect"
import { AiError, LanguageModel, Tool, Toolkit } from "effect/ai"
import { Test } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const Label = Schema.Struct({ type: Schema.Literals(["bug", "feature", "question", "chore"]) })

const label = (title: string) =>
  Effect.map(LanguageModel.generateObject({ prompt: `Label this issue: ${title}`, schema: Label }), (reply) => reply.value)

const answer = (prompt: string, text: string) => ({ request: { prompt }, response: [{ type: "text", text }] })

const run = <A, E>(effect: Effect.Effect<A, E, LanguageModel.LanguageModel | Test.Recording>, fixture: Test.Fixture) =>
  Effect.runPromiseExit(Effect.provide(effect, Test.replay(fixture)))

const defect = (exit: Exit.Exit<unknown, unknown>): unknown => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isSuccess(exit)) return undefined
  return Cause.squash(exit.cause)
}

test("Test.replay answers generateObject from a hand-written recording", async () => {
  const exit = await run(label("Crash on start"), { calls: [answer("Label this issue: Crash on start", `{"type":"bug"}`)] })
  expect(exit).toEqual(Exit.succeed({ type: "bug" }))
})

test("Test.replay claims each recording once: a repeated request needs a second recording", async () => {
  const fixture = { calls: [answer("Label this issue: Crash", `{"type":"bug"}`)] }
  const twice = Effect.zip(label("Crash"), label("Crash"))
  const error = defect(await run(twice, fixture))
  expect(error).toBeInstanceOf(Test.UnrecordedCall)
  expect((error as Test.UnrecordedCall).lastMessage).toBe("Label this issue: Crash")

  const both = { calls: [answer("Label this issue: Crash", `{"type":"bug"}`), answer("Label this issue: Crash", `{"type":"chore"}`)] }
  expect(await run(twice, both)).toEqual(Exit.succeed([{ type: "bug" }, { type: "chore" }]))
})

test("Test.replay dies on a request the recording does not describe and never answers it", async () => {
  const error = defect(await run(label("Slow build"), { calls: [answer("Label this issue: Crash", `{"type":"bug"}`)] }))
  expect(error).toBeInstanceOf(Test.UnrecordedCall)
  const unrecorded = error as Test.UnrecordedCall
  expect(unrecorded.method).toBe("generateText")
  expect(unrecorded.responseFormat).toBe("json generateObject")
  expect(unrecorded.message).toContain("Slow build")
})

test("Test.replay compares the fields a recording names and ignores the model a recording was made with", async () => {
  const exact = {
    calls: [{
      request: {
        prompt: [{ role: "user", content: [{ type: "text", text: "Label this issue: Crash" }] }],
        responseFormat: { type: "json", objectName: "generateObject", schema: Tool.getJsonSchemaFromSchema(Label) }
      },
      response: [
        { type: "response-metadata", id: "r1", modelId: "claude-opus-5-5", timestamp: "2026-11-09T00:00:00.000Z" },
        { type: "text", text: `{"type":"bug"}` }
      ]
    }]
  }
  expect(await run(label("Crash"), exact)).toEqual(Exit.succeed({ type: "bug" }))

  const textFormat = { calls: [{ ...exact.calls[0]!, request: { ...exact.calls[0]!.request, responseFormat: { type: "text" } } }] }
  expect(defect(await run(label("Crash"), textFormat))).toBeInstanceOf(Test.UnrecordedCall)
})

test("Test.replay replays a recorded provider failure as the typed AiError", async () => {
  const failure = Schema.encodeSync(AiError.AiError)(AiError.make({
    module: "Anthropic",
    method: "generateText",
    reason: new AiError.RateLimitError({})
  }))
  const exit = await run(label("Crash"), { calls: [{ request: { prompt: "Label this issue: Crash" }, failure }] })
  expect(Exit.isFailure(exit)).toBe(true)
  const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
  expect(error).toBeInstanceOf(AiError.AiError)
  expect((error as AiError.AiError).reason._tag).toBe("RateLimitError")
})

test("Test.replay serves streamText from recorded stream parts", async () => {
  const fixture = {
    calls: [{
      request: { prompt: "hello" },
      stream: [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "hi " },
        { type: "text-delta", id: "t", delta: "there" },
        { type: "text-end", id: "t" }
      ]
    }]
  }
  const text = LanguageModel.streamText({ prompt: "hello" }).pipe(
    Stream.filter((part) => part.type === "text-delta"),
    Stream.map((part) => (part.type === "text-delta" ? part.delta : "")),
    Stream.mkString
  )
  expect(await run(text, fixture)).toEqual(Exit.succeed("hi there"))
})

test("Test.replay replays a tool call against the program's toolkit", async () => {
  const Lookup = Tool.make("Lookup", { parameters: Schema.Struct({ id: Schema.String }), success: Schema.String })
  const tools = Toolkit.make(Lookup)
  const fixture = {
    calls: [{
      request: { prompt: "find 7", tools: [{ name: "Lookup", description: undefined, parameters: Tool.getJsonSchema(Lookup) }] },
      response: [{ type: "tool-call", id: "c1", name: "Lookup", params: { id: "7" } }]
    }]
  }
  const program = LanguageModel.generateText({ prompt: "find 7", toolkit: tools, disableToolCallResolution: true }).pipe(
    Effect.map((response) => response.toolCalls.map((call) => [call.name, call.params]))
  )
  expect(await run(program, fixture)).toEqual(Exit.succeed([["Lookup", { id: "7" }]]))
})

test("Test.unconsumed lists the recordings a run did not use", async () => {
  const fixture = { calls: [answer("Label this issue: A", `{"type":"bug"}`), answer("Label this issue: B", `{"type":"chore"}`)] }
  const program = Effect.andThen(label("B"), Test.unconsumed)
  const exit = await run(program, fixture)
  expect(Exit.isSuccess(exit) && exit.value.map((call) => call.request.prompt)).toEqual(["Label this issue: A"])
})

test("Test.replay dies with InvalidFixture when the fixture is not a recording", async () => {
  expect(defect(await run(label("A"), { calls: [{ response: [] }] } as unknown as Test.Fixture))).toBeInstanceOf(Test.InvalidFixture)
  expect(defect(await run(label("A"), { calls: [{ request: { prompt: 42 }, response: [] }] }))).toBeInstanceOf(Test.InvalidFixture)
})

// VIP-71 rule: each recorded call is claimed once. However requests
// interleave, n concurrent requests over n recordings of one prompt are each
// answered by a distinct recording, and an (n+1)th request is a defect.
test("property: concurrent requests claim distinct recordings, never one twice", async () => {
  await checkProperty(fc, {
    name: "test-replay-claim-once",
    rule: "VIP-71: each recorded call is claimed once; a request the fixture does not describe is a defect",
    command: "bun test tests/experimental-test-replay.test.ts",
    arbitrary: fc.record({ n: fc.integer({ min: 1, max: 8 }), extra: fc.boolean() }),
    numRuns: 100,
    check: async ({ n, extra }: { readonly n: number; readonly extra: boolean }) => {
      const fixture = {
        calls: Array.from({ length: n }, (_, i) => ({ request: { prompt: "same" }, response: [{ type: "text", text: String(i) }] }))
      }
      const one = Effect.map(LanguageModel.generateText({ prompt: "same" }), (response) => response.text)
      const requests = Effect.all(Array.from({ length: n + (extra ? 1 : 0) }, () => one), { concurrency: "unbounded" })
      const exit = await run(requests, fixture)
      if (extra) {
        expect(defect(exit)).toBeInstanceOf(Test.UnrecordedCall)
        return
      }
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect([...exit.value].sort((a, b) => Number(a) - Number(b))).toEqual(Array.from({ length: n }, (_, i) => String(i)))
      }
    }
  })
}, 60000)
