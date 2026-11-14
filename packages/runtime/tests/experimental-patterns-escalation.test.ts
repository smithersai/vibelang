import { expect, test } from "bun:test"
import fc from "fast-check"
import * as Effect from "effect/Effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as EscalationModule from "vibelang-runtime/experimental/patterns/Escalation"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { Escalation, PatternError, ReviewLoop } = Patterns

test("Escalation: the subpath module is the namespace's module", () => {
  expect(EscalationModule.run).toBe(Escalation.run)
})

test("Escalation.run stops after acceptance", async () => {
  const attempts: Array<string> = []
  const rung = (name: string, value: string) => () => Effect.sync(() => (attempts.push(name), value))
  const reached = await Effect.runPromise(Escalation.run("request", {
    rungs: [rung("first", "draft"), rung("second", "accepted"), rung("third", "unreachable")],
    accept: (value) => Effect.succeed(value === "accepted")
  }))
  expect(reached).toEqual({ level: 1, result: "accepted", exhausted: false })
  expect(attempts).toEqual(["first", "second"])
})

test("Escalation uses the same own-property acceptance vocabulary as ReviewLoop", async () => {
  const inherited = Object.create({ approved: true }) as unknown
  for (const decision of [true, "approved", { approved: true }, { accepted: true }]) {
    const reached = await Effect.runPromise(Escalation.run("request", {
      rungs: [() => Effect.succeed("cheap"), () => Effect.succeed("expensive")],
      accept: () => Effect.succeed(decision)
    }))
    expect(Escalation.accepted(decision)).toBe(true)
    expect(ReviewLoop.accepted(decision)).toBe(true)
    expect(reached).toEqual({ level: 0, result: "cheap", exhausted: false })
  }
  for (const decision of [{ approved: "yes" }, { accepted: 1 }, { approved: false }, "Approved", inherited]) {
    const reached = await Effect.runPromise(Escalation.run("request", {
      rungs: [() => Effect.succeed("cheap"), () => Effect.succeed("expensive")],
      accept: () => Effect.succeed(decision)
    }))
    expect(Escalation.accepted(decision)).toBe(false)
    expect(ReviewLoop.accepted(decision)).toBe(false)
    expect(reached).toEqual({ level: 1, result: "expensive", accepted: false, exhausted: true })
  }
})

test("Escalation.run escalates on the default predicate when there is no accept", async () => {
  const attempts: Array<number> = []
  const reached = await Effect.runPromise(Escalation.run("request", {
    rungs: [
      () => Effect.sync(() => (attempts.push(0), { ok: false })),
      () => Effect.sync(() => (attempts.push(1), { ok: true }))
    ]
  }))
  expect(reached).toEqual({ level: 1, result: { ok: true }, exhausted: false })
  expect(attempts).toEqual([0, 1])
})

test("Escalation.defaultEscalate escalates on a failure marker and settles on anything else", () => {
  expect(Escalation.defaultEscalate(undefined)).toBe(true)
  expect(Escalation.defaultEscalate(null)).toBe(true)
  expect(Escalation.defaultEscalate({ error: "boom" })).toBe(true)
  expect(Escalation.defaultEscalate({ error: 0 })).toBe(true)
  expect(Escalation.defaultEscalate({ failed: true })).toBe(true)
  expect(Escalation.defaultEscalate({ ok: false })).toBe(true)
  expect(Escalation.defaultEscalate({ ok: true })).toBe(false)
  expect(Escalation.defaultEscalate({ error: false })).toBe(false)
  expect(Escalation.defaultEscalate({ error: null })).toBe(false)
  expect(Escalation.defaultEscalate({ error: undefined })).toBe(false)
  expect(Escalation.defaultEscalate("done")).toBe(false)
})

test("Escalation.run stops at a rung whose escalateIf refuses even when accept would escalate", async () => {
  const attempts: Array<number> = []
  const reached = await Effect.runPromise(Escalation.run("request", {
    rungs: [
      { run: () => Effect.sync(() => (attempts.push(0), "cheap")), escalateIf: () => Effect.succeed(false) },
      () => Effect.sync(() => (attempts.push(1), "strong"))
    ],
    accept: () => Effect.succeed(false)
  }))
  expect(reached).toEqual({ level: 0, result: "cheap", exhausted: false })
  expect(attempts).toEqual([0])
})

test("Escalation.run hands each escalateIf its own result and rung level", async () => {
  const seen: Array<readonly [string, number]> = []
  await Effect.runPromise(Escalation.run("request", {
    rungs: [
      { run: () => Effect.succeed("a"), escalateIf: (result, level) => Effect.sync(() => seen.push([result, level]) > 0) },
      { run: () => Effect.succeed("b"), escalateIf: (result, level) => Effect.sync(() => seen.push([result, level]) < 0) }
    ]
  }))
  expect(seen).toEqual([["a", 0], ["b", 1]])
})

