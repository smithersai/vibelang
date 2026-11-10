import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fc from "fast-check"
import { Cause, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AiError, LanguageModel, Tool, Toolkit } from "effect/ai"
import { Test } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// The live provider a miss reaches: a real LanguageModel built with Effect's
// own constructor, answering from a function and counting its calls.
const provider = (answer: (prompt: string) => string, calls: Array<string>) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (options) =>
        Effect.sync(() => {
          const prompt = lastUserText(options.prompt)
          calls.push(prompt)
          return [{ type: "text", text: answer(prompt) }]
        }),
      streamText: (options) =>
        Stream.suspend(() => {
          const prompt = lastUserText(options.prompt)
          calls.push(prompt)
          const text = answer(prompt)
          return Stream.fromIterable([
            { type: "text-start", id: "t" },
            ...text.split(" ").map((word, i) => ({ type: "text-delta", id: "t", delta: i === 0 ? word : ` ${word}` })),
            { type: "text-end", id: "t" }
          ] as const)
        })
    })
  )

const lastUserText = (prompt: { readonly content: ReadonlyArray<{ readonly role: string; readonly content: unknown }> }) => {
  const last = prompt.content[prompt.content.length - 1]!
  const parts = last.content as ReadonlyArray<{ readonly type: string; readonly text?: string }>
  return parts.map((part) => part.text ?? "").join("")
}

const Label = Schema.Struct({ type: Schema.Literals(["bug", "feature", "question", "chore"]) })
const label = (title: string) =>
  Effect.map(LanguageModel.generateObject({ prompt: `Label this issue: ${title}`, schema: Label }), (reply) => reply.value.type)
const text = (prompt: string) => Effect.map(LanguageModel.generateText({ prompt }), (reply) => reply.text)

const scratch = () => mkdtempSync(join(tmpdir(), "vibelang-test-record-"))

const recordIn = <A, E>(
  path: string,
  live: Layer.Layer<LanguageModel.LanguageModel>,
  effect: Effect.Effect<A, E, LanguageModel.LanguageModel | Test.Recording>
) => Effect.runPromiseExit(Effect.provide(effect, Test.record(path, { live }).pipe(Layer.provide(NodeFileSystem.layer))))

const replayFrom = <A, E>(path: string, effect: Effect.Effect<A, E, LanguageModel.LanguageModel | Test.Recording>) =>
  Effect.runPromiseExit(Effect.provide(effect, Test.replay(JSON.parse(readFileSync(path, "utf8")))))

