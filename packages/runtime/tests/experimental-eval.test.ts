import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fc from "fast-check"
import { Context, Effect, Exit, Layer } from "effect"
import { Eval, Scorer } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const greet = (name: string) => Effect.succeed(`Hello, ${name}`)

// The VIP-69 example: a scorer from a record type, one case, a gate.
const polite = Scorer.make({
  name: "polite",
  version: "1",
  score: (run: { output: string; expected: string }) => run.output === run.expected ? 1 : 0
})

const greetSuite = Eval.suite("greet", {
  target: greet,
  cases: [{ name: "ada", input: ["Ada"], expected: "Hello, Ada" }],
  scorers: [polite],
  gate: { min: 1, tolerance: 0 }
})

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const failure = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) throw new Error("expected a failure")
  const reason = exit.cause.reasons[0]
  if (reason?._tag !== "Fail") throw new Error(`expected a typed failure, got ${reason?._tag}`)
  return reason.error
}

const gateAgainst = (committed: string, suite: Eval.Suite<any, any, never>) =>
  Effect.gen(function*() {
    const result = yield* Eval.run(suite)
    const report = yield* Eval.compare(yield* Eval.load(committed), result)
    return Eval.gate(report, suite.gate)
  })

test("the VIP example runs, writes a baseline and passes its gate", async () => {
  const result = await run(Eval.run(greetSuite, { runId: "nightly" }))
  expect(result.runId).toBe("nightly")
  expect(result.observations).toHaveLength(1)
  const [observation] = result.observations
  expect(observation).toMatchObject({ case: "ada", kind: "score", score: 1, scorer: polite.scorerKey, scorerName: "polite" })
  const committed = Eval.write(await run(Eval.baseline(result)))
  expect(committed.split("\n")).toHaveLength(4)
  const grade = await run(gateAgainst(committed, greetSuite))
  expect(grade).toMatchObject({ exitCode: 0, summary: "passed" })
})

test("a score that drops on a different answer is a regression and exits 1", async () => {
  const committed = Eval.write(await run(Eval.run(greetSuite).pipe(Effect.flatMap(Eval.baseline))))
  const rude = Eval.suite("greet", { ...greetSuite, target: (name: string) => Effect.succeed(`Go away, ${name}`) })
  const report = await run(Effect.gen(function*() {
    return yield* Eval.compare(yield* Eval.load(committed), yield* Eval.run(rude))
  }))
  expect(report.regressions).toHaveLength(1)
  expect(report.regressions[0]!.drop).toBe(1)
  expect(report.nondeterminism).toHaveLength(0)
  const grade = Eval.gate(report, { min: 0 })
  expect(grade.exitCode).toBe(1)
  expect(grade.summary).toContain("regression for ada/polite")
})

test("a score that moves on the same answer is nondeterminism, not a regression", async () => {
  let calls = 0
  const flaky = Scorer.make({ name: "flaky", version: "1", score: () => calls++ === 0 ? 1 : 0.5 })
  const suite = Eval.suite("flaky", { target: greet, cases: [{ name: "ada", input: ["Ada"] }], scorers: [flaky] })
  const committed = Eval.write(await run(Eval.run(suite).pipe(Effect.flatMap(Eval.baseline))))
  const report = await run(Effect.gen(function*() {
    return yield* Eval.compare(yield* Eval.load(committed), yield* Eval.run(suite))
  }))
  expect(report.regressions).toHaveLength(0)
  expect(report.nondeterminism.map((item) => item.delta)).toEqual([-0.5])
  expect(Eval.gate(report).exitCode).toBe(1)
  expect(Eval.gate(report, { tolerance: 0.5 }).exitCode).toBe(0)
})

test("a score missing from either side exits 1", async () => {
  const committed = Eval.write(await run(Eval.run(greetSuite).pipe(Effect.flatMap(Eval.baseline))))
  const renamed = Eval.suite("greet", { ...greetSuite, scorers: [Scorer.make({ ...polite, version: "2", score: () => 1 })] })
  const report = await run(Effect.gen(function*() {
    return yield* Eval.compare(yield* Eval.load(committed), yield* Eval.run(renamed))
  }))
  expect(report.missing.map((item) => item.side).sort()).toEqual(["baseline", "run"])
  const grade = Eval.gate(report)
  expect(grade.exitCode).toBe(1)
  expect(grade.summary).toContain("missing run score for ada/polite")
})

