import { test, expect } from "bun:test"
import { contrastDiagnostics } from "../../site/scripts/contrast-diagnostics.mjs"

function recorder() {
  const records: any[] = []
  const diagnostics = contrastDiagnostics({
    log: (_prefix: string, json: string) => records.push(JSON.parse(json)),
    snapshot: () => ({ cgroupMemoryEvents: "oom_kill 1", freeMemoryBytes: 123 }),
  })
  return { diagnostics, records }
}

test("a failing axe operation names theme, page, state and memory without hiding its error", async () => {
  const { diagnostics, records } = recorder()
  const error = new Error("frame.evaluate: Target crashed")
  const details = { theme: "light", path: "/vibelang-features/115-cheat-sheet", state: "scrolled" }
  await expect(diagnostics.run("axe", details, async () => { throw error })).rejects.toBe(error)
  expect(records.map(record => record.event)).toEqual(["start", "failed"])
  expect(records[1]).toMatchObject({ ...details, phase: "axe", error: error.message, resources: { cgroupMemoryEvents: "oom_kill 1" } })
  expect(records[1].sequence).toBe(records[0].sequence)
})

test("renderer crash events retain the in-flight audit rather than the last completed page", async () => {
  const { diagnostics, records } = recorder()
  const events = new Map<string, (...args: any[]) => void>()
  diagnostics.watch({ on: (event: string, callback: (...args: any[]) => void) => events.set(event, callback) }, { theme: "dark", path: "/" })
  const result = await diagnostics.run("axe", { theme: "dark", path: "/", state: "copied" }, async () => {
    events.get("crash")!()
    events.get("requestfailed")!({ url: () => "https://vibelang.sh/assets/app.js?private=discard", failure: () => ({ errorText: "net::ERR_FAILED" }) })
    return 42
  })
  expect(result).toBe(42)
  expect(records.find(record => record.event === "renderer-crash")).toMatchObject({ phase: "axe", theme: "dark", path: "/", state: "copied" })
  expect(records.find(record => record.event === "request-failed")).toMatchObject({ requestPath: "/assets/app.js", error: "net::ERR_FAILED" })
  expect(JSON.stringify(records)).not.toContain("private")
  expect(records.at(-1).event).toBe("complete")
})
