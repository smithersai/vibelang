import { expect, test } from "bun:test"
import fc from "fast-check"
import { Cause, Effect, Fiber, Latch, Result } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as SupervisorModule from "vibelang-runtime/experimental/patterns/Supervisor"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { PatternError, Supervisor } = Patterns
type Task = Patterns.Supervisor.Task

const plan = {
  tasks: [
    { id: "a", workerType: "coder" },
    { id: "b", workerType: "coder" },
    { id: "c", workerType: "tester" }
  ]
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const flip = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect))

test("Supervisor: the pattern subpath and the Experimental namespace export the same module", () => {
  expect(SupervisorModule.run).toBe(Supervisor.run)
})

test("Supervisor.run delegates again only the retriable tasks and finalizes every output", async () => {
  const attempts: Array<string> = []
  const reviews = [{ allDone: false, retriable: ["b"] }, { allDone: true, retriable: [] }]
  let bFailures = 0
  const result = await run(Supervisor.run("goal", {
    maxRounds: 3,
    maxTasks: 16,
    concurrency: 2,
    plan: () => Effect.succeed(plan),
    worker: ({ round, task }) =>
      Effect.suspend(() => {
        attempts.push(`${round}:${task.id}`)
        if (task.id === "b" && bFailures === 0) {
          bFailures += 1
          return Effect.fail("b exploded")
        }
        return Effect.succeed(`${task.id}-done`)
      }),
    review: ({ round }) => Effect.succeed(reviews[round - 1]!),
    finalize: ({ results }) =>
      Effect.succeed(results.map((outcome) => outcome._tag === "Done" ? outcome.output : `${outcome.id}-failed`))
  }))
  expect(attempts).toEqual(["1:a", "1:b", "1:c", "2:b"])
  expect(result.exhausted).toBe(false)
  expect(result).toMatchObject({ rounds: 2, final: ["a-done", "b-done", "c-done"] })
})

test("Supervisor.run hands a worker delegated again the review that asked for it and its retriable ids", async () => {
  const seen: Array<unknown> = []
  const first = { allDone: false, retriable: ["b"], note: "b needs tests" }
  await run(Supervisor.run("goal", {
    maxRounds: 2,
    maxTasks: 16,
    concurrency: 1,
    plan: () => Effect.succeed(plan),
    worker: (args) => {
      const { input: _input, plan: _plan, ...rest } = args
      seen.push(rest)
      return Effect.succeed(`${args.task.id}-done`)
    },
    review: ({ round }) => Effect.succeed(round === 1 ? first : { allDone: true }),
    finalize: () => Effect.succeed("final")
  }))
  expect(seen).toEqual([
    { task: plan.tasks[0], round: 1 },
    { task: plan.tasks[1], round: 1 },
    { task: plan.tasks[2], round: 1 },
    { task: plan.tasks[1], round: 2, review: first, retriable: ["b"] }
  ])
})

test("Supervisor.run reports the last review as exhausted when the round bound is reached", async () => {
  let finalized = 0
  const review = { allDone: false, retriable: ["a", "b", "c"] }
  const result = await run(Supervisor.run("goal", {
    maxRounds: 2,
    maxTasks: 16,
    concurrency: 3,
    plan: () => Effect.succeed(plan),
    worker: ({ task }) => Effect.succeed(`${task.id}-done`),
    review: () => Effect.succeed(review),
    finalize: () => Effect.sync(() => (finalized += 1, "never"))
  }))
  expect(result).toEqual({ exhausted: true, rounds: 2, review })
  expect(finalized).toBe(0)
})

test("Supervisor.run stops when an unfinished review names nothing to delegate again", async () => {
  const review = { allDone: false, retriable: [] }
  const rounds: Array<number> = []
  const result = await run(Supervisor.run("goal", {
    maxRounds: 5,
    maxTasks: 16,
    concurrency: 3,
    plan: () => Effect.succeed(plan),
    worker: ({ round, task }) => Effect.sync(() => (rounds.push(round), `${task.id}-done`)),
    review: () => Effect.succeed(review),
    finalize: () => Effect.succeed("never")
  }))
  expect(result).toEqual({ exhausted: true, rounds: 1, review })
  expect(rounds).toEqual([1, 1, 1])
})