// An injected faulty service: the judge a scorer depends on is unreachable.
interface JudgeShape {
  readonly grade: (text: string) => Effect.Effect<number, Error>
}
const Judge = Context.Service<JudgeShape>("test/Eval/Judge")
const judged = Scorer.make({
  name: "judged",
  version: "1",
  score: (run: { output: string }) =>
    Effect.gen(function*() {
      const judge = yield* Judge
      return yield* judge.grade(run.output)
    })
})
const judgedSuite = Eval.suite("judged", { target: greet, cases: [{ name: "ada", input: ["Ada"] }], scorers: [judged] })

test("a scorer that fails records an inconclusive observation, never a zero, and the gate exits 5", async () => {
  const down = Layer.succeed(Judge, { grade: () => Effect.fail(new Error("judge unreachable")) })
  const result = await run(Eval.run(judgedSuite).pipe(Effect.provide(down)))
  expect(result.observations).toEqual([
    expect.objectContaining({ kind: "inconclusive", code: "inconclusive", reason: expect.stringContaining("judge unreachable") })
  ])
  const baseline = await run(Eval.baseline(result))
  expect(baseline.records).toHaveLength(0)
  const report = await run(Eval.compare(baseline, result))
  const grade = Eval.gate(report, { min: 0 })
  expect(grade.exitCode).toBe(5)
  const up = Layer.succeed(Judge, { grade: () => Effect.succeed(0.75) })
  const healthy = await run(Eval.run(judgedSuite).pipe(Effect.provide(up)))
  expect(healthy.observations).toEqual([expect.objectContaining({ kind: "score", score: 0.75 })])
})

