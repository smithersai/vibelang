import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const runSecondsLine = /^\/\/ run-seconds: (\d+)\b/m

// The relative .mjs modules a runner imports, compiled output aside.
export function runnerHelpers(file, text = fs.readFileSync(file, "utf8")) {
  return [...text.matchAll(/\bfrom\s+"(\.{1,2}\/[^"]+\.mjs)"/g)]
    .map((match) => path.resolve(path.dirname(file), match[1]))
    .filter((helper) => fs.existsSync(helper) && !helper.split(path.sep).includes("out"))
}

// A custom runner's deadline: the N of its own `// run-seconds: N` line, or
// else the largest N among its helpers, or else 60 s.
export function runnerSeconds(file) {
  const text = fs.readFileSync(file, "utf8")
  const own = runSecondsLine.exec(text)
  if (own) return Number(own[1])
  const inherited = runnerHelpers(file, text).flatMap((helper) => runSecondsLine.exec(fs.readFileSync(helper, "utf8"))?.[1] ?? [])
  return inherited.length ? Math.max(...inherited.map(Number)) : 60
}

// The stage deadlines written in a file, in seconds.
export function stageSeconds(text) {
  const written = [...text.matchAll(/\btimeout:\s*([0-9_]+)/g)].map((match) => Number(match[1].replaceAll("_", "")))
  return written.reduce((sum, ms) => sum + ms, 0) / 1000
}

// A case owns its command history, so concurrent workers never mix evidence.
export class CaseCommands {
  records = []

  run(command, argv, { phase, timeout, ...options }) {
    return new Promise((resolve) => {
      const started = Date.now()
      const monotonicStart = performance.now()
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
      // Pipe chunks can split a UTF-8 character; decode each stream incrementally.
      child.stdout.setEncoding("utf8")
      child.stderr.setEncoding("utf8")
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
          wallMs: performance.now() - monotonicStart,
          exitCode: record.error ? null : code, signal,
          stdoutTail: stdout.slice(-16_384), stderrTail: stderr.slice(-16_384),
        })
        resolve({ code: record.errorCode ?? (signal ? `killed by ${signal}` : record.timedOut ? `timed out after ${timeout} ms` : code), stdout, stderr })
      })
    })
  }
}