test("Supervisor.run never runs more workers at once than the concurrency bound", async () => {
  const program = Effect.gen(function*() {
    const held = yield* Latch.make()
    const saturated = yield* Latch.make()
    const entered: Array<string> = []
    let inFlight = 0
    let peak = 0
    const running = yield* Supervisor.run("goal", {
      maxRounds: 1,
      maxTasks: 16,
      concurrency: 2,
      plan: () => Effect.succeed({ tasks: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, workerType: "coder" })) }),
      worker: ({ task }) =>
        Effect.gen(function*() {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          entered.push(task.id)
          if (entered.length === 2) yield* Latch.open(saturated)
          yield* Latch.await(held)
          inFlight -= 1
          return "ok"
        }),
      review: () => Effect.succeed({ allDone: true, retriable: [] }),
      finalize: () => Effect.succeed("done")
    }).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Latch.await(saturated)
    const whileHeld = { entered: [...entered], inFlight }
    yield* Latch.open(held)
    const result = yield* Fiber.join(running)
    return { whileHeld, result, entered, peak }
  })
  const { whileHeld, result, entered, peak } = await run(program)
  expect(whileHeld).toEqual({ entered: ["a", "b"], inFlight: 2 })
  expect(result).toEqual({ exhausted: false, rounds: 1, final: "done" })
  expect(entered).toEqual(["a", "b", "c", "d", "e", "f"])
  expect(peak).toBe(2)
})

test("Supervisor.run propagates a worker defect instead of keeping it as a Failed outcome", async () => {
  const defect = new Error("the worker threw")
  const exit = await Effect.runPromiseExit(Supervisor.run("goal", {
    maxRounds: 1,
    maxTasks: 16,
    concurrency: 2,
    plan: () => Effect.succeed({ tasks: [{ id: "a", workerType: "coder" }, { id: "b", workerType: "coder" }] }),
    worker: ({ task }) => task.id === "b" ? Effect.die(defect) : Effect.succeed(`${task.id}-done`),
    review: () => Effect.succeed({ allDone: true }),
    finalize: ({ results }) => Effect.succeed(results)
  }))
  expect(exit._tag).toBe("Failure")
  if (exit._tag === "Failure") {
    expect(Cause.hasDies(exit.cause)).toBe(true)
    expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBe(defect)
  }
})

test("Supervisor.run refuses a bad plan through the error channel before any callback after the plan", async () => {
  const cases: ReadonlyArray<readonly [unknown, string]> = [
    [{ tasks: [{ id: "a", workerType: "coder" }, { id: "a", workerType: "coder" }] }, "Supervisor task ids must be unique"],
    [{ tasks: [] }, "Supervisor input must contain at least one task"],
    [{ tasks: "nope" }, "Supervisor input must contain a tasks array"],
    [{}, "Supervisor input must contain a tasks array"],
    [null, "Supervisor input must contain a tasks array"],
    [{ tasks: [{ id: "a" }] }, "Supervisor tasks must each carry a string id and a string workerType"],
    [{ tasks: [null] }, "Supervisor tasks must each carry a string id and a string workerType"],
    [
      { tasks: Array.from({ length: 5 }, (_, index) => ({ id: `t${index}`, workerType: "coder" })) },
      "Supervisor plan names 5 tasks, more than maxTasks 4"
    ]
  ]
  for (const [malformed, message] of cases) {
    let callbacks = 0
    const failure = await flip(Supervisor.run("goal", {
      maxRounds: 2,
      maxTasks: 4,
      concurrency: 1,
      plan: () => Effect.succeed(malformed as Patterns.Supervisor.Plan),
      worker: () => Effect.sync(() => (callbacks += 1, "ok")),
      review: () => Effect.sync(() => (callbacks += 1, { allDone: true })),
      finalize: () => Effect.sync(() => (callbacks += 1, "done"))
    }))
    expect(failure).toBeInstanceOf(PatternError)
    expect((failure as InstanceType<typeof PatternError>).code).toBe("invalid_input")
    expect((failure as InstanceType<typeof PatternError>).message).toBe(message)
    expect(callbacks).toBe(0)
  }
})

