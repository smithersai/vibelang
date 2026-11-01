import { spawn } from "node:child_process"

// A case owns its command history, so concurrent workers never mix evidence.
export class CaseCommands {
  records = []

  run(command, argv, { phase, timeout, ...options }) {
    return new Promise((resolve) => {
      const started = Date.now()
      const record = {
        phase, command, argv, cwd: options.cwd ?? process.cwd(),
        startedAt: new Date(started).toISOString(),
        timeoutMs: timeout, deadline: new Date(started + timeout).toISOString(),
        exitCode: null, signal: null, timedOut: false,
      }
      this.records.push(record)
      // Own a process group so a runner's subprocesses share its deadline.
      const grouped = process.platform !== "win32"
      const child = spawn(command, argv, { ...options, detached: grouped, stdio: ["ignore", "pipe", "pipe"] })
      record.pid = child.pid ?? null
      record.processGroup = grouped ? child.pid ?? null : null
      const terminate = () => {
        if (!child.pid) return
        if (grouped) {
          try { process.kill(-child.pid, "SIGKILL") }
          catch (error) {
            if (error.code !== "ESRCH") {
              record.terminationError = error.message
              child.kill("SIGKILL")
            }
          }
        } else child.kill("SIGKILL")
      }
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (d) => (stdout += d))
      child.stderr.on("data", (d) => (stderr += d))
      const timer = setTimeout(() => {
        record.timedOut = true
        terminate()
        // A descendant can escape the group or inherit these pipes on Windows.
        // Stop waiting for its EOF once the command's deadline has expired.
        child.stdout.destroy()
        child.stderr.destroy()
      }, timeout)
      child.on("error", (error) => {
        record.error = error.message
        record.errorCode = error.code
      })
      child.on("close", (code, signal) => {
        clearTimeout(timer)
        terminate()
        Object.assign(record, {
          finishedAt: new Date().toISOString(),
          exitCode: record.error ? null : code, signal,
          stdoutTail: stdout.slice(-16_384), stderrTail: stderr.slice(-16_384),
        })
        resolve({ code: record.errorCode ?? (signal ? `killed by ${signal}` : record.timedOut ? `timed out after ${timeout} ms` : code), stdout, stderr })
      })
    })
  }
}
