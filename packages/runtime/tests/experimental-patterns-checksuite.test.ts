import { expect, test } from "bun:test"
import fc from "fast-check"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Latch from "effect/Latch"
import { Patterns } from "vibelang-runtime/experimental"
import * as CheckSuiteModule from "vibelang-runtime/experimental/patterns/CheckSuite"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { CheckSuite, PatternError } = Patterns

const refusal = async <A, E>(effect: Effect.Effect<A, E>) => {
  const error = await Effect.runPromise(Effect.flip(effect))
  expect(error).toBeInstanceOf(PatternError)
  return error as InstanceType<typeof PatternError>
}

const results = [
  { id: "lint", passed: true },
  { id: "typecheck", passed: true },
  { id: "test", passed: false }
]

test("CheckSuite: the subpath module is the namespace's module", () => {
  expect(CheckSuiteModule.run).toBe(CheckSuite.run)
})

for (
  const [passing, total, decided] of [
    [0, 1, false],
    [1, 2, false],
    [2, 4, false],
    [1, 3, false],
    [2, 3, true],
    [1, 1, true]
  ] as const
) {
  for (const continueOnFail of [false, true]) {
    test(`CheckSuite requires a strict majority for ${passing}/${total} passes (tolerant: ${continueOnFail})`, async () => {
      const classified = Array.from({ length: total }, (_, index) => ({ id: `check-${index}`, passed: index < passing }))
      const expected = {
        passed: classified.slice(0, passing).map(({ id }) => id),
        failed: classified.slice(passing).map(({ id }) => id),
        errors: {},
        strategy: "majority",
        verdict: decided
      }
      expect(CheckSuite.verdict(classified, "majority")).toEqual(expected)
      expect(await Effect.runPromise(CheckSuite.run("head", {
        strategy: "majority",
        concurrency: 2,
        continueOnFail,
        checks: Object.fromEntries(classified.map(({ id, passed }) => [id, () => Effect.succeed({ passed })]))
      }))).toEqual(expected)
    })
  }
}

test("CheckSuite.rows decodes quarantine outcomes only with the third argument", () => {
  const values = { test: { _tag: "Succeeded", member: "test", value: { passed: false } } }
  const ids = ["test"]
  expect(CheckSuite.rows(values, ids)).toEqual([{ id: "test", passed: true }])
  expect(CheckSuite.rows(values, ids, false)).toEqual(CheckSuite.rows(values, ids))
  expect(CheckSuite.rows(values, ids, true)).toEqual([{ id: "test", passed: false }])
  expect(CheckSuite.verdict(CheckSuite.rows(values, ids), "all-pass").verdict).toBe(true)
  expect(CheckSuite.verdict(CheckSuite.rows(values, ids, true), "all-pass").verdict).toBe(false)
})

for (const error of [new Error("tsc: 14 errors in src/Foo.ts"), "tsc exited 2", undefined, null, false, 0, ""]) {
  test(`CheckSuite keeps a tolerated error through rows and run: ${String(error)}`, async () => {
    // A prototype-shaped id must stay an own key of the errors record.
    const id = "__proto__"
    const expected = { passed: ["lint"], failed: [id], errors: { [id]: error }, strategy: "any-pass", verdict: true }
    const classified = CheckSuite.rows(
      { lint: { _tag: "Succeeded", member: "lint", value: { ok: true } }, [id]: { _tag: "Quarantined", member: id, error } },
      ["lint", id],
      true
    )
    expect(classified).toStrictEqual([{ id: "lint", passed: true }, { id, passed: false, error }])
    const reduced = CheckSuite.verdict(classified, "any-pass")
    expect(reduced).toStrictEqual(expected)
    expect(Object.hasOwn(reduced.errors, id)).toBe(true)
    expect(reduced.errors[id]).toBe(error)
    const executed = await Effect.runPromise(CheckSuite.run("head", {
      strategy: "any-pass",
      concurrency: 1,
      continueOnFail: true,
      checks: { lint: () => Effect.succeed({ ok: true }), [id]: () => Effect.fail(error) }
    }))
    expect(executed).toStrictEqual(expected)
    expect(Object.hasOwn(executed.errors, id)).toBe(true)
    expect(executed.errors[id]).toBe(error)
  })
}