test("Supervisor.run refuses bad bounds and a stall bound below two", async () => {
  const stages = {
    plan: () => Effect.succeed(plan),
    worker: () => Effect.succeed("ok"),
    review: () => Effect.succeed({ allDone: true }),
    finalize: () => Effect.succeed("done")
  }
  for (const bounds of [
    { maxRounds: 0, maxTasks: 16, concurrency: 1 },
    { maxRounds: 1, maxTasks: Number.POSITIVE_INFINITY, concurrency: 1 },
    { maxRounds: 1, maxTasks: 16, concurrency: 1.5 }
  ]) {
    const failure = await flip(Supervisor.run("goal", { ...stages, ...bounds }))
    expect(failure).toBeInstanceOf(PatternError)
    expect(failure.code).toBe("invalid_decorator")
    expect(failure.message).toBe("Supervisor maxRounds, maxTasks and concurrency must be positive safe integers")
  }
  const stall = await flip(Supervisor.run("goal", { ...stages, maxRounds: 2, maxTasks: 16, concurrency: 1, stall: { rounds: 1 } }))
  expect(stall).toMatchObject({ code: "invalid_decorator", message: "Supervisor stall rounds must be a safe integer of at least 2" })
})

test("Supervisor.run ignores malformed retriable values without delegating again", async () => {
  for (const review of [null, { retriable: "a" }, { retriable: [1, false] }]) {
    let workers = 0
    const result = await run(Supervisor.run("goal", {
      maxRounds: 2,
      maxTasks: 16,
      concurrency: 1,
      plan: () => Effect.succeed({ tasks: [{ id: "a", workerType: "coder" }] }),
      worker: () => Effect.sync(() => (workers += 1, "done")),
      review: () => Effect.succeed(review),
      finalize: () => Effect.succeed("unused")
    }))
    expect(result).toEqual({ exhausted: true, rounds: 1, review })
    expect(workers).toBe(1)
  }
})

test("Supervisor.run accepts a review of true and reads allDone and retriable as own properties only", async () => {
  let finalized = 0
  const stages = {
    maxRounds: 3,
    maxTasks: 16,
    concurrency: 1,
    plan: () => Effect.succeed(plan),
    worker: () => Effect.succeed("ok"),
    finalize: () => Effect.sync(() => (finalized += 1, "done"))
  }
  const inherited = Object.create({ allDone: true, retriable: ["a"] }) as object
  expect(await run(Supervisor.run("goal", { ...stages, review: () => Effect.succeed(inherited) })))
    .toMatchObject({ exhausted: true, rounds: 1 })
  expect(finalized).toBe(0)
  expect(await run(Supervisor.run("goal", { ...stages, review: () => Effect.succeed(true) })))
    .toEqual({ exhausted: false, rounds: 1, final: "done" })
})

