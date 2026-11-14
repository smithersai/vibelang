import { expect, test } from "bun:test"
import fc from "fast-check"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as BurndownModule from "vibelang-runtime/experimental/patterns/Burndown"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { Burndown, PatternError } = Patterns
type ItemArgs = Patterns.Burndown.ItemArgs<unknown, Issue>
type RoundOptions<W, E, L = unknown> = Patterns.Burndown.RoundOptions<unknown, Issue, W, E, never, L>

interface Issue {
  readonly id: string
  readonly owner?: string
}

const items = (...ids: ReadonlyArray<string>): ReadonlyArray<Issue> => ids.map((id) => ({ id }))

// A tape of every stage call, in the order the round made them.
const recorder = () => {
  const tape: Array<string> = []
  const note = (entry: string) => Effect.sync(() => void tape.push(entry))
  return { tape, note }
}

const baseOptions = (note: (entry: string) => Effect.Effect<void>) => ({
  key: "sweep",
  concurrency: 4,
  claim: ({ item }: ItemArgs) => note(`claim:${item.id}`),
  work: ({ executionId, item }: ItemArgs & { readonly executionId: string }) =>
    Effect.as(note(`work:${item.id}@${executionId}`), `fixed ${item.id}`),
  release: ({ item, status }: ItemArgs & { readonly status: Patterns.Burndown.Status }) => note(`release:${item.id}:${status}`)
})

// Work that takes `millis[item.id]` milliseconds and notes when it finishes.
const timed = (note: (entry: string) => Effect.Effect<void>, millis: Record<string, number>) => ({ item }: ItemArgs) =>
  Effect.as(Effect.andThen(Effect.sleep(millis[item.id] ?? 0), note(`worked:${item.id}`)), `fixed ${item.id}`)

const runRound = <W, E, L = unknown>(
  input: Partial<Patterns.Burndown.RoundInput<unknown, Issue>> & { readonly items: ReadonlyArray<Issue> },
  options: RoundOptions<W, E, L>
) => Effect.runPromise(Burndown.round({ input: { repo: "acme/app" }, round: 0, ...input }, options))

const refusedRound = (input: Record<string, unknown>, options: Record<string, unknown> = {}) => {
  const { note } = recorder()
  return Effect.runPromise(Effect.flip(Burndown.round(
    { input: undefined, round: 0, items: items("a"), ...input } as never,
    { ...baseOptions(note), ...options } as never
  )))
}

const failOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit) ? exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error : undefined

test("Burndown: the pattern subpath and the Experimental namespace export the same module", () => {
  expect(BurndownModule.round).toBe(Burndown.round)
  expect(new Burndown.Held({ message: "m" })._tag).toBe("Burndown/Held")
  expect(new Burndown.Stop({ message: "m" })._tag).toBe("Burndown/Stop")
  expect(Burndown.available(2)).toEqual({ _tag: "Available", slots: 2 })
  expect(Burndown.waitUntil(5)).toEqual({ _tag: "WaitUntil", at: 5 })
  expect(Burndown.exhausted("out")).toEqual({ _tag: "Exhausted", detail: "out" })
  expect(Burndown.skip("why")).toEqual({ _tag: "Skip", detail: "why" })
  expect(Burndown.ours).toEqual({ _tag: "Ours" })
})

test("Burndown.round bounds duplicate item ids in validation errors before invoking stages", async () => {
  const id = "a".repeat(100_000)
  const { note, tape } = recorder()
  const error = await Effect.runPromise(Effect.flip(Burndown.round({ input: null, round: 0, items: items(id, id) }, baseOptions(note))))
  expect(error).toMatchObject({ code: "invalid_input" })
  expect(error.message.length).toBeLessThan(200)
  expect(error.message).toContain(id.slice(0, 64))
  expect(error.message).toContain(String(id.length))
  expect(tape).toEqual([])
})

test("Burndown.round releases a claim when interruption arrives as acquisition succeeds", async () => {
  const held = new Set<string>()
  const released: Array<string> = []
  const { note, tape } = recorder()
  const exit = await Effect.runPromiseExit(Burndown.round({ input: null, round: 0, items: items("a") }, {
    ...baseOptions(note),
    claim: ({ item }) =>
      Effect.uninterruptible(Effect.withFiber((fiber) =>
        Effect.sync(() => {
          held.add(item.id)
          fiber.interruptUnsafe()
        })
      )),
    release: ({ item }) => Effect.sync(() => (held.delete(item.id), released.push(item.id)))
  }))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(released).toEqual(["a"])
  expect([...held]).toEqual([])
  expect(tape).toEqual([])
})

test("Burndown.round claims, works, and releases only the items selection calls ours", async () => {
  const { note, tape } = recorder()
  const result = await runRound({ items: [{ id: "a" }, { id: "b", owner: "mac-mini" }, { id: "c" }] }, {
    ...baseOptions(note),
    select: ({ item }) => Effect.succeed(item.owner === undefined ? Burndown.ours : Burndown.skip(`held by ${item.owner}`)),
    detail: (output: string) => output
  })
  expect(result).toEqual({
    rows: [
      { id: "a", status: "landed", detail: "fixed a" },
      { id: "b", status: "skipped", detail: "held by mac-mini" },
      { id: "c", status: "landed", detail: "fixed c" }
    ],
    launched: 2,
    deferred: 0
  })
  expect(tape.filter((entry) => entry.includes(":b"))).toEqual([])
  expect(tape).toContain("work:a@sweep/a")
  expect(tape).toContain("release:c:landed")
})

