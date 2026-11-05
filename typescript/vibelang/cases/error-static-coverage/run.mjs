// run-seconds: 180
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { Session } from "node:inspector/promises"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import fc from "fast-check"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
// Native subclasses retain TypeScript static members; DSL error declarations reject them.
const kinds = ["error", "schema error", "class"]
const bodies = [
  "",
  "static { events.push(1) }",
  "static sampleValue = 1",
  "static sampleValue: number | undefined",
  "declare static sampleValue: number",
  "static sampleMethod() { return 3 }",
  "declare static typed: number\nstatic { events.push(1) }\nstatic sampleValue = 2",
  "static { events.push(1) }\nstatic { events.push(2) }",
  "static firstValue = 1\nstatic secondValue = 2",
  "static sampleMethod() { return 3 }\nstatic { events.push(1) }",
  "static sampleValue = 1\nstatic { events.push(1) }",
]
const session = new Session()
session.connect()
await session.post("Profiler.enable")
let sequence = 0

// Decode ECMA-426 segments independently of the compiler's source-map writer.
function lookupFor(mapping) {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const state = [0, 0, 0, 0, 0]
  const lines = mapping.split(";").map((line) => {
    state[0] = 0
    return (line ? line.split(",") : []).map((field) => {
      const values = []
      for (let i = 0, value = 0, shift = 0; i < field.length; i++) {
        const digit = digits.indexOf(field[i])
        assert.ok(digit >= 0)
        value += (digit & 31) << shift
        if (digit & 32) shift += 5
        else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1)
          value = shift = 0
        }
      }
      for (let i = 0; i < values.length; i++) state[i] += values[i]
      return values.length === 1 ? [state[0]] : state.slice(0, 4)
    })
  })
  return (line, column) => {
    const segments = lines[line] || []
    const found = segments.findLast((segment) => segment[0] <= column)
    return found?.length > 1 ? [found[2], found[3]] : undefined
  }
}

function coverageRows(script, file, wanted) {
  const text = fs.readFileSync(file, "utf8")
  const sourceMap = JSON.parse(fs.readFileSync(file + ".map", "utf8"))
  assert.equal(sourceMap.sources.length, 1)
  const lookup = lookupFor(sourceMap.mappings)
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1)
  const position = (offset) => {
    let line = 0
    while (line + 1 < starts.length && starts[line + 1] <= offset) line++
    return [line, offset - starts[line]]
  }
  return script.functions
    .filter((fn) => fn.functionName === wanted)
    .map((fn) => lookup(...position(fn.ranges[0].startOffset)))
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

async function check(kind, bodyIndex, indent = 2, crlf = false) {
  const project = path.join(dir, "out", "profiles", String(sequence++))
  fs.mkdirSync(project, { recursive: true })
  const newline = crlf ? "\r\n" : "\n"
  const body = bodies[bodyIndex].split("\n").map((line) => " ".repeat(indent) + line).join(newline)
  const source = (form) => [
    "export const events: number[] = []",
    form === "class" ? "export class Base extends Error {}" : "export " + form + " Base {}",
    "export class Sample extends Base {",
    body,
    "}",
    "",
  ].join(newline)
  fs.writeFileSync(path.join(project, "main.vibe"), source(kind))
  fs.writeFileSync(path.join(project, "native.ts"), source("class"))
  fs.writeFileSync(path.join(project, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, types: [], skipLibCheck: true, sourceMap: true, outDir: "out" },
    files: ["main.vibe", "native.ts"],
  }))
  const built = spawnSync(compiler, ["-p", project, "--pretty", "false"], { encoding: "utf8", timeout: 30000 })
  assert.equal(built.status, 0, String(built.stdout) + String(built.stderr))
  const vibeFile = path.join(project, "out/main.js")
  const nativeFile = path.join(project, "out/native.js")
  await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true })
  const vibe = await import(pathToFileURL(vibeFile))
  const native = await import(pathToFileURL(nativeFile))
  if (typeof native.Sample.sampleMethod === "function") {
    assert.equal(vibe.Sample.sampleMethod(), native.Sample.sampleMethod())
  }
  const { result } = await session.post("Profiler.takePreciseCoverage")
  await session.post("Profiler.stopPreciseCoverage")
  assert.deepEqual(vibe.events, native.events)
  const script = (file) => {
    const found = result.find((entry) => entry.url === pathToFileURL(file).href)
    assert.ok(found, file)
    return found
  }
  for (const name of ["<static_initializer>", "sampleMethod"]) {
    assert.deepEqual(
      coverageRows(script(vibeFile), vibeFile, name),
      coverageRows(script(nativeFile), nativeFile, name),
      JSON.stringify({ kind, body: bodies[bodyIndex], indent, crlf, name }),
    )
  }
}

try {
  for (const kind of kinds) for (let body = 0; body < bodies.length; body++) await check(kind, body)
  await fc.assert(fc.asyncProperty(
    fc.constantFrom(...kinds),
    fc.integer({ min: 0, max: bodies.length - 1 }),
    fc.integer({ min: 0, max: 4 }),
    fc.boolean(),
    check,
  ), { numRuns: 32 })
  console.log("coverage preserves written static initialization")
} finally {
  session.disconnect()
}
