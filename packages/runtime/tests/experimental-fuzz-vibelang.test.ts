// What VibeLang adds to the upstream fuzz copy, and what the module promises
// its callers: a Schema goes where an Arbitrary does, a simulated execution is
// a pure function of its schedule tape, a failing corpus store is a FuzzError,
// and the module loads in Bun and in a realm with no Node globals.
import { expect, test } from "bun:test"
import fc from "fast-check"
import { execFileSync } from "node:child_process"
import { runInNewContext } from "node:vm"
import { Arbitrary, Clock, Effect, Exit, Ref, Schema } from "effect"
import { Fuzz, FuzzSimulation } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const Int = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))
const Ints = Schema.Array(Int)

test("Fuzz.run takes a Schema and gives the report of its Arbitrary", async () => {
  await checkProperty(fc, {
    name: "fuzz-schema-overload",
    rule: "VIP-70: `Fuzz.run` accepts a schema directly; the overload calls `Arbitrary.schema`",
    command: "bun test tests/experimental-fuzz-vibelang.test.ts",
    arbitrary: fc.record({ seed: fc.integer({ min: 0, max: 1_000_000 }), needle: fc.integer({ min: 0, max: 1000 }) }),
    numRuns: 20,
    check: async ({ seed, needle }: { seed: number; needle: number }) => {
      const property = (xs: ReadonlyArray<number>) => !xs.includes(needle)
      const options = { seed, executions: 300 }
      const fromSchema = await Effect.runPromise(Fuzz.run(Ints, property, options))
      const fromArbitrary = await Effect.runPromise(Fuzz.run(Arbitrary.schema(Ints), property, options))
      expect(fromSchema).toEqual(fromArbitrary)
    }
  })
  // A Schema value with a refinement is generated within it.
  const report = await Effect.runPromise(Fuzz.run(Int, (n) => n <= 1000 && n >= 0, { seed: 1, executions: 500 }))
  expect(report._tag).toBe("Passed")
})

// Fibers that each take a few steps, some after a virtual sleep. Every step
// logs the fiber, the step and the virtual time it ran at.
type Shape = ReadonlyArray<ReadonlyArray<number>>
const program = (shape: Shape, log: Array<string>) =>
  Effect.gen(function*() {
    const shared = yield* Ref.make(0)
    yield* Effect.all(
      shape.map((steps, fiber) =>
        Effect.forEach(steps, (sleep, step) =>
          Effect.gen(function*() {
            if (sleep > 0) yield* Effect.sleep(sleep)
            const seen = yield* Ref.get(shared)
            yield* Ref.set(shared, seen + 1)
            log.push(`${fiber}.${step}@${yield* Clock.currentTimeMillis}:${seen}`)
          }))
      ),
      { concurrency: "unbounded" }
    )
    return yield* Ref.get(shared)
  })

const simulate = async (shape: Shape, words: ReadonlyArray<number>) => {
  const log: Array<string> = []
  let read = 0
  const tape: Fuzz.ScheduleTape = { next: () => read < words.length ? words[read++] : 0 }
  const result = await Effect.runPromise(FuzzSimulation.execution().run(Effect.exit(program(shape, log)), tape))
  return { log, result, read }
}

test("a simulated execution is a function of its schedule tape: the same tape gives the same schedule and result", async () => {
  const schedules = new Set<string>()
  await checkProperty(fc, {
    name: "fuzz-simulation-deterministic",
    rule: "VIP-70: under `FuzzSimulation.execution()`, each execution has its own scheduler and a virtual clock",
    command: "bun test tests/experimental-fuzz-vibelang.test.ts",
    arbitrary: fc.record({
      shape: fc.array(fc.array(fc.constantFrom(0, 0, 1, 5, 1000), { minLength: 1, maxLength: 5 }), { minLength: 2, maxLength: 4 }),
      words: fc.array(fc.nat({ max: 0xffffffff }), { maxLength: 64 })
    }),
    numRuns: 100,
    check: async ({ shape, words }: { shape: Shape; words: ReadonlyArray<number> }) => {
      const first = await simulate(shape, words)
      const second = await simulate(shape, words)
      expect(second).toEqual(first)
      expect(first.result._tag).toBe("Completed")
      schedules.add(first.log.join(" "))
    }
  })
  // The property is not vacuous: different tapes and shapes gave different schedules.
  expect(schedules.size).toBeGreaterThan(10)
})

test("a lost update: one tape interleaves the read and write, the zero tape does not", async () => {
  const shape: Shape = [[0], [0]]
  const cooperative = await simulate(shape, [])
  expect(cooperative.log.map((line) => line.split(":")[1])).toEqual(["0", "1"])
  let lost = false
  for (let word = 1; word < 64 && !lost; word++) {
    const { log } = await simulate(shape, Array.from({ length: 16 }, (_, at) => (word * 0x9e3779b9 + at * 0x7f4a7c15) >>> 0))
    lost = log.every((line) => line.endsWith(":0"))
  }
  expect(lost).toBe(true)
})