test("Burndown.round skips an item whose selection is malformed or fails, and reconsiders nothing settled", async () => {
  const { note, tape } = recorder()
  const answers: Record<string, Effect.Effect<Patterns.Burndown.Selection, string>> = {
    a: Effect.succeed({ _tag: "Skip", detail: 7 } as never),
    b: Effect.succeed({ _tag: "Launch" } as never),
    c: Effect.fail("claims unreadable"),
    d: Effect.fail({ message: "rate limited" } as never),
    f: Effect.succeed(Burndown.ours)
  }
  const result = await runRound({ items: items("a", "b", "c", "d", "e", "f"), settled: ["e"] }, {
    ...baseOptions(note),
    select: ({ item }) => answers[item.id]!
  })
  expect(result.rows).toEqual([
    { id: "a", status: "skipped", detail: "selection did not answer ours" },
    { id: "b", status: "skipped", detail: "selection did not answer ours" },
    { id: "c", status: "skipped", detail: "select failed: claims unreadable" },
    { id: "d", status: "skipped", detail: "select failed: rate limited" },
    { id: "f", status: "landed", detail: "" }
  ])
  expect(result.launched).toBe(1)
  expect(tape.filter((entry) => !entry.includes("f"))).toEqual([])
})

test("Burndown.round stops a round that launched nothing because selection erred, naming the cause, before any claim", async () => {
  const { note, tape } = recorder()
  const answers: Record<string, () => Effect.Effect<Patterns.Burndown.Selection, string>> = {
    parked: () => Effect.succeed(Burndown.skip("parked")),
    broken: () => Effect.fail("triage: unconfigured: no judge"),
    malformed: () => Effect.succeed({ _tag: "Launch" } as never),
    thrown: () => Effect.die(new Error("judge crashed"))
  }
  const exit = await Effect.runPromiseExit(Burndown.round({ input: null, round: 4, items: items("parked", "broken", "malformed", "thrown") }, {
    ...baseOptions(note),
    select: ({ item }) => answers[item.id]!()
  }))
  const stop = failOf(exit)
  expect(stop).toBeInstanceOf(Burndown.Stop)
  const message = (stop as Patterns.Burndown.Stop).message
  expect(message).toContain("round 4 launched nothing")
  expect(message).toContain("3 of 4")
  expect(message).toContain("broken: select failed: triage: unconfigured: no judge")
  expect(message).toContain("malformed: selection did not answer ours")
  expect(tape).toEqual([])
})

test("Burndown.round does not stop a round whose skips are all policy", async () => {
  const { note, tape } = recorder()
  const skipped = await runRound({ items: items("a", "b") }, {
    ...baseOptions(note),
    select: ({ item }) => Effect.succeed(Burndown.skip(`claimed elsewhere ${item.id}`))
  })
  expect(skipped).toEqual({
    rows: [{ id: "a", status: "skipped", detail: "claimed elsewhere a" }, { id: "b", status: "skipped", detail: "claimed elsewhere b" }],
    launched: 0,
    deferred: 0
  })
  expect(tape).toEqual([])
})

test("Burndown.round reports a held claim as held, never works or releases it, and leaves it settled", async () => {
  const { note, tape } = recorder()
  const claim = ({ item }: ItemArgs) =>
    item.id === "a" ? Effect.andThen(note("claim:a"), Effect.fail(new Burndown.Held({ message: "claimed by mac-mini" }))) : note(`claim:${item.id}`)
  const first = await runRound({ items: items("a", "b") }, { ...baseOptions(note), claim })
  expect(first.rows).toEqual([{ id: "a", status: "held", detail: "claimed by mac-mini" }, { id: "b", status: "landed", detail: "" }])
  expect(tape.filter((entry) => entry.endsWith(":a") || entry.includes(":a:") || entry.includes("@sweep/a"))).toEqual(["claim:a"])
  tape.length = 0
  const second = await runRound({ items: items("a", "b"), settled: first.rows.map((row) => row.id), round: 1 }, { ...baseOptions(note), claim })
  expect(second).toEqual({ rows: [], launched: 0, deferred: 0 })
  expect(tape).toEqual([])
})

test("Burndown.round fails an item whose claim fails for another reason, without releasing it", async () => {
  const { note, tape } = recorder()
  const result = await runRound({ items: items("a") }, { ...baseOptions(note), claim: () => Effect.fail("issue-claim exited 1") })
  expect(result.rows).toEqual([{ id: "a", status: "failed", detail: "claim: issue-claim exited 1" }])
  expect(tape).toEqual([])
})

test("Burndown.round releases a claim after the work fails, and one failure leaves its siblings running", async () => {
  const { note, tape } = recorder()
  const result = await runRound({ items: items("a", "b") }, {
    ...baseOptions(note),
    work: ({ item }) => item.id === "a" ? Effect.fail(new Error("agent exited 2")) : Effect.as(Effect.andThen(Effect.sleep("5 millis"), note("work:b")), "ok")
  })
  expect(result.rows).toEqual([{ id: "a", status: "failed", detail: "work: agent exited 2" }, { id: "b", status: "landed", detail: "" }])
  expect(tape).toEqual(["claim:a", "claim:b", "release:a:failed", "work:b", "release:b:landed"])
})

test("Burndown.round appends a release failure to the row without changing its status", async () => {
  const { note } = recorder()
  const result = await runRound({ items: items("a", "b") }, {
    ...baseOptions(note),
    work: ({ item }) => item.id === "a" ? Effect.fail("boom") : Effect.succeed("ok"),
    release: ({ item }) => Effect.fail(`label ${item.id} not removed`)
  })
  expect(result.rows).toEqual([
    { id: "a", status: "failed", detail: "work: boom; release: label a not removed" },
    { id: "b", status: "landed", detail: "release: label b not removed" }
  ])
})

test("Burndown.round requeues an item whose work was interrupted without a recorded cancel", async () => {
  const { note, tape } = recorder()
  const result = await runRound({ items: items("a", "b") }, {
    ...baseOptions(note),
    work: ({ item }) => item.id === "a" ? Effect.interrupt : Effect.succeed(`fixed ${item.id}`),
    release: ({ detail, item, status }) => note(`release:${item.id}:${status}:${detail}`),
    detail: (output: string) => output
  })
  expect(result.rows).toEqual([{ id: "a", status: "requeued", detail: "work: interrupted" }, { id: "b", status: "landed", detail: "fixed b" }])
  expect(result.launched).toBe(2)
  expect(tape.filter((entry) => entry.startsWith("release:"))).toEqual(["release:a:requeued:work: interrupted", "release:b:landed:fixed b"])
})

