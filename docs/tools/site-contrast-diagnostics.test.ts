import { test, expect } from "bun:test"
import { contrastDiagnostics, processMemory } from "../../site/scripts/contrast-diagnostics.mjs"

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

test("completed stages are not labelled as active when the renderer later crashes", async () => {
  const { diagnostics, records } = recorder()
  const events = new Map<string, (...args: any[]) => void>()
  diagnostics.watch({ on: (event: string, callback: (...args: any[]) => void) => events.set(event, callback) }, { theme: "light", path: "/" })
  await diagnostics.run("axe", { state: "copied" }, async () => 1)
  events.get("crash")!()
  expect(records[0].active).toBe(true)
  expect(records[1].active).toBe(false)
  expect(records.at(-1)).toMatchObject({ event: "renderer-crash", active: false, phase: "axe" })
})

test("process memory totals tolerate disappearing processes and omit names and arguments", () => {
  const names = ["go", "vibelang.test", "vibelangfuzz.te", "vibelangmapper.", "node", "bun", "chrome", "customer-secret", "gone", "kernel"]
  const result = processMemory({
    list: () => [...names.map((_, i) => String(i + 1)), "self", "../private"],
    link: (path: string) => {
      const pid = /^\/proc\/(\d+)\/exe$/.exec(path)![1]
      const name = names[Number(pid) - 1]!
      const fullNames: Record<string, string> = { "vibelangfuzz.te": "vibelangfuzz.test", "vibelangmapper.": "vibelangmapper.test" }
      const full = fullNames[name] ?? name
      return "/private/customer-secret/" + full
    },
    read: (path: string) => {
      const [, pid, file] = /^\/proc\/(\d+)\/(comm|status)$/.exec(path)!
      const name = names[Number(pid) - 1]!
      if (name === "gone") throw new Error("process disappeared")
      if (file === "comm") return name + "\n"
      return name === "kernel" ? "Name: kernel\n" : "VmRSS:  12 kB\n"
    },
  })
  expect(result).toEqual({ groups: {
    goTools: { count: 1, rssBytes: 12288 },
    testBinaries: { count: 3, rssBytes: 36864 },
    javascript: { count: 2, rssBytes: 24576 },
    chromium: { count: 1, rssBytes: 12288 },
    other: { count: 1, rssBytes: 12288 },
  }, unreadable: 1 })
  expect(JSON.stringify(result)).not.toContain("customer-secret")
  expect(processMemory({ list: () => { throw new Error("no procfs") } })).toBeUndefined()
})

test("native target crash diagnostics omit target URLs and identifiers", async () => {
  const { diagnostics, records } = recorder()
  const events = new Map<string, (...args: any[]) => void>()
  const sent: any[] = []
  await diagnostics.watchBrowser({ newBrowserCDPSession: async () => ({
    on: (event: string, callback: (...args: any[]) => void) => events.set(event, callback),
    send: async (...args: any[]) => sent.push(args),
  }) })
  expect(sent).toEqual([["Target.setDiscoverTargets", { discover: true }]])
  events.get("Target.targetCrashed")!({ status: "killed", errorCode: 9, targetId: "private-id", url: "https://example.invalid/?credential=secret" })
  expect(records.at(-1)).toMatchObject({ event: "target-crash-status", status: "killed", errorCode: 9 })
  expect(JSON.stringify(records)).not.toContain("private-id")
  expect(JSON.stringify(records)).not.toContain("credential")
})
