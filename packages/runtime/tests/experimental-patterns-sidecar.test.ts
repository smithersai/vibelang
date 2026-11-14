import { expect, test } from "bun:test"
import fc from "fast-check"
import { Cause, Effect, Latch } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as SidecarModule from "vibelang-runtime/experimental/patterns/Sidecar"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { PatternError, Sidecar } = Patterns

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const invalidScores = [
  { primary: Number.NaN, shadow: 0, message: "Sidecar primary score must be a finite number, received NaN" },
  { primary: 0, shadow: Number.NaN, message: "Sidecar shadow score must be a finite number, received NaN" },
  { primary: Number.POSITIVE_INFINITY, shadow: 0, message: "Sidecar primary score must be a finite number, received Infinity" },
  { primary: 0, shadow: Number.POSITIVE_INFINITY, message: "Sidecar shadow score must be a finite number, received Infinity" },
  { primary: Number.NEGATIVE_INFINITY, shadow: 0, message: "Sidecar primary score must be a finite number, received -Infinity" },
  { primary: 0, shadow: Number.NEGATIVE_INFINITY, message: "Sidecar shadow score must be a finite number, received -Infinity" },
  { primary: 1e308, shadow: -1e308, message: "Sidecar score difference must be a finite number, received Infinity" }
] as const

test("Sidecar: the pattern subpath and the Experimental namespace export the same module", () => {
  expect(SidecarModule.run).toBe(Sidecar.run)
})

test("Sidecar.run returns the primary value when the shadow fails", async () => {
  const result = await run(Sidecar.run("prompt", {
    primary: () => Effect.succeed("answer"),
    shadow: () => Effect.fail("shadow is broken")
  }))
  expect(result.primary).toBe("answer")
  expect(result.shadow.quarantined).toBe(true)
  if (result.shadow.quarantined) expect(Cause.hasFails(result.shadow.cause)).toBe(true)
})

test("Sidecar.run quarantines a shadow defect as well as a typed failure", async () => {
  const result = await run(Sidecar.run("prompt", {
    primary: () => Effect.succeed("answer"),
    shadow: () => Effect.die(new Error("shadow blew up"))
  }))
  expect(result.primary).toBe("answer")
  expect(result.shadow.quarantined).toBe(true)
  if (result.shadow.quarantined) expect(Cause.hasDies(result.shadow.cause)).toBe(true)
})

test("Sidecar.run quarantines a shadow callback that throws before it returns an Effect", async () => {
  let primaryRan = false
  const result = await run(Sidecar.run("prompt", {
    primary: () => Effect.sync(() => (primaryRan = true, "answer")),
    shadow: (): Effect.Effect<never> => {
      throw new Error("shadow factory blew up")
    }
  }))
  expect(primaryRan).toBe(true)
  expect(result.primary).toBe("answer")
  expect(result.shadow.quarantined).toBe(true)
  if (result.shadow.quarantined) expect(Cause.hasDies(result.shadow.cause)).toBe(true)
})

test("Sidecar.run propagates a shadow interruption instead of quarantining it", async () => {
  const exit = await Effect.runPromiseExit(Sidecar.run("prompt", {
    primary: () => Effect.succeed("answer"),
    shadow: () => Effect.interrupt
  }))
  expect(exit._tag).toBe("Failure")
  if (exit._tag === "Failure") expect(Cause.hasInterrupts(exit.cause)).toBe(true)
})

test("Sidecar.run fails when the primary fails, because the shadow is not a fallback", async () => {
  const failure = await run(Effect.flip(Sidecar.run("prompt", {
    primary: () => Effect.fail("primary is broken"),
    shadow: () => Effect.succeed("cheap answer")
  })))
  expect(failure).toBe("primary is broken")
})

test("Sidecar.run starts the primary and the shadow concurrently", async () => {
  const program = Effect.gen(function*() {
    const primaryStarted = yield* Latch.make(false)
    const shadowStarted = yield* Latch.make(false)
    // Each side waits for the other to have started, so no sequential order
    // completes this run.
    return yield* Sidecar.run("prompt", {
      primary: () => Effect.as(Effect.andThen(primaryStarted.open, shadowStarted.await), "answer"),
      shadow: () => Effect.as(Effect.andThen(shadowStarted.open, primaryStarted.await), "cheap answer")
    }).pipe(Effect.timeoutOrElse({
      duration: "2 seconds",
      orElse: () => Effect.die(new Error("the primary and the shadow did not overlap"))
    }))
  })
  const result = await run(program)
  expect(result.primary).toBe("answer")
  expect(result.shadow).toEqual({ quarantined: false, value: "cheap answer" })
})

test("Sidecar.run interleaves the primary and the shadow rather than sequencing them", async () => {
  const events: Array<string> = []
  const step = (name: string) =>
    Effect.sync(() => events.push(`start-${name}`)).pipe(
      Effect.andThen(Effect.yieldNow),
      Effect.andThen(Effect.sync(() => events.push(`end-${name}`))),
      Effect.as(name)
    )
  await run(Sidecar.run("prompt", { primary: () => step("primary"), shadow: () => step("shadow") }))
  expect(events).toEqual(["start-primary", "start-shadow", "end-primary", "end-shadow"])
})

test("Sidecar.run scores both outputs and reports the difference", async () => {
  const seen: Array<unknown> = []
  const result = await run(Sidecar.run("prompt", {
    primary: () => Effect.succeed("answer"),
    shadow: () => Effect.succeed("cheap answer"),
    score: (input) => Effect.sync(() => (seen.push(input), { primary: 0.8, shadow: 0.6 }))
  }))
  expect(seen).toEqual([{ primary: "answer", shadow: "cheap answer" }])
  expect(result.delta).toEqual({ primary: 0.8, shadow: 0.6, difference: 0.2, cheaperWins: false })
})

