import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"
import * as fc from "fast-check"
import { Memory } from "vibelang-runtime/experimental"
import { layer as sqlite } from "./fixtures/bun-sqlite-client.ts"

// The SQL store and the in-process store are two adapters of one seam: after
// any sequence of facts, notes, messages and sweeps, every operation returned
// the same value or failed with the same code in both, each namespace holds the same rows, each
// thread the same history, and recall over either gives the same answer.
const scratch = mkdtempSync(join(tmpdir(), "memory-parity-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let files = 0

const ids = ["a", "b", "Δ", "😀", "￿"]
const namespace = fc.record({ kind: fc.constantFrom(...Memory.kinds), id: fc.constantFrom("a", "b", "Δ") })
const text = fc.oneof(fc.constantFrom("alpha", "alpha beta", "{\"content\":\"x\"}", ""), fc.string({ unit: "grapheme", maxLength: 20 }))
const at = fc.constantFrom(1, 1, 2, 3)
const operation = fc.oneof(
  fc.record({
    op: fc.constant("fact" as const),
    namespace,
    key: fc.oneof(fc.constantFrom("k", "K", "k "), fc.string({ unit: "grapheme", minLength: 1, maxLength: 6 })),
    text,
    at,
    ttlMs: fc.constantFrom(undefined, 1, 1e15)
  }),
  fc.record({
    op: fc.constant("sweep" as const),
    now: fc.constantFrom(2, 3, 5),
    writtenBefore: fc.constantFrom(undefined, 2, 3),
    keep: fc.constantFrom(undefined, 0, 1, 2)
  }),
  fc.record({
    op: fc.constant("note" as const),
    namespace,
    id: fc.constantFrom(...ids),
    text: fc.constantFrom("alpha", "beta"),
    supersedes: fc.uniqueArray(fc.constantFrom(...ids), { maxLength: 2 }).map((list) => list.sort((l, r) => l < r ? -1 : l > r ? 1 : 0)),
    at
  }),
  fc.record({
    op: fc.constant("message" as const),
    thread: fc.constantFrom("t1", "t2"),
    id: fc.constantFrom(...ids),
    role: fc.constantFrom("user", "assistant"),
    text: fc.constantFrom("hi", "bye"),
    at
  })
)

type Operation = typeof operation extends fc.Arbitrary<infer A> ? A : never

const apply = (store: Memory.Store, operation: Operation) =>
  operation.op === "fact" ? store.putFact(operation)
  : operation.op === "sweep" ? store.sweep(operation)
  : operation.op === "note" ? store.putNote(operation)
  : store.appendMessage(operation)

const codeOf = (exit: Exit.Exit<unknown, Memory.MemoryError>): string => {
  if (Exit.isSuccess(exit)) return `ok ${JSON.stringify(exit.value) ?? ""}`
  const error = Cause.findErrorOption(exit.cause)
  return error._tag === "Some" ? error.value.code : `defect: ${Cause.pretty(exit.cause)}`
}

test("memory property: the SQLite store and the in-process store agree", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(operation, { maxLength: 25 }), fc.constantFrom("alpha", "beta k", "x"), fc.option(fc.nat({ max: 4 }), { nil: undefined }), async (operations, query, limit) => {
      const runtime = ManagedRuntime.make(Memory.layerSql().pipe(Layer.provide(sqlite(join(scratch, `parity-${++files}.db`)))))
      try {
        const sql = await runtime.runPromise(Effect.map(Effect.service(Memory.Memory), (memory) => memory.store))
        const memory = Memory.makeMemoryStore()
        for (const operation of operations) {
          const left = codeOf(await Effect.runPromiseExit(apply(sql, operation)))
          const right = codeOf(await Effect.runPromiseExit(apply(memory, operation)))
          expect([operation, left]).toEqual([operation, right])
        }
        const sorted = (rows: ReadonlyArray<Memory.SearchRow>) => [...rows].sort((l, r) => l.key < r.key ? -1 : l.key > r.key ? 1 : 0)
        for (const kind of Memory.kinds) {
          for (const id of ["a", "b", "Δ"]) {
            expect(sorted(await Effect.runPromise(sql.searchRows({ kind, id })))).toEqual(sorted(await Effect.runPromise(memory.searchRows({ kind, id }))))
          }
        }
        for (const thread of ["t1", "t2"]) {
          expect(await Effect.runPromise(sql.history(thread, limit))).toEqual(await Effect.runPromise(memory.history(thread, limit)))
        }
        const banks = ["agent-a", "user-Δ", "global-b", "flow-a"]
        const recall = Memory.recall({ banks, query, maxBytes: 300 })
        expect(await runtime.runPromise(recall)).toEqual(await Effect.runPromise(Effect.provide(recall, Memory.layerStore(memory))))
      } finally {
        await runtime.dispose()
      }
    }),
    { numRuns: 80 }
  )
})
