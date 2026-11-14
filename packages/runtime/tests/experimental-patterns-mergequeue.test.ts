import { expect, test } from "bun:test"
import fc from "fast-check"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Latch from "effect/Latch"
import { Patterns } from "vibelang-runtime/experimental"
import * as MergeQueueModule from "vibelang-runtime/experimental/patterns/MergeQueue"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { MergeQueue, PatternError } = Patterns

const invalidPriorities = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, 2 ** 53]

const refusal = async <A, E>(effect: Effect.Effect<A, E>) => {
  const error = await Effect.runPromise(Effect.flip(effect))
  expect(error).toBeInstanceOf(PatternError)
  return error as InstanceType<typeof PatternError>
}

test("MergeQueue: the subpath module is the namespace's module", () => {
  expect(MergeQueueModule.run).toBe(MergeQueue.run)
  expect(MergeQueue.DefaultPriority).toBe(1000)
})

test("MergeQueue.ordered sorts by descending priority, then declaration order", () => {
  const members = [{ id: "docs" }, { id: "hotfix", priority: 5000 }, { id: "feature" }]
  const queue = MergeQueue.ordered(members, MergeQueue.DefaultPriority)
  expect(queue.map((member) => member.id)).toEqual(["hotfix", "docs", "feature"])
  expect(queue.map((member) => member.priority)).toEqual([5000, 1000, 1000])
  expect(queue.map((member) => member.position)).toEqual([0, 1, 2])
  expect(queue[0]!.member).toBe(members[1]!)
})

test("MergeQueue.ordered throws a PatternError for an unsafe priority", () => {
  for (const priority of invalidPriorities) {
    expect(() => MergeQueue.ordered([{ id: "unstable", priority }], MergeQueue.DefaultPriority)).toThrow(
      expect.objectContaining({
        code: "invalid_decorator",
        message: `MergeQueue priority for member "unstable" must be a safe integer, received ${priority}`
      })
    )
  }
})

test("MergeQueue.run hands each member its id, position and the input, never its priority", async () => {
  const result = await Effect.runPromise(MergeQueue.run("land", {
    members: [{ id: "docs", priority: 5000, run: (payload) => Effect.succeed(payload) }],
    failurePolicy: "halt"
  }))
  expect(result.landed[0]!.output).toEqual({ id: "docs", position: 0, input: "land" })
  expect(Object.hasOwn(result.landed[0]!.output, "priority")).toBe(false)
})

test("MergeQueue.run lands members one at a time in priority then declaration order", async () => {
  const trace: Array<string> = []
  const queued = ["docs", "hotfix", "feature"].map((id) => ({
    id,
    ...(id === "hotfix" ? { priority: 5000 } : {}),
    run: () =>
      Effect.gen(function*() {
        trace.push(`start ${id}`)
        yield* Effect.yieldNow
        trace.push(`end ${id}`)
        return id
      })
  }))
  const result = await Effect.runPromise(MergeQueue.run("main", { members: queued, failurePolicy: "halt" }))
  expect(trace).toEqual(["start hotfix", "end hotfix", "start docs", "end docs", "start feature", "end feature"])
  expect(result.order).toEqual(["hotfix", "docs", "feature"])
  expect(result.landed.map((entry) => entry.id)).toEqual(["hotfix", "docs", "feature"])
  expect(result.quarantined).toEqual([])
})

test("MergeQueue.run gives a member without a priority the queue's priority", async () => {
  const result = await Effect.runPromise(MergeQueue.run("main", {
    priority: 10,
    failurePolicy: "halt",
    members: [
      { id: "low", priority: 1, run: () => Effect.succeed("low") },
      { id: "plain", run: () => Effect.succeed("plain") },
      { id: "high", priority: 20, run: () => Effect.succeed("high") }
    ]
  }))
  expect(result.order).toEqual(["high", "plain", "low"])
})

test("MergeQueue.run keeps prototype-shaped member ids in order", async () => {
  const ids = ["__proto__", "constructor", "toString", "normal"]
  const result = await Effect.runPromise(MergeQueue.run("main", {
    failurePolicy: "halt",
    members: ids.map((id) => ({ id, run: ({ id }) => Effect.succeed(`${id}-value`) }))
  }))
  expect(result.order).toEqual(ids)
  expect(result.landed).toEqual(ids.map((id) => ({ id, output: `${id}-value` })))
})