test("Burndown.round asks cancelled about an interrupted item only, and settles it failed when a cancel was recorded", async () => {
  const { note, tape } = recorder()
  const result = await runRound({ items: items("a", "b") }, {
    ...baseOptions(note),
    work: ({ item }) => item.id === "a" ? Effect.interrupt : Effect.succeed(`fixed ${item.id}`),
    cancelled: ({ executionId, item }) => Effect.as(note(`cancelled:${item.id}@${executionId}`), true),
    detail: (output: string) => output
  })
  expect(result.rows).toEqual([{ id: "a", status: "failed", detail: "work: interrupted" }, { id: "b", status: "landed", detail: "fixed b" }])
  expect(tape.filter((entry) => !entry.startsWith("claim:") && !entry.startsWith("work:"))).toEqual([
    "cancelled:a@sweep/a",
    "release:a:failed",
    "release:b:landed"
  ])
})

test("Burndown.round requeues an interrupted item when cancelled answers false or fails, and fails it when the lookup dies", async () => {
  const { note, tape } = recorder()
  const result = await runRound({ items: items("a", "b", "c", "d") }, {
    ...baseOptions(note),
    work: ({ item }) => item.id === "d" ? Effect.fail(undefined) : Effect.interrupt,
    cancelled: ({ item }) =>
      item.id === "a" ? Effect.succeed(false) : item.id === "b" ? Effect.fail("run store unreachable") : Effect.die(new Error("lookup defect"))
  })
  expect(result.rows.map((row) => `${row.id}:${row.status}`)).toEqual(["a:requeued", "b:requeued", "c:failed", "d:failed"])
  expect(result.rows[2]!.detail).toBe("cancelled: lookup defect")
  expect(result.rows[3]!.detail.startsWith("work: ")).toBe(true)
  expect(tape.filter((entry) => entry.startsWith("release:"))).toEqual(["release:a:requeued", "release:b:requeued", "release:c:failed", "release:d:failed"])
})

test("Burndown.round requeues every open claim when the round itself is interrupted without a recorded cancel", async () => {
  const { note, tape } = recorder()
  const exit = await Effect.runPromiseExit(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Burndown.round({ input: undefined, round: 0, items: items("a") }, {
      ...baseOptions(note),
      work: () => Effect.never,
      release: ({ detail, item, status }) => note(`release:${item.id}:${status}:${detail}`)
    }))
    yield* Effect.yieldNow
    yield* Effect.sleep("5 millis")
    yield* Fiber.interrupt(fiber)
    return yield* Fiber.await(fiber)
  }))
  expect(Exit.isSuccess(exit) && Exit.hasInterrupts(exit.value)).toBe(true)
  expect(tape).toEqual(["claim:a", "release:a:requeued:round interrupted"])
})

test("Burndown.round releases every open claim failed when the round is interrupted by a recorded cancel", async () => {
  const { note, tape } = recorder()
  await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Burndown.round({ input: undefined, round: 0, items: items("a", "b") }, {
      ...baseOptions(note),
      work: () => Effect.never,
      cancelled: ({ item }) => Effect.succeed(item.id === "a"),
      release: ({ detail, item, status }) => note(`release:${item.id}:${status}:${detail}`)
    }))
    yield* Effect.sleep("5 millis")
    yield* Fiber.interrupt(fiber)
    yield* Fiber.await(fiber)
  }))
  expect(tape.filter((entry) => entry.startsWith("release:")).sort()).toEqual(["release:a:failed:round died", "release:b:requeued:round interrupted"])
})

test("Burndown.round finishes a release already in flight when the round is interrupted", async () => {
  const { note, tape } = recorder()
  await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Burndown.round({ input: undefined, round: 0, items: items("a", "b") }, {
      ...baseOptions(note),
      work: ({ item }) => item.id === "a" ? Effect.succeed("ok") : Effect.never,
      release: ({ item, status }) => Effect.andThen(Effect.sleep(20), note(`release:${item.id}:${status}`))
    }))
    yield* Effect.sleep(5)
    yield* Fiber.interrupt(fiber)
  }))
  expect(tape).toEqual(["claim:a", "claim:b", "release:a:landed", "release:b:requeued"])
})

for (const stopped of ["cancelled", "release"] as const) {
  test(`Burndown.round finishes every open claim when ${stopped} reports Stop during interruption cleanup`, async () => {
    const { note, tape } = recorder()
    const ready = await Effect.runPromise(Deferred.make<void>())
    const stop = new Burndown.Stop({ message: "cleanup stopped" })
    let started = 0
    const exit = await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Burndown.round({ input: null, round: 0, items: items("a", "b") }, {
        ...baseOptions(note),
        work: () =>
          Effect.gen(function*() {
            started++
            if (started === 2) yield* Deferred.succeed(ready, undefined)
            return yield* Effect.never
          }),
        cancelled: () => stopped === "cancelled" ? Effect.fail(stop) : Effect.succeed(false),
        release: ({ item, status }) =>
          Effect.andThen(note(`cleanup:${item.id}:${status}`), item.id === "a" && stopped === "release" ? Effect.fail(stop) : Effect.void)
      }))
      yield* Deferred.await(ready)
      yield* Fiber.interrupt(fiber)
      return yield* Fiber.await(fiber)
    }))
    expect(Exit.hasInterrupts(exit)).toBe(true)
    expect(tape.filter((entry) => entry.startsWith("cleanup:")).sort()).toEqual([
      `cleanup:a:${stopped === "cancelled" ? "failed" : "requeued"}`,
      `cleanup:b:${stopped === "cancelled" ? "failed" : "requeued"}`
    ])
  })
}

test("Burndown.round lands and releases an item as soon as its work finishes, while a slower item still works", async () => {
  const { note, tape } = recorder()
  const fastReleased = await Effect.runPromise(Deferred.make<void>())
  const result = await runRound({ items: items("slow", "fast") }, {
    ...baseOptions(note),
    work: ({ item }) =>
      Effect.gen(function*() {
        if (item.id === "slow") yield* Deferred.await(fastReleased)
        yield* note(`worked:${item.id}`)
        return `fixed ${item.id}`
      }),
    land: ({ item }) => note(`land:${item.id}`),
    release: ({ item, status }) =>
      Effect.gen(function*() {
        yield* note(`release:${item.id}:${status}`)
        if (item.id === "fast") yield* Deferred.succeed(fastReleased, undefined)
      })
  })
  expect(result.rows.map((row) => `${row.id}:${row.status}`)).toEqual(["slow:landed", "fast:landed"])
  expect(tape).toEqual(["claim:slow", "claim:fast", "worked:fast", "land:fast", "release:fast:landed", "worked:slow", "land:slow", "release:slow:landed"])
})

