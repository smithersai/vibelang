// Runs the compiled program under V8's precise coverage and prints, for each
// function in out/main.js whose start maps to a source position, that
// position and how often V8 counted it. A start maps as coverage tools
// (ast-v8-to-istanbul, v8-to-istanbul) read it: the segment at or before it,
// or the one after it when that segment maps to no source.
import { readFileSync } from "node:fs"
import { Session } from "node:inspector/promises"

const session = new Session()
session.connect()
await session.post("Profiler.enable")
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true })
const { Effect } = await import("effect")
const m = await import("./out/main.js")
const run = (effect) => Effect.runPromise(effect)

await run(m.direct(1))
await run(m.handler(1)(2))
await run(m.load(1))
await run(m.orZero(1))
await run(m.timed(1))
await run(m.pair(1))
await run(Effect.provide(m.nameOf("42"), m.UsersLive))
m.label(0)
await run(m.guarded(1))
await run(m.block(1))
await run(m.traced(1))
await run(m.double(2))

const { result } = await session.post("Profiler.takePreciseCoverage")
const script = result.find((entry) => entry.url.endsWith("/out/main.js"))
const code = readFileSync(new URL("./out/main.js", import.meta.url), "utf8")
const map = JSON.parse(readFileSync(new URL("./out/main.js.map", import.meta.url), "utf8"))

// Source map segments per output line: [column, source?, line?, column?].
const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const lines = []
let state = [0, 0, 0, 0]
for (const text of map.mappings.split(";")) {
  const segments = []
  state[0] = 0
  for (const field of text ? text.split(",") : []) {
    const values = []
    for (let i = 0, value = 0, shift = 0; i < field.length; i++) {
      const digit = digits.indexOf(field[i])
      value += (digit & 31) << shift
      if (digit & 32) shift += 5
      else { values.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0 }
    }
    for (let i = 0; i < values.length; i++) state[i] += values[i]
    segments.push(values.length === 1 ? [state[0]] : state.slice(0, 4))
  }
  lines.push(segments)
}
const lookup = (line, column) => {
  const segments = lines[line] ?? []
  let found = segments.findLast((segment) => segment[0] <= column)
  if (!found || found.length === 1) found = segments.find((segment) => segment[0] >= column)
  return found && found.length > 1 ? `main.vibe:${found[2] + 1}:${found[3] + 1}` : undefined
}
const starts = [0]
for (let i = 0; i < code.length; i++) if (code[i] === "\n") starts.push(i + 1)
const position = (offset) => {
  let line = 0
  while (line + 1 < starts.length && starts[line + 1] <= offset) line++
  return [line, offset - starts[line]]
}

const rows = []
for (const fn of script.functions) {
  const [range] = fn.ranges
  if (range.startOffset === 0 && range.endOffset >= code.length) continue // the module itself
  const source = lookup(...position(range.startOffset))
  if (source) rows.push({ source, text: `${source} ${fn.functionName || "(anonymous)"} ${range.count === 0 ? "uncovered" : "covered"}` })
}
const order = (row) => row.source.split(":").slice(1).map(Number)
rows.sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1])
for (const row of rows) console.log(row.text)
