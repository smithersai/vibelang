import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Cause, Effect, Exit, Layer, Option, Stream } from "effect"
import { SqlClient } from "effect/sql"
import { Durable } from "vibelang-runtime/experimental"
import { layer as sqlite, sqliteStore } from "./fixtures/bun-sqlite-client.ts"
import { spawnBounded } from "./subprocess.ts"

const scratch = mkdtempSync(join(tmpdir(), "durable-sql-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let files = 0
const database = () => join(scratch, `runs-${++files}.db`)


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
contract("SQLite", () => sqliteStore(database()))

// A real crash: the child process kills itself with SIGKILL inside a step.
// The timeout stays below the test's own deadline, which cannot fire while
// a synchronous child runs.
const crashChild = join(import.meta.dir, "fixtures/durable-crash-child.ts")
const child = (db: string, effects: string, crash: string, mode = "order") =>
  spawnBounded(["bun", crashChild, db, effects, crash, mode], { cwd: join(import.meta.dir, ".."), timeout: 20_000 })
const historyOf = (db: string, run: string) =>
  Effect.runPromise(
    Stream.runCollect(Stream.map(Durable.history(run), (entry) => `${entry.eventType}:${(entry.payload as { step?: string }).step ?? ""}`)).pipe(
      Effect.provide(Durable.layerSql.pipe(Layer.provide(sqlite(db))))
    )
  ).then((kinds) => Array.from(kinds))

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
    expect(await historyOf(db, run)).toEqual([
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

test("a process killed between two concurrent calls of one task replays the finished call and runs the other", async () => {
  const db = database()
  const effects = join(scratch, `effects-pair-${files}.txt`)
  writeFileSync(effects, "")
  // fetch:a is recorded; the process dies as fetch:b is about to run.
  const killed = child(db, effects, "fetch:b:before", "pair")
  expect(killed.signalCode).toBe("SIGKILL")
  expect(readFileSync(effects, "utf8").trim().split("\n")).toEqual(["fetch:a"])
  const finished = child(db, effects, "", "pair")
  expect(finished.stderr.toString()).toBe("")
  expect(finished.exitCode).toBe(0)
  const { result, run } = JSON.parse(finished.stdout.toString())
  // Each call gets the result recorded for its own payload.
  expect(result).toEqual(["issues-of-a", "issues-of-b"])
  expect(readFileSync(effects, "utf8").trim().split("\n")).toEqual(["fetch:a", "fetch:b"])
  const kinds = await historyOf(db, run)
  expect(kinds.filter((kind) => kind.startsWith("StepCompleted:")).sort()).toEqual(["StepCompleted:crash#Fetch/1", "StepCompleted:crash#Fetch/2"])
  expect(kinds.at(-1)).toBe("RunCompleted:")
}, 60000)

// Two live engines, in two processes with their own connections, execute
// one run on one SQLite file at once. The store's fence decides: an engine
// whose claim was overtaken dies with FenceLost at its next write, and no
// step is recorded as finished twice.
test("two processes executing one run on one SQLite file record each step once", async () => {
  for (let round = 0; round < 3; round++) {
    const db = database()
    const effects = join(scratch, `effects-race-${files}.txt`)
    writeFileSync(effects, "")
    const start = () =>
      Bun.spawn(["bun", crashChild, db, effects, "", "race"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", timeout: 20_000 })
    const children = [start(), start()]
    const outcomes = await Promise.all(children.map(async (proc) => ({
      code: await proc.exited,
      stdout: await new Response(proc.stdout).text(),
      stderr: await new Response(proc.stderr).text()
    })))
    const winners = outcomes.filter((outcome) => outcome.code === 0)
    expect(winners.length).toBeGreaterThanOrEqual(1)
    for (const outcome of outcomes) {
      if (outcome.code === 0) expect(JSON.parse(outcome.stdout).result).toBe("o1:receipt-42")
      else expect(outcome.stderr).toContain("FenceLost")
    }
    const { run } = JSON.parse(winners[0]!.stdout)
    const kinds = await historyOf(db, run)
    expect(kinds.filter((kind) => kind.startsWith("StepCompleted:"))).toEqual([
      "StepCompleted:crash#Reserve/1",
      "StepCompleted:crash#Charge/1",
      "StepCompleted:crash#Ship/1"
    ])
    expect(kinds.filter((kind) => kind === "RunCompleted:").length).toBe(1)
    expect(kinds.at(-1)).toBe("RunCompleted:")
    // Every effect ran at least once; the journal, not the effects file, is exactly-once.
    const ran = new Set(readFileSync(effects, "utf8").trim().split("\n"))
    expect([...ran].sort()).toEqual(["charge:o1", "reserve:o1", "ship:o1"])
  }
}, 120000)

test("the SQL layer needs a SqlClient, the requirement a program provides", () => {
  const requirement: Layer.Layer<unknown, never, SqlClient.SqlClient> = Durable.layerSql
  expect(Layer.isLayer(requirement)).toBe(true)
})