test("Burndown.round admits the next ours item into a freed slot while the round's capacity allows", async () => {
  const { note, tape } = recorder()
  const slowStarted = await Effect.runPromise(Deferred.make<void>())
  const lastReleased = await Effect.runPromise(Deferred.make<void>())
  let inFlight = 0
  let widest = 0
  const result = await runRound({ items: items("slow", "b", "c", "d"), slots: 2 }, {
    ...baseOptions(note),
    capacity: ({ input, round }) => Effect.as(note(`capacity:${(input as { readonly repo: string }).repo}:${round}`), Burndown.available(2)),
    work: ({ item }) =>
      Effect.gen(function*() {
        inFlight += 1
        widest = Math.max(widest, inFlight)
        if (item.id === "slow") {
          yield* Deferred.succeed(slowStarted, undefined)
          yield* Deferred.await(lastReleased)
        } else yield* Deferred.await(slowStarted)
        inFlight -= 1
        yield* note(`worked:${item.id}`)
        return "ok"
      }),
    release: ({ item, status }) =>
      Effect.gen(function*() {
        yield* note(`release:${item.id}:${status}`)
        if (item.id === "d") yield* Deferred.succeed(lastReleased, undefined)
      })
  })
  expect(result.rows.map((row) => `${row.id}:${row.status}`)).toEqual(["slow:landed", "b:landed", "c:landed", "d:landed"])
  expect(result).toMatchObject({ launched: 4, deferred: 0 })
  expect(widest).toBe(2)
  expect(tape.indexOf("release:d:landed")).toBeLessThan(tape.indexOf("worked:slow"))
  expect(tape.filter((entry) => entry.startsWith("capacity:"))).toEqual(["capacity:acme/app:0", "capacity:acme/app:0"])
})

test("Burndown.round defers the remaining items when the round's capacity does not allow another", async () => {
  const answers: ReadonlyArray<Effect.Effect<unknown, string>> = [
    Effect.succeed(Burndown.exhausted("every account is out")),
    Effect.succeed(Burndown.waitUntil(1)),
    Effect.fail("status unreadable"),
    Effect.succeed({ _tag: "Available" }),
    Effect.succeed({ _tag: "Available", slots: 0 }),
    Effect.succeed(undefined)
  ]
  for (const answer of answers) {
    const { note, tape } = recorder()
    const result = await runRound({ items: items("a", "b", "c"), slots: 1 }, {
      ...baseOptions(note),
      capacity: () => answer as Effect.Effect<Patterns.Burndown.Capacity, string>
    })
    expect(result).toEqual({ rows: [{ id: "a", status: "landed", detail: "" }], launched: 1, deferred: 2 })
    expect(tape).toEqual(["claim:a", "work:a@sweep/a", "release:a:landed"])
  }
})

test("Burndown.round retires a freed slot while the capacity is no wider than the work still in flight", async () => {
  const { note, tape } = recorder()
  const result = await runRound({ items: items("slow", "b", "c", "d"), slots: 2 }, {
    ...baseOptions(note),
    capacity: () => Effect.succeed(Burndown.available(1)),
    work: timed(note, { slow: 20 })
  })
  expect(result).toMatchObject({ launched: 4, deferred: 0 })
  expect(tape.filter((entry) => entry.startsWith("claim:") || entry.startsWith("worked:"))).toEqual([
    "claim:slow", "claim:b", "worked:b", "worked:slow", "claim:c", "worked:c", "claim:d", "worked:d"
  ])
})

test("Burndown.round admits an item once when two freed slots ask for it together", async () => {
  const { note, tape } = recorder()
  const result = await runRound({ items: items("a", "b", "c"), slots: 2 }, {
    ...baseOptions(note),
    capacity: () => Effect.as(Effect.andThen(note("capacity"), Effect.sleep(5)), Burndown.available(2))
  })
  expect(result).toMatchObject({ launched: 3, deferred: 0 })
  expect(tape.filter((entry) => entry === "capacity" || entry === "claim:c")).toEqual(["capacity", "capacity", "claim:c"])
})

test("Burndown.round lands worked items one at a time, in discovery order, and quarantines a failed landing", async () => {
  const { note, tape } = recorder()
  let inFlight = 0
  let widest = 0
  const result = await runRound({ items: items("a", "b", "c") }, {
    ...baseOptions(note),
    land: ({ item, output }) =>
      Effect.gen(function*() {
        inFlight += 1
        widest = Math.max(widest, inFlight)
        yield* Effect.sleep("2 millis")
        inFlight -= 1
        yield* note(`land:${item.id}:${output}`)
        if (item.id === "b") return yield* Effect.fail("merge conflict")
      }),
    detail: (output: string) => output
  })
  expect(result.rows).toEqual([
    { id: "a", status: "landed", detail: "fixed a" },
    { id: "b", status: "failed", detail: "land: merge conflict" },
    { id: "c", status: "landed", detail: "fixed c" }
  ])
  expect(widest).toBe(1)
  expect(tape.filter((entry) => entry.startsWith("land:"))).toEqual(["land:a:fixed a", "land:b:fixed b", "land:c:fixed c"])
  expect(tape.filter((entry) => entry.startsWith("release:"))).toEqual(["release:a:landed", "release:b:failed", "release:c:landed"])
})

