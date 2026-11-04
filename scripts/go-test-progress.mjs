// Keep Go's JSON output intact; add bounded metadata before Go starts and while it is quiet.
// No command arguments, environment values, source text or process paths enter these records.
import { spawn } from "node:child_process"
import { readFileSync, readlinkSync } from "node:fs"
import { basename, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { StringDecoder } from "node:string_decoder"
import { constants } from "node:os"

export function processKinds(pid, proc = "/proc") {
  const kinds = { launcher: 0, go: 0, compile: 0, link: 0, test: 0, other: 0 }
  const pending = [pid], seen = new Set()
  while (pending.length && seen.size < 64) {
    const current = pending.pop()
    if (seen.has(current)) continue
    seen.add(current)
    const base = proc + "/" + current
    try {
      const exe = basename(readlinkSync(base + "/exe"))
      const kind = ["go", "compile", "link"].includes(exe) ? exe :
        exe.endsWith(".test") ? "test" : ["sh", "bash", "dash", "zsh"].includes(exe) ? "launcher" : "other"
      kinds[kind]++
      const children = readFileSync(base + "/task/" + current + "/children", "utf8").trim()
      if (children) pending.push(...children.split(/\s+/).filter(x => /^\d+$/.test(x)).map(Number).slice(0, 64))
    } catch { /* /proc is optional and processes may exit while sampled. */ }
  }
  return Object.values(kinds).some(Boolean) ? kinds : null
}

export function progressState() {
  let buffer = "", discard = false
  const state = { packagesStarted: 0, packagesFinished: 0, testsStarted: 0, testsFinished: 0, buildFailures: 0 }
  return {
    state,
    consume(text, event) {
      for (const part of text.split(/(?<=\n)/)) {
        const newline = part.endsWith("\n")
        if (!discard) {
          if (buffer.length + part.length > 65536) { buffer = ""; discard = true }
          else buffer += part
        }
        if (!newline) continue
        if (!discard) {
          try {
            const item = JSON.parse(buffer)
            if (item.Action === "build-fail" && typeof item.ImportPath === "string" && !item.Test) {
              state.buildFailures++; event("build-fail")
            }
            if (item.Action === "start" && !item.Test) { state.packagesStarted++; event("package-start") }
            if (item.Action === "run" && item.Test) state.testsStarted++
            if (["pass", "fail", "skip"].includes(item.Action)) {
              if (item.Test) state.testsFinished++
              else { state.packagesFinished++; event("package-" + item.Action) }
            }
          } catch { /* Non-JSON tool output still passes through unchanged. */ }
        }
        buffer = ""; discard = false
      }
    }
  }
}

export function run(args) {
  if (args[0] !== "go" || args[1] !== "test" || !args.includes("-json")) {
    process.stderr.write("usage: go-test-progress.mjs go test -json [go test arguments]\n")
    process.exitCode = 2
    return
  }
  const started = performance.now(), observer = progressState(), decoder = new StringDecoder("utf8")
  let child, spawnError, interrupted
  const record = (event, extra = "") => {
    const kinds = child?.pid ? processKinds(child.pid) : null
    const state = observer.state
    const failedBuild = state.buildFailures > 0 && ["build-fail", "finish"].includes(event)
    const phase = failedBuild ? "build-failed" : state.packagesStarted > state.packagesFinished || kinds?.test ? "tests" :
      kinds?.compile || kinds?.link ? "build" : kinds?.go ? "go-setup-or-build" :
      kinds?.launcher ? "launcher" : "starting"
    process.stderr.write("go-progress run=" + process.pid + " event=" + event +
      " elapsed_ms=" + Math.round(performance.now() - started) + " phase=" + phase +
      " packages_started=" + state.packagesStarted + " packages_finished=" + state.packagesFinished +
      " tests_started=" + state.testsStarted + " tests_finished=" + state.testsFinished +
      " build_failures=" + state.buildFailures +
      (kinds ? " processes=" + Object.entries(kinds).map(([k,v]) => k + ":" + v).join(",") : "") +
      (extra ? " " + extra : "") + "\n")
  }
  record("start")
  child = spawn(args[0], args.slice(1), { stdio: ["inherit", "pipe", "inherit"] })
  const heartbeat = setInterval(() => record("heartbeat"), 10000)
  const forward = signal => { interrupted = signal; child.kill(signal) }
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map(signal => {
    const handler = () => forward(signal)
    process.on(signal, handler)
    return [signal, handler]
  })
  child.stdout.on("data", chunk => {
    process.stdout.write(chunk)
    observer.consume(decoder.write(chunk), event => record(event))
  })
  child.on("error", error => { spawnError = error.code || "UNKNOWN" })
  child.on("close", (code, signal) => {
    clearInterval(heartbeat)
    for (const [name, handler] of handlers) process.off(name, handler)
    observer.consume(decoder.end(), event => record(event))
    record("finish", spawnError ? "cause=spawn code=" + spawnError :
      "cause=" + (signal || interrupted ? "signal" : "exit") + " code=" + code +
      (signal || interrupted ? " signal=" + (signal || interrupted) : ""))
    process.exitCode = spawnError ? 1 : signal || interrupted ?
      128 + (constants.signals[signal || interrupted] || 1) : code ?? 1
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run(process.argv.slice(2))
