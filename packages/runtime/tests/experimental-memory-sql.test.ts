import { afterAll, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"
import { Memory } from "vibelang-runtime/experimental"
import { layer as sqlite } from "./fixtures/bun-sqlite-client.ts"

const scratch = mkdtempSync(join(tmpdir(), "memory-sql-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let files = 0
const database = () => join(scratch, `memory-${++files}.db`)

const errorOf = (exit: Exit.Exit<unknown, Memory.MemoryError>) => {
  if (Exit.isSuccess(exit)) throw new Error(`expected a failure, got ${JSON.stringify(exit.value)}`)
  const error = Cause.findErrorOption(exit.cause)
  if (error._tag === "None") throw new Error(Cause.pretty(exit.cause))
  return error.value
}

// The store layerSql builds, read through its own layer. The runtime stays
// open for the test, so the database does too.
const sqlStore = (filename: string) =>
  ManagedRuntime.make(Memory.layerSql().pipe(Layer.provide(sqlite(filename)))).runPromise(
    Effect.map(Effect.service(Memory.Memory), (memory) => memory.store)
  )

// One contract, two stores: what remember and recall rely on.
const contract = (name: string, make: () => Promise<Memory.Store>) => {
  test(`${name} store: a fact is replaced by key and keeps its namespace`, async () => {
    const store = await make()
    const put = (kind: Memory.Kind, id: string, key: string, text: string, at: number) =>
      Effect.runPromise(store.putFact({ namespace: { kind, id }, key, text, at }))
    await put("agent", "a", "k", "first", 1)
    await put("agent", "a", "k", "second", 2)
    await put("agent", "a", "j", "other", 3)
    await put("user", "a", "k", "user's", 4)
    const rows = await Effect.runPromise(store.searchRows({ kind: "agent", id: "a" }))
    expect([...rows].sort((l, r) => l.key.localeCompare(r.key))).toEqual([
      { key: "j", text: "other", updatedAtMs: 3 },
      { key: "k", text: "second", updatedAtMs: 2 }
    ])
    expect(await Effect.runPromise(store.searchRows({ kind: "user", id: "a" }))).toEqual([{ key: "k", text: "user's", updatedAtMs: 4 }])
    expect(await Effect.runPromise(store.searchRows({ kind: "global", id: "a" }))).toEqual([])
  })

  test(`${name} store: text round-trips unchanged`, async () => {
    const store = await make()
    const text = "quotes \" and ' , unicode Δ😀, newline\nand {\"content\": 1}"
    await Effect.runPromise(store.putFact({ namespace: { kind: "flow", id: "f" }, key: "🔑 key", text, at: 7 }))
    expect(await Effect.runPromise(store.searchRows({ kind: "flow", id: "f" }))).toEqual([{ key: "🔑 key", text, updatedAtMs: 7 }])
  })
}

contract("memory", async () => Memory.makeMemoryStore())
contract("SQLite", () => sqlStore(database()))

// A real restart: each operation runs in its own process over one file.
const child = (db: string, ...args: Array<string>) => {
  const result = Bun.spawnSync(["bun", join(import.meta.dir, "fixtures/memory-sql-child.ts"), db, ...args], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe"
  })
  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout.toString()) as { readonly pid: number; readonly rows: unknown }
}

test("memory over SQLite: a later process recalls what an earlier one remembered", () => {
  const db = database()
  const first = child(db, "remember", "style", "prefer early returns")
  const second = child(db, "remember", "naming", "use domain words")
  const third = child(db, "recall", "returns words")
  expect(new Set([first.pid, second.pid, third.pid]).size).toBe(3)
  expect((third.rows as Array<Memory.Recalled>).map(({ bank, key, text, score }) => ({ bank, key, text, score }))).toEqual([
    { bank: "agent-reviewer", key: "naming", text: "use domain words", score: 1 },
    { bank: "agent-reviewer", key: "style", text: "prefer early returns", score: 1 }
  ])
})

test("memory over SQLite: reads a fact Smithers' memory_facts table holds", async () => {
  const db = database()
  // The table as @smthrs/memory 1.0.0-rc.16 creates it on SQLite, with a
  // fact it wrote: an object value with `content`, and one with none.
  const raw = new Database(db, { create: true })
  raw.run(`CREATE TABLE memory_facts (
    namespace_kind TEXT NOT NULL,
    namespace_id TEXT NOT NULL,
    fact_key TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    tags_json TEXT CHECK (tags_json IS NULL OR json_valid(tags_json)),
    ttl_ms INTEGER,
    provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (namespace_kind, namespace_id, fact_key),
    CHECK (namespace_kind IN ('flow', 'agent', 'user', 'global')),
    CHECK (length(namespace_id) > 0),
    CHECK (length(fact_key) > 0),
    CHECK (ttl_ms IS NULL OR ttl_ms >= 0)
  )`)
  const insert = raw.prepare(`INSERT INTO memory_facts VALUES (?, ?, ?, ?, '[]', ?, '{}', ?, ?)`)
  insert.run("global", "notes", "release", JSON.stringify({ content: "cut 0.1.0" }), null, 10, 20)
  insert.run("global", "notes", "plan", JSON.stringify({ steps: ["release"] }), null, 10, 30)
  insert.run("global", "notes", "stale", JSON.stringify({ content: "old release" }), 5, 10, 40)
  raw.close()
  const layer = Memory.layerSql().pipe(Layer.provide(sqlite(db)))
  const rows = await Effect.runPromise(Effect.provide(Memory.recall({ banks: ["global-notes"], query: "release" }), layer))
  expect(rows.map(({ key, text, updatedAtMs }) => [key, text, updatedAtMs])).toEqual([
    ["plan", "{\"steps\":[\"release\"]}", 30],
    ["release", "cut 0.1.0", 20]
  ])
  await Effect.runPromise(Effect.provide(Memory.remember({ bank: "global-notes", key: "release", text: "cut 0.2.0" }), layer))
  const after = new Database(db, { readonly: true })
  expect(after.query(`SELECT value_json, created_at_ms FROM memory_facts WHERE fact_key = 'release'`).get()).toEqual({
    value_json: "{\"content\":\"cut 0.2.0\"}",
    created_at_ms: 10
  })
  after.close()
})

// An injected fault in a real SQLite client: every statement matching the
// pattern fails as the database would.
test("memory over SQLite: a failing database fails with code store", async () => {
  const db = database()
  const broken = { pattern: /^$/ }
  const layer = Memory.layerSql().pipe(Layer.provide(sqlite(db, { fault: (sql) => broken.pattern.test(sql) })))
  const runtime = ManagedRuntime.make(layer)
  await runtime.runPromise(Memory.remember({ bank: "global-n", key: "k", text: "word" }))
  broken.pattern = /INSERT INTO memory_facts/
  const write = errorOf(await runtime.runPromiseExit(Memory.remember({ bank: "global-n", key: "k", text: "other" })))
  expect([write._tag, write.code]).toEqual(["MemoryError", "store"])
  expect(write.message).toContain("could not write a memory fact")
  broken.pattern = /SELECT/
  const read = errorOf(await runtime.runPromiseExit(Memory.recall({ banks: ["global-n"], query: "word" })))
  expect([read.code, read.message]).toEqual(["store", expect.stringContaining("could not read memory facts")])
  broken.pattern = /^$/
  expect((await runtime.runPromise(Memory.recall({ banks: ["global-n"], query: "word" }))).map((row) => row.text)).toEqual(["word"])
  await runtime.dispose()
  const opening = await Effect.runPromiseExit(
    Effect.provide(Memory.recall({ banks: ["global-n"], query: "word" }), Memory.layerSql().pipe(Layer.provide(sqlite(database(), { fault: () => true }))))
  )
  expect(errorOf(opening).message).toContain("could not create the memory tables")
})

