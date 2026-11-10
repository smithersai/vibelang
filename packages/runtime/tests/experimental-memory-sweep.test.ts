import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Cause, Effect, Exit, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Memory } from "vibelang-runtime/experimental"
import { layer as sqlite } from "./fixtures/bun-sqlite-client.ts"

const scratch = mkdtempSync(join(tmpdir(), "memory-sweep-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let files = 0

const errorOf = (exit: Exit.Exit<unknown, Memory.MemoryError>) => {
  if (Exit.isSuccess(exit)) throw new Error(`expected a failure, got ${JSON.stringify(exit.value)}`)
  const error = Cause.findErrorOption(exit.cause)
  if (error._tag === "None") throw new Error(Cause.pretty(exit.cause))
  return error.value
}

// Time is Effect's TestClock, so expiry is exact and the test never sleeps.
const stores: ReadonlyArray<[string, () => Layer.Layer<Memory.Memory, Memory.MemoryError>]> = [
  ["memory", () => Memory.layerStore(Memory.makeMemoryStore())],
  ["SQLite", () => Memory.layerSql().pipe(Layer.provide(sqlite(join(scratch, `sweep-${++files}.db`))))]
]

const run = <A, E>(layer: Layer.Layer<Memory.Memory, Memory.MemoryError>, effect: Effect.Effect<A, E, Memory.Memory>) =>
  Effect.runPromise(Effect.provide(Effect.gen(function*() {
    yield* TestClock.setTime(1_000)
    return yield* effect
  }), Layer.merge(layer, TestClock.layer())))

const keys = (bank: string) => Effect.map(Memory.recall({ banks: [bank], query: "word" }), (rows) => rows.map((row) => row.key).sort())

for (const [name, layer] of stores) {
  test(`${name}: a fact with ttlMs is not recalled once it expires, and nothing is deleted until a sweep`, async () => {
    const result = await run(layer(), Effect.gen(function*() {
      yield* Memory.remember({ bank: "global-n", key: "short", text: "word", ttlMs: 100 })
      yield* Memory.remember({ bank: "global-n", key: "long", text: "word", ttlMs: 10_000 })
      yield* Memory.remember({ bank: "global-n", key: "forever", text: "word" })
      const before = yield* keys("global-n")
      yield* TestClock.adjust(100)
      const after = yield* keys("global-n")
      const swept = yield* Memory.sweep()
      const again = yield* Memory.sweep()
      return { before, after, swept, again }
    }))
    expect(result).toEqual({
      before: ["forever", "long", "short"],
      after: ["forever", "long"],
      swept: { facts: 1, messages: 0 },
      again: { facts: 0, messages: 0 }
    })
  })

  test(`${name}: a sweep with ttl deletes facts not written within it, and rewriting a fact renews it`, async () => {
    const result = await run(layer(), Effect.gen(function*() {
      yield* Memory.remember({ bank: "global-n", key: "old", text: "word" })
      yield* Memory.remember({ bank: "global-n", key: "renewed", text: "word" })
      yield* Memory.note("global-n", "a note is a word too", { id: "n" })
      yield* TestClock.adjust("2 hours")
      yield* Memory.remember({ bank: "global-n", key: "renewed", text: "word again" })
      yield* Memory.remember({ bank: "global-n", key: "new", text: "word" })
      const swept = yield* Memory.sweep({ ttl: "1 hour" })
      return { swept, left: yield* keys("global-n") }
    }))
    expect(result).toEqual({ swept: { facts: 1, messages: 0 }, left: ["n", "new", "renewed"] })
  })

  test(`${name}: a sweep with keep trims every thread to its newest messages`, async () => {
    const result = await run(layer(), Effect.gen(function*() {
      const chat = Memory.thread("chat")
      for (const id of ["m1", "m2", "m3", "m4"]) {
        yield* chat.append({ id, role: "user", text: id })
        yield* TestClock.adjust(1)
      }
      yield* Memory.thread("short").append({ id: "only", role: "user", text: "x" })
      const swept = yield* Memory.sweep({ keep: 2 })
      return {
        swept,
        chat: (yield* chat.history()).map((message) => message.id),
        short: (yield* Memory.thread("short").history()).map((message) => message.id),
        none: yield* Memory.sweep({ keep: 0 })
      }
    }))
    expect(result).toEqual({ swept: { facts: 0, messages: 2 }, chat: ["m3", "m4"], short: ["only"], none: { facts: 0, messages: 3 } })
  })
}

test("sweep: invalid options and ttlMs fail before any I/O", async () => {
  const calls: Array<string> = []
  const store = Memory.makeMemoryStore()
  const layer = Memory.layerStore({
    ...store,
    putFact: (fact) => (calls.push("putFact"), store.putFact(fact)),
    sweep: (options) => (calls.push("sweep"), store.sweep(options))
  })
  const cases: Array<[Effect.Effect<unknown, Memory.MemoryError, Memory.Memory>, ReadonlyArray<string>]> = [
    [Memory.sweep({ keep: -1 }), ["keep"]],
    [Memory.sweep({ keep: 1.5 }), ["keep"]],
    [Memory.sweep({ ttl: "-1 second" as never }), ["ttl"]],
    [Memory.sweep({ ttl: "soon" as never }), ["ttl"]],
    [Memory.remember({ bank: "global-n", key: "k", text: "t", ttlMs: -1 }), ["ttlMs"]],
    [Memory.remember({ bank: "global-n", key: "k", text: "t", ttlMs: 0.5 }), ["ttlMs"]]
  ]
  for (const [effect, path] of cases) {
    const error = errorOf(await Effect.runPromiseExit(Effect.provide(effect, layer)))
    expect([error.code, error.path]).toEqual(["invalid_argument", path])
  }
  expect(calls).toEqual([])
})
