import { relative } from "node:path"
import { inspect } from "node:util"

// Consume every Node test event. Successful test names are quiet; failures,
// test output and Node's original aggregate counts remain visible to the graph.
export default async function* failures(events) {
  const began = Date.now(), pending = new Set(), finished = new Set()
  const line = (event, detail = {}) => "[node-test] " + JSON.stringify({
    event, elapsedMs: Date.now() - began, ...detail
  }) + "\n"
  const heartbeat = setInterval(() => process.stderr.write(line("progress", {
    filesCompleted: finished.size, pending: [...pending]
  })), 30_000)
  heartbeat.unref()
  try {
    yield line("start")
    for await (const { type, data = {} } of events) {
      const file = data.file && relative(process.cwd(), data.file)
      if (file && !finished.has(file)) pending.add(file)
      if (type === "test:fail") yield line("failure", {
        file, line: data.line, column: data.column, name: data.name,
        todo: data.todo, skip: data.skip,
        error: inspect(data.details?.error, {
          depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity,
          colors: false, customInspect: false
        })
      })
      else if (type === "test:stdout" || type === "test:stderr") yield data.message
      else if (type === "test:diagnostic") yield line("diagnostic", { file, message: data.message })
      else if (type === "test:summary") {
        if (file) {
          finished.add(file)
          pending.delete(file)
        } else yield line("summary", { counts: data.counts, success: data.success })
      }
    }
  } finally { clearInterval(heartbeat) }
}