test("Burndown.round runs up to landConcurrency landings at once, starting them in the order work finished", async () => {
  const { note, tape } = recorder()
  let inFlight = 0
  let widest = 0
  const result = await runRound({ items: items("a", "b", "c", "d") }, {
    ...baseOptions(note),
    work: timed(note, { a: 1, b: 2, c: 3, d: 4 }),
    landConcurrency: 2,
    land: ({ item }) =>
      Effect.gen(function*() {
        yield* note(`land:${item.id}`)
        inFlight += 1
        widest = Math.max(widest, inFlight)
        yield* Effect.sleep("20 millis")
        inFlight -= 1
        if (item.id === "b") return yield* Effect.fail("red")
      })
  })
  expect(result.rows.map((row) => `${row.id}:${row.status}`)).toEqual(["a:landed", "b:failed", "c:landed", "d:landed"])
  expect(widest).toBe(2)
  expect(tape.filter((entry) => entry.startsWith("land:"))).toEqual(["land:a", "land:b", "land:c", "land:d"])
})

test("Burndown.round hands what land answered to detail, and each row's detail to release", async () => {
  const { note, tape } = recorder()
  const result = await runRound({ items: items("a", "b") }, {
    ...baseOptions(note),
    land: ({ item }): Effect.Effect<string, string> => item.id === "a" ? Effect.succeed(`rev-${item.id}`) : Effect.fail("checks red"),
    detail: (output: string, landing: string | undefined) => `${output} as ${landing}`,
    release: ({ detail, item, status }) => note(`release:${item.id}:${status}:${detail}`)
  })
  expect(result.rows).toEqual([{ id: "a", status: "landed", detail: "fixed a as rev-a" }, { id: "b", status: "failed", detail: "land: checks red" }])
  expect(tape.filter((entry) => entry.startsWith("release:"))).toEqual(["release:a:landed:fixed a as rev-a", "release:b:failed:land: checks red"])
})

test("Burndown.round renders a landed detail with no landing when there is no land stage", async () => {
  const seen: Array<unknown> = []
  const { note } = recorder()
  await runRound({ items: items("a") }, { ...baseOptions(note), detail: (output: string, landing: unknown) => (seen.push(landing), output) })
  expect(seen).toEqual([undefined])
})

test("Burndown.round skips landing when nothing worked", async () => {
  const { note, tape } = recorder()
  const result = await runRound({ items: items("a") }, { ...baseOptions(note), work: () => Effect.fail("boom"), land: () => note("land") })
  expect(result.rows).toEqual([{ id: "a", status: "failed", detail: "work: boom" }])
  expect(tape).not.toContain("land")
})

test("Burndown.round never runs more than concurrency items at once", async () => {
  let inFlight = 0
  let widest = 0
  const { note } = recorder()
  const result = await runRound({ items: items("a", "b", "c", "d", "e", "f") }, {
    ...baseOptions(note),
    concurrency: 2,
    work: () =>
      Effect.gen(function*() {
        inFlight += 1
        widest = Math.max(widest, inFlight)
        yield* Effect.sleep("3 millis")
        inFlight -= 1
        return "ok"
      })
  })
  expect(result.launched).toBe(6)
  expect(widest).toBe(2)
})

test("Burndown.round launches only as many items as the slots and defers the rest", async () => {
  const { note, tape } = recorder()
  const result = await runRound({ items: items("a", "b", "c"), slots: 2 }, baseOptions(note))
  expect(result).toEqual({ rows: [{ id: "a", status: "landed", detail: "" }, { id: "b", status: "landed", detail: "" }], launched: 2, deferred: 1 })
  expect(tape).not.toContain("claim:c")
})

test("Burndown.round reads its items and options at the call, not when the Effect runs", async () => {
  const { note } = recorder()
  const backlog = [{ id: "a" }]
  const options = { ...baseOptions(note), detail: () => "first" }
  const effect = Burndown.round({ input: undefined, round: 0, items: backlog }, options)
  backlog[0]!.id = "z"
  backlog.push({ id: "b" })
  options.detail = () => "swapped"
  expect((await Effect.runPromise(effect)).rows).toEqual([{ id: "a", status: "landed", detail: "first" }])
})

test("Burndown.round refuses a malformed round before any stage runs", async () => {
  const refusals = [
    [{}, { key: " " }, "invalid_decorator", "Burndown key must be a nonblank string"],
    [{}, { key: 3 }, "invalid_decorator", "Burndown key must be a nonblank string"],
    [{}, { concurrency: 0 }, "invalid_decorator", "Burndown concurrency must be a positive safe integer, received 0"],
    [{ round: -1 }, {}, "invalid_input", "Burndown round must be a non-negative safe integer"],
    [{ round: "1" }, {}, "invalid_input", "Burndown round must be a non-negative safe integer"],
    [{ round: 0.5 }, {}, "invalid_input", "Burndown round must be a non-negative safe integer"],
    [{ slots: 0 }, {}, "invalid_input", "Burndown slots must be a positive safe integer"],
    [{ slots: "2" }, {}, "invalid_input", "Burndown slots must be a positive safe integer"],
    [{}, { landConcurrency: 0 }, "invalid_decorator", "Burndown landConcurrency must be a positive safe integer"],
    [{}, { landConcurrency: 1.5 }, "invalid_decorator", "Burndown landConcurrency must be a positive safe integer"],
    [{ settled: "a" }, {}, "invalid_input", "Burndown settled must be an array of item ids"],
    [{ items: { a: 1 } }, {}, "invalid_input", "Burndown items must be an array"],
    [{ items: [{ id: "" }] }, {}, "invalid_input", "Burndown items must each have a nonblank string id"],
    [{ items: [{ id: 1 }] }, {}, "invalid_input", "Burndown items must each have a nonblank string id"],
    [{ items: [null] }, {}, "invalid_input", "Burndown items must each have a nonblank string id"],
    [{ items: [Object.create({ id: "inherited" })] }, {}, "invalid_input", "Burndown items must each have a nonblank string id"],
    [{ items: [{ id: "a" }, { id: "a" }] }, {}, "invalid_input", "Burndown item ids must be unique, \"a\" (length 1) repeats"]
  ] as const
  for (const [input, options, code, message] of refusals) {
    const error = await refusedRound(input, options)
    expect(error).toBeInstanceOf(PatternError)
    expect(error).toMatchObject({ code, message })
  }
})

