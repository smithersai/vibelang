import { expect, test } from "bun:test"
import fc from "fast-check"
import * as Effect from "effect/Effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as RunbookModule from "vibelang-runtime/experimental/patterns/Runbook"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { PatternError, Runbook } = Patterns

test("Runbook: the subpath module is the namespace's module", () => {
  expect(RunbookModule.run).toBe(Runbook.run)
})

test("Runbook.gated and Runbook.elevated read a step's risk", () => {
  expect(Runbook.gated("safe")).toBe(false)
  expect(Runbook.gated("risky")).toBe(true)
  expect(Runbook.gated("critical")).toBe(true)
  expect(Runbook.elevated("safe")).toBe(false)
  expect(Runbook.elevated("risky")).toBe(false)
  expect(Runbook.elevated("critical")).toBe(true)
})

test("Runbook.run never asks for approval of a safe step", async () => {
  const asked: Array<string> = []
  const result = await Effect.runPromise(Runbook.run("release-1", {
    onDeny: "fail",
    approve: (request) => Effect.sync(() => (asked.push(request.step), "approved")),
    steps: [
      { id: "backup", risk: "safe", run: () => Effect.succeed("backed up") },
      { id: "deploy", risk: "risky", run: () => Effect.succeed("deployed") }
    ]
  }))
  expect(asked).toEqual(["deploy"])
  expect(result).toEqual({ outputs: { backup: "backed up", deploy: "deployed" }, ran: ["backup", "deploy"], skipped: [] })
})

test("Runbook.run returns own outputs for prototype-shaped step ids", async () => {
  const ids = ["__proto__", "constructor", "toString", "normal"]
  const result = await Effect.runPromise(Runbook.run("release-1", {
    onDeny: "fail",
    approve: () => Effect.succeed("approved"),
    steps: ids.map((id) => ({ id, risk: "safe" as const, run: () => Effect.succeed(`${id}-value`) }))
  }))
  expect(Object.getPrototypeOf(result.outputs)).toBe(Object.prototype)
  for (const id of ids) {
    expect(Object.hasOwn(result.outputs, id)).toBe(true)
    expect(result.outputs[id]).toBe(`${id}-value`)
  }
})

test("Runbook.run passes elevated true for a critical step and the previous step's output", async () => {
  const requests: Array<unknown> = []
  const seen: Array<unknown> = []
  await Effect.runPromise(Runbook.run("release-1", {
    onDeny: "fail",
    approve: (request) => Effect.sync(() => (requests.push({ ...request }), "approved")),
    steps: [
      { id: "deploy", risk: "risky", run: () => Effect.succeed("deployed") },
      { id: "migrate", risk: "critical", run: (request) => Effect.sync(() => (seen.push({ ...request }), "migrated")) }
    ]
  }))
  expect(requests).toEqual([
    { step: "deploy", risk: "risky", elevated: false, input: "release-1", previous: undefined },
    { step: "migrate", risk: "critical", elevated: true, input: "release-1", previous: "deployed" }
  ])
  expect(seen).toEqual([{ step: "migrate", risk: "critical", elevated: true, input: "release-1", previous: "deployed" }])
})

test("Runbook.run stops on a denial under onDeny fail with a SchemaError", async () => {
  const ran: Array<string> = []
  for (const answer of ["denied", true, { approved: true }, "Approved"]) {
    const failure = await Effect.runPromise(Effect.flip(Runbook.run("release-1", {
      onDeny: "fail",
      approve: () => Effect.succeed(answer),
      steps: [
        { id: "deploy", risk: "risky", run: () => Effect.sync(() => (ran.push("deploy"), "deployed")) },
        { id: "notify", risk: "safe", run: () => Effect.sync(() => (ran.push("notify"), "notified")) }
      ]
    })))
    expect(failure._tag).toBe("SchemaError")
  }
  expect(ran).toEqual([])
})

test("Runbook.run fails with the approval's own failure", async () => {
  const failure = await Effect.runPromise(Effect.flip(Runbook.run("release-1", {
    onDeny: "skip",
    approve: () => Effect.fail("approver offline" as const),
    steps: [{ id: "deploy", risk: "risky", run: () => Effect.succeed("deployed") }]
  })))
  expect(failure).toBe("approver offline")
})

test("Runbook.run skips a denied step and runs the next one under onDeny skip", async () => {
  const ran: Array<string> = []
  const result = await Effect.runPromise(Runbook.run("release-1", {
    onDeny: "skip",
    approve: (request) => Effect.succeed(request.step === "deploy" ? "denied" : "approved"),
    steps: [
      { id: "deploy", risk: "risky", run: () => Effect.sync(() => (ran.push("deploy"), "deployed")) },
      { id: "notify", risk: "safe", run: () => Effect.sync(() => (ran.push("notify"), "notified")) },
      { id: "migrate", risk: "critical", run: () => Effect.sync(() => (ran.push("migrate"), "migrated")) }
    ]
  }))
  expect(ran).toEqual(["notify", "migrate"])
  expect(result).toEqual({ outputs: { notify: "notified", migrate: "migrated" }, ran: ["notify", "migrate"], skipped: ["deploy"] })
})

