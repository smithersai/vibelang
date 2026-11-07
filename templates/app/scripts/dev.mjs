import { spawn } from "node:child_process"

// Build first so the watch compiler starts from a valid project.
const build = spawn("vibelang", [], { stdio: "inherit" })
build.on("error", fail)
build.on("exit", (code, signal) => {
  if (code !== 0 || signal) process.exit(code || 1)
  const compiler = spawn("vibelang", ["--watch", "--pretty", "false", "--locale", "en"], {
    stdio: ["inherit", "pipe", "inherit"]
  })
  const children = []
  let runner
  let stopping = false
  let watchOutput = ""
  const stop = (code) => {
    if (stopping) return
    stopping = true
    for (const child of children) child.kill("SIGTERM")
    process.exitCode = code
  }
  const track = (child) => {
    children.push(child)
    child.on("error", (error) => { console.error(error.message); stop(1) })
    child.on("exit", (code) => stop(code ?? 1))
    return child
  }
  track(compiler)
  compiler.stdout.pipe(process.stdout)
  compiler.stdout.on("data", (data) => {
    if (runner || stopping) return
    watchOutput = (watchOutput + data.toString()).slice(-4096)
    const plain = watchOutput.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    if (!plain.includes("Found 0 errors. Watching for file changes.")) return
    console.log("dev: compiler is watching; starting Node.")
    runner = track(spawn(process.execPath, ["--watch", "--enable-source-maps", "dist/main.js"], { stdio: "inherit" }))
  })
  process.on("SIGINT", () => stop(130))
  process.on("SIGTERM", () => stop(143))
})

function fail(error) {
  console.error(`dev: ${error.message}. Install the project's dependencies first, with bun install or npm install.`)
  process.exitCode = 1
}
