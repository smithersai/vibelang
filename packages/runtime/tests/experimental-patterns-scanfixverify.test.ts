import { expect, test } from "bun:test"
import fc from "fast-check"
import { Deferred, Effect, Fiber } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as ScanFixVerifyModule from "vibelang-runtime/experimental/patterns/ScanFixVerify"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { PatternError, ScanFixVerify } = Patterns

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

// Each round's scan returns the script's issues for that round, and every
// stage records its call.
const scripted = (rounds: ReadonlyArray<ReadonlyArray<string>>, called: Array<string>) => ({
  scan: ({ iteration }: { readonly iteration: number }) =>
    Effect.sync(() => (called.push(`scan/${iteration}`), rounds[iteration - 1] ?? [])),
  fix: ({ issue, index, iteration }: { readonly issue: string; readonly index: number; readonly iteration: number }) =>
    Effect.sync(() => (called.push(`fix/${iteration}/${index}`), `fixed ${issue}`)),
  verify: ({ fixes, iteration }: { readonly fixes: ReadonlyArray<string>; readonly iteration: number }) =>
    Effect.sync(() => (called.push(`verify/${iteration}`), { fixes, iteration, resolved: true }))
})

test("ScanFixVerify: the pattern subpath and the Experimental namespace export the same module", () => {
  expect(ScanFixVerifyModule.run).toBe(ScanFixVerify.run)
})

test("ScanFixVerify.run fixes only the issues the scan returned and stops on a clean rescan", async () => {
  const called: Array<string> = []
  const report = await run(ScanFixVerify.run("repo", { ...scripted([["issue-a"], []], called), maxRetries: 2, maxIssues: 3, concurrency: 3 }))
  expect(called).toEqual(["scan/1", "fix/1/0", "verify/1", "scan/2"])
  expect(report).toEqual({
    iterations: 2,
    remaining: [],
    resolved: true,
    verifications: [{ fixes: ["fixed issue-a"], iteration: 1, resolved: true }]
  })
})

test("ScanFixVerify.run never fixes or verifies when the first scan is clean", async () => {
  const called: Array<string> = []
  const report = await run(ScanFixVerify.run("repo", { ...scripted([], called), maxRetries: 2, maxIssues: 3, concurrency: 3 }))
  expect(called).toEqual(["scan/1"])
  expect(report).toEqual({ iterations: 1, remaining: [], resolved: true, verifications: [] })
})

test("ScanFixVerify.run reports the remaining issues and every verification at the retry bound", async () => {
  const called: Array<string> = []
  const seen: Array<unknown> = []
  const stages = scripted([["issue-a", "issue-b"], ["issue-b"]], called)
  const report = await run(ScanFixVerify.run("repo", {
    ...stages,
    scan: (args) => Effect.sync(() => seen.push(args)).pipe(Effect.andThen(stages.scan(args))),
    maxRetries: 2,
    maxIssues: 3,
    concurrency: 3
  }))
  expect([...called].sort()).toEqual(["fix/1/0", "fix/1/1", "fix/2/0", "scan/1", "scan/2", "verify/1", "verify/2"])
  expect(seen).toEqual([{ input: "repo", iteration: 1 }, { input: "repo", iteration: 2 }])
  expect(report).toEqual({
    iterations: 2,
    remaining: ["issue-b"],
    resolved: false,
    verifications: [
      { fixes: ["fixed issue-a", "fixed issue-b"], iteration: 1, resolved: true },
      { fixes: ["fixed issue-b"], iteration: 2, resolved: true }
    ]
  })
})

test("ScanFixVerify.run fixes at most maxIssues issues a round and hands verify the scan and its fixes", async () => {
  const called: Array<string> = []
  const verified: Array<unknown> = []
  const stages = scripted([["a", "b", "c"], ["c"], []], called)
  const report = await run(ScanFixVerify.run("repo", {
    ...stages,
    verify: (args) => Effect.sync(() => (verified.push({ issues: args.issues, fixes: args.fixes }), args.iteration)),
    maxRetries: 3,
    maxIssues: 2,
    concurrency: 1
  }))
  expect(called).toEqual(["scan/1", "fix/1/0", "fix/1/1", "scan/2", "fix/2/0", "scan/3"])
  expect(verified).toEqual([
    { issues: ["a", "b", "c"], fixes: ["fixed a", "fixed b"] },
    { issues: ["c"], fixes: ["fixed c"] }
  ])
  expect(report).toEqual({ iterations: 3, remaining: [], resolved: true, verifications: [1, 2] })
})

