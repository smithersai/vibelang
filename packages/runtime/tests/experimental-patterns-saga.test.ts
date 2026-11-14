import { expect, test } from "bun:test"
import fc from "fast-check"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { Patterns } from "vibelang-runtime/experimental"
import * as SagaModule from "vibelang-runtime/experimental/patterns/Saga"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { PatternError, Saga } = Patterns

class Boom extends Data.TaggedError("Boom")<{ readonly step: string }> {}

type Step = SagaModule.RuntimeStep<string, string, Boom, never, Boom, never>

// A scripted step: every call is appended to `trace`, so a test can assert
// the last-in, first-out unwind.
const scripted = (
  trace: Array<string>,
  id: string,
  options?: { readonly fails?: boolean; readonly compensationFails?: boolean; readonly compensationDies?: boolean }
): Step => ({
  id,
  action: () =>
    Effect.suspend(() => {
      trace.push(`do-${id}`)
      return options?.fails === true ? Effect.fail(new Boom({ step: id })) : Effect.succeed(`${id}-done`)
    }),
  compensation: () =>
    Effect.suspend(() => {
      trace.push(`undo-${id}`)
      if (options?.compensationDies === true) return Effect.die(new Error(`undo-${id} exploded`))
      return options?.compensationFails === true ? Effect.fail(new Boom({ step: `undo-${id}` })) : Effect.succeed(undefined)
    })
})

const flipped = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect))

test("Saga: the subpath module is the namespace's module", () => {
  expect(SagaModule.run).toBe(Saga.run)
})

test("Saga.run runs every step and no compensation when the saga succeeds", async () => {
  const trace: Array<string> = []
  const result = await Effect.runPromise(Saga.run("order", {
    steps: [scripted(trace, "one"), scripted(trace, "two")],
    onFailure: "compensate"
  }))
  expect(trace).toEqual(["do-one", "do-two"])
  expect(result).toEqual({ _tag: "Completed", values: { one: "one-done", two: "two-done" } })
})

test("Saga.run hands each action the input and own completed values for prototype-shaped step ids", async () => {
  const ids = ["__proto__", "constructor", "toString", "normal"]
  const seen: Array<Readonly<Record<string, string>>> = []
  const inputs: Array<string> = []
  const result = await Effect.runPromise(Saga.run<string, string, never, never, never, never>("order", {
    onFailure: "fail",
    steps: ids.map((id) => ({
      id,
      action: ({ input, completed }) => Effect.sync(() => (seen.push(completed), inputs.push(input), `${id}-value`)),
      compensation: () => Effect.void
    }))
  }))
  expect(inputs).toEqual(ids.map(() => "order"))
  for (const [index, completed] of seen.entries()) {
    expect(Object.getPrototypeOf(completed)).toBe(Object.prototype)
    expect(Object.keys(completed)).toEqual(ids.slice(0, index))
    for (const id of ids.slice(0, index)) expect(completed[id]).toBe(`${id}-value`)
  }
  expect(result._tag).toBe("Completed")
  const values = (result as SagaModule.Completed<string>).values
  expect(Object.getPrototypeOf(values)).toBe(Object.prototype)
  for (const id of ids) {
    expect(Object.hasOwn(values, id)).toBe(true)
    expect(values[id]).toBe(`${id}-value`)
  }
})

test("Saga.run tells a completed run from a compensated one whose step ids forge it", async () => {
  const completed = await Effect.runPromise(Saga.run("order", {
    onFailure: "compensate",
    steps: [
      { id: "_tag", action: () => Effect.succeed("Compensated"), compensation: () => Effect.void },
      { id: "failure", action: () => Effect.succeed("boom"), compensation: () => Effect.void }
    ]
  }))
  const unwound = await Effect.runPromise(Saga.run("order", {
    onFailure: "compensate",
    steps: [{ id: "a", action: () => Effect.fail("boom"), compensation: () => Effect.void }]
  }))
  expect(completed).toEqual({ _tag: "Completed", values: { _tag: "Compensated", failure: "boom" } })
  expect(unwound).toEqual({ _tag: "Compensated", failure: "boom" })
})