for (const member of ["select", "claim", "work", "land", "release", "detail"] as const) {
  for (const synchronous of [false, true]) {
    if (member === "detail" && !synchronous) continue
    test(`Burndown.round isolates a ${synchronous ? "throw" : "defect"} in ${member} and releases only acquired claims once`, async () => {
      const { note, tape } = recorder()
      const broken = () => {
        if (synchronous) throw new Error(`${member} exploded`)
        return Effect.die(new Error(`${member} exploded`))
      }
      const result = await runRound({ items: items("bad", "sibling") }, {
        ...baseOptions(note),
        select: ({ item }) => item.id === "bad" && member === "select" ? broken() : Effect.succeed(Burndown.ours),
        claim: ({ item }) => item.id === "bad" && member === "claim" ? broken() : note(`claim:${item.id}`),
        work: ({ item }) => item.id === "bad" && member === "work" ? broken() : Effect.succeed(item.id),
        land: ({ item }) => item.id === "bad" && member === "land" ? broken() : note(`land:${item.id}`),
        release: ({ item, status }) =>
          Effect.andThen(note(`release:${item.id}:${status}`), Effect.suspend(() => item.id === "bad" && member === "release" ? broken() : Effect.void)),
        detail: (output: string) => {
          if (output === "bad" && member === "detail") throw new Error("detail exploded")
          return output
        }
      })
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toMatchObject({ id: "bad", status: "failed" })
      expect(result.rows[0]!.detail).toContain(`${member}: ${member} exploded`)
      expect(result.rows[1]).toMatchObject({ id: "sibling", status: "landed", detail: "sibling" })
      expect(tape.filter((entry) => entry.startsWith("release:sibling:"))).toEqual(["release:sibling:landed"])
      expect(tape.filter((entry) => entry.startsWith("release:bad:"))).toHaveLength(member === "select" || member === "claim" ? 0 : 1)
    })
  }
}

test("Burndown.round fails an item with a defect detail when there is no land stage and detail throws", async () => {
  const { note } = recorder()
  const result = await runRound({ items: items("bad", "good") }, {
    ...baseOptions(note),
    detail: (output: string) => {
      if (output === "fixed bad") throw new Error("detail exploded")
      return output
    }
  })
  expect(result.rows).toEqual([{ id: "bad", status: "failed", detail: "detail: detail exploded" }, { id: "good", status: "landed", detail: "fixed good" }])
})

test("Burndown.round propagates typed Stop from work and stops admitting further items", async () => {
  const { note, tape } = recorder()
  const stop = new Burndown.Stop({ message: "workspace unavailable" })
  const exit = await Effect.runPromiseExit(Burndown.round({ input: null, round: 0, items: items("stop", "later") }, {
    ...baseOptions(note),
    concurrency: 1,
    work: () => Effect.fail(stop)
  }))
  expect(exit).toEqual(Exit.fail(stop))
  expect(tape).not.toContain("claim:later")
  expect(tape.filter((entry) => entry.startsWith("release:stop:"))).toHaveLength(1)
})

for (const stage of ["select", "claim", "land", "release", "capacity", "cancelled"] as const) {
  test(`Burndown.round propagates typed Stop from ${stage}`, async () => {
    const { note, tape } = recorder()
    const stop = new Burndown.Stop({ message: `${stage} stopped` })
    const exit = await Effect.runPromiseExit(Burndown.round({ input: null, round: 0, items: items("a", "b"), slots: 1 }, {
      ...baseOptions(note),
      concurrency: 1,
      select: () => stage === "select" ? Effect.fail(stop) : Effect.succeed(Burndown.ours),
      claim: ({ item }) => stage === "claim" ? Effect.fail(stop) : note(`claim:${item.id}`),
      work: ({ item }) => stage === "cancelled" ? Effect.interrupt : Effect.succeed(item.id),
      cancelled: () => Effect.fail(stop),
      land: () => stage === "land" ? Effect.fail(stop) : Effect.void,
      release: ({ item }) => Effect.andThen(note(`release:${item.id}`), stage === "release" ? Effect.fail(stop) : Effect.void),
      capacity: () => stage === "capacity" ? Effect.fail(stop) : Effect.succeed(Burndown.exhausted("no capacity"))
    }))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(exit.cause.reasons.some((reason) => reason._tag === "Fail" && reason.error === stop)).toBe(true)
    expect(tape).not.toContain("claim:b")
  })
}

test("Burndown.round isolates Stop on the defect channel", async () => {
  const { note } = recorder()
  const result = await runRound({ items: items("bad", "good") }, {
    ...baseOptions(note),
    work: ({ item }) => item.id === "bad" ? Effect.die(new Burndown.Stop({ message: "thrown Stop" })) : Effect.succeed("ok")
  })
  expect(result.rows[0]).toMatchObject({ status: "failed", detail: "work: thrown Stop" })
  expect(result.rows[1]).toMatchObject({ status: "landed" })
})

test("Burndown.round isolates failures with a throwing message or string conversion", async () => {
  const unreadable = Object.defineProperty({}, "message", { get: () => { throw new Error("message getter") } })
  const unprintable = { toString: () => { throw new Error("string conversion") } }
  for (const failure of [unreadable, unprintable]) {
    const { note, tape } = recorder()
    const result = await runRound({ items: items("bad", "good") }, {
      ...baseOptions(note),
      work: ({ item }) => item.id === "bad" ? Effect.fail(failure) : Effect.succeed("ok")
    })
    expect(result.rows[0]).toMatchObject({ status: "failed", detail: "work: unrenderable failure" })
    expect(result.rows[1]).toMatchObject({ status: "landed" })
    expect(tape.filter((entry) => entry.startsWith("release:"))).toHaveLength(2)
  }
})

// A scripted burndown: each round's backlog, selection and capacity come from
// the script, and every stage notes its call.
interface Script {
  readonly discover: (round: number) => ReadonlyArray<Issue>
  readonly select?: (item: Issue, round: number) => Patterns.Burndown.Selection
  readonly claim?: (item: Issue) => Effect.Effect<void, Patterns.Burndown.Held | string>
  readonly work?: (item: Issue) => Effect.Effect<string, string>
  readonly capacity?: (call: number) => unknown
}

