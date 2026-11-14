import { expect, test } from "bun:test"
import fc from "fast-check"
import { Data, Effect, Exit } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as OptimizerModule from "vibelang-runtime/experimental/patterns/Optimizer"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { Optimizer, PatternError } = Patterns

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

// Candidates are named by their iteration and scored from a script, as the
// declared form's tests script them.
const scripted = (scores: ReadonlyArray<number>) => ({
  generate: ({ iteration }: { readonly iteration: number }) => Effect.succeed(`candidate-${iteration}`),
  evaluate: ({ iteration }: { readonly iteration: number }) =>
    Effect.succeed({ score: scores[iteration - 1]!, feedback: `feedback-${iteration}` })
})

test("Optimizer: the pattern subpath and the Experimental namespace export the same module", () => {
  expect(OptimizerModule.run).toBe(Optimizer.run)
})

test("Optimizer.run stops at the first candidate that reaches the target", async () => {
  expect(await run(Optimizer.run("prompt", { ...scripted([1, 0, 0]), targetScore: 0.9, maxIterations: 3, onMaxReached: "fail" }))).toEqual({
    best: { candidate: "candidate-1", score: 1, feedback: "feedback-1", iteration: 1 },
    iterations: 1,
    converged: true
  })
})

test("Optimizer.run reports the best attempt, not the last, when the bound is reached", async () => {
  expect(await run(Optimizer.run("prompt", { ...scripted([0.2, 0.7, 0.4]), maxIterations: 3 }))).toEqual({
    best: { candidate: "candidate-2", score: 0.7, feedback: "feedback-2", iteration: 2 },
    iterations: 3,
    converged: false
  })
})

test("Optimizer.run keeps the earliest best across equal scores and a repeated plateau", async () => {
  for (const scores of [[0.5, 0.3, 0.5], [0.5, 0.5, 0.3], [0.1, 0.7, 0.4, 0.7, 0.2, 0.7]]) {
    const firstBest = scores.indexOf(Math.max(...scores)) + 1
    expect(await run(Optimizer.run("prompt", { ...scripted(scores), maxIterations: scores.length }))).toMatchObject({
      best: { candidate: `candidate-${firstBest}`, score: scores[firstBest - 1], iteration: firstBest },
      iterations: scores.length,
      converged: false
    })
  }
})

test("Optimizer.run hands generate the input and the previous attempt, and stops before generating after the target", async () => {
  const seen: Array<unknown> = []
  const result = await run(Optimizer.run("prompt", {
    generate: (args) => Effect.sync(() => (seen.push(args), `candidate-${args.iteration}`)),
    evaluate: scripted([0.2, 0.9, 0.1]).evaluate,
    targetScore: 0.8,
    maxIterations: 3
  }))
  expect(result).toEqual({
    best: { candidate: "candidate-2", score: 0.9, feedback: "feedback-2", iteration: 2 },
    iterations: 2,
    converged: true
  })
  expect(seen).toEqual([
    { input: "prompt", iteration: 1 },
    { input: "prompt", previous: { candidate: "candidate-1", score: 0.2, feedback: "feedback-1", iteration: 1 }, iteration: 2 }
  ])
})

test("Optimizer.run fails exhausted at the bound under onMaxReached fail", async () => {
  const failure = await run(Effect.flip(Optimizer.run("prompt", { ...scripted([0.2, 0.7]), targetScore: 0.9, maxIterations: 2, onMaxReached: "fail" })))
  expect(failure).toBeInstanceOf(PatternError)
  expect(failure).toMatchObject({ code: "exhausted", message: "Optimizer reached its bound of 2 iterations below 0.9" })
})

test("Optimizer.run refuses a non-finite score", async () => {
  for (const score of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const failure = await run(Effect.flip(Optimizer.run("prompt", { ...scripted([0.2, score, 1]), maxIterations: 3 })))
    expect(failure).toMatchObject({
      code: "invalid_input",
      message: `Optimizer evaluation score at iteration 2 must be a finite number, received ${score}`
    })
  }
})

test("Optimizer.run propagates the evaluator's typed error", async () => {
  class EvaluationFailed extends Data.TaggedError("EvaluationFailed")<{ readonly reason: string }> {}
  const error = new EvaluationFailed({ reason: "scorer unavailable" })
  const exit = await Effect.runPromiseExit(Optimizer.run("prompt", {
    generate: () => Effect.succeed("candidate"),
    evaluate: () => Effect.fail(error),
    targetScore: 0.9,
    maxIterations: 3
  }))
  expect(exit).toEqual(Exit.fail(error))
})

test("Optimizer.run refuses bad bounds, a non-finite target, and a fail policy with no target", async () => {
  const stages = scripted([0.5, 0.5])
  for (const maxIterations of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    expect(await run(Effect.flip(Optimizer.run("prompt", { ...stages, targetScore: 0.8, maxIterations })))).toMatchObject({
      code: "invalid_decorator",
      message: "Optimizer maxIterations must be a positive safe integer"
    })
  }
  expect(await run(Effect.flip(Optimizer.run("prompt", { ...stages, maxIterations: 2, onMaxReached: "fail" })))).toMatchObject({
    code: "invalid_decorator",
    message: "Optimizer onMaxReached 'fail' requires a targetScore to fall short of"
  })
  expect(await run(Effect.flip(Optimizer.run("prompt", { ...stages, targetScore: Number.NaN, maxIterations: 2 })))).toMatchObject({
    code: "invalid_decorator",
    message: "Optimizer targetScore must be a finite number"
  })
  // Without a target the search runs every iteration and returns the best.
  expect(await run(Optimizer.run("prompt", { ...stages, maxIterations: 2 }))).toMatchObject({ iterations: 2, converged: false })
})

test("Optimizer.run reads its options at the call, not when the Effect runs", async () => {
  const options = { ...scripted([0.5, 0.9]), maxIterations: 1 as number, targetScore: 0.8 as number | undefined }
  const program = Optimizer.run("prompt", options)
  options.maxIterations = 2
  options.targetScore = Number.NaN
  expect(await run(program)).toMatchObject({ iterations: 1, converged: false })
})

test("property: an optimizer settles on the earliest highest score, converging exactly when a score reached the target in the bound", async () => {
  await checkProperty(fc, {
    name: "patterns-optimizer-best",
    rule: "VIP-73: Optimizer.run generates, evaluates and improves until a target score or the iteration bound",
    command: "bun test tests/experimental-patterns-optimizer.test.ts",
    arbitrary: fc.record({
      scores: fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 8 }),
      target: fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined })
    }),
    numRuns: 200,
    check: async ({ scores, target }: { readonly scores: ReadonlyArray<number>; readonly target: number | undefined }) => {
      const result = await run(Optimizer.run(null, { ...scripted(scores), targetScore: target, maxIterations: scores.length }))
      const reached = target === undefined ? -1 : scores.findIndex((score) => score >= target)
      const seen = reached === -1 ? scores : scores.slice(0, reached + 1)
      const highest = Math.max(...seen)
      expect(result.converged).toBe(reached !== -1)
      expect(result.iterations).toBe(seen.length)
      expect(result.best.iteration).toBe(seen.indexOf(highest) + 1)
      expect(result.best.score).toBe(highest)
    }
  })
})
