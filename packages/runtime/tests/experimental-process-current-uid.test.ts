import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as fc from "fast-check"
import { fileURLToPath } from "node:url"
import { Process } from "vibelang-runtime/experimental"
import { ExperimentalNodeProcess } from "vibelang-runtime/experimental/platform-node"
import corpus from "./fixtures/foldkit-relay-trust-optional-current-uid.json"

const withUid = <A>(get: () => (() => number) | undefined, body: () => A): A => {
  const old = Object.getOwnPropertyDescriptor(process, "getuid")
  Object.defineProperty(process, "getuid", { configurable: true, get })
  try { return body() } finally {
    if (old) Object.defineProperty(process, "getuid", old)
    else delete (process as { getuid?: unknown }).getuid
  }
}
const service = () => Effect.runSync(Effect.provide(Effect.service(Process.Process), ExperimentalNodeProcess.layer))
const uid = fc.option(fc.integer({ min: 0, max: 0xffffffff }), { nil: undefined })

// VIP-33 section2: "What Effect lacks goes under Experimental.X".
// Native optional-call oracle: preserve unavailable undefined, valid uid0,
// receiver binding, fresh lookup and the exact thrown value. No environment or
// file-owner inference, normalization, cached identity or error wrapping.
test("Process.currentUid: seeded optional native lookup is cold and fresh", () => {
  fc.assert(fc.property(fc.array(uid, { minLength: 1, maxLength: 8 }), (values) => {
    let current: number | undefined
    let lookups = 0, calls = 0
    let receiver = true
    withUid(() => {
      lookups++
      return current === undefined ? undefined : function(this: object) {
        calls++; receiver &&= this === process; return current!
      }
    }, () => {
      const currentProcess = service()
      expect(lookups).toBe(0)
      expect(Effect.isEffect(currentProcess.currentUid)).toBe(true)
      const query = currentProcess.currentUid
      expect(lookups).toBe(0)
      for (const value of values) {
        current = value
        expect(Effect.runSync(query)).toBe(value)
      }
      expect(lookups).toBe(values.length)
      expect(calls).toBe(values.filter((v) => v !== undefined).length)
      expect(receiver).toBe(true)
    })
  }), { numRuns: 150, seed: 160033 })
})

const thrown = fc.oneof(fc.anything(), fc.constant(new Error("owned uid probe")), fc.constant(undefined))
const assertFailure = (query: Effect.Effect<number | undefined, unknown>, witness: unknown) => {
  let caught = false
  let observed: unknown
  const result = Effect.runSync(Effect.catch(query, (error) => Effect.sync(() => {
    caught = true; observed = error; return undefined
  })))
  expect(caught).toBe(true)
  expect(observed).toBe(witness)
  expect(result).toBeUndefined()
}

test("Process.currentUid: generated method errors are raw typed failures", () => {
  fc.assert(fc.property(thrown, (witness) => {
    let calls = 0
    let receiver = false
    withUid(() => function(this: object) { calls++; receiver = this === process; throw witness }, () => {
      const query = service().currentUid
      expect(calls).toBe(0)
      expect(Effect.isEffect(query)).toBe(true)
      assertFailure(query, witness)
      expect(calls).toBe(1)
      expect(receiver).toBe(true)
    })
  }), { numRuns: 150, seed: 160034 })
})

test("Process.currentUid: generated property getter errors remain classifiable", () => {
  fc.assert(fc.property(thrown, (witness) => {
    let reads = 0
    withUid(() => { reads++; throw witness }, () => {
      const query = service().currentUid
      expect(reads).toBe(0)
      expect(Effect.isEffect(query)).toBe(true)
      assertFailure(query, witness)
      expect(reads).toBe(1)
    })
  }), { numRuns: 100, seed: 160035 })
})

test("Process.currentUid: fake absence, root uid and generated overrides never infer identity", () => {
  const read = Effect.flatMap(Effect.service(Process.Process), (current) => current.currentUid)
  expect(Effect.runSync(Effect.provide(read, Process.layerTest()))).toBeUndefined()
  expect(Effect.runSync(Effect.provide(read, Process.layerTest({ currentUid: Effect.succeed(0) })))).toBe(0)
  fc.assert(fc.property(uid, (value) => {
    expect(Effect.runSync(Effect.provide(read, Process.layerTest({ currentUid: Effect.succeed(value) })))).toBe(value)
  }), { numRuns: 100, seed: 160036 })
  const error = { code: "UID_PROBE_UNVERIFIED" }
  assertFailure(Effect.provide(read, Process.layerTest({ currentUid: Effect.fail(error) })), error)
})

test("Process.currentUid: Node/Bun execute the consumed relay-trust corpus without printing identity", () => {
  const fixture = fileURLToPath(new URL("./fixtures/process-native-uid.mjs", import.meta.url))
  for (const runtime of ["node", "bun"]) for (const witness of corpus.cases) {
    const child = Bun.spawnSync([runtime, fixture, witness.mode], { stdout: "pipe", stderr: "pipe", timeout: 15_000 })
    expect(child.exitCode).toBe(0)
    expect(child.stderr.toString()).toBe("")
    expect(JSON.parse(child.stdout.toString())).toEqual({ matchesNative: true, rawFailure: true })
  }
}, 60_000)
