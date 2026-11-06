import { relative } from "node:path"
import { inspect } from "node:util"

// Counts cover files whose Node summary arrived; pending files remain explicit.
// Routine successes are counted without filling the live graph output budget.
// Node remains responsible for the exit code, including loader and signal failures.
export default async function* progress(events) {
  const began = Date.now(), pending = new Map(), finished = new Set(), output = new Map()
  const counts = { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 }
  const line = (event, detail = {}) => "[migrate-test] " + JSON.stringify({ event, elapsedMs: Date.now() - began, ...detail }) + "\n"
  const heartbeat = setInterval(() => process.stderr.write(line("progress", {
    filesCompleted: finished.size, filesAwaitingSummary: pending.size, counts,
    pending: [...pending].map(([file, started]) => ({ file, elapsedMs: Date.now() - started }))
  })), 30_000)
  heartbeat.unref()
  try {
    const selected = process.argv.slice(1).map(file => relative(process.cwd(), file))
    yield line("start", { filesSelected: selected.length, files: selected })
    for await (const event of events) {
      const data = event.data ?? {}
      if (!data.file) continue
      const file = relative(process.cwd(), data.file)
      if (!pending.has(file) && !finished.has(file)) {
        pending.set(file, Date.now())
      }
      if (event.type === "test:stdout" || event.type === "test:stderr") {
        output.set(file, (output.get(file) ?? "") + (data.message ?? ""))
      }
      if (event.type === "test:fail" && data.details?.error) {
        if (output.has(file)) {
          yield line("failure-output", { file, output: output.get(file) })
          output.delete(file)
        }
        yield line("test-failed", { file, name: data.name, todo: data.todo, skip: data.skip,
          error: inspect(data.details.error, { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, customInspect: false }) })
      }
      if (event.type === "test:summary" && !finished.has(file)) {
        finished.add(file)
        pending.delete(file)
        for (const name of Object.keys(counts)) counts[name] += data.counts?.[name] ?? 0
        output.delete(file)
      }
    }
    const missing = selected.filter(file => !finished.has(file))
    const complete = missing.length === 0 && counts.cancelled === 0
    yield line(complete ? "complete" : "incomplete", {
      filesSelected: selected.length, filesCompleted: finished.size, missing, counts,
      success: complete && counts.failed === 0
    })
  } finally { clearInterval(heartbeat) }
}