test("a score outside [0, 1] is refused as invalid_score", async () => {
  for (const value of [1.5, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const bad = Scorer.make({ name: "bad", version: "1", score: () => value })
    const suite = Eval.suite("bad", { target: greet, cases: [{ name: "ada", input: ["Ada"] }], scorers: [bad] })
    const result = await run(Eval.run(suite))
    expect(result.observations[0]).toMatchObject({ kind: "inconclusive", code: "invalid_score" })
  }
})

test("a target that fails is a failed case: no scores, the run succeeds, the gate exits 1", async () => {
  const broken = Eval.suite("greet", {
    ...greetSuite,
    target: (name: string) => name === "Bob" ? Effect.fail(new Error("no Bob\ntoday")) : greet(name),
    cases: [...greetSuite.cases, { name: "bob", input: ["Bob"], expected: "Hello, Bob" }]
  })
  const result = await run(Eval.run(broken))
  const bob = result.cases.find((item) => item.case === "bob")!
  expect(bob.error).toMatchObject({ code: "target", path: "cases['bob']" })
  expect(bob.error!.message).toBe("Target failed for case 'bob': no Bob today")
  expect(bob.observations).toHaveLength(0)
  const report = await run(Eval.compare(await run(Eval.baseline(result)), result))
  const grade = Eval.gate(report)
  expect(grade.exitCode).toBe(1)
  expect(grade.summary).toContain("target failed for case 'bob'")
})

test("a defect in a target or scorer stays in its case", async () => {
  const dies = Eval.suite("dies", {
    target: (name: string) => Effect.sync(() => { if (name === "x") throw new Error("boom"); return name }),
    cases: [{ name: "x", input: ["x"] }, { name: "y", input: ["y"] }],
    scorers: [Scorer.make({ name: "throws", version: "1", score: (): number => { throw new Error("scorer boom") } })]
  })
  const result = await run(Eval.run(dies))
  expect(result.cases[0]!.error?.message).toContain("boom")
  expect(result.cases[1]!.observations[0]).toMatchObject({ kind: "inconclusive", reason: expect.stringContaining("scorer boom") })
})

test("a scorer's identity hashes its name, version and canonical config", () => {
  const a = Scorer.make({ name: "s", version: "1", config: { b: 1, a: [1, 2] }, score: () => 1 })
  const b = Scorer.make({ name: "s", version: "1", config: { a: [1, 2], b: 1 }, score: () => 0 })
  expect(a.scorerKey).toMatch(/^[0-9a-f]{64}$/)
  expect(b.scorerKey).toBe(a.scorerKey)
  expect(Scorer.make({ name: "s", version: "2", config: { a: [1, 2], b: 1 }, score: () => 1 }).scorerKey).not.toBe(a.scorerKey)
  expect(Scorer.make({ name: "s", version: "1", config: { a: [2, 1], b: 1 }, score: () => 1 }).scorerKey).not.toBe(a.scorerKey)
  expect(Scorer.make({ name: "t", version: "1", config: { a: [1, 2], b: 1 }, score: () => 1 }).scorerKey).not.toBe(a.scorerKey)
})

test("a declaration with no stable identity never throws, and run refuses it", async () => {
  for (const options of [
    { name: "", version: "1" },
    { name: "s", version: " " },
    { name: "s", version: "1", config: { f: () => 1 } },
    { name: "s", version: "1", config: { gone: undefined } },
    { name: "s", version: "1", config: { when: new Date(0) } },
    { name: "s‮", version: "1" }
  ]) {
    const scorer = Scorer.make({ ...options, score: () => 1 })
    expect(scorer.problem).toBeString()
    expect(scorer.scorerKey).toBe("")
    const error = await failure(Eval.run(Eval.suite("s", { target: greet, cases: [{ name: "a", input: ["a"] }], scorers: [scorer] })))
    expect(error).toMatchObject({ _tag: "EvalError", code: "invalid_suite", path: "scorers[0]" })
  }
})

test("run validates the suite and names the field", async () => {
  const cases = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `c${index}`, input: ["x"] as [string] }))
  const refused = async (suite: Eval.Suite<any, any, never>, path: string) =>
    expect(await failure(Eval.run(suite))).toMatchObject({ code: "invalid_suite", path })
  await refused(Eval.suite(" ", { target: greet, cases: cases(1), scorers: [] }), "name")
  await refused(Eval.suite("s", { target: greet, cases: [], scorers: [] }), "cases")
  await refused(Eval.suite("s", { target: greet, cases: cases(10_001), scorers: [] }), "cases")
  await refused(Eval.suite("s", { target: greet, cases: [...cases(1), ...cases(1)], scorers: [] }), "cases[1].name")
  await refused(Eval.suite("s", { target: greet, cases: cases(1), scorers: [], concurrency: 1_025 }), "concurrency")
  await refused(Eval.suite("s", { target: greet, cases: cases(1), scorers: [], trials: 0 }), "trials")
  await refused(Eval.suite("s", { target: greet, cases: cases(1), scorers: [polite, polite] }), "scorers[1]")
  await refused(Eval.suite("s", { target: greet, cases: cases(1), scorers: [], gate: { min: 2 } }), "gate.min")
  expect(Eval.limits).toMatchObject({ cases: 10_000, concurrency: 1_024 })
  await run(Eval.run(Eval.suite("s", { target: greet, cases: cases(10_000), scorers: [], concurrency: 1_024 })))
})

test("exact, contains and checks grade text", async () => {
  const score = (scorer: Scorer.Scorer<any>, output: unknown, expected?: unknown) =>
    Effect.runPromiseExit(scorer.score({ input: [], output, expected }))
  expect(await score(Scorer.exact, "  Hello,\n  Ada ", "Hello, Ada")).toEqual(Exit.succeed({ score: 1, reason: "Text matches" }))
  expect(await score(Scorer.exact, { b: 1, a: 2 }, { a: 2, b: 1 })).toEqual(Exit.succeed({ score: 1, reason: "Values match" }))
  expect(Exit.isFailure(await score(Scorer.exact, "x"))).toBe(true)
  expect(await score(Scorer.contains("Ada"), "Hello, Ada")).toEqual(Exit.succeed({ score: 1 }))
  expect(await score(Scorer.contains(), "Hello, Ada", "Bob")).toEqual(Exit.succeed({ score: 0 }))
  expect(Scorer.contains("a").scorerKey).not.toBe(Scorer.contains("b").scorerKey)
  const tone = Scorer.checks([
    { includes: ["refund*", ["order", "purchase"]] },
    { excludes: ["sorry", "/as an ai/i"] },
    { words: { max: 12 } },
    { excludesOpener: ["Great question"] },
    { complete: true }
  ])
  const good = await run(tone.score({ output: "Your refunds for the order are on their way." }))
  expect(good.score).toBe(1)
  const bad = await run(tone.score({ output: "Great question! Sorry, the purchase was not refunded because..." }))
  expect(bad.score).toBeCloseTo(2 / 5)
  expect(bad.reason).toContain("excludes: found: \"Sorry\"")
  expect(Scorer.checks([{ includes: ["/(/"] }]).problem).toContain("invalid pattern")
  expect(Scorer.checks([{ words: { max: -1 } }]).problem).toBeString()
})

