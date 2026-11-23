#!/usr/bin/env node
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const runtimeReq = createRequire(path.join(root, "packages/runtime/package.json"))
const { Context, Effect, Layer } = runtimeReq("effect")
const { $provideEntries, $provideService } = await import(path.join(root, "packages/runtime/dist/index.js"))

class Key1 extends Context.Service()("bench/Key1") {}
class Key2 extends Context.Service()("bench/Key2") {}
class Key3 extends Context.Service()("bench/Key3") {}
class Key4 extends Context.Service()("bench/Key4") {}

const N = 5_000
const body1 = Effect.map(Key1, (n) => n + 1)
const body4 = Effect.gen(function* () {
  return (yield* Key1) + (yield* Key2) + (yield* Key3) + (yield* Key4)
})

const runLoop = (form, expectedPerIter) => {
  const loop = Effect.fnUntraced(function* () {
    let sum = 0
    for (let i = 0; i < N; i++) sum += yield* form()
    return sum
  })
  return {
    opsPerCall: N,
    unit: "ns/op",
    batch: 1,
    fn: () => Effect.runSync(loop()),
    verify: (res) => assert.equal(res, expectedPerIter * N)
  }
}

await runSuite({
  suite: "runtime-provide",
  category: "runtime",
  description: "Service and Layer provision helpers ($provideEntries, $provideService) vs native Effect.provideService.",
  cases: [
    {
      name: "Effect.provideService (1 service)",
      ...runLoop(() => Effect.provideService(body1, Key1, 1), 2)
    },
    {
      name: "$provideEntries (1 service)",
      ...runLoop(() => $provideEntries(body1, [$provideService(Key1, "Key1", 1)]), 2)
    },
    {
      name: "Effect.provide (1-service Layer)",
      ...runLoop(() => Effect.provide(body1, $provideService(Key1, "Key1", 1)), 2)
    },
    {
      name: "$provideEntries (4 services)",
      ...runLoop(() => $provideEntries(body4, [
        $provideService(Key1, "Key1", 1),
        $provideService(Key2, "Key2", 2),
        $provideService(Key3, "Key3", 3),
        $provideService(Key4, "Key4", 4)
      ]), 10)
    },
    {
      name: "$provideEntries (Layer.succeed)",
      ...runLoop(() => $provideEntries(body1, [Layer.succeed(Key1, 1)]), 2)
    }
  ]
})
