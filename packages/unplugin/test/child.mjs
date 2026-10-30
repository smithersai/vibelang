import { execFileSync, spawn } from "node:child_process"

// runChild runs a command to its end and resolves with its exit code, its
// stdout and stderr, and both interleaved as output. The child leads a
// process group of its own, so everything it starts can be listed and killed.
//
// A child that has not exited within limit ms is killed with its group, and
// runChild rejects with the processes still running and the output so far: a
// hang names itself instead of holding the test runner until its target's
// timeout. A child that exits while processes it started still hold its
// output open would never close; runChild waits five seconds for them, logs
// which they are, kills them and resolves.
export function runChild(command, args, { limit = 120_000, ...options } = {}) {
  return new Promise((accept, reject) => {
    const line = [command, ...args].join(" ")
    let stdout = ""
    let stderr = ""
    let output = ""
    let settled = false
    let grace
    const child = spawn(command, args, { ...options, detached: true })
    const settle = (finish) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(grace)
      finish()
      kill(child.pid)
    }
    const timer = setTimeout(() => settle(() => reject(new Error(
      `${line} did not exit within ${limit / 1000} s. Still running:\n${group(child.pid)}\nOutput so far:\n${output}`))), limit)
    child.stdout.on("data", (data) => { stdout += data; output += data })
    child.stderr.on("data", (data) => { stderr += data; output += data })
    child.on("error", (error) => settle(() => reject(error)))
    child.on("exit", (code) => {
      grace = setTimeout(() => settle(() => {
        console.log(`${line} exited ${code}, but processes it started still hold its output:\n${group(child.pid)}`)
        accept({ code, stdout, stderr, output })
      }), 5000)
    })
    child.on("close", (code) => settle(() => accept({ code, stdout, stderr, output })))
  })
}

// group lists the processes of a process group, one per line.
function group(pgid) {
  try {
    const lines = execFileSync("ps", ["-A", "-o", "pid=,pgid=,etime=,command="], { encoding: "utf8" }).split("\n")
    return lines.filter((line) => line.trim().split(/\s+/)[1] === String(pgid)).join("\n") || "(none)"
  } catch (error) {
    return `(ps failed: ${error.message})`
  }
}

function kill(pgid) {
  try {
    process.kill(-pgid, "SIGKILL")
  } catch {}
}
