import { expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { Memory } from "vibelang-runtime/experimental"

const run = <A>(effect: Effect.Effect<A, Memory.MemoryError, Memory.Memory>, layer = Memory.test) =>
  Effect.runPromise(Effect.provide(effect, layer))

const failure = async <A>(effect: Effect.Effect<A, Memory.MemoryError, Memory.Memory>, layer = Memory.test) => {
  const exit = await Effect.runPromiseExit(Effect.provide(effect, layer))
  if (Exit.isSuccess(exit)) throw new Error(`expected a failure, got ${JSON.stringify(exit.value)}`)
  const error = Cause.findErrorOption(exit.cause)
  if (error._tag === "None") throw new Error(Cause.pretty(exit.cause))
  return error.value
}

const at = (store: Memory.Store, bank: string, key: string, text: string, ms: number) =>
  Effect.runPromise(store.putFact({ namespace: Memory.namespaceOf(bank), key, text, at: ms }))

test("memory: a remembered fact is recalled by a query word", async () => {
  const rows = await run(Effect.gen(function*() {
    yield* Memory.remember({ bank: "global-notes", key: "release", text: "cut 0.1.0" })
    return yield* Memory.recall({ banks: ["global-notes"], query: "release" })
  }))
  expect(rows.map(({ updatedAtMs: _, ...row }) => row)).toEqual([{ bank: "global-notes", key: "release", text: "cut 0.1.0", score: 1 }])
  expect(typeof rows[0]!.updatedAtMs).toBe("number")
})

test("memory: a later program over the same store recalls what an earlier one remembered", async () => {
  const store = Memory.makeMemoryStore()
  await run(Memory.remember({ bank: "agent-reviewer", key: "style", text: "prefer early returns" }), Memory.layerStore(store))
  const rows = await run(Memory.recall({ banks: ["agent-reviewer"], query: "returns" }), Memory.layerStore(store))
  expect(rows.map((row) => row.text)).toEqual(["prefer early returns"])
  const fresh = await run(Memory.recall({ banks: ["agent-reviewer"], query: "returns" }))
  expect(fresh).toEqual([])
})

test("memory: remembering a key again replaces its text", async () => {
  const rows = await run(Effect.gen(function*() {
    yield* Memory.remember({ bank: "user-ada", key: "editor", text: "vim" })
    yield* Memory.remember({ bank: "user-ada", key: "editor", text: "helix editor" })
    return yield* Memory.recall({ banks: ["user-ada"], query: "editor" })
  }))
  expect(rows.map((row) => [row.key, row.text])).toEqual([["editor", "helix editor"]])
})

test("memory: rows rank by matched terms, then newest, then key, then bank", async () => {
  const store = Memory.makeMemoryStore()
  await at(store, "global-a", "k2", "alpha beta", 5)
  await at(store, "global-a", "k1", "alpha", 10)
  await at(store, "global-a", "k3", "alpha", 20)
  await at(store, "global-b", "k3", "alpha", 20)
  await at(store, "global-a", "k0", "alpha", 20)
  await at(store, "global-a", "k4", "gamma", 30)
  const rows = await run(Memory.recall({ banks: ["global-b", "global-a"], query: "Alpha, BETA!" }), Memory.layerStore(store))
  expect(rows.map((row) => [row.bank, row.key, row.score])).toEqual([
    ["global-a", "k2", 2],
    ["global-a", "k0", 1],
    ["global-a", "k3", 1],
    ["global-b", "k3", 1],
    ["global-a", "k1", 1]
  ])
})

test("memory: a bank without a kind prefix is a flow bank, and a bank named twice is read once", async () => {
  expect(Memory.namespaceOf("notes")).toEqual({ kind: "flow", id: "notes" })
  expect(Memory.namespaceOf("flow-notes")).toEqual({ kind: "flow", id: "notes" })
  expect(Memory.namespaceOf("global-")).toEqual({ kind: "flow", id: "global-" })
  expect(Memory.bankOf({ kind: "user", id: "ada" })).toBe("user-ada")
  const rows = await run(Effect.gen(function*() {
    yield* Memory.remember({ bank: "notes", key: "k", text: "shared word" })
    return yield* Memory.recall({ banks: ["notes", "flow-notes", "notes"], query: "word" })
  }))
  expect(rows.map((row) => [row.bank, row.key])).toEqual([["notes", "k"]])
})

test("memory: banks are isolated and a recall reads only the banks it names", async () => {
  const rows = await run(Effect.gen(function*() {
    yield* Memory.remember({ bank: "user-ada", key: "secret", text: "word" })
    yield* Memory.remember({ bank: "user-bob", key: "public", text: "word" })
    return yield* Memory.recall({ banks: ["user-bob"], query: "word" })
  }))
  expect(rows.map((row) => row.key)).toEqual(["public"])
})

test("memory: every recall is cut to its byte budget", async () => {
  const store = Memory.makeMemoryStore()
  await at(store, "global-n", "a", "word ".repeat(100), 2)
  await at(store, "global-n", "b", "word", 1)
  const layer = Memory.layerStore(store)
  const whole = await run(Memory.recall({ banks: ["global-n"], query: "word", maxBytes: Memory.MAX_RECALL_BYTES }), layer)
  expect(whole.map((row) => row.key)).toEqual(["a", "b"])
  const cut = await run(Memory.recall({ banks: ["global-n"], query: "word", maxBytes: 120 }), layer)
  expect(cut.map((row) => row.key)).toEqual(["a"])
  expect(cut[0]!.text.length).toBeLessThan(500)
  expect(new TextEncoder().encode(JSON.stringify(cut)).byteLength).toBeLessThanOrEqual(120)
  expect(await run(Memory.recall({ banks: ["global-n"], query: "word", maxBytes: 0 }), layer)).toEqual([])
  const fallback = await run(Memory.recall({ banks: ["global-n"], query: "word" }), layer)
  expect(new TextEncoder().encode(JSON.stringify(fallback)).byteLength).toBeLessThanOrEqual(Memory.DEFAULT_RECALL_BYTES)
})

test("memory: a query with no words or no banks recalls nothing", async () => {
  const rows = await run(Effect.gen(function*() {
    yield* Memory.remember({ bank: "global-n", key: "k", text: "word" })
    return [
      yield* Memory.recall({ banks: ["global-n"], query: " !? " }),
      yield* Memory.recall({ banks: [], query: "word" })
    ]
  }))
  expect(rows).toEqual([[], []])
})

// A store that fails every call and counts the calls: the unhappy paths run
// against a real Store implementation, not a mock of the module.
const faulty = () => {
  const calls: Array<string> = []
  const broken = (name: string) => {
    calls.push(name)
    return Effect.fail(new Memory.MemoryError({ code: "store", message: `${name}: disk unavailable` }))
  }
  const store: Memory.Store = {
    putFact: () => broken("putFact"),
    searchRows: () => broken("searchRows")
  }
  return { calls, layer: Memory.layerStore(store) }
}

test("memory: a failing store fails remember and recall with code store", async () => {
  const { calls, layer } = faulty()
  const write = await failure(Memory.remember({ bank: "global-n", key: "k", text: "t" }), layer)
  expect([write._tag, write.code, write.message]).toEqual(["MemoryError", "store", "putFact: disk unavailable"])
  const read = await failure(Memory.recall({ banks: ["global-n"], query: "t" }), layer)
  expect(read.code).toBe("store")
  expect(calls).toEqual(["putFact", "searchRows"])
})

test("memory: invalid input fails with a code and a path before any I/O", async () => {
  const { calls, layer } = faulty()
  const cases: Array<[Effect.Effect<unknown, Memory.MemoryError, Memory.Memory>, string, ReadonlyArray<string> | undefined]> = [
    [Memory.remember({ bank: "", key: "k", text: "t" }), "invalid_namespace", ["bank"]],
    [Memory.remember({ bank: "b".repeat(129), key: "k", text: "t" }), "invalid_argument", ["bank"]],
    [Memory.remember({ bank: "global-n", key: "", text: "t" }), "invalid_argument", ["key"]],
    [Memory.remember({ bank: "global-n", key: "é".repeat(513), text: "t" }), "invalid_argument", ["key"]],
    [Memory.remember({ bank: "global-n", key: "k", text: "x".repeat(Memory.MAX_TEXT_BYTES + 1) }), "invalid_argument", ["text"]],
    [Memory.recall({ banks: ["global-n", ""], query: "q" }), "invalid_namespace", ["banks", "1"]],
    [Memory.recall({ banks: Array.from({ length: 17 }, (_, i) => `global-${i}`), query: "q" }), "invalid_argument", ["banks"]],
    [Memory.recall({ banks: ["global-n"], query: "q".repeat(Memory.MAX_TEXT_BYTES + 1) }), "invalid_argument", ["query"]],
    [Memory.recall({ banks: ["global-n"], query: "q", maxBytes: -1 }), "invalid_argument", ["maxBytes"]],
    [Memory.recall({ banks: ["global-n"], query: "q", maxBytes: 1.5 }), "invalid_argument", ["maxBytes"]],
    [Memory.recall({ banks: ["global-n"], query: "q", maxBytes: Memory.MAX_RECALL_BYTES + 1 }), "invalid_argument", ["maxBytes"]]
  ]
  for (const [effect, code, path] of cases) {
    const error = await failure(effect, layer)
    expect([error.code, error.path]).toEqual([code, path])
  }
  expect(calls).toEqual([])
})

test("memory: a replacement ranking reads through the store and is still cut to the budget", async () => {
  const store = Memory.makeMemoryStore()
  await at(store, "global-n", "k", "x".repeat(400), 1)
  const everything: Memory.Recall = ({ banks }, store) =>
    Effect.map(
      Effect.forEach(banks, ({ bank, namespace }) =>
        Effect.map(store.searchRows(namespace), (rows) => rows.map((row) => ({ ...row, bank, score: 0 })))),
      (rows) => rows.flat()
    )
  const rows = await run(Memory.recall({ banks: ["global-n"], query: "unrelated", maxBytes: 100 }), Memory.layerStore(store, { recall: everything }))
  expect(rows.map((row) => row.key)).toEqual(["k"])
  expect(new TextEncoder().encode(JSON.stringify(rows)).byteLength).toBeLessThanOrEqual(100)
})