test("CheckSuite.rows keeps failure-row errors without reading arbitrary rows as outcomes", () => {
  const values = {
    failure: { error: "3 failing" },
    empty: { error: "" },
    nil: { error: null },
    absent: { error: undefined },
    clear: { error: false }
  }
  const ids = Object.keys(values)
  const expected = [
    { id: "failure", passed: false, error: "3 failing" },
    { id: "empty", passed: false, error: "" },
    { id: "nil", passed: true },
    { id: "absent", passed: true },
    { id: "clear", passed: true }
  ]
  expect(CheckSuite.rows(values, ids)).toStrictEqual(expected)
  expect(CheckSuite.rows(
    Object.fromEntries(Object.entries(values).map(([member, value]) => [member, { _tag: "Succeeded", member, value }])),
    ids,
    true
  )).toStrictEqual(expected)
  expect(CheckSuite.rows({ invalid: { ok: true } }, ["invalid"], true)).toEqual([{ id: "invalid", passed: false }])
})

test("CheckSuite.verdict resolves each strategy from the same results", () => {
  expect(CheckSuite.verdict(results, "all-pass")).toEqual({
    passed: ["lint", "typecheck"],
    failed: ["test"],
    errors: {},
    strategy: "all-pass",
    verdict: false
  })
  expect(CheckSuite.verdict(results, "majority").verdict).toBe(true)
  expect(CheckSuite.verdict(results, "any-pass").verdict).toBe(true)
  expect(CheckSuite.verdict(results.slice(0, 2), "all-pass").verdict).toBe(true)
  expect(CheckSuite.verdict([{ id: "test", passed: false }], "any-pass").verdict).toBe(false)
})

test("CheckSuite.verdict never passes an empty suite", () => {
  expect(CheckSuite.verdict([], "all-pass").verdict).toBe(false)
  expect(CheckSuite.verdict([], "any-pass").verdict).toBe(false)
  expect(CheckSuite.verdict([], "majority").verdict).toBe(false)
})

test("CheckSuite.passed reads a failure signal out of a check row", () => {
  expect(CheckSuite.passed({ ok: true })).toBe(true)
  expect(CheckSuite.passed(undefined)).toBe(false)
  expect(CheckSuite.passed(null)).toBe(false)
  expect(CheckSuite.passed({ passed: false })).toBe(false)
  expect(CheckSuite.passed({ ok: false })).toBe(false)
  expect(CheckSuite.passed({ failed: true })).toBe(false)
  expect(CheckSuite.passed({ error: "boom" })).toBe(false)
  expect(CheckSuite.passed({ error: false })).toBe(true)
  expect(CheckSuite.passed("done")).toBe(true)
})

test("CheckSuite.rows classifies a record in the order of the ids", () => {
  expect(CheckSuite.rows({ test: { ok: false }, lint: { ok: true } }, ["lint", "typecheck", "test"])).toEqual([
    { id: "lint", passed: true },
    { id: "typecheck", passed: false },
    { id: "test", passed: false }
  ])
  expect(CheckSuite.rows("not a record", ["lint"])).toEqual([{ id: "lint", passed: false }])
  expect(CheckSuite.rows({ nil: null, absent: undefined, text: "done" }, ["nil", "absent", "text"]))
    .toEqual([{ id: "nil", passed: false }, { id: "absent", passed: false }, { id: "text", passed: true }])
})

test("CheckSuite.rows treats inherited prototype-shaped rows as missing", () => {
  const ids = ["__proto__", "constructor", "toString", "normal"]
  expect(CheckSuite.rows({}, ids)).toEqual(ids.map((id) => ({ id, passed: false })))
  const values = Object.fromEntries(ids.map((id) => [id, { ok: true }]))
  expect(Object.getPrototypeOf(values)).toBe(Object.prototype)
  expect(CheckSuite.rows(values, ids)).toEqual(ids.map((id) => ({ id, passed: true })))
})

test("CheckSuite reads a quarantined check as failed, whatever the check failed with", () => {
  const boom = { _tag: "Quarantined", member: "test", error: new Error("boom") }
  const falsy = { _tag: "Quarantined", member: "test", error: null }
  const lint = { _tag: "Succeeded", member: "lint", value: { ok: true } }
  expect(CheckSuite.passed(boom)).toBe(false)
  expect(CheckSuite.passed(falsy)).toBe(true)
  expect(CheckSuite.rows({ lint, test: falsy }, ["lint", "test"], true)).toEqual([
    { id: "lint", passed: true },
    { id: "test", passed: false, error: null }
  ])
})