test("a campaign under simulation is a function of its seed", async () => {
  const Amount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
  const conserved = ([a, b]: readonly [number, number]) =>
    Effect.gen(function*() {
      const balance = yield* Ref.make(100)
      const paid = yield* Ref.make(0)
      const withdraw = (amount: number) =>
        Effect.gen(function*() {
          const current = yield* Ref.get(balance)
          if (current < amount) return
          yield* Ref.set(balance, current - amount)
          yield* Ref.update(paid, (total) => total + amount)
        })
      yield* Effect.all([withdraw(a), withdraw(b)], { concurrency: 2 })
      return (yield* Ref.get(balance)) + (yield* Ref.get(paid)) === 100
    })
  await checkProperty(fc, {
    name: "fuzz-simulation-campaign-deterministic",
    rule: "VIP-70: a finding replays; the same seed gives the same search",
    command: "bun test tests/experimental-fuzz-vibelang.test.ts",
    arbitrary: fc.integer({ min: 0, max: 1_000_000 }),
    numRuns: 10,
    check: async (seed: number) => {
      const run = () =>
        Effect.runPromise(Fuzz.run(Schema.Tuple([Amount, Amount]), conserved, {
          seed,
          executions: 300,
          execution: FuzzSimulation.execution()
        }))
      const first = await run()
      expect(await run()).toEqual(first)
      if (first._tag === "Falsified") {
        const replayed = await Effect.runPromise(Fuzz.run(Schema.Tuple([Amount, Amount]), conserved, {
          replay: first.findings[0].replay,
          execution: FuzzSimulation.execution()
        }))
        expect(replayed._tag).toBe("Falsified")
        if (replayed._tag === "Falsified") expect(replayed.findings[0].input).toEqual(first.findings[0].input)
      }
    }
  })
})

// The injected faults: stores that fail. A run never reports a pass it could
// not keep, and never turns a store failure into a finding.
const header = (bytes: ReadonlyArray<number>) => !(bytes[0] === 7 && bytes[1] === 9)
const target = Fuzz.target(Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 }))), header, {
  id: "header",
  revision: "1"
})
const runWith = (store: Fuzz.Store) =>
  Effect.runPromiseExit(Effect.provideService(Fuzz.runTarget(target, { seed: 1, executions: 20_000 }), Fuzz.Corpus, store))
const failure = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true)
  const error = Exit.isFailure(exit) ? exit.cause.reasons.find((reason) => reason._tag === "Fail") : undefined
  return (error as { error: Fuzz.FuzzError } | undefined)?.error
}

test("a store whose load fails fails the run with its FuzzError", async () => {
  const error = failure(await runWith({
    load: () => Effect.fail(new Fuzz.FuzzError({ reason: "Corpus", message: "store offline" })),
    save: () => Effect.void
  }))
  expect([error?._tag, error?.reason, error?.message]).toEqual(["FuzzError", "Corpus", "store offline"])
})

test("a store whose save fails fails the run once the failure is confirmed", async () => {
  const saved: Array<string> = []
  const error = failure(await runWith({
    load: () => Effect.succeed([]),
    save: (_, entry) =>
      entry.kind === "Failure"
        ? Effect.fail(new Fuzz.FuzzError({ reason: "Corpus", message: "disk full" }))
        : Effect.sync(() => void saved.push(entry.key))
  }))
  expect([error?.reason, error?.message]).toEqual(["Corpus", "disk full"])
})

test("a store holding an unreadable entry is a Corpus error, not a skipped fixture", async () => {
  const error = failure(await runWith({
    load: () => Effect.succeed([{ kind: "Failure", key: "bad", text: "not a fuzz entry" }]),
    save: () => Effect.void
  }))
  expect(error?.reason).toBe("Corpus")
})

test("Bun runs the published module with virtual time", () => {
  const output = execFileSync("bun", [
    "--eval",
    `import { Fuzz, FuzzSimulation } from "vibelang-runtime/experimental"; import { Effect, Schema } from "effect"; const r = await Effect.runPromise(Fuzz.run(Schema.Literal(1), () => Effect.as(Effect.sleep("1 hour"), true), { executions: 3, execution: FuzzSimulation.execution() })); console.log(r._tag, r.stats.executions);`
  ], { encoding: "utf8", cwd: import.meta.dir })
  expect(output.trim()).toBe("Passed 3")
})

test("the module runs in a realm without Node globals", async () => {
  const built = await Bun.build({
    entrypoints: [new URL("./fixtures/fuzz-browser-entry.ts", import.meta.url).pathname],
    target: "browser",
    format: "iife"
  })
  expect(built.success).toBe(true)
  const realm: Record<string, unknown> = { TextEncoder, TextDecoder, setTimeout, clearTimeout, queueMicrotask, console }
  runInNewContext(await built.outputs[0].text(), realm)
  const report = await (realm.result as Promise<{ _tag: string; stats: { executions: number } }>)
  expect([report._tag, report.stats.executions]).toEqual(["Passed", 3])
})