test("MergeQueue.run stops later members when one fails under halt", async () => {
  const ran: Array<string> = []
  const queued = ["first", "second", "third"].map((id) => ({
    id,
    run: () => Effect.suspend(() => (ran.push(id), id === "second" ? Effect.fail(`${id} conflicts`) : Effect.succeed(id)))
  }))
  const failure = await Effect.runPromise(Effect.flip(MergeQueue.run("main", { members: queued, failurePolicy: "halt" })))
  expect(failure).toBe("second conflicts")
  expect(ran).toEqual(["first", "second"])
})

test("MergeQueue.run never starts a member behind one that fails under halt", async () => {
  const ran: Array<string> = []
  const queued = ["first", "second"].map((id) => ({
    id,
    run: () =>
      Effect.gen(function*() {
        ran.push(id)
        yield* Effect.yieldNow
        return yield* Effect.fail(`${id} conflicts`)
      })
  }))
  const failure = await Effect.runPromise(Effect.flip(MergeQueue.run("main", { members: queued, failurePolicy: "halt" })))
  expect(failure).toBe("first conflicts")
  expect(ran).toEqual(["first"])
})

test("MergeQueue.run refuses halt above concurrency 1 before any member starts", async () => {
  let ran = 0
  const failure = await refusal(MergeQueue.run("main", {
    members: [{ id: "a", run: () => Effect.sync(() => (ran += 1, "landed")) }],
    concurrency: 2,
    failurePolicy: "halt"
  }))
  expect(failure.code).toBe("invalid_decorator")
  expect(failure.message).toBe("MergeQueue halt requires concurrency 1")
  expect(ran).toBe(0)
})

test("MergeQueue.run reads its options at the call, not when the Effect runs", async () => {
  const trace: Array<string> = []
  const mutableMembers = [{ id: "a", run: () => Effect.sync(() => (trace.push("a"), "a")) }]
  const options: { members: typeof mutableMembers; failurePolicy: "halt" | "quarantine"; concurrency: number } = {
    members: mutableMembers,
    failurePolicy: "quarantine",
    concurrency: 1
  }
  const queue = MergeQueue.run("main", options)
  mutableMembers[0] = { id: "a", run: () => Effect.sync(() => (trace.push("swapped"), "swapped")) }
  mutableMembers.push({ id: "late", run: () => Effect.sync(() => (trace.push("late"), "late")) })
  options.failurePolicy = "halt"
  options.concurrency = 0
  const result = await Effect.runPromise(queue)
  expect(trace).toEqual(["a"])
  expect(result).toEqual({ landed: [{ id: "a", output: "a" }], quarantined: [], order: ["a"] })
})

test("MergeQueue.run lands the rest and reports the failure under quarantine, untagged", async () => {
  const ran: Array<string> = []
  const queued = ["first", "second", "third"].map((id) => ({
    id,
    run: () => Effect.suspend(() => (ran.push(id), id === "second" ? Effect.fail(`${id} conflicts`) : Effect.succeed(id)))
  }))
  const result = await Effect.runPromise(MergeQueue.run("main", { members: queued, failurePolicy: "quarantine" }))
  expect(ran).toEqual(["first", "second", "third"])
  expect(result.landed).toEqual([{ id: "first", output: "first" }, { id: "third", output: "third" }])
  expect(result.quarantined).toEqual([{ id: "second", error: "second conflicts" }])
  expect(Object.hasOwn(result.quarantined[0]!, "_tag")).toBe(false)
})

test("MergeQueue.run propagates a member defect instead of quarantining it", async () => {
  const defect = new Error("the landing threw")
  const exit = await Effect.runPromiseExit(MergeQueue.run("main", {
    members: [{ id: "first", run: () => Effect.succeed("first") }, { id: "second", run: () => Effect.die(defect) }],
    failurePolicy: "quarantine"
  }))
  expect(exit._tag).toBe("Failure")
  if (exit._tag === "Failure") expect(Cause.hasDies(exit.cause)).toBe(true)
})

test("MergeQueue.run never lands more than the concurrency bound at once", async () => {
  const program = Effect.gen(function*() {
    const held = yield* Latch.make()
    const saturated = yield* Latch.make()
    const entered: Array<string> = []
    let inFlight = 0
    let peak = 0
    const queued = ["a", "b", "c", "d"].map((id) => ({
      id,
      run: () =>
        Effect.gen(function*() {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          entered.push(id)
          if (entered.length === 2) yield* Latch.open(saturated)
          yield* Latch.await(held)
          inFlight -= 1
          return id
        })
    }))
    const running = yield* MergeQueue.run("main", { members: queued, concurrency: 2, failurePolicy: "quarantine" })
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* Latch.await(saturated)
    const whileHeld = { entered: [...entered], inFlight }
    yield* Latch.open(held)
    const result = yield* Fiber.join(running)
    return { whileHeld, result, entered, peak }
  })
  const { whileHeld, result, entered, peak } = await Effect.runPromise(program)
  expect(whileHeld).toEqual({ entered: ["a", "b"], inFlight: 2 })
  expect(result.landed.map((entry) => entry.id)).toEqual(["a", "b", "c", "d"])
  expect(entered).toEqual(["a", "b", "c", "d"])
  expect(peak).toBe(2)
})