test("fromJsonLines reads cases and refuses malformed lines", async () => {
  const lines = "﻿{\"name\":\"ada\",\"input\":[\"Ada\"],\"expected\":\"Hello, Ada\"}\n\n{\"name\":\"bob\",\"input\":[\"Bob\"]}\r\n"
  const suite = await run(Eval.fromJsonLines(lines, { name: "greet", target: greet, scorers: [Scorer.exact] }))
  expect(suite.cases.map((item) => item.name)).toEqual(["ada", "bob"])
  const result = await run(Eval.run(suite))
  expect(result.observations.map((item) => item.kind)).toEqual(["score", "inconclusive"])
  expect(await failure(Eval.fromJsonLines("{\"name\":\"a\",\"input\":\"Ada\"}", { name: "g", target: greet, scorers: [] })))
    .toMatchObject({ code: "invalid_suite", path: "line[1].input" })
  expect(await failure(Eval.fromJsonLines("{oops", { name: "g", target: greet, scorers: [] })))
    .toMatchObject({ code: "invalid_suite", path: "line[1]" })
})

test("a Smithers baseline loads, and a bad one is refused with its path", async () => {
  const smithers = JSON.stringify({
    records: [{ case: "ada", scorer: "k", stepKey: "s", suite: "greet", score: 0.875 }],
    suite: "greet",
    version: 1
  }, null, 2)
  expect((await run(Eval.load(smithers))).records).toEqual([{ suite: "greet", case: "ada", scorer: "k", stepKey: "s", score: 0.875 }])
  expect(await failure(Eval.load("{\"version\":2,\"records\":[]}"))).toMatchObject({ code: "invalid_baseline", path: "version" })
  expect(await failure(Eval.load(smithers.replace("0.875", "1.5")))).toMatchObject({ path: "records[0].score" })
  expect(await failure(Eval.load(smithers.replace("\"ada\"", "\"a\\u0007\"")))).toMatchObject({ path: "records[0].case" })
  const other = await run(Eval.load(smithers.replaceAll("greet", "other")))
  expect(await failure(Eval.compare(other, await run(Eval.run(greetSuite))))).toMatchObject({ code: "invalid_baseline" })
})

test("trials run each case again and report pass@k", async () => {
  let call = 0
  const coin = Eval.suite("coin", {
    target: () => Effect.sync(() => call++ % 2 === 0 ? "heads" : "tails"),
    cases: [{ name: "flip", input: [], expected: "heads" }],
    scorers: [Scorer.exact],
    trials: 4
  })
  const result = await run(Eval.run(coin, { k: 2 }))
  expect(call).toBe(4)
  expect(result.cases[0]!.trials).toMatchObject({ n: 4, passes: 2, rate: 0.5 })
  expect(result.cases[0]!.trials.passAtK).toBeCloseTo(5 / 6)
  expect(result.observations).toHaveLength(4)
  expect(await failure(Eval.run(coin, { k: 5 }))).toMatchObject({ code: "invalid_run_options" })
})

test("passAtK matches the unbiased estimator and refuses impossible counts", () => {
  expect(Eval.passAtK(10, 0, 3)).toBe(0)
  expect(Eval.passAtK(10, 10, 1)).toBe(1)
  expect(Eval.passAtK(5, 2, 2)).toBeCloseTo(1 - (3 / 5) * (2 / 4))
  expect(Eval.passAtK(3, 4, 1)).toBeNaN()
  expect(Eval.passAtK(3, 1, 4)).toBeNaN()
})

