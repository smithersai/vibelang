import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Stream } from "effect"
import { LanguageModel, type Response, Tool } from "effect/ai"
import * as fc from "fast-check"
import { Memory } from "vibelang-runtime/experimental"

const errorOf = (exit: Exit.Exit<unknown, Memory.MemoryError>) => {
  if (Exit.isSuccess(exit)) throw new Error(`expected a failure, got ${JSON.stringify(exit.value)}`)
  const error = Cause.findErrorOption(exit.cause)
  if (error._tag === "None") throw new Error(Cause.pretty(exit.cause))
  return error.value
}

// A real in-process store behind a recorder: every store call is listed, so
// a test can show a refused call never reached the store.
const recorded = () => {
  const store = Memory.makeMemoryStore()
  const calls: Array<string> = []
  const wrap = <K extends keyof Memory.Store>(name: K): Memory.Store[K] =>
    ((...args: Array<unknown>) => {
      calls.push(name)
      return (store[name] as (...args: Array<unknown>) => unknown)(...args)
    }) as Memory.Store[K]
  const layer = Memory.layerStore({
    putFact: wrap("putFact"),
    searchRows: wrap("searchRows"),
    putNote: wrap("putNote"),
    appendMessage: wrap("appendMessage"),
    history: wrap("history"),
    sweep: wrap("sweep")
  })
  const run = <A, E>(effect: Effect.Effect<A, E, Memory.Memory>) => Effect.runPromiseExit(Effect.provide(effect, layer))
  return { calls, run }
}

test("scoped: calls without a bank use the bound bank", async () => {
  const { run } = recorded()
  const exit = await run(Memory.scoped("agent-reviewer")(Effect.gen(function*() {
    yield* Memory.remember({ key: "style", text: "early returns" })
    yield* Memory.note("", "prefer small functions", { id: "n1" })
    return yield* Memory.recall({ query: "returns functions" })
  })))
  if (!Exit.isSuccess(exit)) throw new Error(Cause.pretty(exit.cause))
  expect(exit.value.map((row) => [row.bank, row.key]).sort()).toEqual([["agent-reviewer", "n1"], ["agent-reviewer", "style"]])
  const outside = await run(Memory.recall({ banks: ["agent-reviewer"], query: "returns" }))
  expect(Exit.isSuccess(outside) && outside.value.map((row) => row.key)).toEqual(["style"])
})

test("scoped: a call naming another namespace fails with invalid_namespace before any I/O", async () => {
  const { calls, run } = recorded()
  const refused: Array<[Effect.Effect<unknown, Memory.MemoryError, Memory.Memory>, ReadonlyArray<string>]> = [
    [Memory.remember({ bank: "agent-other", key: "k", text: "t" }), ["bank"]],
    [Memory.remember({ bank: "user-reviewer", key: "k", text: "t" }), ["bank"]],
    [Memory.note("global-notes", "t"), ["bank"]],
    [Memory.recall({ banks: ["agent-reviewer", "global-notes"], query: "t" }), ["banks", "1"]],
    [Memory.scoped("agent-other")(Memory.recall({ query: "t" })), ["namespace"]]
  ]
  for (const [effect, path] of refused) {
    const error = errorOf(await run(Memory.scoped("agent-reviewer")(effect)))
    expect([error.code, error.path]).toEqual(["invalid_namespace", path])
  }
  expect(calls).toEqual([])
  expect(errorOf(await run(Memory.scoped("")(Effect.void))).code).toBe("invalid_namespace")
  expect(errorOf(await run(Memory.remember({ key: "k", text: "t" }))).code).toBe("invalid_namespace")
  expect(calls).toEqual([])
})

test("scoped: the same namespace under another spelling, and a nested scope of it, are allowed", async () => {
  const { run } = recorded()
  const exit = await run(Memory.scoped("notes")(Effect.gen(function*() {
    yield* Memory.remember({ bank: "flow-notes", key: "k", text: "word" })
    return yield* Memory.scoped("flow-notes")(Memory.recall({ banks: ["notes"], query: "word" }))
  })))
  expect(Exit.isSuccess(exit) && exit.value.map((row) => [row.bank, row.key])).toEqual([["notes", "k"]])
})

test("scoped: threads are named by id and a scope does not limit them", async () => {
  const { run } = recorded()
  const exit = await run(Memory.scoped("agent-a")(Effect.gen(function*() {
    yield* Memory.thread("t").append({ id: "m", role: "user", text: "hi" })
    return yield* Memory.thread("t").history()
  })))
  expect(Exit.isSuccess(exit) && exit.value.map((message) => message.text)).toEqual(["hi"])
})

const collect = <A, E, R>(stream: Stream.Stream<A, E, R>) => Effect.map(Stream.runCollect(stream), (chunk) => Array.from(chunk))

test("tools: the model's remember and recall reach only the bound bank", async () => {
  const { run } = recorded()
  const exit = await run(Effect.gen(function*() {
    yield* Memory.remember({ bank: "agent-b", key: "secret", text: "the word" })
    const kit = yield* Memory.tools("agent-a")
    const wrote = yield* collect(yield* kit.handle("remember", { key: "fact", text: "the word" }))
    const read = yield* collect(yield* kit.handle("recall", { query: "word" }))
    const mine = yield* Memory.recall({ banks: ["agent-a"], query: "word" })
    return { wrote: wrote.map((part) => part.result), read: read.map((part) => part.result), mine: mine.map((row) => row.key) }
  }))
  if (!Exit.isSuccess(exit)) throw new Error(Cause.pretty(exit.cause))
  expect(exit.value.wrote).toEqual([{ key: "fact" }])
  expect((exit.value.read[0] as ReadonlyArray<Memory.Recalled>).map((row) => [row.bank, row.key, row.text])).toEqual([["agent-a", "fact", "the word"]])
  expect(exit.value.mine).toEqual(["fact"])
})