test("ScanFixVerify.run bounds fixes in flight and holds the next batch until the whole batch is done", async () => {
  const program = Effect.gen(function*() {
    const concurrency = 2
    const gates = yield* Effect.all([Deferred.make<void>(), Deferred.make<void>(), Deferred.make<void>()])
    const arrivals = yield* Effect.all([Deferred.make<void>(), Deferred.make<void>(), Deferred.make<void>()])
    const finished = yield* Effect.all([Deferred.make<void>(), Deferred.make<void>(), Deferred.make<void>()])
    const started: Array<number> = []
    let inFlight = 0
    let peak = 0
    const fiber = yield* Effect.forkChild(
      ScanFixVerify.run("repo", {
        scan: ({ iteration }) => Effect.succeed(iteration === 1 ? ["a", "b", "c"] : []),
        fix: ({ issue, index }) =>
          Effect.gen(function*() {
            started.push(index)
            inFlight += 1
            peak = Math.max(peak, inFlight)
            yield* Deferred.succeed(arrivals[index]!, undefined)
            yield* Deferred.await(gates[index]!)
            inFlight -= 1
            yield* Deferred.succeed(finished[index]!, undefined)
            return `fixed ${issue}`
          }),
        verify: () => Effect.succeed(true),
        maxRetries: 2,
        maxIssues: 3,
        concurrency
      }),
      { startImmediately: true }
    )
    yield* Effect.all([Deferred.await(arrivals[0]!), Deferred.await(arrivals[1]!)])
    const saturated = { inFlight, peak, started: [...started], third: yield* Deferred.isDone(arrivals[2]!) }
    yield* Deferred.succeed(gates[0]!, undefined)
    yield* Deferred.await(finished[0]!)
    // A batch waits for every member, even after one slot is free.
    const afterOne = yield* Deferred.isDone(arrivals[2]!)
    yield* Deferred.succeed(gates[1]!, undefined)
    yield* Deferred.await(arrivals[2]!)
    const secondDone = yield* Deferred.isDone(finished[1]!)
    yield* Deferred.succeed(gates[2]!, undefined)
    const report = yield* Fiber.join(fiber)
    return { saturated, afterOne, secondDone, report, started, inFlight, peak }
  })
  const observed = await run(program)
  expect(observed.saturated).toEqual({ inFlight: 2, peak: 2, started: [0, 1], third: false })
  expect(observed.afterOne).toBe(false)
  expect(observed.secondDone).toBe(true)
  expect(observed.report).toMatchObject({ iterations: 2, remaining: [], resolved: true })
  expect(observed.started).toEqual([0, 1, 2])
  expect(observed.inFlight).toBe(0)
  expect(observed.peak).toBe(2)
})

test("ScanFixVerify.run refuses bounds that are not positive safe integers", async () => {
  const stages = scripted([], [])
  const options = { ...stages, maxRetries: 1, maxIssues: 1, concurrency: 1 }
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    for (const invalid of [{ ...options, maxRetries: value }, { ...options, maxIssues: value }, { ...options, concurrency: value }]) {
      const failure = await run(Effect.flip(ScanFixVerify.run("repo", invalid)))
      expect(failure).toBeInstanceOf(PatternError)
      expect(failure).toMatchObject({
        code: "invalid_decorator",
        message: "ScanFixVerify maxRetries, maxIssues, and concurrency must be positive safe integers"
      })
    }
  }
})

test("ScanFixVerify.resolved reads true or an own resolved: true only", () => {
  expect(ScanFixVerify.resolved(true)).toBe(true)
  expect(ScanFixVerify.resolved({ resolved: true })).toBe(true)
  expect(ScanFixVerify.resolved(false)).toBe(false)
  expect(ScanFixVerify.resolved(Object.create({ resolved: true }))).toBe(false)
  expect(ScanFixVerify.resolved("resolved")).toBe(false)
  expect(ScanFixVerify.resolved({ resolved: "true" })).toBe(false)
  expect(ScanFixVerify.resolved(undefined)).toBe(false)
})

test("ScanFixVerify.run reads its options at the call, not when the Effect runs", async () => {
  const called: Array<string> = []
  const options = { ...scripted([["a"], ["a"]], called), maxRetries: 1, maxIssues: 1, concurrency: 1 }
  const program = ScanFixVerify.run("repo", options)
  options.maxRetries = 0
  options.fix = () => Effect.succeed("swapped")
  expect(await run(program)).toMatchObject({ iterations: 1, resolved: false, remaining: ["a"] })
  expect(called).toEqual(["scan/1", "fix/1/0", "verify/1"])
})

test("property: a scan-fix-verify loop fixes min(issues, maxIssues) issues a round and ends resolved exactly when a scan came back clean in the bound", async () => {
  await checkProperty(fc, {
    name: "patterns-scan-fix-verify-rounds",
    rule: "VIP-73: ScanFixVerify.run scans for issues, fixes them concurrently, verifies, and repeats until clean",
    command: "bun test tests/experimental-patterns-scanfixverify.test.ts",
    arbitrary: fc.record({
      counts: fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 5 }),
      maxRetries: fc.integer({ min: 1, max: 5 }),
      maxIssues: fc.integer({ min: 1, max: 4 }),
      concurrency: fc.integer({ min: 1, max: 3 })
    }),
    numRuns: 200,
    check: async ({ counts, maxRetries, maxIssues, concurrency }: { readonly counts: ReadonlyArray<number>; readonly maxRetries: number; readonly maxIssues: number; readonly concurrency: number }) => {
      const fixedPerRound: Array<number> = []
      const report = await run(ScanFixVerify.run(null, {
        scan: ({ iteration }) => Effect.succeed(Array.from({ length: counts[iteration - 1] ?? 0 }, (_, index) => index)),
        fix: ({ issue }) => Effect.succeed(issue),
        verify: ({ fixes }) => Effect.sync(() => fixedPerRound.push(fixes.length)),
        maxRetries,
        maxIssues,
        concurrency
      }))
      const rounds = [...counts, 0].slice(0, maxRetries)
      const clean = rounds.indexOf(0)
      expect(report.resolved).toBe(clean !== -1)
      expect(report.iterations).toBe(clean === -1 ? maxRetries : clean + 1)
      const worked = clean === -1 ? rounds : rounds.slice(0, clean)
      expect(fixedPerRound).toEqual(worked.map((count) => Math.min(count, maxIssues)))
      expect(report.verifications).toHaveLength(worked.length)
    }
  })
})