const scripted = (script: Script, maxRounds: number) => {
  const { note, tape } = recorder()
  let capacityCalls = 0
  const options: Patterns.Burndown.Options<unknown, Issue, string, string, never, unknown, never, never, never, never> = {
    discover: ({ round }) => Effect.as(note(`discover:${round}`), script.discover(round)),
    ...(script.capacity === undefined ? {} : {
      capacity: ({ round }) => Effect.as(note(`capacity:${round}`), script.capacity!(capacityCalls++) as Patterns.Burndown.Capacity)
    }),
    dispatch: {
      key: "test",
      concurrency: 2,
      ...(script.select === undefined ? {} : { select: ({ item, round }) => Effect.succeed(script.select!(item, round)) }),
      claim: ({ item }) => Effect.andThen(note(`claim:${item.id}`), script.claim?.(item) ?? Effect.void),
      work: ({ item, round }) => Effect.andThen(note(`work:${item.id}@${round}`), script.work?.(item) ?? Effect.succeed("ok")),
      release: ({ item, status }) => note(`release:${item.id}:${status}`)
    },
    maxRounds
  }
  return { tape, options }
}

test("Burndown.run rediscovers the backlog each round until a round launches nothing", async () => {
  const backlog: Record<number, ReadonlyArray<Issue>> = { 0: items("a", "b"), 1: items("a", "b", "c"), 2: items("a", "b", "c") }
  const { options, tape } = scripted({ discover: (round) => backlog[round] ?? [] }, 10)
  expect(await Effect.runPromise(Burndown.run({ repo: "acme/app" }, options))).toEqual({
    rows: [{ id: "a", status: "landed", detail: "" }, { id: "b", status: "landed", detail: "" }, { id: "c", status: "landed", detail: "" }],
    rounds: 3,
    stopped: "drained"
  })
  expect(tape.filter((entry) => entry.startsWith("discover:"))).toEqual(["discover:0", "discover:1", "discover:2"])
  expect(tape.filter((entry) => entry.startsWith("work:"))).toEqual(["work:a@0", "work:b@0", "work:c@1"])
})

test("Burndown.run never retries a held or failed item in a later round", async () => {
  const { options, tape } = scripted({
    discover: (round) => round < 3 ? items("held", "broken", "fresh") : [],
    claim: (item) => item.id === "held" ? Effect.fail(new Burndown.Held({ message: "mac-mini" })) : Effect.void,
    work: (item) => item.id === "broken" ? Effect.fail("tests red") : Effect.succeed("ok")
  }, 5)
  expect(await Effect.runPromise(Burndown.run(null, options))).toEqual({
    rows: [
      { id: "held", status: "held", detail: "mac-mini" },
      { id: "broken", status: "failed", detail: "work: tests red" },
      { id: "fresh", status: "landed", detail: "" }
    ],
    rounds: 2,
    stopped: "drained"
  })
  expect(tape.filter((entry) => entry.startsWith("claim:")).sort()).toEqual(["claim:broken", "claim:fresh", "claim:held"])
})

test("Burndown.run works an item again in a later round after its work was interrupted without a cancel", async () => {
  let attempts = 0
  const { options, tape } = scripted({
    discover: () => items("a", "b"),
    work: (item) => item.id === "a" && attempts++ === 0 ? Effect.interrupt : Effect.succeed("ok")
  }, 5)
  expect(await Effect.runPromise(Burndown.run(null, options))).toEqual({
    rows: [{ id: "a", status: "landed", detail: "" }, { id: "b", status: "landed", detail: "" }],
    rounds: 3,
    stopped: "drained"
  })
  expect(tape.filter((entry) => entry.startsWith("work:a") || entry.startsWith("release:a"))).toEqual(["work:a@0", "release:a:requeued", "work:a@1", "release:a:landed"])
})

test("Burndown.run replaces a skipped row once a later round calls the item ours", async () => {
  const { options } = scripted({
    discover: () => items("a", "b"),
    select: (item, round) => item.id === "b" && round === 0 ? Burndown.skip("claimed elsewhere") : Burndown.ours
  }, 5)
  expect(await Effect.runPromise(Burndown.run(null, options))).toEqual({
    rows: [{ id: "a", status: "landed", detail: "" }, { id: "b", status: "landed", detail: "" }],
    rounds: 3,
    stopped: "drained"
  })
})

test("Burndown.run fails instead of draining when every selection errs", async () => {
  const { options, tape } = scripted({ discover: () => items("a", "b") }, 5)
  const exit = await Effect.runPromiseExit(Burndown.run(null, {
    ...options,
    dispatch: { ...options.dispatch, select: ({ item }) => Effect.fail(`triage: unconfigured: no judge for ${item.id}`) }
  }))
  const stop = failOf(exit)
  expect(stop).toBeInstanceOf(Burndown.Stop)
  expect((stop as Patterns.Burndown.Stop).message).toContain("a: select failed: triage: unconfigured: no judge for a")
  expect(tape).toEqual(["discover:0"])
})

test("Burndown.run still drains when a round skips every item by policy", async () => {
  const { options, tape } = scripted({ discover: () => items("a", "b"), select: (item) => Burndown.skip(`claimed elsewhere ${item.id}`) }, 5)
  expect(await Effect.runPromise(Burndown.run(null, options))).toEqual({
    rows: [{ id: "a", status: "skipped", detail: "claimed elsewhere a" }, { id: "b", status: "skipped", detail: "claimed elsewhere b" }],
    rounds: 1,
    stopped: "drained"
  })
  expect(tape.filter((entry) => entry.startsWith("claim:"))).toEqual([])
})

test("Burndown.run stops at the round budget", async () => {
  const { options } = scripted({ discover: (round) => items(`item-${round}`) }, 2)
  expect(await Effect.runPromise(Burndown.run(null, options))).toEqual({
    rows: [{ id: "item-0", status: "landed", detail: "" }, { id: "item-1", status: "landed", detail: "" }],
    rounds: 2,
    stopped: "max_rounds"
  })
})

