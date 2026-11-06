// A debugger's whole path, over V8's inspector protocol as VS Code speaks it:
// find the generated line of a .vibe line through the script's own map, set
// the breakpoint there, run, and read the paused frame back through the map.
import { strict as assert } from "node:assert"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { AnyMap, decodedMappings, encodedMap, generatedPositionFor, originalPositionFor } from "@jridgewell/trace-mapping"
import { compiler, entry, locate, mainVibe, project, succeed } from "./helpers.mjs"

class Inspector {
  constructor(socket) {
    this.socket = socket
    this.next = 1
    this.waiting = new Map()
    this.events = new Map()
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data)
      if (message.id !== undefined) this.waiting.get(message.id)?.(message)
      else for (const listener of this.events.get(message.method) ?? []) listener(message.params)
    })
  }
  send(method, params = {}) {
    const id = this.next++
    return new Promise((done, failed) => {
      this.waiting.set(id, (reply) => reply.error ? failed(new Error(`${method}: ${reply.error.message}`)) : done(reply.result))
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, listener) {
    this.events.set(method, [...(this.events.get(method) ?? []), listener])
  }
}

async function debug(root, args) {
  const child = spawn(process.execPath, ["--inspect-brk=127.0.0.1:0", ...args], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VIBELANG_CACHE_DIR: join(root, ".vibelang-cache") }
  })
  let stderr = ""
  const address = new Promise((done, failed) => {
    child.stderr.on("data", (chunk) => {
      stderr += chunk
      const match = /ws:\/\/\S+/.exec(stderr)
      if (match) done(match[0])
    })
    child.on("close", () => failed(new Error(`no inspector:\n${stderr}`)))
  })
  const socket = new WebSocket(await address)
  await once(socket, "open")
  return { child, inspector: new Inspector(socket), socket, log: () => stderr }
}

const decode = (url) => JSON.parse(Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString("utf8"))

/**
 * Breaks at `needle` by its .vibe line and returns where V8 paused, mapped back
 * to .vibe, with `expression` evaluated there. V8 pauses before a script with a
 * source map runs, the pause VS Code's debugger sets its breakpoints in, so
 * the breakpoint is in place before the script's first statement.
 */
async function breakAt(root, args, script, needle, expression) {
  const { child, inspector, socket, log } = await debug(root, args)
  let timer
  try {
    const target = locate(mainVibe, needle, "main.vibe")
    const scripts = new Map()
    inspector.on("Debugger.scriptParsed", (parsed) => scripts.set(parsed.scriptId, parsed))
    let map
    const hit = new Promise((done, failed) => {
      inspector.on("Debugger.paused", async (event) => {
        try {
          if (event.hitBreakpoints?.length) return done(event)
          const parsed = scripts.get(event.data?.scriptId ?? event.callFrames[0].location.scriptId)
          if (event.reason === "instrumentation" && parsed?.url.endsWith(script)) {
            map = await sourceMapOf(parsed, root)
            const source = map.sources.find((name) => name.endsWith("main.vibe"))
            const generated = generatedPositionFor(new AnyMap(map), { source, line: target.line, column: target.column })
            assert.notEqual(generated.line, null, `${needle} has no generated position`)
            await inspector.send("Debugger.setBreakpointByUrl", { url: parsed.url, lineNumber: generated.line - 1, columnNumber: generated.column })
          }
          await inspector.send("Debugger.resume")
        } catch (error) {
          failed(error)
        }
      })
    })
    await inspector.send("Runtime.enable")
    await inspector.send("Debugger.enable")
    await inspector.send("Debugger.setInstrumentationBreakpoint", { instrumentation: "beforeScriptWithSourceMapExecution" })
    await inspector.send("Runtime.runIfWaitingForDebugger")
    const event = await Promise.race([hit, new Promise((_, failed) => timer = setTimeout(() => failed(new Error(`no pause at ${needle}:\n${log()}`)), 60000))])
    const frame = event.callFrames[0]
    const original = originalPositionFor(new AnyMap(map), { line: frame.location.lineNumber + 1, column: frame.location.columnNumber })
    const value = await inspector.send("Debugger.evaluateOnCallFrame", { callFrameId: frame.callFrameId, expression })
    const { scriptSource } = await inspector.send("Debugger.getScriptSource", { scriptId: frame.location.scriptId })
    const statement = scriptSource.split(/\r\n|[\n\r\u2028\u2029]/)[frame.location.lineNumber]
    return { original, target, value: value.result.value, functionName: frame.functionName, statement }
  } finally {
    clearTimeout(timer)
    socket.close()
    child.kill()
  }
}

async function sourceMapOf({ sourceMapURL }, root) {
  if (sourceMapURL.startsWith("data:")) return decode(sourceMapURL)
  const { readFile } = await import("node:fs/promises")
  return JSON.parse(await readFile(join(root, "out", sourceMapURL), "utf8"))
}

// V8's frame and script text are independent of the map used in both directions.
async function checkPlainBreakpoint(root) {
  const needle = 'const made = middle("p")'
  const { original, target, value, functionName, statement } = await breakAt(root, ["entry.mjs"], "out/main.js", needle, "typeof label")
  assert.equal(original.line, target.line)
  assert.equal(functionName, "plainTrace", "paused function")
  assert.ok(statement.includes(needle), `paused statement: ${statement}`)
  assert.equal(value, "undefined", "plainTrace has no label parameter")
}

test("the debugger check rejects maps that swap statements or functions", async (t) => {
  for (const other of ['const made = leaf(label + "-m")', 'return made.message.length > 0 ? made : new Error("empty")']) {
    await t.test(other, async (t) => {
      const root = project(t, { "entry.mjs": entry("./out/main.js") })
      await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
      const code = await readFile(join(root, "out/main.js"), "utf8")
      const lines = code.split("\n")
      const intended = lines.findIndex((line) => line.includes('const made = middle("p")'))
      const actual = other.startsWith("return") ? intended + 1 : lines.findIndex((line) => line.includes(other))
      assert.ok(intended >= 0 && actual >= 0 && lines[actual].includes(other), "mutation statements exist")
      const path = join(root, "out/main.js.map")
      const map = new AnyMap(JSON.parse(await readFile(path, "utf8")))
      const rows = decodedMappings(map)
      ;[rows[intended], rows[actual]] = [rows[actual], rows[intended]]
      await writeFile(path, JSON.stringify(encodedMap(new AnyMap({ ...encodedMap(map), mappings: rows }))))
      await assert.rejects(checkPlainBreakpoint(root), /paused function|paused statement/)
    })
  }
})

test("a breakpoint set by .vibe line pauses there in the compiler's output", async (t) => {
  const root = project(t, { "entry.mjs": entry("./out/main.js") })
  await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
  await checkPlainBreakpoint(root)
})

test("a breakpoint set by .vibe line pauses there in an effect function", async (t) => {
  const root = project(t, { "entry.mjs": entry("./out/main.js") })
  await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
  const { original, target, value } = await breakAt(root, ["entry.mjs"], "out/main.js", "const picked = match", "value")
  assert.equal(original.line, target.line)
  assert.equal(value, 3)
})

test("a breakpoint set by .vibe line pauses there through vibelang/register", async (t) => {
  const root = project(t)
  const { original, target, value } = await breakAt(root, ["--import", "vibelang/register", join("src", "entry.mjs")], "src/main.vibe", "const picked = match", "value")
  assert.equal(original.line, target.line)
  assert.equal(value, 3)
})