test("CheckSuite.run stops at the first failing check when continueOnFail is false", async () => {
  const ran: Array<string> = []
  const failure = await Effect.runPromise(Effect.flip(CheckSuite.run("head", {
    strategy: "all-pass",
    concurrency: 1,
    continueOnFail: false,
    checks: {
      lint: () => Effect.sync(() => ran.push("lint")).pipe(Effect.as({ ok: true })),
      typecheck: () => Effect.suspend(() => (ran.push("typecheck"), Effect.fail("tsc exited 2"))),
      test: () => Effect.sync(() => ran.push("test")).pipe(Effect.as({ ok: true }))
    }
  })))
  expect(failure).toBe("tsc exited 2")
  expect(ran).toEqual(["lint", "typecheck"])
})

test("CheckSuite.run runs every check and lists the failed one when continueOnFail is true", async () => {
  const ran: Array<string> = []
  const verdict = await Effect.runPromise(CheckSuite.run("head", {
    strategy: "majority",
    concurrency: 3,
    continueOnFail: true,
    checks: {
      lint: () => Effect.sync(() => ran.push("lint")).pipe(Effect.as({ ok: true })),
      typecheck: () => Effect.suspend(() => (ran.push("typecheck"), Effect.fail("tsc exited 2"))),
      test: () => Effect.sync(() => ran.push("test")).pipe(Effect.as({ ok: true }))
    }
  }))
  expect(ran.sort()).toEqual(["lint", "test", "typecheck"])
  expect(verdict).toEqual({
    passed: ["lint", "test"],
    failed: ["typecheck"],
    errors: { typecheck: "tsc exited 2" },
    strategy: "majority",
    verdict: true
  })
})

test("CheckSuite.run passes the input to every check", async () => {
  const seen: Array<string> = []
  await Effect.runPromise(CheckSuite.run("head", {
    strategy: "all-pass",
    concurrency: 2,
    continueOnFail: false,
    checks: { a: (input: string) => Effect.sync(() => seen.push(`a:${input}`)), b: (input: string) => Effect.sync(() => seen.push(`b:${input}`)) }
  }))
  expect(seen.sort()).toEqual(["a:head", "b:head"])
})

test("CheckSuite.run propagates a check defect even when continueOnFail is true", async () => {
  const defect = new Error("the check threw")
  const exit = await Effect.runPromiseExit(CheckSuite.run("head", {
    strategy: "all-pass",
    concurrency: 2,
    continueOnFail: true,
    checks: { lint: () => Effect.succeed({ ok: true }), typecheck: () => Effect.die(defect) }
  }))
  expect(exit._tag).toBe("Failure")
  if (exit._tag === "Failure") {
    expect(Cause.hasDies(exit.cause)).toBe(true)
  }
})

test("CheckSuite.run fails a check whose row reports a failure", async () => {
  const verdict = await Effect.runPromise(CheckSuite.run<string, unknown, never, never>("head", {
    strategy: "all-pass",
    concurrency: 2,
    continueOnFail: true,
    checks: { lint: () => Effect.succeed({ ok: true }), test: () => Effect.succeed({ passed: false, error: "3 failing" }) }
  }))
  expect(verdict.errors).toEqual({ test: "3 failing" })
  expect(verdict.failed).toEqual(["test"])
  expect(verdict.verdict).toBe(false)
})

test("CheckSuite.run refuses an invalid concurrency, an empty suite and an empty id before a check runs", async () => {
  let ran = 0
  const check = () => Effect.sync(() => (ran += 1, { ok: true }))
  for (const concurrency of [0, -1, 1.5, Number.NaN]) {
    const failure = await refusal(CheckSuite.run("head", {
      strategy: "all-pass",
      concurrency,
      continueOnFail: true,
      checks: { lint: check }
    }))
    expect(failure.code).toBe("invalid_decorator")
    expect(failure.message).toBe("CheckSuite concurrency must be a positive safe integer")
  }
  const empty = await refusal(CheckSuite.run<string, { readonly ok: boolean }, never, never>("head", {
    strategy: "all-pass",
    concurrency: 2,
    continueOnFail: true,
    checks: {}
  }))
  expect(empty.code).toBe("invalid_decorator")
  expect(empty.message).toBe("CheckSuite requires at least one check")
  const unnamed = await refusal(CheckSuite.run("head", {
    strategy: "all-pass",
    concurrency: 2,
    continueOnFail: true,
    checks: { "": check, lint: check }
  }))
  expect(unnamed.code).toBe("invalid_decorator")
  expect(unnamed.message).toBe("CheckSuite check ids must not be empty")
  expect(ran).toBe(0)
})

