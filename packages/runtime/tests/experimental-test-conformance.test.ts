import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Exit, Layer } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { Durable, Test } from "vibelang-runtime/experimental"
import { layer as sqlite } from "./fixtures/bun-sqlite-client.ts"

const runCase = (conformanceCase: Test.ConformanceCase, subject: Test.EngineSubject) =>
  Effect.runPromiseExit(conformanceCase.run(subject))

const names = Test.conformance.engine().map((c) => c.name)

test("Test.conformance.engine() is the nine identity, interruption, replay and race cases, frozen", () => {
  expect(names).toEqual([
    "identity/distinct",
    "identity/idempotent",
    "identity/activity-name",
    "interrupt/in-flight",
    "replay/completed-prefix",
    "replay/suspended-frontier",
    "race/loser-interrupted",
    "race/recorded-winner",
    "race/recorded-loser"
  ])
  const suite = Test.conformance.engine()
  expect(Object.isFrozen(suite) && suite.every((c) => Object.isFrozen(c))).toBe(true)
})

// The standard engine over memory: storage is one store, and each build of
// the layer is a process over it.
const durableMemory: Test.EngineSubject = Effect.sync(() => Durable.layerStore(Durable.makeMemoryStore()))

describe("Experimental.Durable over a memory store passes every case", () => {
  for (const conformanceCase of Test.conformance.engine()) {
    test(conformanceCase.name, async () => {
      expect(await runCase(conformanceCase, durableMemory)).toEqual(Exit.void)
    })
  }
})

describe("Experimental.Durable over SQLite passes every case", () => {
  for (const conformanceCase of Test.conformance.engine()) {
    test(conformanceCase.name, async () => {
      const dir = mkdtempSync(join(tmpdir(), "vibelang-conformance-"))
      try {
        const subject: Test.EngineSubject = Effect.sync(() => Durable.layerSql.pipe(Layer.provide(sqlite(join(dir, "runs.db")))))
        expect(await runCase(conformanceCase, subject)).toEqual(Exit.void)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})

// Effect's own engine keeps runs in the memory of one process, so it passes
// the cases inside a process and fails every case that restarts it.
const effectMemory: Test.EngineSubject = Effect.succeed(WorkflowEngine.layerMemory)

test("Effect's WorkflowEngine.layerMemory passes the in-process cases and fails the restart cases", async () => {
  const outcomes: Record<string, string> = {}
  for (const conformanceCase of Test.conformance.engine()) {
    const exit = await runCase(conformanceCase, effectMemory)
    outcomes[conformanceCase.name] = Exit.isSuccess(exit) ? "pass" : "fail"
  }
  expect(outcomes).toEqual({
    "identity/distinct": "pass",
    "identity/idempotent": "pass",
    "identity/activity-name": "pass",
    "interrupt/in-flight": "pass",
    "replay/completed-prefix": "fail",
    "replay/suspended-frontier": "fail",
    "race/loser-interrupted": "pass",
    "race/recorded-winner": "fail",
    "race/recorded-loser": "fail"
  })
})

// An injected faulty store: the real memory store, except that it never
// keeps a step's result, as a database that lost writes would.
const forgetful: Test.EngineSubject = Effect.sync(() => {
  const store = Durable.makeMemoryStore()
  return Durable.layerStore({
    ...store,
    commit: (run, update, at) =>
      store.commit(run, { ...update, events: update.events.filter((event) => event.eventType !== "StepCompleted") }, at)
  })
})

test("a store that loses step results fails the replay case with a violation naming it", async () => {
  const replay = Test.conformance.engine().find((c) => c.name === "replay/completed-prefix")!
  const exit = await runCase(replay, forgetful)
  expect(Exit.isFailure(exit)).toBe(true)
  const violation = Exit.isFailure(exit) ? exit.cause.reasons[0] : undefined
  expect(violation?._tag === "Fail" && violation.error).toMatchObject({ _tag: "ConformanceViolation", case: "replay/completed-prefix" })
})
