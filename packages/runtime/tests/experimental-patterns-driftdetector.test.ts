import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as DriftDetectorModule from "vibelang-runtime/experimental/patterns/DriftDetector"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { DriftDetector } = Patterns

type Snapshot = { readonly checksum: string }

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

test("DriftDetector: the pattern subpath and the Experimental namespace export the same module", () => {
  expect(DriftDetectorModule.run).toBe(DriftDetector.run)
})

test("DriftDetector.run alerts once with the comparison when the snapshot drifted", async () => {
  const alerted: Array<unknown> = []
  const result = await run(DriftDetector.run({ target: "config" }, {
    baseline: { checksum: "a" } as Snapshot,
    capture: () => Effect.succeed({ checksum: "b" }),
    compare: ({ baseline, snapshot }) => Effect.succeed({ drifted: snapshot.checksum !== baseline.checksum, from: baseline.checksum }),
    alert: (input) => Effect.sync(() => (alerted.push(input.comparison), "paged"))
  }))
  expect(result.drifted).toBe(true)
  expect(result.snapshot).toEqual({ checksum: "b" })
  expect(result.alert).toBe("paged")
  expect(alerted).toEqual([{ drifted: true, from: "a" }])
})

test("DriftDetector.run skips the alert when nothing drifted", async () => {
  let alerts = 0
  const result = await run(DriftDetector.run({ target: "config" }, {
    baseline: { checksum: "a" } as Snapshot,
    capture: () => Effect.succeed({ checksum: "a" }),
    compare: ({ baseline, snapshot }) => Effect.succeed({ drifted: snapshot.checksum !== baseline.checksum }),
    alert: () => Effect.sync(() => (++alerts, "paged"))
  }))
  expect(result).toEqual({ snapshot: { checksum: "a" }, comparison: { drifted: false }, drifted: false })
  expect(alerts).toBe(0)
})

test("DriftDetector.run hands the input and the baseline to capture and compare", async () => {
  const seen: Array<unknown> = []
  await run(DriftDetector.run({ target: "config" }, {
    baseline: { checksum: "a" } as Snapshot,
    capture: (input) => Effect.sync(() => (seen.push(input), { checksum: "a" })),
    compare: (input) => Effect.sync(() => (seen.push(input.baseline), { drifted: false }))
  }))
  expect(seen).toEqual([{ input: { target: "config" }, baseline: { checksum: "a" } }, { checksum: "a" }])
})

test("DriftDetector.run lets a custom alertIf override the default reader", async () => {
  let alerts = 0
  const result = await run(DriftDetector.run({ target: "config" }, {
    baseline: 100,
    capture: () => Effect.succeed(140),
    compare: ({ baseline, snapshot }) => Effect.succeed({ delta: snapshot - baseline }),
    alertIf: (comparison) => comparison.delta > 25,
    alert: () => Effect.sync(() => (++alerts, "paged"))
  }))
  expect(result.drifted).toBe(true)
  expect(alerts).toBe(1)
})

test("DriftDetector.run reports drift without alerting when no alert is configured", async () => {
  const result = await run(DriftDetector.run({ target: "config" }, {
    baseline: { checksum: "a" } as Snapshot,
    capture: () => Effect.succeed({ checksum: "b" }),
    compare: ({ baseline, snapshot }) => Effect.succeed({ drifted: snapshot.checksum !== baseline.checksum }),
    alertIf: undefined
  }))
  expect(result.drifted).toBe(true)
  expect(result.alert).toBeUndefined()
  expect(result.comparison).toEqual({ drifted: true })
})

test("DriftDetector.run fails with the alert's failure", async () => {
  const failure = await run(Effect.flip(DriftDetector.run("x", {
    baseline: 0,
    capture: () => Effect.succeed(1),
    compare: () => Effect.succeed(true),
    alert: () => Effect.fail("pager down")
  })))
  expect(failure).toBe("pager down")
})

test("DriftDetector.drifted reads true or an own drifted: true only", () => {
  expect(DriftDetector.drifted(true)).toBe(true)
  expect(DriftDetector.drifted({ drifted: true })).toBe(true)
  expect(DriftDetector.drifted({ drifted: false })).toBe(false)
  expect(DriftDetector.drifted(Object.create({ drifted: true }))).toBe(false)
  expect(DriftDetector.drifted("changed")).toBe(false)
})

test("DriftDetector.run reads its options at the call, not when the Effect runs", async () => {
  const options = {
    baseline: 1,
    capture: () => Effect.succeed(1),
    compare: ({ snapshot, baseline }: { readonly snapshot: number; readonly baseline: number }) => Effect.succeed(snapshot !== baseline),
    alert: () => Effect.succeed("paged")
  }
  const program = DriftDetector.run("x", options)
  options.baseline = 2
  options.alert = () => Effect.succeed("swapped")
  expect(await run(program)).toEqual({ snapshot: 1, comparison: false, drifted: false })
})

test("property: a drift detector alerts exactly when the comparison reports drift and an alert is configured", async () => {
  await checkProperty(fc, {
    name: "patterns-drift-detector-alert",
    rule: "VIP-73: DriftDetector.run captures a snapshot, compares it with a baseline, and alerts when it moved",
    command: "bun test tests/experimental-patterns-driftdetector.test.ts",
    arbitrary: fc.record({ baseline: fc.integer({ min: 0, max: 5 }), snapshot: fc.integer({ min: 0, max: 5 }), alerts: fc.boolean() }),
    numRuns: 200,
    check: async ({ baseline, snapshot, alerts }: { readonly baseline: number; readonly snapshot: number; readonly alerts: boolean }) => {
      let raised = 0
      const result = await run(DriftDetector.run(null, {
        baseline,
        capture: () => Effect.succeed(snapshot),
        compare: ({ snapshot, baseline }) => Effect.succeed({ drifted: snapshot !== baseline }),
        alert: alerts ? () => Effect.sync(() => ++raised) : undefined
      }))
      expect(result.drifted).toBe(snapshot !== baseline)
      expect(raised).toBe(alerts && snapshot !== baseline ? 1 : 0)
      expect("alert" in result).toBe(raised === 1)
    }
  })
})
