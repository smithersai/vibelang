import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"
import { Memory } from "vibelang-runtime/experimental"
import { layer as sqlite } from "./fixtures/bun-sqlite-client.ts"

const scratch = mkdtempSync(join(tmpdir(), "memory-notes-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let files = 0

const errorOf = (exit: Exit.Exit<unknown, Memory.MemoryError>) => {
  if (Exit.isSuccess(exit)) throw new Error(`expected a failure, got ${JSON.stringify(exit.value)}`)
  const error = Cause.findErrorOption(exit.cause)
  if (error._tag === "None") throw new Error(Cause.pretty(exit.cause))
  return error.value
}

// Every behavior runs over both stores through the public operations.
const stores: ReadonlyArray<[string, () => Layer.Layer<Memory.Memory, Memory.MemoryError>]> = [
  ["memory", () => Memory.layerStore(Memory.makeMemoryStore())],
  ["SQLite", () => Memory.layerSql().pipe(Layer.provide(sqlite(join(scratch, `notes-${++files}.db`))))]
]

for (const [name, layer] of stores) {
  const runtime = () => ManagedRuntime.make(layer())

  test(`${name}: a note is recalled by its id, and a superseding note replaces it`, async () => {
    const memory = runtime()
    const keys = (query: string) =>
      memory.runPromise(Effect.map(Memory.recall({ banks: ["agent-ci"], query }), (rows) => rows.map((row) => [row.key, row.text])))
    await memory.runPromise(Memory.note("agent-ci", "tests take 4 minutes", { id: "n1" }))
    await memory.runPromise(Memory.note("agent-ci", "deploy on fridays is fine", { id: "n2" }))
    expect(await keys("minutes")).toEqual([["n1", "tests take 4 minutes"]])
    expect(await memory.runPromise(Memory.note("agent-ci", "tests take 9 minutes", { id: "n3", supersedes: "n1" }))).toEqual({ id: "n3" })
    expect(await keys("minutes")).toEqual([["n3", "tests take 9 minutes"]])
    await memory.runPromise(Memory.note("agent-ci", "never deploy on fridays", { supersedes: ["n2", "n2"] }))
    expect((await keys("fridays")).map(([, text]) => text)).toEqual(["never deploy on fridays"])
    await memory.dispose()
  })

  test(`${name}: writing a note again is idempotent, and a different one under its id conflicts`, async () => {
    const memory = runtime()
    await memory.runPromise(Memory.note("user-ada", "likes tea", { id: "a" }))
    await memory.runPromise(Memory.note("user-ada", "likes green tea", { id: "b", supersedes: ["a"] }))
    await memory.runPromise(Memory.note("user-ada", "likes green tea", { id: "b", supersedes: "a" }))
    const conflicts = [
      [Memory.note("user-ada", "likes coffee", { id: "b", supersedes: "a" }), "idempotency_conflict", ["id"]],
      [Memory.note("user-bob", "likes green tea", { id: "b", supersedes: "a" }), "idempotency_conflict", ["id"]],
      [Memory.note("user-ada", "likes green tea", { id: "b" }), "supersede_conflict", ["supersedes"]],
      [Memory.note("user-ada", "x", { id: "c", supersedes: "c" }), "supersede_conflict", ["supersedes"]],
      [Memory.note("user-ada", "x", { id: "d", supersedes: "missing" }), "supersede_conflict", ["supersedes"]],
      [Memory.note("user-bob", "x", { id: "e", supersedes: "a" }), "supersede_conflict", ["supersedes"]]
    ] as const
    for (const [effect, code, path] of conflicts) {
      const error = errorOf(await memory.runPromiseExit(effect))
      expect([error.code, error.path]).toEqual([code, path])
    }
    const rows = await memory.runPromise(Memory.recall({ banks: ["user-ada", "user-bob"], query: "likes x" }))
    expect(rows.map((row) => [row.bank, row.key])).toEqual([["user-ada", "b"]])
    await memory.dispose()
  })

  test(`${name}: a note without an id gets a fresh one each call`, async () => {
    const memory = runtime()
    const first = await memory.runPromise(Memory.note("global-n", "same text"))
    const second = await memory.runPromise(Memory.note("global-n", "same text"))
    expect(first.id).toMatch(/^note-[0-9a-f]{32}$/)
    expect(second.id).not.toBe(first.id)
    expect((await memory.runPromise(Memory.recall({ banks: ["global-n"], query: "same" }))).length).toBe(2)
    await memory.dispose()
  })

  test(`${name}: a thread appends each message once and reads back newest last`, async () => {
    const memory = runtime()
    const chat = Memory.thread("chat-1")
    await memory.runPromise(chat.append({ id: "m1", role: "user", text: "hello" }))
    await memory.runPromise(chat.append({ id: "m2", role: "assistant", text: "hi" }))
    await memory.runPromise(chat.append({ id: "m1", role: "user", text: "hello" }))
    await memory.runPromise(Memory.thread("chat-2").append({ id: "m1", role: "user", text: "elsewhere" }))
    await memory.runPromise(chat.append({ id: "m3", role: "user", text: "bye" }))
    const view = (messages: ReadonlyArray<Memory.Message>) => messages.map((message) => [message.id, message.role, message.text])
    expect(view(await memory.runPromise(chat.history()))).toEqual([["m1", "user", "hello"], ["m2", "assistant", "hi"], ["m3", "user", "bye"]])
    expect(view(await memory.runPromise(chat.history({ limit: 2 })))).toEqual([["m2", "assistant", "hi"], ["m3", "user", "bye"]])
    expect(await memory.runPromise(chat.history({ limit: 0 }))).toEqual([])
    expect(view(await memory.runPromise(chat.history({ limit: 10 })))).toHaveLength(3)
    expect(await memory.runPromise(Memory.thread("never").history())).toEqual([])
    for (const [message, path] of [[{ id: "m1", role: "assistant", text: "hello" }, ["role"]], [{ id: "m1", role: "user", text: "HELLO" }, ["text"]]] as const) {
      const error = errorOf(await memory.runPromiseExit(chat.append(message)))
      expect([error.code, error.path]).toEqual(["idempotency_conflict", path])
    }
    await memory.dispose()
  })
}

// A store that fails every call and records it: invalid input never reaches it.
test("notes and threads: invalid input fails before any I/O", async () => {
  const calls: Array<string> = []
  const broken = (name: string) => () => {
    calls.push(name)
    return Effect.fail(new Memory.MemoryError({ code: "store", message: name }))
  }
  const layer = Memory.layerStore({
    putFact: broken("putFact"),
    searchRows: broken("searchRows"),
    putNote: broken("putNote"),
    appendMessage: broken("appendMessage"),
    history: broken("history")
  })
  const cases: Array<[Effect.Effect<unknown, Memory.MemoryError, Memory.Memory>, string, ReadonlyArray<string>]> = [
    [Memory.note("", "t"), "invalid_namespace", ["bank"]],
    [Memory.note("global-n", "x".repeat(Memory.MAX_TEXT_BYTES + 1)), "invalid_argument", ["text"]],
    [Memory.note("global-n", "t", { id: "" }), "invalid_argument", ["id"]],
    [Memory.note("global-n", "t", { supersedes: ["a", ""] }), "invalid_argument", ["supersedes", "1"]],
    [Memory.note("global-n", "t", { id: "a", supersedes: "a" }), "supersede_conflict", ["supersedes"]],
    [Memory.thread("").append({ id: "m", role: "user", text: "t" }), "invalid_argument", ["thread"]],
    [Memory.thread("t").append({ id: "", role: "user", text: "t" }), "invalid_argument", ["id"]],
    [Memory.thread("t").append({ id: "m", role: "", text: "t" }), "invalid_argument", ["role"]],
    [Memory.thread("").history(), "invalid_argument", ["thread"]],
    [Memory.thread("t").history({ limit: -1 }), "invalid_argument", ["limit"]],
    [Memory.thread("t").history({ limit: 0.5 }), "invalid_argument", ["limit"]]
  ]
  for (const [effect, code, path] of cases) {
    const error = errorOf(await Effect.runPromiseExit(Effect.provide(effect, layer)))
    expect([error.code, error.path]).toEqual([code, path])
  }
  expect(calls).toEqual([])
  const failed = errorOf(await Effect.runPromiseExit(Effect.provide(Memory.thread("t").history(), layer)))
  expect([failed.code, calls]).toEqual(["store", ["history"]])
})

// A real restart: each operation runs in its own process over one SQLite file.
const child = (db: string, ...args: Array<string>) => {
  const result = Bun.spawnSync(["bun", join(import.meta.dir, "fixtures/memory-sql-child.ts"), db, ...args], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe"
  })
  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout.toString()).rows
}

test("notes and threads over SQLite: later processes see earlier processes' notes and messages", () => {
  const db = join(scratch, `restart-${++files}.db`)
  child(db, "note", "n1", "", "tests take 4 minutes")
  child(db, "note", "n2", "n1", "tests take 9 minutes")
  expect(child(db, "recall", "minutes").map((row: Memory.Recalled) => [row.key, row.text])).toEqual([["n2", "tests take 9 minutes"]])
  child(db, "append", "chat", "m1", "user", "hello")
  child(db, "append", "chat", "m2", "assistant", "hi")
  child(db, "append", "chat", "m1", "user", "hello")
  expect(child(db, "history", "chat", "5").map((message: Memory.Message) => [message.id, message.text])).toEqual([["m1", "hello"], ["m2", "hi"]])
})