test("MergeQueue.run refuses an empty queue, an invalid bound and a duplicate id", async () => {
  const empty = await refusal(MergeQueue.run("main", { members: [], failurePolicy: "halt" }))
  expect(empty.code).toBe("invalid_decorator")
  expect(empty.message).toBe("MergeQueue requires at least one member")
  for (const concurrency of [-1, 0, 1.5, Number.NaN]) {
    const bound = await refusal(MergeQueue.run("main", {
      members: [{ id: "a", run: () => Effect.succeed("a") }],
      concurrency,
      failurePolicy: "quarantine"
    }))
    expect(bound.code).toBe("invalid_decorator")
    expect(bound.message).toBe("MergeQueue concurrency must be a positive safe integer")
  }
  const duplicate = await refusal(MergeQueue.run("main", {
    members: [{ id: "a", run: () => Effect.succeed("a") }, { id: "a", run: () => Effect.succeed("b") }],
    failurePolicy: "halt"
  }))
  expect(duplicate.code).toBe("invalid_decorator")
  expect(duplicate.message).toBe("MergeQueue member ids must be unique")
})

test("MergeQueue.run refuses every unsafe member or queue priority before running", async () => {
  let ran = 0
  for (const priority of invalidPriorities) {
    const member = await refusal(MergeQueue.run("main", {
      members: [{ id: "unstable", priority, run: () => Effect.sync(() => (ran += 1, "landed")) }],
      failurePolicy: "halt"
    }))
    expect(member.code).toBe("invalid_decorator")
    expect(member.message).toBe(`MergeQueue priority for member "unstable" must be a safe integer, received ${priority}`)
    const queue = await refusal(MergeQueue.run("main", {
      priority,
      members: [{ id: "unstable", run: () => Effect.sync(() => (ran += 1, "landed")) }],
      failurePolicy: "halt"
    }))
    expect(queue.message).toBe(`MergeQueue priority for member "unstable" must be a safe integer, received ${priority}`)
  }
  expect(ran).toBe(0)
})

test("property: a quarantining queue lands every member that succeeds, in queue order, and holds back the rest", async () => {
  await checkProperty(fc, {
    name: "patterns-mergequeue-order",
    rule: "VIP-73: MergeQueue.run lands members in one prioritized order at a concurrency the queue owns",
    command: "bun test tests/experimental-patterns-mergequeue.test.ts",
    arbitrary: fc.record({
      members: fc.array(fc.record({ priority: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }), fails: fc.boolean() }), {
        minLength: 1,
        maxLength: 8
      }),
      concurrency: fc.integer({ min: 1, max: 4 })
    }),
    numRuns: 200,
    check: async ({ members, concurrency }: {
      readonly members: ReadonlyArray<{ readonly priority: number | undefined; readonly fails: boolean }>
      readonly concurrency: number
    }) => {
      const declared = members.map((member, index) => ({
        id: `m${index}`,
        priority: member.priority,
        run: ({ id, position }: { readonly id: string; readonly position: number }) =>
          member.fails ? Effect.fail(`${id} failed`) : Effect.succeed(position)
      }))
      const result = await Effect.runPromise(MergeQueue.run("main", {
        members: declared,
        concurrency,
        priority: 1,
        failurePolicy: "quarantine"
      }))
      const order = declared
        .map((member, index) => ({ id: member.id, rank: member.priority ?? 1, index }))
        .sort((left, right) => right.rank - left.rank || left.index - right.index)
        .map(({ id }) => id)
      expect(result.order).toEqual(order)
      const failing = new Set(declared.filter((_, index) => members[index]!.fails).map((member) => member.id))
      expect(result.landed).toEqual(
        order.flatMap((id, position) => failing.has(id) ? [] : [{ id, output: position }])
      )
      expect(result.quarantined).toEqual(order.filter((id) => failing.has(id)).map((id) => ({ id, error: `${id} failed` })))
    }
  })
})
