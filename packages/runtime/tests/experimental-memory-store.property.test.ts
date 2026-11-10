import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, ManagedRuntime } from "effect"
import * as fc from "fast-check"
import { Memory } from "vibelang-runtime/experimental"
import { layer as sqlite } from "./fixtures/bun-sqlite-client.ts"

// The SQL store and the in-process store are two adapters of one seam: after
// any sequence of writes, each namespace holds the same rows in both, and
// recall over either gives the same answer.
const scratch = mkdtempSync(join(tmpdir(), "memory-parity-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let files = 0

const namespace = fc.record({ kind: fc.constantFrom(...Memory.kinds), id: fc.constantFrom("a", "b", "Δ") })
const write = fc.record({
  namespace,
  key: fc.oneof(fc.constantFrom("k", "K", "k "), fc.string({ unit: "grapheme", minLength: 1, maxLength: 6 })),
  text: fc.oneof(fc.constantFrom("alpha", "alpha beta", "{\"content\":\"x\"}", ""), fc.string({ unit: "grapheme", maxLength: 20 })),
  at: fc.nat({ max: 50 })
})

test("memory property: the SQLite store and the in-process store agree", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(write, { maxLength: 20 }), fc.constantFrom("alpha", "beta k", "x"), async (writes, query) => {
      const runtime = ManagedRuntime.make(Memory.layerSql().pipe(Layer.provide(sqlite(join(scratch, `parity-${++files}.db`)))))
      try {
        const sql = await runtime.runPromise(Effect.map(Effect.service(Memory.Memory), (memory) => memory.store))
        const memory = Memory.makeMemoryStore()
        for (const fact of writes) {
          await Effect.runPromise(sql.putFact(fact))
          await Effect.runPromise(memory.putFact(fact))
        }
        const sorted = (rows: ReadonlyArray<Memory.SearchRow>) => [...rows].sort((l, r) => l.key < r.key ? -1 : l.key > r.key ? 1 : 0)
        for (const kind of Memory.kinds) {
          for (const id of ["a", "b", "Δ"]) {
            expect(sorted(await Effect.runPromise(sql.searchRows({ kind, id })))).toEqual(sorted(await Effect.runPromise(memory.searchRows({ kind, id }))))
          }
        }
        const banks = ["agent-a", "user-Δ", "global-b", "flow-a"]
        const recall = Memory.recall({ banks, query, maxBytes: 300 })
        expect(await runtime.runPromise(recall)).toEqual(await Effect.runPromise(Effect.provide(recall, Memory.layerStore(memory))))
      } finally {
        await runtime.dispose()
      }
    }),
    { numRuns: 60 }
  )
})