test("property: passAtK is a probability that rises with passes and with k", async () => {
  await checkProperty(fc, {
    name: "eval-pass-at-k",
    rule: "VIP-69: Eval.passAtK(n, c, k) is the chance at least one of k trials passes",
    command: "bun test tests/experimental-eval.test.ts",
    arbitrary: fc.integer({ min: 1, max: 60 }).chain((n) =>
      fc.record({ n: fc.constant(n), c: fc.integer({ min: 0, max: n }), k: fc.integer({ min: 1, max: n }) })
    ),
    check: ({ n, c, k }: { n: number; c: number; k: number }) => {
      const p = Eval.passAtK(n, c, k)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1 + 1e-12)
      if (c < n) expect(Eval.passAtK(n, c + 1, k)).toBeGreaterThanOrEqual(p - 1e-12)
      if (k < n) expect(Eval.passAtK(n, c, k + 1)).toBeGreaterThanOrEqual(p - 1e-12)
      expect(p).toBeCloseTo(k === 1 ? c / n : p)
    },
    numRuns: 300
  })
})

const recordArbitrary = fc.record({
  case: fc.string({ minLength: 1, maxLength: 6 }).filter((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value)),
  scorer: fc.constantFrom("k1", "k2"),
  stepKey: fc.constantFrom("s1", "s2"),
  score: fc.double({ min: 0, max: 1, noNaN: true })
})

test("property: a written baseline loads back to the same records, and writing is idempotent", async () => {
  await checkProperty(fc, {
    name: "eval-baseline-round-trip",
    rule: "VIP-69: Eval.write gives text Eval.load reads back unchanged",
    command: "bun test tests/experimental-eval.test.ts",
    arbitrary: fc.array(recordArbitrary, { maxLength: 12 }),
    check: async (records: ReadonlyArray<{ case: string; scorer: string; stepKey: string; score: number }>) => {
      const baseline: Eval.Baseline = { version: 1, suite: "s", records: records.map((record) => ({ suite: "s", ...record })) }
      const written = Eval.write(baseline)
      const loaded = await run(Eval.load(written))
      expect(Eval.write(loaded)).toBe(written)
      expect(loaded.records.length).toBe(records.length)
      expect([...loaded.records.map((record) => record.score)].sort()).toEqual(
        [...records.map((record) => Object.is(record.score, -0) ? 0 : record.score)].sort()
      )
    },
    numRuns: 200
  })
})

// A run built from generated observations and case failures, for the gate.
const fakeRun = (
  scores: ReadonlyArray<{ case: string; value: number | null }>,
  failedCases: ReadonlyArray<string>
): Eval.RunResult => {
  const observations: Array<Eval.Observation> = scores.map((item) =>
    item.value === null
      ? { case: item.case, scorer: "k", stepKey: "s", at: "t", kind: "inconclusive", code: "inconclusive", reason: "down" }
      : { case: item.case, scorer: "k", stepKey: "s", at: "t", kind: "score", score: item.value }
  )
  const names = [...new Set([...scores.map((item) => item.case), ...failedCases])]
  const summary = { n: 1, passes: 0, rate: 0, passAt1: 0, passAtK: 0, passHatK: 0, stderr: 0 }
  return {
    runId: "r",
    suite: "s",
    at: "t",
    cases: names.map((name) => ({
      case: name,
      observations: observations.filter((item) => item.case === name),
      trials: summary,
      ...(failedCases.includes(name) ? { error: new Eval.EvalError({ code: "target", message: "down" }) } : {})
    })),
    observations,
    trials: { cases: names.length, passAt1: 0, passAtK: 0, passHatK: 0, allPass: 0, perCase: {} },
    k: 1
  }
}