test("Escalation.run passes the input to every rung and to the fallback", async () => {
  const seen: Array<string> = []
  const reached = await Effect.runPromise(Escalation.run("request", {
    rungs: [(input: string) => Effect.sync(() => (seen.push(`rung:${input}`), { ok: false }))],
    fallback: (input: string) => Effect.sync(() => (seen.push(`fallback:${input}`), "human"))
  }))
  expect(seen).toEqual(["rung:request", "fallback:request"])
  expect(reached).toEqual({ level: 1, result: "human", exhausted: false })
})

test("Escalation.run runs the fallback only after every rung escalates", async () => {
  let fallbacks = 0
  const fallback = () => Effect.sync(() => (fallbacks = fallbacks + 1, "human"))
  const reached = await Effect.runPromise(Escalation.run("request", {
    rungs: [() => Effect.succeed({ ok: false }), () => Effect.succeed({ ok: false })],
    fallback
  }))
  expect(reached).toEqual({ level: 2, result: "human", exhausted: false })
  expect(fallbacks).toBe(1)
  const early = await Effect.runPromise(Escalation.run("request", {
    rungs: [() => Effect.succeed({ ok: true }), () => Effect.succeed({ ok: false })],
    fallback
  }))
  expect(early).toEqual({ level: 0, result: { ok: true }, exhausted: false })
  expect(fallbacks).toBe(1)
})

test("Escalation.run returns the last result when the ladder is exhausted without a fallback", async () => {
  const exhausted = await Effect.runPromise(Escalation.run("request", {
    rungs: [() => Effect.succeed({ ok: false }), () => Effect.succeed({ ok: false, note: "last" })]
  }))
  expect(exhausted).toEqual({ level: 1, result: { ok: false, note: "last" }, accepted: false, exhausted: true })
})

test("Escalation.run does not admit a rung appended while the run is in flight", async () => {
  const attempts: Array<string> = []
  const rungs: Array<(input: string) => Effect.Effect<{ readonly ok: boolean }>> = []
  const late = () => Effect.sync(() => (attempts.push("late"), { ok: true }))
  rungs.push(() => Effect.sync(() => (attempts.push("first"), rungs.push(late), { ok: false })))
  const result = await Effect.runPromise(Escalation.run("request", { rungs }))
  expect(attempts).toEqual(["first"])
  expect(result).toEqual({ level: 0, result: { ok: false }, accepted: false, exhausted: true })
})

test("Escalation.run reads its options at the call, not when the Effect runs", async () => {
  const rungs: Array<(input: string) => Effect.Effect<string>> = [() => Effect.succeed("cheap")]
  const options: {
    rungs: typeof rungs
    accept: ((result: string) => Effect.Effect<boolean>) | undefined
  } = { rungs, accept: () => Effect.succeed(true) }
  const program = Escalation.run("request", options)
  rungs.push(() => Effect.succeed("late"))
  options.accept = () => Effect.succeed(false)
  expect(await Effect.runPromise(program)).toEqual({ level: 0, result: "cheap", exhausted: false })
})

test("Escalation.run fails with a PatternError for an empty ladder", async () => {
  const error = await Effect.runPromise(Effect.flip(
    Escalation.run("request", { rungs: [] as ReadonlyArray<(input: string) => Effect.Effect<string>> })
  ))
  expect(error).toBeInstanceOf(PatternError)
  expect(error.code).toBe("invalid_decorator")
  expect(error.message).toBe("Escalation requires at least one rung")
})

test("property: a ladder settles on the first accepted rung, else falls back or reports the last rung exhausted", async () => {
  await checkProperty(fc, {
    name: "patterns-escalation-first-accepted",
    rule: "VIP-73: Escalation.run tries each rung in order until one result is accepted",
    command: "bun test tests/experimental-patterns-escalation.test.ts",
    arbitrary: fc.record({
      accepts: fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
      withFallback: fc.boolean()
    }),
    numRuns: 200,
    check: async ({ accepts, withFallback }: { readonly accepts: ReadonlyArray<boolean>; readonly withFallback: boolean }) => {
      const ran: Array<number> = []
      const rungs = accepts.map((ok, index) => () => Effect.sync(() => (ran.push(index), { ok, index })))
      const result = await Effect.runPromise(Escalation.run("input", {
        rungs,
        ...(withFallback ? { fallback: () => Effect.succeed({ ok: true, index: -1 }) } : {})
      }))
      const first = accepts.indexOf(true)
      if (first >= 0) {
        expect(result).toEqual({ level: first, result: { ok: true, index: first }, exhausted: false })
        expect(ran).toEqual(Array.from({ length: first + 1 }, (_, index) => index))
      } else if (withFallback) {
        expect(result).toEqual({ level: accepts.length, result: { ok: true, index: -1 }, exhausted: false })
      } else {
        const last = accepts.length - 1
        expect(result).toEqual({ level: last, result: { ok: false, index: last }, accepted: false, exhausted: true })
      }
    }
  })
})