test("Runbook.run hands a skipped step's predecessor to the next step", async () => {
  const seen: Array<unknown> = []
  await Effect.runPromise(Runbook.run("release-1", {
    onDeny: "skip",
    approve: (request) => Effect.succeed(request.step === "deploy" ? "denied" : "approved"),
    steps: [
      { id: "backup", risk: "safe", run: () => Effect.succeed("backed up") },
      { id: "deploy", risk: "risky", run: () => Effect.succeed("deployed") },
      { id: "notify", risk: "safe", run: ({ previous }) => Effect.sync(() => (seen.push(previous), "notified")) }
    ]
  }))
  expect(seen).toEqual(["backed up"])
})

test("Runbook.run refuses an empty runbook and a duplicate step id", async () => {
  const empty = await Effect.runPromise(Effect.flip(Runbook.run("release-1", {
    onDeny: "fail",
    approve: () => Effect.succeed("approved"),
    steps: []
  })))
  expect(empty).toBeInstanceOf(PatternError)
  expect(empty).toMatchObject({ code: "invalid_decorator", message: "Runbook requires at least one step" })
  const duplicate = await Effect.runPromise(Effect.flip(Runbook.run("release-1", {
    onDeny: "fail",
    approve: () => Effect.succeed("approved"),
    steps: [
      { id: "deploy", risk: "safe", run: () => Effect.succeed("a") },
      { id: "deploy", risk: "safe", run: () => Effect.succeed("b") }
    ]
  })))
  expect(duplicate).toBeInstanceOf(PatternError)
  expect(duplicate).toMatchObject({ code: "invalid_decorator", message: "Runbook step ids must be unique" })
})

test("Runbook.run does not admit a step appended while the run is in flight", async () => {
  const trace: Array<string> = []
  const steps: Array<RunbookModule.RuntimeStep<string, string, never, never>> = []
  const late = { id: "late", risk: "safe" as const, run: () => Effect.sync(() => (trace.push("late"), "late-done")) }
  steps.push({ id: "first", risk: "safe", run: () => Effect.sync(() => (trace.push("first"), steps.push(late), "first-done")) })
  const result = await Effect.runPromise(Runbook.run("release-1", { steps, approve: () => Effect.succeed("approved"), onDeny: "fail" }))
  expect(trace).toEqual(["first"])
  expect(result).toEqual({ outputs: { first: "first-done" }, ran: ["first"], skipped: [] })
})

test("Runbook.run reads its options at the call, not when the Effect runs", async () => {
  const steps: Array<RunbookModule.RuntimeStep<string, string, never, never>> = [
    { id: "deploy", risk: "risky", run: () => Effect.succeed("deployed") }
  ]
  const options: { steps: typeof steps; approve: () => Effect.Effect<string>; onDeny: "fail" | "skip" } = {
    steps,
    approve: () => Effect.succeed("denied"),
    onDeny: "skip"
  }
  const program = Runbook.run("release-1", options)
  steps.push({ id: "late", risk: "safe", run: () => Effect.succeed("late") })
  options.approve = () => Effect.succeed("approved")
  options.onDeny = "fail"
  expect(await Effect.runPromise(program)).toEqual({ outputs: {}, ran: [], skipped: ["deploy"] })
})

test("property: under onDeny skip a step runs exactly when it is safe or approved", async () => {
  await checkProperty(fc, {
    name: "patterns-runbook-gates",
    rule: "VIP-73: Runbook.run runs ordered steps; a step's risk decides whether an approval gates it",
    command: "bun test tests/experimental-patterns-runbook.test.ts",
    arbitrary: fc.array(fc.record({ risk: fc.constantFrom("safe" as const, "risky" as const, "critical" as const), approve: fc.boolean() }), {
      minLength: 1,
      maxLength: 8
    }),
    numRuns: 200,
    check: async (plan: ReadonlyArray<{ readonly risk: "safe" | "risky" | "critical"; readonly approve: boolean }>) => {
      const asked: Array<string> = []
      const previousSeen: Array<unknown> = []
      const steps = plan.map(({ risk }, index) => ({
        id: `s${index}`,
        risk,
        run: ({ previous }: { readonly previous: string | undefined }) =>
          Effect.sync(() => (previousSeen.push(previous), `out${index}`))
      }))
      const result = await Effect.runPromise(Runbook.run("input", {
        steps,
        onDeny: "skip",
        approve: (request) =>
          Effect.sync(() => (asked.push(request.step), plan[Number(request.step.slice(1))]!.approve ? "approved" : "no"))
      }))
      const runs = plan.map(({ risk, approve }) => risk === "safe" || approve)
      expect(asked).toEqual(steps.filter((step) => step.risk !== "safe").map((step) => step.id))
      expect(result.ran).toEqual(steps.filter((_, index) => runs[index]).map((step) => step.id))
      expect(result.skipped).toEqual(steps.filter((_, index) => !runs[index]).map((step) => step.id))
      const ranOutputs = plan.flatMap((_, index) => runs[index] ? [`out${index}`] : [])
      expect(previousSeen).toEqual([undefined, ...ranOutputs.slice(0, -1)].slice(0, ranOutputs.length))
    }
  })
})
