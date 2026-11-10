import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, Exit, Layer } from "effect"
import * as AiError from "effect/ai/AiError"
import * as Decision from "effect/ai/Decision"
import * as DecisionModel from "effect/ai/DecisionModel"
import { Eval, Scorer, Test } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// A scripted decision model: each call answers with the next answer and
// records the state it was sent. Effect's DecisionModel.make validates the
// answer as it would a provider's. It never reaches a provider.
const scripted = (answers: ReadonlyArray<unknown>, states: Array<unknown> = []) => {
  let next = 0
  return Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: (options) =>
        Effect.sync(() => {
          states.push(options.state)
          return {
            answers: { verdict: answers[Math.min(next++, answers.length - 1)] } as any,
            usage: { inputTokens: undefined, outputTokens: undefined }
          }
        })
    })
  )
}

const seat = "openai:gpt-6"
const helpful = Decision.probability({ instructions: "Does the output greet the person named in the context?" })
const quality = Decision.rate({ instructions: "How polite is the output?", criteria: ["rude", "flat", "warm"] })
const verdict = Decision.classify({
  instructions: "Is the output a correct greeting?",
  criteria: { correct: "greets the right person", wrong: "greets someone else", unclear: null }
})

const grade = (scorer: Scorer.Scorer<{ readonly input: unknown; readonly output: unknown }>, output: unknown, input: unknown = "Ada") =>
  Effect.runPromiseExit(scorer.score({ input, output }))

test("a probability decision's answer is the score, and the judge reads context and output", async () => {
  const states: Array<unknown> = []
  const exit = await grade(Scorer.decide(helpful, { model: seat, layer: scripted([{ _tag: "Probability", probability: 0.8 }], states) }), "Hello, Ada")
  expect(exit).toEqual(Exit.succeed({ score: 0.8, meta: { probability: 0.8, judge: seat } }))
  expect(states).toEqual([{ context: "Ada", output: "Hello, Ada" }])
})

test("a rate decision maps its rating onto [0, 1] from the lowest level to the highest", async () => {
  const answer = { _tag: "Rate", rating: 1.5, probabilities: { rude: 0, flat: 0.5, warm: 0.5 } }
  const exit = await grade(Scorer.decide(quality, { model: seat, layer: scripted([answer]) }), "Hi")
  expect(exit).toEqual(Exit.succeed({
    score: 0.75,
    meta: { label: "flat", rating: 1.5, probabilities: { rude: 0, flat: 0.5, warm: 0.5 }, judge: seat }
  }))
})

test("a classify decision scores the probability of its passing labels and says whether the chosen label passes", async () => {
  const answer = { _tag: "Classify", label: "correct", probabilities: { correct: 0.7, wrong: 0.2, unclear: 0.1 } }
  const exit = await grade(Scorer.decide(verdict, { model: seat, layer: scripted([answer]), pass: ["correct"] }), "Hello, Ada")
  expect(Exit.isSuccess(exit) && exit.value.score).toBeCloseTo(0.7)
  expect(Exit.isSuccess(exit) && exit.value.meta).toEqual({
    label: "correct",
    probabilities: { correct: 0.7, wrong: 0.2, unclear: 0.1 },
    pass: true,
    judge: seat
  })
  const lenient = await grade(Scorer.decide(verdict, { model: seat, layer: scripted([answer]), pass: ["correct", "unclear"] }), "Hello")
  expect(Exit.isSuccess(lenient) && lenient.value.score).toBeCloseTo(0.8)
})

test("the seat, the decision and the passing labels are the scorer's identity", () => {
  const layer = scripted([])
  const base = Scorer.decide(verdict, { model: seat, layer, pass: ["correct"] })
  expect(base.problem).toBeUndefined()
  expect(base.scorerKey).toMatch(/^[0-9a-f]{64}$/)
  expect(Scorer.decide(verdict, { model: seat, layer: scripted([]), pass: ["correct"] }).scorerKey).toBe(base.scorerKey)
  expect(Scorer.decide(verdict, { model: "anthropic:claude-sonnet-5-5", layer, pass: ["correct"] }).scorerKey).not.toBe(base.scorerKey)
  expect(Scorer.decide(verdict, { model: seat, layer, pass: ["correct", "unclear"] }).scorerKey).not.toBe(base.scorerKey)
  expect(Scorer.decide(helpful, { model: seat, layer }).scorerKey).not.toBe(base.scorerKey)
  expect(Scorer.decide(helpful, { model: seat, layer }).scorerKey).not.toBe(Scorer.rubric(
    [{ id: "helpful", question: "Helpful?", low: "no", high: "yes" }],
    { model: seat, layer: Layer.empty as any }
  ).scorerKey)
})

test("a decision scorer with no judge, no usable decision or bad passing labels is refused, never thrown", async () => {
  const layer = scripted([])
  expect(Scorer.decide(helpful, { model: " ", layer }).problem).toContain("seat")
  expect(Scorer.decide(verdict, { model: seat, layer }).problem).toContain("pass")
  expect(Scorer.decide(verdict, { model: seat, layer, pass: [] }).problem).toContain("pass")
  expect(Scorer.decide(verdict, { model: seat, layer, pass: ["maybe"] }).problem).toContain("\"maybe\"")
  expect(Scorer.decide(verdict, { model: seat, layer, pass: ["correct", "wrong", "unclear"] }).problem).toContain("failing")
  expect(Scorer.decide(helpful, { model: seat, layer, pass: ["yes"] }).problem).toContain("only to a classify")
  expect(Scorer.decide(Decision.locate({ image: "photo", instructions: "Find the face" }) as any, { model: seat, layer }).problem)
    .toContain("locate")
  expect(Scorer.decide({ _tag: "Probability", instructions: () => "x" } as any, { model: seat, layer }).problem).toContain("plain data")
  expect(Scorer.decide(helpful, { model: seat } as any).problem).toContain("DecisionModel")
  expect(Scorer.decide(null as any, null as any).problem).toBeDefined()
  const refused = await grade(Scorer.decide(verdict, { model: seat, layer }), "Hello")
  expect(JSON.stringify(refused)).toContain("invalid_declaration")
})