test("Test.record calls the live model on a miss, writes the answer, and the file then replays with no live model", async () => {
  const dir = scratch()
  try {
    const path = join(dir, "fixtures", "label.json")
    const calls: Array<string> = []
    const live = provider(() => `{"type":"bug"}`, calls)
    expect(await recordIn(path, live, label("Crash"))).toEqual(Exit.succeed("bug"))
    expect(calls).toEqual(["Label this issue: Crash"])
    const written = JSON.parse(readFileSync(path, "utf8"))
    expect(written.calls).toHaveLength(1)
    expect(written.calls[0].request.responseFormat.type).toBe("json")
    expect(written.calls[0].response).toEqual([{ type: "text", text: `{"type":"bug"}`, metadata: {} }])

    // A second run is a hit: the live model is not called again.
    expect(await recordIn(path, live, label("Crash"))).toEqual(Exit.succeed("bug"))
    expect(calls).toHaveLength(1)
    // And the recording replays under the strict double.
    expect(await replayFrom(path, label("Crash"))).toEqual(Exit.succeed("bug"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Test.record never builds the live layer when the recording answers every request", async () => {
  const dir = scratch()
  try {
    const path = join(dir, "label.json")
    writeFileSync(path, JSON.stringify({ calls: [{ request: { prompt: "hi" }, response: [{ type: "text", text: "hello" }] }] }))
    const unbuildable = Layer.effect(LanguageModel.LanguageModel, Effect.die("no key in CI"))
    expect(await recordIn(path, unbuildable, text("hi"))).toEqual(Exit.succeed("hello"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Test.record claims recordings once, so a repeated request is recorded twice and replays twice", async () => {
  const dir = scratch()
  try {
    const path = join(dir, "twice.json")
    let n = 0
    const calls: Array<string> = []
    const live = provider(() => `answer ${++n}`, calls)
    expect(await recordIn(path, live, Effect.zip(text("same"), text("same")))).toEqual(Exit.succeed(["answer 1", "answer 2"]))
    expect(await replayFrom(path, Effect.zip(text("same"), text("same")))).toEqual(Exit.succeed(["answer 1", "answer 2"]))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Test.record records a finished stream and replays it", async () => {
  const dir = scratch()
  try {
    const path = join(dir, "stream.json")
    const live = provider(() => "one two three", [])
    const streamed = LanguageModel.streamText({ prompt: "count" }).pipe(
      Stream.filter((part) => part.type === "text-delta"),
      Stream.map((part) => (part.type === "text-delta" ? part.delta : "")),
      Stream.mkString
    )
    expect(await recordIn(path, live, streamed)).toEqual(Exit.succeed("one two three"))
    expect(await replayFrom(path, streamed)).toEqual(Exit.succeed("one two three"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Test.record writes nothing for an interrupted stream", async () => {
  const dir = scratch()
  try {
    const path = join(dir, "interrupted.json")
    const live = Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: () => Effect.die("unused"),
        streamText: () =>
          Stream.concat(Stream.fromIterable([{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "half" }] as const), Stream.never)
      })
    )
    const program = Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Stream.runDrain(LanguageModel.streamText({ prompt: "slow" })))
      yield* Effect.sleep(20)
      yield* Fiber.interrupt(fiber)
    })
    expect(Exit.isSuccess(await recordIn(path, live, program))).toBe(true)
    expect(existsSync(path)).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Test.record records a provider's typed AiError, which then replays as the same failure", async () => {
  const dir = scratch()
  try {
    const path = join(dir, "failure.json")
    const failing = Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: () =>
          Effect.fail(AiError.make({ module: "Provider", method: "generateText", reason: new AiError.RateLimitError({}) })),
        streamText: () => Stream.die("unused")
      })
    )
    const reason = (exit: Exit.Exit<unknown, unknown>) =>
      Exit.isFailure(exit) ? (Cause.squash(exit.cause) as AiError.AiError).reason._tag : "succeeded"
    expect(reason(await recordIn(path, failing, text("hi")))).toBe("RateLimitError")
    expect(reason(await replayFrom(path, text("hi")))).toBe("RateLimitError")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Test.record refuses to write a call that holds a credential", async () => {
  const dir = scratch()
  try {
    const path = join(dir, "secret.json")
    const leaky = provider(() => "your key is sk-ant-api03-abcdefghijklmnop", [])
    const exit = await recordIn(path, leaky, text("what is my key"))
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Test.CredentialInRecording)
    expect((Exit.isFailure(exit) && (Cause.squash(exit.cause) as Test.CredentialInRecording).rule)).toBe("api-key")
    expect(existsSync(path)).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Test.record replays a tool call it recorded against the toolkit", async () => {
  const dir = scratch()
  try {
    const path = join(dir, "tools.json")
    const Lookup = Tool.make("Lookup", { parameters: Schema.Struct({ id: Schema.String }), success: Schema.String })
    const live = Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: () => Effect.succeed([{ type: "tool-call", id: "c1", name: "Lookup", params: { id: "7" } }]),
        streamText: () => Stream.die("unused")
      })
    )
    const program = LanguageModel.generateText({ prompt: "find 7", toolkit: Toolkit.make(Lookup), disableToolCallResolution: true }).pipe(
      Effect.map((response) => response.toolCalls.map((call) => [call.name, call.params]))
    )
    expect(await recordIn(path, live, program)).toEqual(Exit.succeed([["Lookup", { id: "7" }]]))
    expect(JSON.parse(readFileSync(path, "utf8")).calls[0].request.tools[0].name).toBe("Lookup")
    expect(await replayFrom(path, program)).toEqual(Exit.succeed([["Lookup", { id: "7" }]]))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// VIP-71: record and replay are one contract. Whatever sequence of requests a
// recording run made, a strict replay of the file it wrote answers the same
// sequence with the same answers and leaves nothing unconsumed.
test("property: what Test.record writes, Test.replay answers identically", async () => {
  await checkProperty(fc, {
    name: "test-record-replay-roundtrip",
    rule: "VIP-71: Test.record replays path and writes misses; Test.replay of that file never calls a provider",
    command: "bun test tests/experimental-test-record.test.ts",
    arbitrary: fc.array(fc.constantFrom("a", "b", "c", "a b"), { minLength: 1, maxLength: 6 }),
    numRuns: 40,
    check: async (prompts: ReadonlyArray<string>) => {
      const dir = scratch()
      try {
        const path = join(dir, "roundtrip.json")
        let n = 0
        const live = provider((prompt) => `${prompt}#${++n}`, [])
        const program = Effect.gen(function*() {
          const answers = yield* Effect.forEach(prompts, text)
          return { answers, left: (yield* Test.unconsumed).length }
        })
        const recorded = await recordIn(path, live, program)
        expect(Exit.isSuccess(recorded)).toBe(true)
        const replayed = await replayFrom(path, program)
        expect(replayed).toEqual(recorded)
        expect(Exit.isSuccess(replayed) && replayed.value.left).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })
}, 60000)
