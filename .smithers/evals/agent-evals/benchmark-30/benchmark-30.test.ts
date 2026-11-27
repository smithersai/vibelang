import { describe, expect, test } from "bun:test"
import { BENCHMARK_VERSION, CATEGORIES, TASKS, tasksByCategory } from "./index.mjs"
import { verifyBenchmark30 } from "./verify.mjs"

describe("agent-evals benchmark-30 manifest & offline verifier", () => {
  test("contains exactly 30 unique tasks across 6 categories (5 tasks each)", () => {
    expect(BENCHMARK_VERSION).toBe("benchmark-30/v1")
    expect(CATEGORIES).toHaveLength(6)
    expect(TASKS).toHaveLength(30)

    const ids = new Set(TASKS.map((t) => t.id))
    expect(ids.size).toBe(30)

    for (const cat of CATEGORIES) {
      const group = tasksByCategory(cat.id)
      expect(group).toHaveLength(5)
      for (const task of group) {
        expect(task.prompt.length).toBeGreaterThan(30)
        expect(task.vibe.length).toBeGreaterThan(30)
        expect(task.effectTs.length).toBeGreaterThan(30)
        expect(task.fault.vibe.length).toBeGreaterThan(20)
        expect(["compile-error", "runtime-fail"]).toContain(task.fault.kind)
      }
    }
  })

  test("all 30 Vibe references, 30 Effect TS references, and 30 fault-injection controls pass", async () => {
    const report = await verifyBenchmark30()
    expect(report.totals.tasks).toBe(30)
    expect(report.totals.vibePassed).toBe(30)
    expect(report.totals.effectTsPassed).toBe(30)
    expect(report.totals.faultsCaught).toBe(30)
    expect(report.totals.tasksPassed).toBe(30)
  }, 60_000)
})