test("a judge that cannot be reached, refuses or answers out of range is inconclusive, and the gate cannot pass", async () => {
  const unreachable = Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: () => Effect.fail(AiError.make({ module: "Test", method: "decide", reason: new AiError.UnknownError({ description: "connection refused" }) } as any))
    })
  )
  const notBuilt = Layer.effect(DecisionModel.DecisionModel, Effect.fail("no key for the judge"))
  const answers = [{ _tag: "Refusal" }, { _tag: "Probability", probability: 1.5 }, { _tag: "Rate", rating: 1 }, undefined]
  for (const layer of [unreachable, notBuilt, ...answers.map((answer) => scripted([answer]))]) {
    const exit = await grade(Scorer.decide(helpful, { model: seat, layer: layer as any }), "Hello")
    expect(Exit.isFailure(exit)).toBe(true)
    expect(JSON.stringify(exit)).toContain("inconclusive")
  }
  const suite = Eval.suite("greets", {
    target: (name: string) => Effect.succeed(`Hello, ${name}`),
    cases: [{ name: "ada", input: ["Ada"] }],
    scorers: [Scorer.decide(helpful, { model: seat, layer: scripted([{ _tag: "Refusal" }]) })]
  })
  const result = await Effect.runPromise(Eval.run(suite))
  expect(result.observations).toEqual([expect.objectContaining({ kind: "inconclusive", code: "inconclusive" })])
  const report = await Effect.runPromise(Eval.compare(await Effect.runPromise(Eval.baseline(result)), result))
  expect(Eval.gate(report, { min: 0, tolerance: 0.25 }).exitCode).toBe(5)
})

test("a suite graded by Experimental.Test.decisions, and calibrate on a classify judge", async () => {
  const recorded = {
    calls: [
      { request: { state: { context: "Ada", output: "Hello, Ada" } }, response: { answers: { verdict: { _tag: "Classify", label: "correct", probabilities: { correct: 0.9, wrong: 0.05, unclear: 0.05 } } } } },
      { request: { state: { context: "Ada", output: "Go away" } }, response: { answers: { verdict: { _tag: "Classify", label: "wrong", probabilities: { correct: 0.1, wrong: 0.8, unclear: 0.1 } } } } },
      { request: { state: { context: "Ada", output: "Hi" } }, response: { answers: { verdict: { _tag: "Classify", label: "correct", probabilities: { correct: 0.6, wrong: 0.3, unclear: 0.1 } } } } }
    ]
  }
  const judge = Test.decisions(recorded)
  const scorer = Scorer.decide(verdict, { model: seat, layer: judge, pass: ["correct"] })
  const agreement = await Effect.runPromise(Scorer.calibrate(scorer, [
    { input: "Ada", output: "Hello, Ada", verdict: "pass" },
    { input: "Ada", output: "Go away", verdict: "fail" },
    { input: "Ada", output: "Hi", verdict: "fail" }
  ]).pipe(Effect.provide(judge)))
  expect(agreement).toEqual({ total: 3, agree: 2, accuracy: 2 / 3, truePass: 1, trueFail: 1, falsePass: 1, falseFail: 0, inconclusive: 0 })
})

test("property: any provider answer gives a score in [0, 1] whose pass matches the chosen label, or is inconclusive", async () => {
  const labels = ["correct", "wrong", "unclear"] as const
  await checkProperty(fc, {
    name: "decide-answer-score",
    rule: "VIP-69 rules 1 and 8: a score is a finite number in [0, 1]; a judge that gives no valid answer is inconclusive and never passes",
    command: "bun test tests/experimental-scorer-decide.test.ts",
    arbitrary: fc.record({
      label: fc.oneof(fc.constantFrom(...labels), fc.string({ maxLength: 8 })),
      weights: fc.array(fc.double({ min: -0.5, max: 2, noNaN: true }), { minLength: 3, maxLength: 3 }),
      normalize: fc.boolean(),
      pass: fc.subarray([...labels], { minLength: 1, maxLength: 2 })
    }),
    check: async ({ label, normalize, pass, weights }: { label: string; weights: Array<number>; normalize: boolean; pass: Array<string> }) => {
      const total = weights.reduce((sum, weight) => sum + weight, 0)
      const values = normalize && total > 0 && weights.every((weight) => weight >= 0) ? weights.map((weight) => weight / total) : weights
      const probabilities = Object.fromEntries(labels.map((name, index) => [name, values[index]]))
      const exit = await grade(Scorer.decide(verdict, { model: seat, layer: scripted([{ _tag: "Classify", label, probabilities }]), pass }), "Hi")
      if (Exit.isSuccess(exit)) {
        expect(exit.value.score).toBeGreaterThanOrEqual(0)
        expect(exit.value.score).toBeLessThanOrEqual(1)
        expect((exit.value.meta as { pass: boolean }).pass).toBe(pass.includes(label))
        expect(exit.value.score).toBeCloseTo(pass.reduce((sum, name) => sum + probabilities[name]!, 0) / values.reduce((a, b) => a + b, 0))
      } else {
        expect(JSON.stringify(exit)).toContain("inconclusive")
      }
    },
    numRuns: 200
  })
})