test("Saga.run compensates completed steps in reverse with their own values and settles under compensate", async () => {
  const trace: Array<string> = []
  const undone: Array<unknown> = []
  const steps = [scripted(trace, "one"), scripted(trace, "two"), scripted(trace, "three", { fails: true })]
  const recorded = steps.map((step) => ({
    ...step,
    compensation: (args: { readonly id: string; readonly input: string; readonly value: string }) =>
      Effect.flatMap(Effect.sync(() => undone.push(args)), () => step.compensation(args))
  }))
  const result = await Effect.runPromise(Saga.run("order", { steps: recorded, onFailure: "compensate" }))
  expect(trace).toEqual(["do-one", "do-two", "do-three", "undo-two", "undo-one"])
  expect(undone).toEqual([{ id: "two", input: "order", value: "two-done" }, { id: "one", input: "order", value: "one-done" }])
  expect(result).toEqual({ _tag: "Compensated", failure: new Boom({ step: "three" }) })
})

test("Saga.run defaults an omitted policy to compensate", async () => {
  const trace: Array<string> = []
  const result = await Effect.runPromise(Saga.run("order", {
    steps: [scripted(trace, "one"), scripted(trace, "two"), scripted(trace, "three", { fails: true })]
  }))
  expect(trace).toEqual(["do-one", "do-two", "do-three", "undo-two", "undo-one"])
  expect(result).toEqual({ _tag: "Compensated", failure: new Boom({ step: "three" }) })
})

test("Saga.run re-fails with the original error under compensate-and-fail", async () => {
  const trace: Array<string> = []
  const error = await flipped(Saga.run("order", {
    steps: [scripted(trace, "one"), scripted(trace, "two"), scripted(trace, "three", { fails: true })],
    onFailure: "compensate-and-fail"
  }))
  expect(trace).toEqual(["do-one", "do-two", "do-three", "undo-two", "undo-one"])
  expect(error).toEqual(new Boom({ step: "three" }))
})

test("Saga.run runs no compensation under the fail policy", async () => {
  const trace: Array<string> = []
  const error = await flipped(Saga.run("order", {
    steps: [scripted(trace, "one"), scripted(trace, "two", { fails: true })],
    onFailure: "fail"
  }))
  expect(trace).toEqual(["do-one", "do-two"])
  expect(error).toEqual(new Boom({ step: "two" }))
})

test("Saga.run reports failing compensations in sorted order and still runs the rest", async () => {
  const trace: Array<string> = []
  const error = await flipped(Saga.run("order", {
    steps: [
      scripted(trace, "two", { compensationFails: true }),
      scripted(trace, "one", { compensationFails: true }),
      scripted(trace, "clean"),
      scripted(trace, "three", { fails: true })
    ]
  }))
  expect(trace).toEqual(["do-two", "do-one", "do-clean", "do-three", "undo-clean", "undo-one", "undo-two"])
  expect(error).toEqual(new PatternError({
    code: "compensation_failed",
    message: "Saga compensation failed for: one, two",
    cause: {
      failure: new Boom({ step: "three" }),
      residue: [{ id: "one", error: new Boom({ step: "undo-one" }) }, { id: "two", error: new Boom({ step: "undo-two" }) }]
    }
  }))
})

test("Saga.run collects a throwing or dying compensation alongside typed undo failures", async () => {
  const trace: Array<string> = []
  const defect = new Error("undo-two threw")
  const error = await flipped(Saga.run("order", {
    steps: [
      scripted(trace, "one", { compensationFails: true }),
      {
        ...scripted(trace, "two"),
        compensation: (): Effect.Effect<never> => {
          trace.push("undo-two")
          throw defect
        }
      },
      scripted(trace, "four", { compensationDies: true }),
      scripted(trace, "three", { fails: true })
    ]
  }))
  expect(trace).toEqual(["do-one", "do-two", "do-four", "do-three", "undo-four", "undo-two", "undo-one"])
  expect(error).toBeInstanceOf(PatternError)
  expect((error as InstanceType<typeof PatternError>).message).toBe("Saga compensation failed for: four, one, two")
  expect((error as InstanceType<typeof PatternError>).cause).toEqual({
    failure: new Boom({ step: "three" }),
    residue: [
      { id: "four", error: new Error("undo-four exploded") },
      { id: "one", error: new Boom({ step: "undo-one" }) },
      { id: "two", error: defect }
    ]
  })
})

test("Saga.run reports compensation residue without inventing a failure for a forward defect", async () => {
  const error = await flipped(Saga.run("order", {
    steps: [
      scripted([], "one", { compensationFails: true }),
      { id: "two", action: () => Effect.die(new Error("forward defect")), compensation: () => Effect.void }
    ],
    onFailure: "compensate"
  }))
  expect(error).toBeInstanceOf(PatternError)
  expect(error).toMatchObject({ code: "compensation_failed", message: "Saga compensation failed for: one" })
  expect((error as InstanceType<typeof PatternError>).cause).toEqual({ residue: [{ id: "one", error: new Boom({ step: "undo-one" }) }] })
})

