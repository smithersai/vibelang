import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Decision, DecisionModel } from "effect/ai"
import * as Test from "../src/experimental/Test"
import * as Eval from "../src/experimental/Eval"
import * as Scorer from "../src/experimental/Scorer"

test("baseline identity survives serialization and distinguishes targets with identical answers", async () => {
  const answer = () => Effect.succeed("ok")
  const run = (target: typeof answer) => Effect.runPromise(Eval.run(Eval.suite("suite", {
    target, cases: [{ name: "case", input: [], expected: "ok" }], scorers: [Scorer.exact]
  })))
  const plain = await run(answer)
  expect(plain.targetTag).toBe("answer")
  const tagged = await run(Object.assign(answer, { key: "app/task" }))
  const baseline = await Effect.runPromise(Eval.baseline(tagged))
  const restored = await Effect.runPromise(Eval.load(Eval.write(baseline)))
  expect(restored.records[0]?.targetTag).toBe("app/task")
  expect((await Effect.runPromise(Eval.compare(restored, tagged))).missing).toEqual([])
  expect((await Effect.runPromise(Eval.compare(restored, plain))).missing.map(item => item.side).sort()).toEqual(["baseline", "run"])
})

test("a replayed decision target produces a baseline without a live provider", async () => {
  const urgent = Decision.make({ input: Schema.String, decisions: {
    urgent: Decision.probability({ instructions: "Is this urgent?" })
  } })
  const classify = (input: string) => Effect.map(DecisionModel.decide(urgent, { input }), result => result.answers.urgent.probability)
  const suite = Eval.suite("triage", {
    target: classify, cases: [{ name: "one", input: ["offline"], expected: 0.75 }], scorers: [Scorer.exact]
  })
  const replay = Test.decisions({ calls: [{
    request: { state: "offline" }, response: { answers: { urgent: { _tag: "Probability", probability: 0.75 } } }
  }] })
  const baseline = await Effect.runPromise(Eval.run(suite).pipe(Effect.provide(replay), Effect.flatMap(Eval.baseline)))
  expect(baseline.records).toMatchObject([{ targetTag: "classify", case: "one", score: 1 }])
})
