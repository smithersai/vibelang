// VIP-57 fixture: a main thread that calls the services of rpc-stats.mjs on a
// pool of real worker threads. `node rpc-host.mjs <log file> [node|bun]` prints
// one JSON line of results, then must exit on its own once the pool's scope
// closes. The second argument picks the platform's services bundle.
import { readFileSync, writeFileSync } from "node:fs"
import { threadId, Worker as NodeWorker } from "node:worker_threads"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as runtime from "vibelang-runtime/internal"
import { Rpc } from "vibelang-runtime/experimental"
import { ExperimentalBunServices } from "vibelang-runtime/experimental/platform-bun"
import { ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"
import { EmptySample, Labels, Stats } from "./rpc-stats.mjs"

const logFile = process.argv[2]
const services = process.argv[3] === "bun" ? ExperimentalBunServices.layer : ExperimentalNodeServices.layer
writeFileSync(logFile, "")
process.env.RPC_FIXTURE_LOG = logFile
process.env.RPC_FIXTURE_PLATFORM = process.argv[3] ?? "node"

// What the compiler emits for `import statsWorker from "./rpc-stats.vibe" with { type: "worker" }`.
const statsWorker = runtime.$worker(new URL("./rpc-stats.mjs", import.meta.url), [Stats, Labels])
// What a bundler plugin emits instead: the URL of a self-contained entry.
const bundledWorker = runtime.$worker(new URL("./rpc-stats-entry.mjs", import.meta.url), [Stats, Labels], true)

const calls = Effect.gen(function*() {
  const stats = yield* Stats
  const labels = yield* Labels
  const summary = yield* stats.summarize([1, 2, 3, 6])
  const empty = yield* Effect.flip(stats.summarize([]))
  const arity = [yield* stats.arity(), yield* stats.arity(1), yield* stats.arity(1, 2)]
  const ticks = yield* Stream.runCollect(stats.ticks(3))
  const tickError = yield* Effect.flip(Stream.runCollect(stats.ticks(-1)))
  const statsThread = yield* stats.thread()
  const label = yield* labels.thread()
  yield* stats.reset()
  const started = Date.now()
  const slow = yield* Effect.all([stats.slow(400), stats.slow(400)], { concurrency: "unbounded" })
  const elapsed = Date.now() - started
  return {
    summary,
    empty: empty._tag,
    emptyIsClass: empty instanceof EmptySample,
    arity,
    ticks,
    tickError: tickError._tag,
    statsThread,
    label,
    slow,
    elapsed
  }
})

const run = (handle) =>
  Effect.runPromise(calls.pipe(Effect.provide(Rpc.workers(handle, { size: 2 })), Effect.provide(services)))

const module = await run(statsWorker)
const moduleLog = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean)
writeFileSync(logFile, "")
const entry = await run(bundledWorker)
const entryLog = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean)
writeFileSync(logFile, "")
// What a plugin emits for a bundler whose worker chunks come only from
// `new Worker(new URL(…, import.meta.url))`: a function that starts the worker.
const entryUrl = new URL("./rpc-stats-entry.mjs", import.meta.url)
const spawnedWorker = runtime.$worker(
  () => process.argv[3] === "bun" ? new globalThis.Worker(entryUrl, { type: "module" }) : new NodeWorker(entryUrl),
  [Stats, Labels],
  true
)
const spawn = await run(spawnedWorker)
const spawnLog = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean)
console.log(JSON.stringify({ mainThread: threadId, module, moduleLog, entry, entryLog, spawn, spawnLog }))
