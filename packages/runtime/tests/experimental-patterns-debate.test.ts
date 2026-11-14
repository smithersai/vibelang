import { expect, test } from "bun:test"
import fc from "fast-check"
import * as Effect from "effect/Effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as DebateModule from "vibelang-runtime/experimental/patterns/Debate"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { Debate, PatternError } = Patterns

test("Debate: the subpath module is the namespace's module", () => {
  expect(DebateModule.run).toBe(Debate.run)
})

test("Debate.run runs participants with a real accumulated transcript", async () => {
  const seen: Array<unknown> = []
  const result = await Effect.runPromise(Debate.run("topic", {
    rounds: 2,
    proponent: ({ input, round, transcript }) => {
      seen.push(["proponent", input, round, transcript.length])
      return Effect.succeed(`p${round}`)
    },
    opponent: ({ input, proponent, round, transcript }) => {
      seen.push(["opponent", input, proponent, round, transcript.length])
      return Effect.succeed(`o${round}`)
    },
    judge: ({ input, transcript }) => Effect.succeed({ input, transcript })
  }))
  expect(seen).toEqual([
    ["proponent", "topic", 1, 0],
    ["opponent", "topic", "p1", 1, 0],
    ["proponent", "topic", 2, 1],
    ["opponent", "topic", "p2", 2, 1]
  ])
  expect(result).toEqual({
    input: "topic",
    transcript: [{ proponent: "p1", opponent: "o1" }, { proponent: "p2", opponent: "o2" }]
  })
})

test("Debate.run hands every stage a frozen transcript copy", async () => {
  const retained: Array<ReadonlyArray<DebateModule.RuntimeTurn<unknown, unknown>>> = []
  const tryForge = (transcript: ReadonlyArray<DebateModule.RuntimeTurn<unknown, unknown>>) => {
    retained.push(transcript)
    try {
      ;(transcript as Array<DebateModule.RuntimeTurn<unknown, unknown>>).push({ proponent: "forged", opponent: "forged" })
    } catch {
      // A frozen transcript refuses the forged turn.
    }
  }
  const result = await Effect.runPromise(Debate.run("topic", {
    rounds: 2,
    proponent: ({ round, transcript }) => (tryForge(transcript), Effect.succeed(`p${round}`)),
    opponent: ({ round, transcript }) => (tryForge(transcript), Effect.succeed(`o${round}`)),
    judge: ({ transcript }) => (tryForge(transcript), Effect.succeed(transcript))
  }))
  expect(retained.every(Object.isFrozen)).toBe(true)
  expect(retained.map((transcript) => transcript.length)).toEqual([0, 0, 1, 1, 2])
  expect(result).toEqual([{ proponent: "p1", opponent: "o1" }, { proponent: "p2", opponent: "o2" }])
})

test("Debate.run freezes turns so a participant cannot rewrite history", async () => {
  let reassignment: unknown
  let deletion: unknown
  const result = await Effect.runPromise(Debate.run("topic", {
    rounds: 2,
    proponent: ({ round, transcript }) => {
      if (round === 2) {
        const first = transcript[0] as { proponent?: string; opponent?: string }
        try {
          first.proponent = "forged"
        } catch (error) {
          reassignment = error
        }
        try {
          delete first.opponent
        } catch (error) {
          deletion = error
        }
      }
      return Effect.succeed(`p${round}`)
    },
    opponent: ({ round }) => Effect.succeed(`o${round}`),
    judge: ({ transcript }) => Effect.succeed(transcript)
  }))
  expect(reassignment).toBeInstanceOf(TypeError)
  expect(deletion).toBeInstanceOf(TypeError)
  expect(result).toEqual([{ proponent: "p1", opponent: "o1" }, { proponent: "p2", opponent: "o2" }])
})

test("Debate.run fails with a stage's own failure and stops there", async () => {
  let judged = false
  const failure = await Effect.runPromise(Effect.flip(Debate.run("topic", {
    rounds: 3,
    proponent: ({ round }) => Effect.succeed(round),
    opponent: ({ round }) => round === 2 ? Effect.fail("opponent left" as const) : Effect.succeed(round),
    judge: () => Effect.sync(() => (judged = true))
  })))
  expect(failure).toBe("opponent left")
  expect(judged).toBe(false)
})

test("Debate.run refuses a round count that is not a positive safe integer", async () => {
  for (const rounds of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const failure = await Effect.runPromise(Effect.flip(Debate.run("topic", {
      rounds,
      proponent: () => Effect.succeed("unused"),
      opponent: () => Effect.succeed("unused"),
      judge: () => Effect.succeed("unused")
    })))
    expect(failure).toBeInstanceOf(PatternError)
    expect(failure).toMatchObject({
      code: "invalid_decorator",
      message: `Debate rounds must be a positive safe integer, received ${rounds}`
    })
  }
})

test("Debate.run reads its options at the call, not when the Effect runs", async () => {
  const options: {
    rounds: number
    proponent: () => Effect.Effect<string>
    opponent: () => Effect.Effect<string>
    judge: (state: { readonly transcript: ReadonlyArray<unknown> }) => Effect.Effect<number>
  } = {
    rounds: 1,
    proponent: () => Effect.succeed("p"),
    opponent: () => Effect.succeed("o"),
    judge: ({ transcript }) => Effect.succeed(transcript.length)
  }
  const program = Debate.run("topic", options)
  options.rounds = 0
  options.judge = () => Effect.succeed(-1)
  expect(await Effect.runPromise(program)).toBe(1)
})

test("property: a debate of n rounds gives the judge n alternating turns in order", async () => {
  await checkProperty(fc, {
    name: "patterns-debate-transcript",
    rule: "VIP-73: Debate.run is a bounded, alternating exchange that a judge settles",
    command: "bun test tests/experimental-patterns-debate.test.ts",
    arbitrary: fc.integer({ min: 1, max: 12 }),
    numRuns: 100,
    check: async (rounds: number) => {
      const calls: Array<string> = []
      const transcript = await Effect.runPromise(Debate.run("q", {
        rounds,
        proponent: ({ round, transcript }) => Effect.sync(() => (calls.push(`p${round}:${transcript.length}`), `p${round}`)),
        opponent: ({ round, proponent }) => Effect.sync(() => (calls.push(`o${round}:${proponent}`), `o${round}`)),
        judge: ({ transcript }) => Effect.succeed(transcript)
      }))
      expect(transcript).toEqual(Array.from({ length: rounds }, (_, index) => ({ proponent: `p${index + 1}`, opponent: `o${index + 1}` })))
      expect(calls).toEqual(Array.from({ length: rounds }, (_, index) => [`p${index + 1}:${index}`, `o${index + 1}:p${index + 1}`]).flat())
    }
  })
})
