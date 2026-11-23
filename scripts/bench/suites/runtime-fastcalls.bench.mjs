#!/usr/bin/env node
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const runtimeReq = createRequire(path.join(root, "packages/runtime/package.json"))
const { Context, Data, Effect } = runtimeReq("effect")
const { $direct, $done, $fast, $isRun, $settle } = await import(path.join(root, "packages/runtime/dist/index.js"))

const N = 20_000
const expected = N * (N - 1)

class SampleErr extends Data.TaggedError("SampleErr") {}
class SampleSvc extends Context.Service()("bench/SampleSvc") {}

const doubleDirect = (n) => n * 2
const doubleBody = function* (n) { return n * 2 }
function doubleWrapped(...args) { return Effect.sync(() => doubleDirect(...args)) }
doubleWrapped[$direct] = doubleDirect
const doubleEffectOnly = Effect.fnUntraced(doubleBody)
const exitBody = function* (n) { return yield* Effect.succeed(n * 2) }
const viaExit = Effect.fnUntraced(exitBody)
const syncBody = function* (n) { return yield* Effect.sync(() => n * 2) }
const viaSync = Effect.fnUntraced(syncBody)

function doubleFast(n) { const it = doubleBody(n), s = it.next(); return s.done ? $done(s.value) : $settle(it, s) }
function exitFast(n) { const it = exitBody(n), s = it.next(); return s.done ? $done(s.value) : $settle(it, s) }
function syncFast(n) { const it = syncBody(n), s = it.next(); return s.done ? $done(s.value) : $settle(it, s) }
const doubleBounded = $fast(doubleBody)
const exitBounded = $fast(exitBody)
const syncBounded = $fast(syncBody)

const sampleEffect = Effect.succeed(42)
const samplePlain = { a: 1, b: 2 }
const sampleErr = new SampleErr()

const loopCase = (name, gen) => {
  const runner = Effect.fnUntraced(gen)
  return {
    name,
    opsPerCall: N,
    unit: "ns/op",
    batch: 1,
    fn: () => Effect.runSync(runner()),
    verify: (res) => assert.equal(res, expected)
  }
}

await runSuite({
  suite: "runtime-fastcalls",
  category: "runtime",
  description: "VibeLang runtime fast-call protocol ($direct, $fast, $done, $settle, $isRun) vs Effect.fnUntraced.",
  cases: [
    {
      name: "$isRun(number)",
      unit: "ns/op",
      fn: (_, i) => $isRun(i),
      verify: (v) => assert.equal(v, false)
    },
    {
      name: "$isRun(plain object)",
      unit: "ns/op",
      fn: () => $isRun(samplePlain),
      verify: (v) => assert.equal(v, false)
    },
    {
      name: "$isRun(Effect.succeed)",
      unit: "ns/op",
      fn: () => $isRun(sampleEffect),
      verify: (v) => assert.equal(v, true)
    },
    {
      name: "$isRun(TaggedError)",
      unit: "ns/op",
      fn: () => $isRun(sampleErr),
      verify: (v) => assert.equal(v, false)
    },
    {
      name: "$isRun(Context.Service)",
      unit: "ns/op",
      fn: () => $isRun(SampleSvc),
      verify: (v) => assert.equal(v, false)
    },
    loopCase("$direct same-file", function* () {
      let s = 0
      for (let i = 0; i < N; i++) s += doubleDirect(i)
      return s
    }),
    loopCase("f[$direct] cross-module", function* () {
      let s = 0, t
      for (let i = 0; i < N; i++) s += ((t = (doubleWrapped[$direct] ?? doubleWrapped)(i)), doubleWrapped[$direct] ? t : ($isRun(t) ? yield* t : t))
      return s
    }),
    loopCase("plain + $isRun (L3)", function* () {
      let s = 0, t
      for (let i = 0; i < N; i++) s += (t = doubleDirect(i), $isRun(t) ? yield* t : t)
      return s
    }),
    loopCase("fast call, pure body", function* () {
      let s = 0, t
      for (let i = 0; i < N; i++) s += (t = doubleFast(i), $isRun(t) ? yield* t : t)
      return s
    }),
    loopCase("$fast entry, pure body", function* () {
      let s = 0, t
      for (let i = 0; i < N; i++) s += (t = doubleBounded(i), $isRun(t) ? yield* t : t)
      return s
    }),
    loopCase("Effect.fn, yield* f(x)", function* () {
      let s = 0
      for (let i = 0; i < N; i++) s += yield* doubleEffectOnly(i)
      return s
    }),
    loopCase("fast call, yields Exit", function* () {
      let s = 0, t
      for (let i = 0; i < N; i++) s += (t = exitFast(i), $isRun(t) ? yield* t : t)
      return s
    }),
    loopCase("$fast entry, yields Exit", function* () {
      let s = 0, t
      for (let i = 0; i < N; i++) s += (t = exitBounded(i), $isRun(t) ? yield* t : t)
      return s
    }),
    loopCase("Effect.fn, yields Exit", function* () {
      let s = 0
      for (let i = 0; i < N; i++) s += yield* viaExit(i)
      return s
    }),
    loopCase("fast call, suspends", function* () {
      let s = 0, t
      for (let i = 0; i < N; i++) s += (t = syncFast(i), $isRun(t) ? yield* t : t)
      return s
    }),
    loopCase("$fast entry, suspends", function* () {
      let s = 0, t
      for (let i = 0; i < N; i++) s += (t = syncBounded(i), $isRun(t) ? yield* t : t)
      return s
    }),
    loopCase("Effect.fn, suspends", function* () {
      let s = 0
      for (let i = 0; i < N; i++) s += yield* viaSync(i)
      return s
    })
  ]
})