test("CheckSuite.run never runs more checks at once than the concurrency bound", async () => {
  const program = Effect.gen(function*() {
    const held = yield* Latch.make()
    const saturated = yield* Latch.make()
    const entered: Array<string> = []
    let inFlight = 0
    let peak = 0
    const check = (id: string) => () =>
      Effect.gen(function*() {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        entered.push(id)
        if (entered.length === 2) yield* Latch.open(saturated)
        yield* Latch.await(held)
        inFlight -= 1
        return { ok: true }
      })
    const running = yield* CheckSuite.run<string, { readonly ok: boolean }, never, never>("head", {
      strategy: "all-pass",
      concurrency: 2,
      continueOnFail: false,
      checks: { lint: check("lint"), typecheck: check("typecheck"), test: check("test"), audit: check("audit") }
    }).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Latch.await(saturated)
    const whileHeld = { entered: [...entered], inFlight }
    yield* Latch.open(held)
    const verdict = yield* Fiber.join(running)
    return { whileHeld, verdict, entered, peak }
  })
  const { whileHeld, verdict, entered, peak } = await Effect.runPromise(program)
  expect(whileHeld).toEqual({ entered: ["lint", "typecheck"], inFlight: 2 })
  expect(verdict.verdict).toBe(true)
  expect(entered).toEqual(["lint", "typecheck", "test", "audit"])
  expect(peak).toBe(2)
})

test("CheckSuite.run reads its options at the call, not when the Effect runs", async () => {
  const checks: Record<string, () => Effect.Effect<{ readonly ok: boolean }>> = { lint: () => Effect.succeed({ ok: true }) }
  const options: { checks: typeof checks; strategy: "all-pass" | "any-pass"; concurrency: number; continueOnFail: boolean } = {
    checks,
    strategy: "all-pass",
    concurrency: 1,
    continueOnFail: false
  }
  const program = CheckSuite.run("head", options)
  checks["late"] = () => Effect.succeed({ ok: false })
  options.strategy = "any-pass"
  options.concurrency = 0
  expect(await Effect.runPromise(program)).toEqual({
    passed: ["lint"],
    failed: [],
    errors: {},
    strategy: "all-pass",
    verdict: true
  })
})

test("property: a check suite's verdict follows its strategy over the classified rows", async () => {
  await checkProperty(fc, {
    name: "patterns-checksuite-strategy",
    rule: "VIP-73: CheckSuite.run runs independent checks with a concurrency bound and reduces their rows to one verdict",
    command: "bun test tests/experimental-patterns-checksuite.test.ts",
    arbitrary: fc.record({
      outcomes: fc.array(fc.constantFrom("pass", "row-fail", "fail"), { minLength: 1, maxLength: 8 }),
      strategy: fc.constantFrom("all-pass" as const, "majority" as const, "any-pass" as const),
      concurrency: fc.integer({ min: 1, max: 9 })
    }),
    numRuns: 200,
    check: async ({ outcomes, strategy, concurrency }: {
      readonly outcomes: ReadonlyArray<"pass" | "row-fail" | "fail">
      readonly strategy: "all-pass" | "majority" | "any-pass"
      readonly concurrency: number
    }) => {
      const ids = outcomes.map((_, index) => `c${index}`)
      const checks = Object.fromEntries(ids.map((id, index) => [id, () =>
        outcomes[index] === "fail" ? Effect.fail(`${id} broke`) : Effect.succeed({ ok: outcomes[index] === "pass" })]))
      const verdict = await Effect.runPromise(CheckSuite.run("head", { checks, strategy, concurrency, continueOnFail: true }))
      const passing = ids.filter((_, index) => outcomes[index] === "pass")
      expect(verdict.passed).toEqual(passing)
      expect(verdict.failed).toEqual(ids.filter((_, index) => outcomes[index] !== "pass"))
      expect(Object.keys(verdict.errors)).toEqual(ids.filter((_, index) => outcomes[index] === "fail"))
      const expected = strategy === "all-pass"
        ? passing.length === ids.length
        : strategy === "majority"
        ? passing.length * 2 > ids.length
        : passing.length > 0
      expect(verdict.verdict).toBe(expected)
    }
  })
})
