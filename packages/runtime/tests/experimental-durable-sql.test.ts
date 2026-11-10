import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Stream } from "effect"
import { SqlClient } from "effect/sql"
import { Durable } from "vibelang-runtime/experimental"
import { layer as sqlite } from "./fixtures/bun-sqlite-client.ts"

const scratch = mkdtempSync(join(tmpdir(), "durable-sql-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let files = 0
const database = () => join(scratch, `runs-${++files}.db`)

// The store an engine sees over SQLite, read through the engine's own layer.
// The runtime stays open for the test, so the database does too.
const sqlStore = (filename: string) =>
  ManagedRuntime.make(Durable.layerSql.pipe(Layer.provide(sqlite(filename)))).runPromise(
    Effect.map(Effect.service(Durable.Durable), (durable) => durable.internals.store)
  )

// One contract, two stores: what the engine relies on.
const contract = (name: string, make: () => Promise<Durable.Store>) => {
  test(`${name} store: open is idempotent and journals RunStarted once`, async () => {
    const store = await make()
    const row = await Effect.runPromise(store.open({ run: "r1", workflow: "w", payload: { a: 1 }, parent: undefined, at: 10 }))
    const again = await Effect.runPromise(store.open({ run: "r1", workflow: "other", payload: {}, parent: undefined, at: 20 }))
    expect(row).toEqual(again)
    expect(row).toMatchObject({ run: "r1", workflow: "w", payload: { a: 1 }, status: "running", fence: 0, createdAt: 10 })
    const entries = await Effect.runPromise(store.entries("r1"))
    expect(entries.map((entry) => [entry.seq, entry.eventType])).toEqual([[1, "RunStarted"]])
  })

  test(`${name} store: a commit under an old fence is refused and changes nothing`, async () => {
    const store = await make()
    await Effect.runPromise(store.open({ run: "r2", workflow: "w", payload: {}, parent: undefined, at: 1 }))
    const first = await Effect.runPromise(store.claim("r2", "a", 2))
    const second = await Effect.runPromise(store.claim("r2", "b", 3))
    expect([first, second]).toEqual([1, 2])
    const stale = await Effect.runPromiseExit(store.commit("r2", { fence: first, events: [{ eventType: "X", payload: {} }] }, 4))
    expect(Exit.isFailure(stale) && Cause.pretty(stale.cause)).toContain("FenceLost")
    const seqs = await Effect.runPromise(store.commit("r2", {
      fence: second,
      events: [{ eventType: "A", payload: 1 }, { eventType: "B", payload: [2] }],
      status: "succeeded",
      result: { ok: true }
    }, 5))
    expect(seqs).toEqual([2, 3])
    expect(Option.getOrThrow(await Effect.runPromise(store.get("r2")))).toMatchObject({ status: "succeeded", result: { ok: true }, owner: "b" })
    const missing = await Effect.runPromiseExit(store.claim("nope", "a", 1))
    expect(Exit.isFailure(missing) && Cause.pretty(missing.cause)).toContain("RunNotFound")
  })

  test(`${name} store: entries, append, fork and truncate`, async () => {
    const store = await make()
    await Effect.runPromise(store.open({ run: "r3", workflow: "w", payload: {}, parent: undefined, at: 1 }))
    await Effect.runPromise(store.append("r3", [{ eventType: "A", payload: "a" }, { eventType: "B", payload: "b" }, { eventType: "C", payload: "c" }], 2))
    expect((await Effect.runPromise(store.entries("r3", { from: 2, to: 3 }))).map((entry) => entry.eventType)).toEqual(["A", "B"])
    const forked = await Effect.runPromise(store.fork("r3", 3, "r3f", 9))
    expect(forked).toMatchObject({ run: "r3f", status: "suspended", fence: 0 })
    expect((await Effect.runPromise(store.entries("r3f"))).map((entry) => entry.eventType)).toEqual(["RunStarted", "A"])
    expect((await Effect.runPromise(store.entries("r3"))).length).toBe(4)
    const fence = await Effect.runPromise(store.truncate("r3", 2, "c", 10))
    expect(fence).toBe(1)
    expect((await Effect.runPromise(store.entries("r3"))).map((entry) => entry.eventType)).toEqual(["RunStarted"])
    expect(Option.getOrThrow(await Effect.runPromise(store.get("r3")))).toMatchObject({ status: "suspended", owner: "c" })
  })

  test(`${name} store: list filters, the cache expires, and sweep deletes old finished runs`, async () => {
    const store = await make()
    for (const [run, workflow] of [["s1", "w1"], ["s2", "w2"]] as const) {
      await Effect.runPromise(store.open({ run, workflow, payload: {}, parent: undefined, at: 1 }))
    }
    await Effect.runPromise(store.commit("s1", { fence: 0, events: [], status: "succeeded", result: 1 }, 2))
    expect((await Effect.runPromise(store.list({ status: "succeeded" }))).map((row) => row.run)).toEqual(["s1"])
    expect((await Effect.runPromise(store.list({ workflow: "w2" }))).map((row) => row.run)).toEqual(["s2"])
    await Effect.runPromise(store.cachePut("k", { value: { v: 1 }, expiresAt: 100 }))
    await Effect.runPromise(store.cachePut("forever", { value: [1], expiresAt: undefined }))
    expect(await Effect.runPromise(store.cacheGet("k", 50))).toEqual(Option.some({ v: 1 }))
    expect(await Effect.runPromise(store.cacheGet("k", 100))).toEqual(Option.none())
    expect(await Effect.runPromise(store.sweep(3, 200))).toBe(1)
    expect((await Effect.runPromise(store.list({}))).map((row) => row.run)).toEqual(["s2"])
    expect(await Effect.runPromise(store.entries("s1"))).toEqual([])
    expect(await Effect.runPromise(store.cacheGet("forever", 10 ** 12))).toEqual(Option.some([1]))
  })
}

contract("memory", async () => Durable.makeMemoryStore())
contract("SQLite", () => sqlStore(database()))

// A real crash: the child process kills itself with SIGKILL inside a step.
const child = (db: string, effects: string, crash: string) =>
  Bun.spawnSync(["bun", join(import.meta.dir, "fixtures/durable-crash-child.ts"), db, effects, crash], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe"
  })

for (const phase of ["before", "after"] as const) {
  test(`a process killed ${phase} a step's effect resumes from SQLite on its next start`, async () => {
    const db = database()
    const effects = join(scratch, `effects-${files}.txt`)
    writeFileSync(effects, "")
    const killed = child(db, effects, `charge:o1:${phase}`)
    expect(killed.signalCode).toBe("SIGKILL")
    const finished = child(db, effects, "")
    expect(finished.exitCode).toBe(0)
    const { result, run } = JSON.parse(finished.stdout.toString())
    expect(result).toBe("o1:receipt-42")
    const ran = readFileSync(effects, "utf8").trim().split("\n")
    expect(ran).toEqual(phase === "after"
      ? ["reserve:o1", "charge:o1", "charge:o1", "ship:o1"]
      : ["reserve:o1", "charge:o1", "ship:o1"])
    const kinds = await Effect.runPromise(
      Stream.runCollect(Stream.map(Durable.history(run), (entry) => `${entry.eventType}:${(entry.payload as { step?: string }).step ?? ""}`)).pipe(
        Effect.provide(Durable.layerSql.pipe(Layer.provide(sqlite(db))))
      )
    )
    expect(Array.from(kinds)).toEqual([
      "RunStarted:",
      "StepStarted:crash#Reserve/1",
      "StepCompleted:crash#Reserve/1",
      "StepStarted:crash#Charge/1",
      "StepStarted:crash#Charge/1",
      "StepCompleted:crash#Charge/1",
      "StepStarted:crash#Ship/1",
      "StepCompleted:crash#Ship/1",
      "RunCompleted:"
    ])
    // A third start joins the finished run and runs nothing.
    const joined = child(db, effects, "")
    expect(JSON.parse(joined.stdout.toString()).result).toBe("o1:receipt-42")
    expect(readFileSync(effects, "utf8").trim().split("\n")).toEqual(ran)
  }, 60000)
}

test("the SQL layer needs a SqlClient, the requirement a program provides", () => {
  const requirement: Layer.Layer<unknown, never, SqlClient.SqlClient> = Durable.layerSql
  expect(Layer.isLayer(requirement)).toBe(true)
})
