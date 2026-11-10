import { expect, test } from "bun:test"
import fc from "fast-check"
import { Cause, Effect, Exit, Schema } from "effect"
import { AiError, Decision, DecisionModel } from "effect/ai"
import { Test } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const Triage = Decision.make({
  input: Schema.Struct({ title: Schema.String }),
  decisions: {
    kind: Decision.classify({ instructions: "What kind of issue is this?", criteria: { bug: null, feature: null } })
  }
})

const triage = (title: string) => DecisionModel.decide(Triage, { input: { title } })
const settled = (title: string) => DecisionModel.decideSettled(Triage, { input: { title } })

const run = <A, E>(effect: Effect.Effect<A, E, DecisionModel.DecisionModel>, fixture: Test.DecisionFixture) =>
  Effect.runPromiseExit(Effect.provide(effect, Test.decisions(fixture)))

// Effect's classify decision needs the provider's label distribution.
const classified = (label: string) => ({ _tag: "Classify", label, probabilities: { bug: label === "bug" ? 0.9 : 0.1, feature: label === "bug" ? 0.1 : 0.9 } })

const answer = (title: string, kind: unknown) => ({
  request: { state: { title } },
  response: { answers: { kind } }
})

const squash = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined)

test("Test.decisions answers a decision from a hand-written recording", async () => {
  const exit = await run(Effect.map(triage("Crash on start"), (r) => r.answers.kind.label), {
    calls: [answer("Crash on start", classified("bug"))]
  })
  expect(exit).toEqual(Exit.succeed("bug"))
})

test("Test.decisions validates a recorded answer against the program's definition, as a provider's", async () => {
  const unknownLabel = await run(Effect.map(settled("X"), (r) => r.outcomes.kind), {
    calls: [answer("X", { _tag: "Classify", label: "question", probabilities: { question: 1 } })]
  })
  expect(Exit.isSuccess(unknownLabel) && unknownLabel.value).toMatchObject({ failure: { _tag: "Unanswered", reason: "Invalid" } })
  const refused = await run(Effect.map(settled("Y"), (r) => r.outcomes.kind), { calls: [answer("Y", { _tag: "Refusal" })] })
  expect(Exit.isSuccess(refused) && refused.value).toMatchObject({ failure: { _tag: "Unanswered", reason: "Refused" } })
})

test("Test.decisions dies on an unrecorded request and claims each recording once", async () => {
  const fixture = { calls: [answer("A", classified("bug"))] }
  expect(squash(await run(triage("B"), fixture))).toBeInstanceOf(Test.UnrecordedDecision)
  const twice = await run(Effect.zip(triage("A"), triage("A")), fixture)
  expect(squash(twice)).toBeInstanceOf(Test.UnrecordedDecision)
  expect((squash(twice) as Test.UnrecordedDecision).decisions).toEqual(["kind"])
})

test("Test.decisions compares the decisions a recording names", async () => {
  const exact = {
    calls: [{
      request: { state: { title: "A" }, decisions: { kind: { _tag: "Classify", instructions: "Something else?", criteria: { bug: null, feature: null } } } },
      response: { answers: { kind: classified("bug") } }
    }]
  }
  expect(squash(await run(triage("A"), exact))).toBeInstanceOf(Test.UnrecordedDecision)
  exact.calls[0]!.request.decisions.kind.instructions = "What kind of issue is this?"
  expect(Exit.isSuccess(await run(triage("A"), exact))).toBe(true)
})

test("Test.decisions replays a recorded provider failure and dies on a malformed fixture", async () => {
  const failure = Schema.encodeSync(AiError.AiError)(AiError.make({
    module: "Provider",
    method: "decide",
    reason: new AiError.RateLimitError({})
  }))
  const failed = squash(await run(triage("A"), { calls: [{ request: { state: { title: "A" } }, failure }] }))
  expect((failed as AiError.AiError).reason._tag).toBe("RateLimitError")
  expect(squash(await run(triage("A"), { calls: [{ response: {} }] } as unknown as Test.DecisionFixture))).toBeInstanceOf(
    Test.InvalidFixture
  )
})

test("property: concurrent decisions claim distinct recordings, never one twice", async () => {
  await checkProperty(fc, {
    name: "test-decisions-claim-once",
    rule: "VIP-71: each recorded decision is claimed once; a request the fixture does not describe is a defect",
    command: "bun test tests/experimental-test-decisions.test.ts",
    arbitrary: fc.record({ labels: fc.array(fc.constantFrom("bug", "feature"), { minLength: 1, maxLength: 8 }), extra: fc.boolean() }),
    numRuns: 100,
    check: async ({ labels, extra }: { readonly labels: ReadonlyArray<"bug" | "feature">; readonly extra: boolean }) => {
      const fixture = { calls: labels.map((label) => answer("same", classified(label))) }
      const one = Effect.map(triage("same"), (r) => r.answers.kind.label)
      const exit = await run(Effect.all(Array.from({ length: labels.length + (extra ? 1 : 0) }, () => one), { concurrency: "unbounded" }), fixture)
      if (extra) {
        expect(squash(exit)).toBeInstanceOf(Test.UnrecordedDecision)
        return
      }
      expect(Exit.isSuccess(exit) && [...exit.value].sort()).toEqual([...labels].sort())
    }
  })
}, 60000)
