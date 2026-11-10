import { expect, test } from "bun:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { Effect, Layer, Schema } from "effect"
import { Durable } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const Release = Durable.workflow("identity#Release", {
  payload: { targets: Schema.ReadonlySet(Schema.String) },
  success: Schema.Array(Schema.String)
})

test("equal sets built in different orders join one run, and the body sees them sorted", async () => {
  const store = Durable.makeMemoryStore()
  const seen: Array<ReadonlyArray<string>> = []
  const layer = Release.toLayer(({ targets }) => Effect.sync(() => (seen.push([...targets]), [...targets]))).pipe(
    Layer.provideMerge(Durable.layerStore(store))
  )
  const first = await Effect.runPromise(Release.execute({ targets: new Set(["b", "a"]) }).pipe(Effect.provide(layer)))
  const second = await Effect.runPromise(Release.execute({ targets: new Set(["a", "b"]) }).pipe(Effect.provide(layer)))
  expect(first).toEqual(["a", "b"])
  expect(second).toEqual(["a", "b"])
  expect(seen).toEqual([["a", "b"]])
  expect(await Effect.runPromise(Release.executionId({ targets: new Set(["b", "a"]) }))).toBe(
    await Effect.runPromise(Release.executionId({ targets: new Set(["a", "b"]) }))
  )
})

test("identity is RFC 8785 text of the schema's JSON encoding", () => {
  const Shape = Schema.Struct({ z: Schema.Number, a: Schema.ReadonlyMap(Schema.String, Schema.Date), list: Schema.Array(Schema.Number) })
  const text = Durable.identity(Shape)({
    z: 1,
    a: new Map([["y", new Date(0)], ["x", new Date(1000)]]),
    list: [3, 1]
  })
  expect(text).toBe('{"a":[["x","1970-01-01T00:00:01.000Z"],["y","1970-01-01T00:00:00.000Z"]],"list":[3,1],"z":1}')
})

// Identity is stable under reordering: the same data, with every set, map
// and record built in another order, has the same identity and run id;
// reordering an array, whose order is meaningful, changes it.
const Shape = Schema.Struct({
  tags: Schema.ReadonlySet(Schema.String),
  scores: Schema.ReadonlyMap(Schema.String, Schema.Number),
  groups: Schema.Array(Schema.Struct({ ids: Schema.ReadonlySet(Schema.Number), labels: Schema.Record(Schema.String, Schema.Boolean) })),
  nested: Schema.ReadonlyMap(Schema.String, Schema.ReadonlySet(Schema.String))
})
const Shaped = Durable.workflow("identity#Shaped", { payload: Shape.fields })

type Input = {
  readonly tags: ReadonlyArray<string>
  readonly scores: ReadonlyArray<readonly [string, number]>
  readonly groups: ReadonlyArray<{ readonly ids: ReadonlyArray<number>; readonly labels: ReadonlyArray<readonly [string, boolean]> }>
  readonly nested: ReadonlyArray<readonly [string, ReadonlyArray<string>]>
  readonly seed: number
}

// A deterministic shuffle, so a saved regression replays exactly.
const shuffle = <A>(items: ReadonlyArray<A>, seed: number): Array<A> => {
  const out = [...items]
  let state = seed >>> 0 || 1
  for (let index = out.length - 1; index > 0; index--) {
    state = (state * 1103515245 + 12345) >>> 0
    const other = state % (index + 1)
    ;[out[index], out[other]] = [out[other]!, out[index]!]
  }
  return out
}

const build = (input: Input, seed: number | undefined): Schema.Schema.Type<typeof Shape> => {
  const order = <A>(items: ReadonlyArray<A>, salt: number) => seed === undefined ? [...items] : shuffle(items, seed + salt)
  return {
    tags: new Set(order(input.tags, 1)),
    scores: new Map(order(input.scores, 2)),
    groups: input.groups.map((group, index) => ({
      ids: new Set(order(group.ids, 3 + index)),
      labels: Object.fromEntries(order(group.labels, 100 + index))
    })),
    nested: new Map(order(input.nested, 4).map(([key, values], index) => [key, new Set(order(values, 200 + index))] as const))
  }
}

const unique = <A>(entries: ReadonlyArray<readonly [string, A]>) => {
  const seen = new Set<string>()
  return entries.filter(([key]) => !seen.has(key) && (seen.add(key), true))
}

const quote = "Entries are ordered by a stable text rank of their sorted value, compared in UTF-16 code units. A `Map` orders by key."

test("identity is stable under reordering of sets, maps and records, and not of arrays", async () => {
  assert.ok(readFileSync(new URL("../../../docs/design/vips/0044-durable-values.md", import.meta.url), "utf8").includes(quote))
  await checkProperty(fc, {
    name: "durable-identity-reordering",
    rule: "VIP-44: " + quote,
    command: "bun test tests/experimental-durable-identity.test.ts",
    arbitrary: fc.record({
      tags: fc.uniqueArray(fc.string({ maxLength: 4 }), { maxLength: 6 }),
      scores: fc.array(fc.tuple(fc.string({ maxLength: 3 }), fc.integer({ min: -5, max: 5 })), { maxLength: 6 }).map(unique),
      groups: fc.array(
        fc.record({
          ids: fc.uniqueArray(fc.integer({ min: 0, max: 20 }), { maxLength: 5 }),
          labels: fc.array(fc.tuple(fc.constantFrom("a", "b", "zz", "é", "B"), fc.boolean()), { maxLength: 4 }).map(unique)
        }),
        { maxLength: 3 }
      ),
      nested: fc.array(fc.tuple(fc.string({ maxLength: 3 }), fc.uniqueArray(fc.string({ maxLength: 3 }), { maxLength: 4 })), { maxLength: 4 }).map(unique),
      seed: fc.integer({ min: 1, max: 2 ** 31 - 1 })
    }),
    numRuns: 200,
    check: async (input: Input) => {
      const original = build(input, undefined)
      const reordered = build(input, input.seed)
      const id = Durable.identity(Shape)
      assert.equal(id(reordered), id(original))
      assert.equal(
        await Effect.runPromise(Shaped.executionId(reordered)),
        await Effect.runPromise(Shaped.executionId(original))
      )
      const groups = original.groups.map((group) => id({ ...original, groups: [group] }))
      if (JSON.stringify(groups) !== JSON.stringify([...groups].reverse())) {
        assert.notEqual(id({ ...original, groups: [...original.groups].reverse() }), id(original))
      }
    }
  })
}, 60000)
