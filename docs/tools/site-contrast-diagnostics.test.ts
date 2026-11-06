import { test, expect } from "bun:test"
import fc from "fast-check"
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

test("media timings correlate response and completion with a bounded safe request record", async () => {
  let time = 100
  const records: any[] = []
  const diagnostics = contrastDiagnostics({
    log: (_: string, json: string) => records.push(JSON.parse(json)),
    snapshot: () => ({}), now: () => time,
  })
  const events = new Map<string, (...args: any[]) => void>()
  diagnostics.watch({ on: (event: string, callback: (...args: any[]) => void) => events.set(event, callback) }, { theme: "dark", path: "/" })
  const request = {
    url: () => "https://vibelang.sh/videos/demo.mp4?credential=secret",
    resourceType: () => "media",
    headers: () => ({ range: "bytes=100-", authorization: "secret" }),
  }
  await diagnostics.run("navigate", { theme: "dark", path: "/" }, async () => {
    events.get("request")!(request)
    time = 120
    events.get("response")!({
      request: () => request, status: () => 206,
      headers: () => ({ "content-type": "video/mp4", "content-range": "bytes 100-199/200", "content-length": "100", "set-cookie": "secret" }),
    })
    time = 160
    events.get("requestfinished")!(request)
  })
  const media = records.filter(record => record.event.startsWith("media-"))
  expect(media.map(record => record.event)).toEqual(["media-request", "media-response", "media-finished"])
  expect(media[0]).toMatchObject({ requestPath: "/videos/demo.mp4", requestRange: "bytes=100-", theme: "dark", path: "/", requestOperationSequence: 1 })
  expect(media[1]).toMatchObject({ status: 206, contentType: "video/mp4", contentRange: "bytes 100-199/200", contentLength: 100, elapsedMs: 20 })
  expect(media[2]).toMatchObject({ elapsedMs: 60 })
  expect(new Set(media.map(record => record.requestSequence)).size).toBe(1)
  expect(JSON.stringify(records)).not.toMatch(/credential|secret|authorization|set-cookie/)
})

test("media diagnostics bound per-page volume and retain abort or close duration", async () => {
  for (const terminal of ["requestfailed", "close"]) {
    let time = 0
    const records: any[] = []
    const diagnostics = contrastDiagnostics({ log: (_: string, json: string) => records.push(JSON.parse(json)), snapshot: () => ({}), now: () => time })
    const events = new Map<string, (...args: any[]) => void>()
    diagnostics.watch({ on: (event: string, callback: (...args: any[]) => void) => events.set(event, callback) }, { path: "/" })
    const requests = Array.from({ length: 40 }, (_, index) => ({
      url: () => "https://vibelang.sh/videos/" + index + ".mp4?secret=value",
      resourceType: () => "media", headers: () => ({ range: "secret-header" }),
      failure: () => ({ errorText: "net::ERR_ABORTED" }),
    }))
    for (const request of requests) events.get("request")!(request)
    // Ordinary assets and external media are outside this bounded local-media trace.
    events.get("request")!({ url: () => "https://vibelang.sh/assets/app.js", resourceType: () => "script" })
    events.get("request")!({ url: () => "https://example.invalid/private", resourceType: () => "media" })
    time = 15000
    if (terminal === "requestfailed") for (const request of requests) events.get(terminal)!(request)
    events.get("close")!()
    const media = records.filter(record => record.event.startsWith("media-"))
    expect(media.filter(record => record.event === "media-request")).toHaveLength(16)
    const completed = media.filter(record => record.event === (terminal === "close" ? "media-pending-at-close" : "media-failed"))
    expect(completed).toHaveLength(16)
    expect(completed.every(record => record.elapsedMs === 15000 && record.requestRange === "invalid")).toBe(true)
    expect(media).toHaveLength(32)
    expect(JSON.stringify(media)).not.toMatch(/secret|example.invalid|private|app.js/)
  }
})

test("generated range metadata retains numbers while arbitrary header values stay private", () => {
  fc.assert(fc.property(fc.nat({ max: 1000000 }), fc.nat({ max: 1000000 }), fc.boolean(), (start, width, valid) => {
    const records: any[] = []
    const diagnostics = contrastDiagnostics({ log: (_: string, json: string) => records.push(JSON.parse(json)), snapshot: () => ({}) })
    const events = new Map<string, (...args: any[]) => void>()
    diagnostics.watch({ on: (event: string, callback: (...args: any[]) => void) => events.set(event, callback) }, {})
    const requestRange = valid ? "bytes=" + start + "-" : "bytes=private-value"
    const contentRange = valid ? "bytes " + start + "-" + (start + width) + "/" + (start + width + 1) : "private-value"
    const request = { url: () => "https://vibelang.sh/videos/demo.mp4?private=value", resourceType: () => "media", headers: () => ({ range: requestRange }) }
    events.get("request")!(request)
    events.get("response")!({ request: () => request, status: () => 206, headers: () => ({
      "content-type": valid ? "video/mp4; private=value" : "application/private-value",
      "content-range": contentRange, "content-length": valid ? String(width + 1) : "private-value",
    }) })
    events.get("requestfinished")!(request)
    expect(records).toHaveLength(3)
    expect(records[0].requestRange).toBe(valid ? requestRange : "invalid")
    expect(records[1]).toMatchObject({
      contentType: valid ? "video/mp4" : "other",
      contentRange: valid ? contentRange : "invalid",
    })
    expect(records[1].contentLength).toBe(valid ? width + 1 : undefined)
    expect(JSON.stringify(records)).not.toContain("private")
  }), { numRuns: 64, seed: 308 })
})