test("tools: no tool takes a bank, and a memory failure is returned to the model", async () => {
  for (const tool of Object.values(Memory.toolkit.tools)) {
    expect(JSON.stringify(Tool.getJsonSchema(tool))).not.toContain("bank")
  }
  const { calls, run } = recorded()
  const exit = await run(Effect.gen(function*() {
    const kit = yield* Memory.tools("agent-a")
    const parts = yield* collect(yield* kit.handle("remember", { key: "", text: "t" }))
    const budget = yield* collect(yield* kit.handle("recall", { query: "t", maxBytes: -1 }))
    return [...parts, ...budget].map((part) => [part.isFailure, part.result])
  }))
  if (!Exit.isSuccess(exit)) throw new Error(Cause.pretty(exit.cause))
  expect(exit.value).toEqual([
    [true, { code: "invalid_argument", message: "memory key must be a non-empty string", path: ["key"] }],
    [true, { code: "invalid_argument", message: "maxBytes must be an integer from 0 to 65536", path: ["maxBytes"] }]
  ])
  expect(calls).toEqual([])
  const unbound = await run(Effect.gen(function*() {
    const kit = yield* Memory.tools("")
    return (yield* collect(yield* kit.handle("recall", { query: "t" }))).map((part) => [part.isFailure, (part.result as { code: string }).code])
  }))
  expect(Exit.isSuccess(unbound) && unbound.value).toEqual([[true, "invalid_namespace"]])
  expect(calls).toEqual([])
})

test("tools: a bank smuggled into the model's arguments is ignored", async () => {
  const { run } = recorded()
  const exit = await run(Effect.gen(function*() {
    const kit = yield* Memory.tools("agent-a")
    yield* collect(yield* kit.handle("remember", { key: "k", text: "word", bank: "global-all" } as never))
    return yield* Memory.recall({ banks: ["agent-a", "global-all"], query: "word" })
  }))
  expect(Exit.isSuccess(exit) && exit.value.map((row) => row.bank)).toEqual(["agent-a"])
})

// A scripted model, built with Effect's own LanguageModel.make: it asks for
// the recall tool once. The memory toolkit is passed as `toolkit` unchanged.
test("tools: a language model's recall call runs against the bound bank", async () => {
  const seen: Array<ReadonlyArray<string>> = []
  const model = LanguageModel.make({
    generateText: (options) =>
      Effect.sync(() => {
        seen.push(options.tools.map((tool) => tool.name))
        return [
          { type: "tool-call", id: "call-1", name: "recall", params: { query: "release" } },
          { type: "finish", reason: "tool-calls", usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } }
        ] as Array<Response.PartEncoded>
      }),
    streamText: () => Stream.empty
  })
  const { run } = recorded()
  const exit = await run(Effect.gen(function*() {
    yield* Memory.remember({ bank: "agent-a", key: "release", text: "cut 0.1.0" })
    yield* Memory.remember({ bank: "agent-b", key: "release", text: "not yours" })
    const response = yield* LanguageModel.generateText({ prompt: "what did we release?", toolkit: Memory.tools("agent-a") }).pipe(
      Effect.provideServiceEffect(LanguageModel.LanguageModel, model)
    )
    return response.toolResults.map((part) => part.result)
  }))
  if (!Exit.isSuccess(exit)) throw new Error(Cause.pretty(exit.cause))
  expect(seen).toEqual([["remember", "recall"]])
  expect((exit.value[0] as ReadonlyArray<Memory.Recalled>).map((row) => [row.bank, row.text])).toEqual([["agent-a", "cut 0.1.0"]])
})

// VIP-66 rules 1 and 2: inside a scope, a call reaches the store only when
// the bank it names is the bound namespace, under any spelling; every other
// bank fails with invalid_namespace and no store call.
const bankName = fc.oneof(
  fc.constantFrom("a", "flow-a", "agent-a", "user-a", "global-a", "flow-", "agent-", "agent-a-b", "a-agent"),
  fc.tuple(fc.constantFrom("", "flow-", "agent-", "user-", "global-", "other-"), fc.string({ minLength: 1, maxLength: 4 })).map(([prefix, id]) => prefix + id)
)

test("scoped property: only the bound namespace reaches the store", async () => {
  await fc.assert(
    fc.asyncProperty(bankName, bankName, fc.constantFrom("remember", "note", "recall"), async (bound, named, operation) => {
      const { calls, run } = recorded()
      const effect: Effect.Effect<unknown, Memory.MemoryError, Memory.Memory> =
        operation === "remember" ? Memory.remember({ bank: named, key: "k", text: "t" })
        : operation === "note" ? Memory.note(named, "t")
        : Memory.recall({ banks: [named], query: "t" })
      const exit = await run(Memory.scoped(bound)(effect))
      const same = Memory.namespaceOf(bound).kind === Memory.namespaceOf(named).kind && Memory.namespaceOf(bound).id === Memory.namespaceOf(named).id
      if (same) {
        expect(Exit.isSuccess(exit)).toBe(true)
        expect(calls.length).toBe(1)
      } else {
        expect(errorOf(exit).code).toBe("invalid_namespace")
        expect(calls).toEqual([])
      }
    }),
    { numRuns: 300 }
  )
})
