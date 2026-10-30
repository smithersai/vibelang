import { strict as assert } from "node:assert"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, statSync, renameSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find(path => !existsSync(path))
const skip = missing && `run typescript/vibelang/smoke.sh first; missing ${missing}`

test("watch counts warnings separately on initial and incremental builds", { skip, timeout: 60000 }, async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-watch-warning-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, noEmit: true },
    include: ["*.vibe"]
  }))
  const events = []
  const sourceState = () => {
    try {
      const content = readFileSync(join(root, "main.vibe"))
      return { sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length, mtime: statSync(join(root, "main.vibe")).mtimeMs }
    } catch (error) { return { error: error.code } }
  }
  const record = (event, detail) => events.push({ time: new Date().toISOString(), elapsedMs: performance.now(), event, source: sourceState(), detail })
  const diagnostic = () => JSON.stringify(events, null, 2)
  const source = 'function step(n: number) { return n + 1 }\nexport function f() { return step(1) catch 0 }\n'
  const file = join(root, "main.vibe")
  writeFileSync(file, source)
  const normal = spawnSync(native, ["--pretty", "false"], { cwd: root, encoding: "utf8" })
  assert.equal(normal.status, 0, normal.stdout + normal.stderr)
  assert.match(normal.stdout, /warning EK9204/)
  const child = spawn(native, ["-w", "--pretty", "false", "--preserveWatchOutput"], { cwd: root })
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve))
      child.kill()
      await exited
    }
  })
  let output = ""
  let buffer = ""
  const builds = []
  let pending
  const receive = chunk => {
    record("watch output", String(chunk))
    output += chunk
    buffer += chunk
    // A chunk may contain several completions or only part of one.
    for (;;) {
      const end = /Watching for file changes\.\r?\n/.exec(buffer)
      if (!end) break
      const length = end.index + end[0].length
      const build = { output: buffer.slice(0, length), source: sourceState() }
      buffer = buffer.slice(length)
      builds.push(build)
      record("build complete", build)
    }
    pending?.()
  }
  child.stdout.on("data", receive)
  child.stderr.on("data", receive)
  const cycle = accepts => new Promise((resolve, reject) => {
    const revision = sourceState().sha256
    const timer = setTimeout(() => {
      pending = undefined
      reject(new Error(`watch timeout for source ${revision}:\n${output}\n${diagnostic()}`))
    }, 20000)
    pending = () => {
      while (builds.length) {
        const build = builds.shift()
        if (build.source.sha256 !== revision || !accepts(build.output)) {
          record("intermediate build ignored", build)
          continue
        }
        clearTimeout(timer)
        pending = undefined
        resolve(build.output)
        return
      }
    }
    pending()
  })
  const writeRevision = (label, content) => {
    // writeFileSync truncates before writing. A watcher can compile that empty
    // snapshot. Replace the whole file instead, without a timing-based delay.
    const next = file + ".next"
    writeFileSync(next, content)
    renameSync(next, file)
    record("source revision written", label)
  }
  record("waiting for initial build")
  const initial = await cycle(text => /warning EK9204/.test(text))
  assert.match(initial, /Found 0 errors and 1 warning\. Watching for file changes\./, diagnostic())
  writeRevision("broken", source + 'const broken: number = "wrong"\n')
  const incremental = await cycle(text => /error TS2322/.test(text) && /warning EK9204/.test(text))
  assert.match(incremental, /Found 1 error and 1 warning\. Watching for file changes\./, diagnostic())
  writeRevision("repaired", source)
  const repaired = await cycle(text => /warning EK9204/.test(text) && !/error TS\d+/.test(text))
  assert.match(repaired, /Found 0 errors and 1 warning\. Watching for file changes\./, diagnostic())
})