test("Burndown.run launches only the capacity's slots and picks the rest up next round", async () => {
  const { options, tape } = scripted({ discover: () => items("a", "b", "c"), capacity: () => Burndown.available(2) }, 5)
  const result = await Effect.runPromise(Burndown.run(null, options))
  expect(result.rows.map((row) => row.status)).toEqual(["landed", "landed", "landed"])
  expect(result).toMatchObject({ rounds: 3, stopped: "drained" })
  expect(tape.filter((entry) => entry.startsWith("work:"))).toEqual(["work:a@0", "work:b@0", "work:c@1"])
})

test("Burndown.run waits until the capacity's reset instant, then asks again", async () => {
  const { options, tape } = scripted({
    discover: () => items("a"),
    capacity: (call) => call === 0 ? Burndown.waitUntil(Date.now() + 20) : Burndown.available(1)
  }, 5)
  const started = Date.now()
  const result = await Effect.runPromise(Burndown.run(null, options))
  expect(Date.now() - started).toBeGreaterThanOrEqual(15)
  expect(result).toEqual({ rows: [{ id: "a", status: "landed", detail: "" }], rounds: 3, stopped: "drained" })
  expect(tape.slice(0, 3)).toEqual(["capacity:0", "capacity:1", "discover:1"])
})

test("Burndown.run settles at the budget when a wait spends the last round", async () => {
  const { options, tape } = scripted({ discover: () => items("a"), capacity: () => Burndown.waitUntil(0) }, 1)
  expect(await Effect.runPromise(Burndown.run(null, options))).toEqual({ rows: [], rounds: 1, stopped: "max_rounds" })
  expect(tape).toEqual(["capacity:0"])
})

test("Burndown.run fails exhausted on exhausted capacity without discovering", async () => {
  const { options, tape } = scripted({ discover: () => items("a"), capacity: () => Burndown.exhausted("every account is out of credit") }, 5)
  const failure = await Effect.runPromise(Effect.flip(Burndown.run(null, options)))
  expect(failure).toBeInstanceOf(PatternError)
  expect(failure).toMatchObject({ code: "exhausted", message: "Burndown capacity is exhausted: every account is out of credit" })
  expect(tape).toEqual(["capacity:0"])
})

test("Burndown.run dies when the capacity breaks its contract, and fails with the discovery's failure", async () => {
  for (const answer of [{ _tag: "Available", slots: 0 }, { _tag: "WaitUntil", at: Number.NaN }, { _tag: "Exhausted" }, null, "Available"]) {
    const { options } = scripted({ discover: () => items("a"), capacity: () => answer }, 2)
    const exit = await Effect.runPromiseExit(Burndown.run(null, options))
    expect(Exit.isFailure(exit) && exit.cause.reasons.some((reason) => reason._tag === "Die")).toBe(true)
  }
  const { options } = scripted({ discover: () => items("a") }, 2)
  const failure = await Effect.runPromise(Effect.flip(Burndown.run(null, { ...options, discover: () => Effect.fail("tracker down") })))
  expect(failure).toBe("tracker down")
})

test("Burndown.run refuses a round budget it cannot bound", async () => {
  const { options } = scripted({ discover: () => [] }, 1)
  for (const maxRounds of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER]) {
    const failure = await Effect.runPromise(Effect.flip(Burndown.run(null, { ...options, maxRounds })))
    expect(failure).toMatchObject({
      code: "invalid_decorator",
      message: "Burndown maxRounds must be a positive safe integer below Number.MAX_SAFE_INTEGER"
    })
  }
})

test("Burndown.run reads its options at the call, not when the Effect runs", async () => {
  const { options, tape } = scripted({ discover: (round) => items(`item-${round}`) }, 1)
  const mutable = { ...options, dispatch: { ...options.dispatch } }
  const program = Burndown.run(null, mutable)
  mutable.maxRounds = 3
  mutable.dispatch.key = " "
  expect(await Effect.runPromise(program)).toMatchObject({ rounds: 1, stopped: "max_rounds" })
  expect(tape).toContain("work:item-0@0")
})

test("property: a burndown lands every item that works and fails the rest, each claimed once, and drains within the bound", async () => {
  await checkProperty(fc, {
    name: "patterns-burndown-drains",
    rule: "VIP-73: Burndown.run works a backlog down round after round at a concurrency and capacity the burndown owns",
    command: "bun test tests/experimental-patterns-burndown.test.ts",
    arbitrary: fc.record({
      outcomes: fc.array(fc.constantFrom("lands", "fails", "held"), { minLength: 1, maxLength: 6 }),
      slots: fc.integer({ min: 1, max: 4 }),
      concurrency: fc.integer({ min: 1, max: 3 })
    }),
    numRuns: 100,
    check: async ({ outcomes, slots, concurrency }: { readonly outcomes: ReadonlyArray<"lands" | "fails" | "held">; readonly slots: number; readonly concurrency: number }) => {
      const backlog = outcomes.map((_, index) => ({ id: `i${index}` }))
      const claims: Array<string> = []
      const result = await Effect.runPromise(Burndown.run(null, {
        discover: () => Effect.succeed(backlog),
        capacity: () => Effect.succeed(Burndown.available(slots)),
        dispatch: {
          key: "k",
          concurrency,
          claim: ({ item }) =>
            Effect.suspend(() => (claims.push(item.id), outcomes[Number(item.id.slice(1))] === "held" ? Effect.fail(new Burndown.Held({ message: "theirs" })) : Effect.void)),
          work: ({ item }) => outcomes[Number(item.id.slice(1))] === "fails" ? Effect.fail("red") : Effect.succeed("ok"),
          release: () => Effect.void
        },
        maxRounds: 20
      }))
      const expected = { lands: "landed", fails: "failed", held: "held" } as const
      expect(result.stopped).toBe("drained")
      expect(result.rows.map((row) => row.status)).toEqual(outcomes.map((outcome) => expected[outcome]))
      expect([...claims].sort()).toEqual(backlog.map((item) => item.id).sort())
      expect(result.rounds).toBe(Math.ceil(outcomes.length / Math.min(slots, outcomes.length)) + 1)
    }
  })
})