test("Saga.run propagates a forward defect when every compensation succeeds", async () => {
  const defect = new Error("forward defect")
  const trace: Array<string> = []
  const exit = await Effect.runPromiseExit(Saga.run("order", {
    steps: [scripted(trace, "zero"), { id: "one", action: () => Effect.die(defect), compensation: () => Effect.void }],
    onFailure: "compensate"
  }))
  expect(exit._tag).toBe("Failure")
  if (exit._tag === "Failure") expect(Cause.hasDies(exit.cause)).toBe(true)
  expect(trace).toEqual(["do-zero", "undo-zero"])
})

test("Saga.run does not admit a step appended while the run is in flight", async () => {
  const trace: Array<string> = []
  const steps: Array<SagaModule.RuntimeStep<string, string, never, never, never, never>> = []
  const late = { id: "late", action: () => Effect.sync(() => (trace.push("late"), "late-done")), compensation: () => Effect.void }
  steps.push({ id: "one", action: () => Effect.sync(() => (trace.push("one"), steps.push(late), "one-done")), compensation: () => Effect.void })
  const result = await Effect.runPromise(Saga.run("order", { steps, onFailure: "fail" }))
  expect(trace).toEqual(["one"])
  expect(result).toEqual({ _tag: "Completed", values: { one: "one-done" } })
})

test("Saga.run compensates completed steps when the forward chain is interrupted", async () => {
  const trace: Array<string> = []
  await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(
      Saga.run("order", {
        steps: [
          scripted(trace, "one"),
          { id: "two", action: () => Effect.never, compensation: () => Effect.sync(() => trace.push("undo-two")) }
        ],
        onFailure: "compensate"
      }),
      { startImmediately: true }
    )
    yield* Effect.yieldNow
    yield* Fiber.interrupt(fiber)
  }))
  expect(trace).toEqual(["do-one", "undo-one"])
})

test("Saga.run fails with a PatternError for an empty saga and for duplicate step ids", async () => {
  const empty = await flipped(Saga.run("order", { steps: [] as ReadonlyArray<Step>, onFailure: "compensate" }))
  expect(empty).toBeInstanceOf(PatternError)
  expect(empty).toMatchObject({ code: "invalid_decorator", message: "Saga requires at least one step" })
  const step = scripted([], "one")
  const duplicate = await flipped(Saga.run("order", { steps: [step, step], onFailure: "compensate" }))
  expect(duplicate).toBeInstanceOf(PatternError)
  expect(duplicate).toMatchObject({ code: "invalid_decorator", message: "Saga step ids must be unique" })
})

test("Saga.run reads its options at the call, not when the Effect runs", async () => {
  const trace: Array<string> = []
  const steps = [scripted(trace, "one")]
  const options: { steps: Array<Step>; onFailure: "fail" | "compensate" } = { steps, onFailure: "fail" }
  const saga = Saga.run("order", options)
  steps[0] = { ...steps[0]!, action: () => Effect.sync(() => (trace.push("do-swapped"), "swapped")) }
  steps.push(scripted(trace, "late"))
  options.onFailure = "compensate"
  expect(await Effect.runPromise(saga)).toEqual({ _tag: "Completed", values: { one: "one-done" } })
  expect(trace).toEqual(["do-one"])
})

test("property: a failing saga undoes exactly the completed steps, newest first", async () => {
  await checkProperty(fc, {
    name: "patterns-saga-unwind",
    rule: "VIP-73: Saga.run runs forward steps whose compensations unwind in reverse on a failure",
    command: "bun test tests/experimental-patterns-saga.test.ts",
    arbitrary: fc.record({ length: fc.integer({ min: 1, max: 8 }), failAt: fc.integer({ min: 0, max: 9 }) }),
    numRuns: 200,
    check: async ({ length, failAt }: { readonly length: number; readonly failAt: number }) => {
      const trace: Array<string> = []
      const steps = Array.from({ length }, (_, index) => scripted(trace, `s${index}`, { fails: index === failAt }))
      const result = await Effect.runPromise(Saga.run("order", { steps }))
      if (failAt >= length) {
        expect(result._tag).toBe("Completed")
        expect(trace).toEqual(steps.map((step) => `do-${step.id}`))
      } else {
        expect(result).toEqual({ _tag: "Compensated", failure: new Boom({ step: `s${failAt}` }) })
        const done = steps.slice(0, failAt).map((step) => step.id)
        expect(trace).toEqual([
          ...done.map((id) => `do-${id}`),
          `do-s${failAt}`,
          ...[...done].reverse().map((id) => `undo-${id}`)
        ])
      }
    }
  })
})
