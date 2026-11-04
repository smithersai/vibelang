import { relative } from "node:path"
import { inspect } from "node:util"

// Counts cover files whose Node summary arrived; pending files remain explicit.
// The reporter never sets an exit code or replaces Node's normal spec output.
export default async function* progress(events) {
  const began = Date.now(), pending = new Map(), finished = new Set()
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
        yield line("file-observed", { file })
      }
      if (event.type === "test:fail" && data.details?.error) {
        yield line("test-failed", { file, name: data.name,
          error: inspect(data.details.error, { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, customInspect: false }) })
      }
      if (event.type === "test:summary" && !finished.has(file)) {
        finished.add(file)
        pending.delete(file)
        for (const name of Object.keys(counts)) counts[name] += data.counts?.[name] ?? 0
        yield line("file-complete", { file, counts: data.counts, success: data.success })
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