test("Supervisor.run with a stall breaker stops, parks or escalates on a repeated signal", async () => {
  const review = { allDone: false, retriable: ["a", "b", "c"] }
  const options = {
    maxRounds: 9,
    maxTasks: 16,
    concurrency: 3,
    plan: () => Effect.succeed(plan),
    worker: ({ task }: { readonly task: Task }) => Effect.succeed(`${task.id}-done`),
    review: () => Effect.succeed(review),
    finalize: () => Effect.succeed("never")
  }
  expect(await run(Supervisor.run("goal", { ...options, stall: { rounds: 3, on: "park" } }))).toEqual({
    exhausted: true,
    rounds: 3,
    review,
    stalled: { _tag: "Stalled", signal: "output", rounds: 3, on: "park" }
  })
  const checks = await run(Supervisor.run("goal", { ...options, stall: { rounds: 2, signals: () => ({ checks: ["b", "a"] }) } }))
  expect(checks).toMatchObject({ rounds: 2, stalled: { signal: "checks" } })
  // An Error failure is compared by its name and message, so the same failure
  // twice in a row is a repeat.
  const failing = await run(Supervisor.run("goal", {
    ...options,
    worker: ({ task }: { readonly task: Task }): Effect.Effect<string, unknown> =>
      task.id === "a" ? Effect.fail(new Error("flaky")) : task.id === "b" ? Effect.fail({ reason: "down" }) : Effect.succeed(`${task.id}-done`),
    stall: { rounds: 2 }
  }))
  expect(failing).toMatchObject({ rounds: 2, stalled: { signal: "output" } })
  const escalated = await flip(Supervisor.run("goal", { ...options, stall: { rounds: 2, on: "escalate" } }))
  expect(escalated).toMatchObject({ code: "stalled", message: "Supervisor stalled: the same result for 2 rounds in a row" })
})

test("Supervisor.run reads its options at the call, not when the Effect runs", async () => {
  const trace: Array<string> = []
  const options = {
    maxRounds: 1,
    maxTasks: 16,
    concurrency: 1,
    plan: () => Effect.succeed({ tasks: [{ id: "a", workerType: "coder" }] }),
    worker: ({ task }: { readonly task: Task }) => Effect.sync(() => (trace.push(`work ${task.id}`), "done")),
    review: () => Effect.succeed({ allDone: true, retriable: [] }),
    finalize: () => Effect.succeed("final")
  }
  const supervision = Supervisor.run("goal", options)
  options.worker = () => Effect.sync(() => (trace.push("swapped"), "swapped"))
  options.finalize = () => Effect.succeed("swapped")
  options.maxRounds = 5
  expect(await run(supervision)).toEqual({ exhausted: false, rounds: 1, final: "final" })
  expect(trace).toEqual(["work a"])
})

test("property: a supervision runs a task in every round until it succeeds, and finalizes exactly when every task succeeded", async () => {
  await checkProperty(fc, {
    name: "patterns-supervisor-retriable-rounds",
    rule: "VIP-73: Supervisor.run delegates again only the tasks the review calls retriable, until a review accepts or the rounds are spent",
    command: "bun test tests/experimental-patterns-supervisor.test.ts",
    arbitrary: fc.record({
      // failures[task]: how many attempts of that task fail before it succeeds.
      failures: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 5 }),
      maxRounds: fc.integer({ min: 1, max: 5 }),
      concurrency: fc.integer({ min: 1, max: 3 })
    }),
    numRuns: 200,
    check: async ({ failures, maxRounds, concurrency }: { readonly failures: ReadonlyArray<number>; readonly maxRounds: number; readonly concurrency: number }) => {
      const attempts = failures.map(() => 0)
      const result = await run(Supervisor.run("goal", {
        maxRounds,
        maxTasks: 16,
        concurrency,
        plan: () => Effect.succeed({ tasks: failures.map((_, index) => ({ id: `t${index}`, workerType: "w" })) }),
        worker: ({ task }) => {
          const index = Number(task.id.slice(1))
          attempts[index]! += 1
          return attempts[index]! > failures[index]! ? Effect.succeed(index) : Effect.fail(index)
        },
        review: ({ results }) =>
          Effect.succeed({
            allDone: results.every((outcome) => outcome._tag === "Done"),
            retriable: results.filter((outcome) => outcome._tag === "Failed").map((outcome) => outcome.id)
          }),
        finalize: ({ results }) => Effect.succeed(results.length)
      }))
      const needed = Math.max(...failures) + 1
      const rounds = Math.min(needed, maxRounds)
      expect(result.rounds).toBe(rounds)
      expect(result.exhausted).toBe(needed > maxRounds)
      expect(attempts).toEqual(failures.map((count) => Math.min(count + 1, rounds)))
    }
  })
})
