import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as InterveneModule from "vibelang-runtime/experimental/patterns/Intervene"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { Intervene } = Patterns

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

test("Intervene: the pattern subpath and the Experimental namespace export the same module", () => {
  expect(InterveneModule.run).toBe(Intervene.run)
})

test("Intervene.run never applies on a dry run and reports the proposal", async () => {
  let applied = 0
  const reported = await run(Intervene.run("refactor", {
    dryRun: true,
    read: () => Effect.succeed(["a.ts", "b.ts"]),
    propose: ({ context }) => Effect.succeed({ edits: context.length }),
    apply: () => Effect.sync(() => (applied += 1, "written")),
    report: (args) => Effect.succeed(args)
  }))
  expect(applied).toBe(0)
  expect(reported).toEqual({ phase: "report", input: "refactor", proposal: { edits: 2 }, applied: undefined, dryRun: true })
})

test("Intervene.run applies and reports what was written when the approval decodes", async () => {
  const trace: Array<unknown> = []
  const reported = await run(Intervene.run("refactor", {
    dryRun: false,
    read: (args) => Effect.sync(() => trace.push(args)).pipe(Effect.as(["a.ts"])),
    propose: (args) => Effect.sync(() => trace.push(args)).pipe(Effect.as({ edits: 1 })),
    approval: (args) => Effect.sync(() => trace.push(args)).pipe(Effect.as("approved")),
    apply: (args) => Effect.sync(() => trace.push(args)).pipe(Effect.as("written")),
    report: (args) => Effect.sync(() => trace.push("report")).pipe(Effect.as(args))
  }))
  expect(trace).toEqual([
    { phase: "read", input: "refactor" },
    { phase: "propose", input: "refactor", context: ["a.ts"] },
    { input: "refactor", proposal: { edits: 1 } },
    { phase: "apply", input: "refactor", proposal: { edits: 1 } },
    "report"
  ])
  expect(reported).toMatchObject({ applied: "written", dryRun: false })
})

test("Intervene.run applies directly when no approval callback is configured", async () => {
  const trace: Array<string> = []
  const reported = await run(Intervene.run("refactor", {
    dryRun: false,
    read: () => Effect.sync(() => (trace.push("read"), ["a.ts"])),
    propose: () => Effect.sync(() => (trace.push("propose"), { edits: 1 })),
    apply: () => Effect.sync(() => (trace.push("apply"), "written")),
    report: (args) => Effect.sync(() => (trace.push("report"), args))
  }))
  expect(trace).toEqual(["read", "propose", "apply", "report"])
  expect(reported).toMatchObject({ applied: "written", dryRun: false })
})

test("Intervene.run stops before apply with a SchemaError when the approval is denied", async () => {
  let applied = 0
  const failure = await run(Effect.flip(Intervene.run("refactor", {
    dryRun: false,
    read: () => Effect.succeed(["a.ts"]),
    propose: () => Effect.succeed({ edits: 1 }),
    approval: () => Effect.succeed("denied"),
    apply: () => Effect.sync(() => (applied += 1, "written")),
    report: (args) => Effect.succeed(args)
  })))
  expect(failure._tag).toBe("SchemaError")
  expect(applied).toBe(0)
})

test("Intervene.run reads its options at the call, not when the Effect runs", async () => {
  const options = {
    dryRun: true,
    read: () => Effect.succeed(1),
    propose: () => Effect.succeed(2),
    apply: () => Effect.succeed(3),
    report: ({ applied }: { readonly applied: number | undefined }) => Effect.succeed(applied ?? "dry")
  }
  const program = Intervene.run("x", options)
  options.dryRun = false
  expect(await run(program)).toBe("dry")
})

test("property: an intervention applies exactly when it is not a dry run and the approval, if any, answers approved", async () => {
  await checkProperty(fc, {
    name: "patterns-intervene-gate",
    rule: "VIP-73: Intervene.run reads a target, proposes a change, applies it behind an optional approval, and reports",
    command: "bun test tests/experimental-patterns-intervene.test.ts",
    arbitrary: fc.record({
      dryRun: fc.boolean(),
      decision: fc.option(fc.constantFrom<unknown>("approved", "denied", true, null, { approved: true }), { nil: undefined })
    }),
    numRuns: 200,
    check: async ({ dryRun, decision }: { readonly dryRun: boolean; readonly decision: unknown }) => {
      let applied = 0
      const exit = await Effect.runPromiseExit(Intervene.run("x", {
        dryRun,
        read: () => Effect.succeed("context"),
        propose: () => Effect.succeed("proposal"),
        apply: () => Effect.sync(() => ++applied),
        report: ({ applied }) => Effect.succeed(applied),
        approval: decision === undefined ? undefined : () => Effect.succeed(decision)
      }))
      const gated = !dryRun && decision !== undefined && decision !== "approved"
      expect(exit._tag).toBe(gated ? "Failure" : "Success")
      expect(applied).toBe(!dryRun && !gated ? 1 : 0)
    }
  })
})
