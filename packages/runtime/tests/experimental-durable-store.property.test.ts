import { afterAll, test } from "bun:test"
import { strict as assert } from "node:assert"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fc from "fast-check"
import { Effect, Exit, Layer, ManagedRuntime } from "effect"
import { Durable } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { layer as sqlite } from "./fixtures/bun-sqlite-client.ts"

// Two adapters behind one seam: any sequence of store operations gives the
// same results and failures from the memory store and the SQLite store.
const scratch = mkdtempSync(join(tmpdir(), "durable-store-property-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let files = 0

const runs = ["a", "b", "c"] as const
const statuses = ["running", "suspended", "succeeded", "failed", "interrupted"] as const
type Op =
  | { readonly op: "open"; readonly run: string; readonly at: number }
  | { readonly op: "claim"; readonly run: string; readonly owner: string; readonly at: number }
  | { readonly op: "commit"; readonly run: string; readonly stale: boolean; readonly events: number; readonly status: string | null; readonly at: number }
  | { readonly op: "append"; readonly run: string; readonly events: number; readonly at: number }
  | { readonly op: "fork"; readonly run: string; readonly seq: number; readonly target: string; readonly at: number }
  | { readonly op: "truncate"; readonly run: string; readonly seq: number; readonly at: number }
  | { readonly op: "cachePut"; readonly key: string; readonly expiresAt: number | null }
  | { readonly op: "cacheGet"; readonly key: string; readonly now: number }
  | { readonly op: "sweep"; readonly before: number; readonly now: number }
  | { readonly op: "list"; readonly status: string | null }
  | { readonly op: "entries"; readonly run: string; readonly from: number; readonly to: number }

const at = fc.integer({ min: 1, max: 50 })
const run = fc.constantFrom(...runs)
const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant("open" as const), run, at }),
  fc.record({ op: fc.constant("claim" as const), run, owner: fc.constantFrom("x", "y"), at }),
  fc.record({
    op: fc.constant("commit" as const),
    run,
    stale: fc.boolean(),
    events: fc.integer({ min: 0, max: 2 }),
    status: fc.option(fc.constantFrom(...statuses), { nil: null }),
    at
  }),
  fc.record({ op: fc.constant("append" as const), run, events: fc.integer({ min: 1, max: 2 }), at }),
  fc.record({ op: fc.constant("fork" as const), run, seq: fc.integer({ min: 1, max: 6 }), target: fc.constantFrom("f1", "f2"), at }),
  fc.record({ op: fc.constant("truncate" as const), run, seq: fc.integer({ min: 1, max: 6 }), at }),
  fc.record({ op: fc.constant("cachePut" as const), key: fc.constantFrom("k1", "k2"), expiresAt: fc.option(at, { nil: null }) }),
  fc.record({ op: fc.constant("cacheGet" as const), key: fc.constantFrom("k1", "k2"), now: at }),
  fc.record({ op: fc.constant("sweep" as const), before: at, now: at }),
  fc.record({ op: fc.constant("list" as const), status: fc.option(fc.constantFrom(...statuses), { nil: null }) }),
  fc.record({ op: fc.constant("entries" as const), run, from: fc.integer({ min: 1, max: 4 }), to: fc.integer({ min: 1, max: 8 }) })
)

// Applies the operations and records each observable result. Fences come
// from the store, so a "stale" commit uses one less than the current fence.
const apply = async (store: Durable.Store, ops: ReadonlyArray<Op>) => {
  const trace: Array<unknown> = []
  const result = async <A, E>(effect: Effect.Effect<A, E>) => {
    const exit = await Effect.runPromiseExit(effect)
    return Exit.isSuccess(exit) ? { ok: exit.value } : { error: (exit.cause.reasons[0] as { error?: { _tag?: string } }).error?._tag ?? "defect" }
  }
  const fenceOf = async (name: string) => {
    const row = await Effect.runPromise(store.get(name))
    return row._tag === "Some" ? row.value.fence : 0
  }
  const events = (n: number, tag: string) => Array.from({ length: n }, (_, i) => ({ eventType: `${tag}${i}`, payload: { i, tag } }))
  for (const op of ops) {
    switch (op.op) {
      case "open":
        trace.push(await result(store.open({ run: op.run, workflow: `w-${op.run}`, payload: { run: op.run }, parent: undefined, at: op.at })))
        break
      case "claim":
        trace.push(await result(store.claim(op.run, op.owner, op.at)))
        break
      case "commit": {
        const fence = (await fenceOf(op.run)) - (op.stale ? 1 : 0)
        trace.push(await result(store.commit(op.run, {
          fence,
          events: events(op.events, "C"),
          status: op.status === null ? undefined : op.status as Durable.RunStatus,
          result: op.status === null ? undefined : { done: op.status }
        }, op.at)))
        break
      }
      case "append":
        trace.push(await result(store.append(op.run, events(op.events, "A"), op.at)))
        break
      case "fork": {
        const exists = (await Effect.runPromise(store.get(op.target)))._tag === "Some"
        // A fork target is always a new run id in the engine.
        trace.push(exists ? "skip" : await result(store.fork(op.run, op.seq, op.target, op.at)))
        break
      }
      case "truncate":
        trace.push(await result(store.truncate(op.run, op.seq, "t", op.at)))
        break
      case "cachePut":
        trace.push(await result(store.cachePut(op.key, { value: { key: op.key }, expiresAt: op.expiresAt ?? undefined })))
        break
      case "cacheGet":
        trace.push(await result(store.cacheGet(op.key, op.now)))
        break
      case "sweep":
        trace.push(await result(store.sweep(op.before, op.now)))
        break
      case "list":
        trace.push(await result(store.list(op.status === null ? {} : { status: op.status as Durable.RunStatus })))
        break
      case "entries":
        trace.push(await result(store.entries(op.run, { from: op.from, to: op.to })))
        break
    }
  }
  trace.push(await result(store.list({})))
  for (const name of [...runs, "f1", "f2"]) trace.push(await result(store.get(name)), await result(store.entries(name)))
  return JSON.parse(JSON.stringify(trace))
}

test("the memory and SQLite stores agree on every sequence of operations", async () => {
  await checkProperty(fc, {
    name: "durable-store-parity",
    rule: "std-durable: a fork swaps the store by providing another layer; everything that decides behavior sits above the store",
    command: "bun test tests/experimental-durable-store.property.test.ts",
    arbitrary: fc.array(opArbitrary, { minLength: 1, maxLength: 25 }),
    numRuns: 100,
    check: async (ops: ReadonlyArray<Op>) => {
      const runtime = ManagedRuntime.make(Durable.layerSql.pipe(Layer.provide(sqlite(join(scratch, `p-${++files}.db`)))))
      try {
        const sql = await runtime.runPromise(Effect.map(Effect.service(Durable.Durable), (durable) => durable.internals.store))
        assert.deepEqual(await apply(sql, ops), await apply(Durable.makeMemoryStore(), ops))
      } finally {
        await runtime.dispose()
      }
    }
  })
}, 120000)