test("property: a gate is pure, and a partial pass never exits 0", async () => {
  await checkProperty(fc, {
    name: "eval-gate-partial-pass",
    rule: "VIP-69 rules 6 and 7: a gate is pure; 0 only when every case cleared it; 5 when it could not decide",
    command: "bun test tests/experimental-eval.test.ts",
    arbitrary: fc.record({
      scores: fc.array(
        fc.record({ case: fc.constantFrom("a", "b", "c"), value: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }) }),
        { maxLength: 8 }
      ),
      failed: fc.subarray(["a", "b", "c"]),
      min: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined })
    }),
    check: async ({ scores, failed, min }: {
      scores: ReadonlyArray<{ case: string; value: number | null }>
      failed: ReadonlyArray<string>
      min: number | undefined
    }) => {
      const result = fakeRun(scores, failed)
      const baseline = await run(Eval.baseline(result))
      const report = await run(Eval.compare(baseline, result))
      const options = min === undefined ? {} : { min }
      const grade = Eval.gate(report, options)
      expect(Eval.gate(report, options)).toEqual(grade)
      const values = scores.flatMap((item) => item.value === null ? [] : [item.value])
      const partial = failed.length > 0 || scores.some((item) => item.value === null) || values.length === 0 ||
        (min !== undefined && values.some((value) => value < min))
      if (partial) expect(grade.exitCode).not.toBe(0)
      else expect(grade.exitCode).toBe(0)
      if (failed.length > 0 || (min !== undefined && values.some((value) => value < min))) expect(grade.exitCode).toBe(1)
    },
    numRuns: 300
  })
})

test("an invalid gate threshold cannot decide: exit 5", async () => {
  const report = await run(Effect.gen(function*() {
    const result = yield* Eval.run(greetSuite)
    return yield* Eval.compare(yield* Eval.baseline(result), result)
  }))
  expect(Eval.gate(report, { min: Number.NaN }).exitCode).toBe(5)
  expect(Eval.gate(report, { mean: 1.5 }).exitCode).toBe(5)
})

test("property: a scorer key is SHA-256 of the canonical identity, as node:crypto computes it", async () => {
  await checkProperty(fc, {
    name: "eval-scorer-key-sha256",
    rule: "VIP-69 rule 2: name, version and configuration hash into a scorerKey",
    command: "bun test tests/experimental-eval.test.ts",
    arbitrary: fc.record({
      name: fc.string({ unit: "grapheme", minLength: 1, maxLength: 80 }).filter((value) =>
        value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)
      ),
      size: fc.integer({ min: 0, max: 300 })
    }),
    check: ({ name, size }: { name: string; size: number }) => {
      const config = { text: "x".repeat(size) }
      const scorer = Scorer.make({ name, version: "1", config, score: () => 1 })
      const expected = createHash("sha256").update(JSON.stringify({ config, id: name, version: "1" })).digest("hex")
      expect(scorer.scorerKey).toBe(expected)
    },
    numRuns: 200
  })
})

// Review findings: each test failed before its fix.

test("a judge outage after a baseline exists is inconclusive (exit 5), not a missing score", async () => {
  const committed = await run(Eval.run(judgedSuite).pipe(
    Effect.provide(Layer.succeed(Judge, { grade: () => Effect.succeed(0.9) })),
    Effect.flatMap(Eval.baseline)
  ))
  const down = Layer.succeed(Judge, { grade: () => Effect.fail(new Error("judge unreachable")) })
  const report = await run(Effect.gen(function*() {
    return yield* Eval.compare(committed, yield* Eval.run(judgedSuite))
  }).pipe(Effect.provide(down)))
  expect(report.missing).toEqual([])
  const grade = Eval.gate(report, { min: 0 })
  expect(grade.exitCode).toBe(5)
  expect(grade.summary).toContain("judge unreachable")
})

test("leftover scores at new step keys pair by score, so equal scores are no regression", async () => {
  const record = (stepKey: string, score: number) => ({ suite: "s", case: "c", scorer: "k", stepKey, score })
  const observation = (stepKey: string, score: number): Eval.Observation => ({ case: "c", scorer: "k", stepKey, at: "t", kind: "score", score })
  for (const [left, right] of [["d", "c"], ["c", "d"]] as const) {
    const result = { ...fakeRun([], []), observations: [observation(left, 0.5), observation(right, 0.9)] }
    const report = await run(Eval.compare({ version: 1, suite: "s", records: [record("a", 0.5), record("b", 0.9)] }, result))
    expect(report.regressions).toEqual([])
  }
})