test("Sidecar.run does not score when the shadow is quarantined, and reports no delta without a scorer", async () => {
  let scored = 0
  const quarantined = await run(Sidecar.run("prompt", {
    primary: () => Effect.succeed("answer"),
    shadow: () => Effect.fail("shadow is broken"),
    score: () => Effect.sync(() => (++scored, { primary: 1, shadow: 0 }))
  }))
  expect(scored).toBe(0)
  expect(quarantined.delta).toBeUndefined()
  const unscored = await run(Sidecar.run("prompt", {
    primary: () => Effect.succeed("answer"),
    shadow: () => Effect.succeed("cheap answer")
  }))
  expect(unscored).toEqual({ primary: "answer", shadow: { quarantined: false, value: "cheap answer" } })
})

test("Sidecar.run refuses non-finite scores and an overflowing difference", async () => {
  for (const scores of invalidScores) {
    const failure = await run(Effect.flip(Sidecar.run("prompt", {
      primary: () => Effect.succeed("answer"),
      shadow: () => Effect.succeed("cheap answer"),
      score: () => Effect.succeed(scores)
    })))
    expect(failure).toBeInstanceOf(PatternError)
    expect((failure as InstanceType<typeof PatternError>).code).toBe("invalid_input")
    expect((failure as InstanceType<typeof PatternError>).message).toBe(scores.message)
  }
})

test("Sidecar.run rounds ordinary scores and keeps a rounded negative zero", async () => {
  const stages = { primary: () => Effect.succeed("answer"), shadow: () => Effect.succeed("cheap answer") }
  const ordinary = await run(Sidecar.run("prompt", { ...stages, score: () => Effect.succeed({ primary: 0.8, shadow: 0.5 }) }))
  const negativeZero = await run(Sidecar.run("prompt", { ...stages, score: () => Effect.succeed({ primary: 0, shadow: Number.MIN_VALUE }) }))
  expect(ordinary.delta).toEqual({ primary: 0.8, shadow: 0.5, difference: 0.3, cheaperWins: false })
  expect(Object.is(negativeZero.delta?.difference, -0)).toBe(true)
  expect(negativeZero.delta?.cheaperWins).toBe(true)
})

test("Sidecar.delta survives floating-point subtraction and counts a tie for the cheaper seat", () => {
  expect(Sidecar.delta(0.3, 0.1)).toEqual({ primary: 0.3, shadow: 0.1, difference: 0.2, cheaperWins: false })
  expect(Sidecar.delta(0.6, 0.9)).toEqual({ primary: 0.6, shadow: 0.9, difference: -0.3, cheaperWins: true })
  expect(Sidecar.delta(0.5, 0.5).cheaperWins).toBe(true)
  expect(Sidecar.delta(0.8, 0.5)).toEqual({ primary: 0.8, shadow: 0.5, difference: 0.3, cheaperWins: false })
  expect(Object.is(Sidecar.delta(0, Number.MIN_VALUE).difference, -0)).toBe(true)
})

test("Sidecar.delta throws PatternError for non-finite scores and an overflowing difference", () => {
  for (const scores of invalidScores) {
    expect(() => Sidecar.delta(scores.primary, scores.shadow)).toThrow(
      expect.objectContaining({ code: "invalid_input", message: scores.message })
    )
  }
})

test("Sidecar.run reads its options at the call, not when the Effect runs", async () => {
  const options = {
    primary: () => Effect.succeed("answer"),
    shadow: () => Effect.succeed("cheap answer"),
    score: () => Effect.succeed({ primary: 1, shadow: 1 })
  }
  const program = Sidecar.run("prompt", options)
  options.primary = () => Effect.succeed("swapped")
  options.shadow = () => Effect.succeed("swapped")
  options.score = () => Effect.succeed({ primary: 0, shadow: 9 })
  expect(await run(program)).toEqual({
    primary: "answer",
    shadow: { quarantined: false, value: "cheap answer" },
    delta: { primary: 1, shadow: 1, difference: 0, cheaperWins: true }
  })
})

test("property: a sidecar's delta is the rounded difference, and cheaperWins exactly when the shadow scored at least the primary", async () => {
  await checkProperty(fc, {
    name: "patterns-sidecar-delta",
    rule: "VIP-73: Sidecar.run runs a cheap shadow beside the primary and measures the gap",
    command: "bun test tests/experimental-patterns-sidecar.test.ts",
    arbitrary: fc.record({
      primary: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
      shadow: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
      shadowFails: fc.boolean()
    }),
    numRuns: 200,
    check: async ({ primary, shadow, shadowFails }: { readonly primary: number; readonly shadow: number; readonly shadowFails: boolean }) => {
      const result = await run(Sidecar.run("input", {
        primary: (input: string) => Effect.succeed(`${input}:primary`),
        shadow: (input: string) => shadowFails ? Effect.fail("down") : Effect.succeed(`${input}:shadow`),
        score: () => Effect.succeed({ primary, shadow })
      }))
      expect(result.primary).toBe("input:primary")
      expect(result.shadow.quarantined).toBe(shadowFails)
      if (shadowFails) {
        expect(result.delta).toBeUndefined()
      } else {
        expect(result.delta).toEqual({ primary, shadow, difference: Number((primary - shadow).toFixed(12)), cheaperWins: shadow >= primary })
        expect(result.delta).toEqual(Sidecar.delta(primary, shadow))
      }
    }
  })
})
