// Nanoseconds per pass through provider helpers and their Effect 4.1.1
// counterparts, best of 15 rounds of 20,000 passes. VIP-12 service entries
// use ordinary Layer.succeed providers, including native Scope and MemoMap.
// Run from packages/runtime: bun run build && node tests/provide-bench.mjs
import { Context, Effect } from "effect"
import { $provideEntries, $provideService } from "vibelang-runtime"

class Key extends Context.Service()("bench/Key") {}
const N = 20_000
const body = Effect.map(Key, (n) => n + 1)

const forms = {
  "Effect.provideService": () => Effect.provideService(body, Key, 1),
  "$provideEntries (provide Key = 1 { })": () => $provideEntries(body, [$provideService(Key, "Key", 1)]),
  "Effect.provide one-service Layer": () => Effect.provide(body, $provideService(Key, "Key", 1))
}

const best = {}
for (let round = 0; round < 15; round++) {
  for (const [name, form] of Object.entries(forms)) {
    const loop = Effect.fnUntraced(function* () {
      let sum = 0
      for (let i = 0; i < N; i++) sum += yield* form()
      return sum
    })
    const t0 = performance.now()
    const sum = Effect.runSync(loop())
    const ns = ((performance.now() - t0) * 1e6) / N
    if (sum !== 2 * N) throw new Error(`${name}: ${sum}`)
    best[name] = Math.min(best[name] ?? Infinity, ns)
  }
}
for (const [name, ns] of Object.entries(best)) console.log(`${ns.toFixed(0).padStart(7)} ns  ${name}`)