test("a target or scorer that interrupts itself is a failed case or an inconclusive score; interrupting the run still stops it", async () => {
  const selfish = Eval.suite("selfish", {
    target: (name: string) => name === "x" ? Effect.interrupt : Effect.succeed(name),
    cases: [{ name: "x", input: ["x"] }, { name: "y", input: ["y"] }],
    scorers: [Scorer.make({ name: "quits", version: "1", score: () => Effect.interrupt })]
  })
  const result = await run(Eval.run(selfish))
  expect(result.cases[0]!.error?.code).toBe("target")
  expect(result.cases[1]!.observations[0]).toMatchObject({ kind: "inconclusive" })
  const forever = Eval.suite("forever", { target: () => Effect.never, cases: [{ name: "x", input: [] }], scorers: [] })
  const exit = await Effect.runPromiseExit(Eval.run(forever).pipe(Effect.timeout("50 millis")))
  expect(Exit.isFailure(exit)).toBe(true)
})

test("scorers run inside the suite's concurrency, not multiplied by it", async () => {
  let live = 0, peak = 0
  const slow = (name: string) =>
    Scorer.make({
      name,
      version: "1",
      score: () =>
        Effect.gen(function*() {
          live++
          peak = Math.max(peak, live)
          yield* Effect.sleep("2 millis")
          live--
          return 1
        })
    })
  const suite = Eval.suite("wide", {
    target: greet,
    cases: Array.from({ length: 8 }, (_, index) => ({ name: `c${index}`, input: [`n${index}`] as [string] })),
    scorers: [slow("a"), slow("b"), slow("c"), slow("d")],
    concurrency: 2
  })
  await run(Eval.run(suite))
  expect(peak).toBeLessThanOrEqual(2)
})

test("declarations and the gate never throw on malformed input", async () => {
  const anyEval = Eval as any, anyScorer = Scorer as any
  for (const make of [
    () => anyEval.suite("x", { cases: 5 }),
    () => anyEval.suite("x", undefined),
    () => anyEval.suite(undefined, null)
  ]) {
    const suite = make()
    expect(await failure(Eval.run(suite))).toMatchObject({ code: "invalid_suite" })
  }
  for (const make of [
    () => anyScorer.make(undefined),
    () => anyScorer.make({ name: Object.create(null), version: "1", score: () => 1 }),
    () => anyScorer.checks(5),
    () => anyScorer.rubric([], undefined)
  ]) {
    expect(make().problem).toBeString()
  }
  expect(anyScorer.checks([], null).problem).toBeUndefined()
  const report = await run(Effect.gen(function*() {
    const result = yield* Eval.run(greetSuite)
    return yield* Eval.compare(yield* Eval.baseline(result), result)
  }))
  expect(Eval.gate(report, { min: Object.create(null) } as any).exitCode).toBe(5)
  expect(Eval.gate(report, { tolerance: Object.create(null) } as any).exitCode).toBe(5)
  expect(Eval.gate(report, null as any).exitCode).toBe(0)
})

test("a score function that throws fails with a ScorerError, not a defect", async () => {
  const thrower = Scorer.make({ name: "t", version: "1", score: (): number => { throw new Error("bad") } })
  expect(await failure(thrower.score({ input: [], output: 1, expected: 1 }))).toMatchObject({ _tag: "ScorerError", code: "inconclusive" })
})

test("checks refuse unusable bounds and empty groups, and are frozen at declaration", async () => {
  expect(Scorer.checks([{ words: null } as any]).problem).toBeString()
  expect(Scorer.checks([{ includes: [[]] }]).problem).toBeString()
  const list: Array<Scorer.Check> = [{ includes: ["hello"] }]
  const scorer = Scorer.checks(list)
  const key = scorer.scorerKey
  list.push({ includes: ["missing"] })
  ;(list[0] as { includes: Array<string> }).includes.push("absent")
  expect((await run(scorer.score({ output: "hello" }))).score).toBe(1)
  expect(Scorer.checks([{ includes: ["hello"] }]).scorerKey).toBe(key)
})
