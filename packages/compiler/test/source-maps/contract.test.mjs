// The construct table of docs/maintainers/source-maps.md, as a test. A row
// names one token at each end by its context, with | at the token: the
// generated token must map to the source token, through both consumers, or to
// nothing when the row has no source side.
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping"
import { SourceMapConsumer } from "source-map"
import { compiler, position, project, succeed, tsconfig } from "./helpers.mjs"

const constructs = {
  "effect function": [`export effect function load(id: string) {
  const value = try succeed(id)
  return value
}
`, [
    ["export function |load(id)", "effect function |load(id: string)"],
    ["|const value = yield*", "|const value = try"],
    ["yield* |Effect", null, "skip"],
    ["return |value;", "return |value"],
    ["|function* load", null]
  ]],
  "try": [`export effect function run() {
  const first = try succeed(1)
  return try succeed(first + 1)
}
`, [
    ["|first + 1", "|first + 1"],
    ["const |first = yield*", "const |first = try"]
  ]],
  "do": [`export function run(flag: boolean) {
  const value = do { const inner = flag ? 1 : 2; inner + 1 }
  return value
}
`, [
    ["const |inner = flag", "const |inner = flag"],
    ["= |inner + 1", "; |inner + 1"]
  ]],
  "catch": [`export effect function run() {
  const value = fail("no") catch (reason) => reason + "handled"
  return value
}
`, [
    ["|reason + \"handled\"", "|reason + \"handled\""],
    ["fail(|\"no\")", "fail(|\"no\")"]
  ]],
  "for try": [`export effect function* numbers() {
  yield 1
}
export effect function walk() {
  let total = 0
  for try (const item of numbers()) {
    total = total + item
  }
  return total
}
`, [
    ["|total = total + item", "|total = total + item"],
    ["= total + |item", "= total + |item"]
  ]],
  "schema": [`export schema Point { x: number; label: string }
`, [
    ["export const |Point", "schema |Point"],
    ["|x: Schema", "|x: number"],
    ["|label: Schema", "|label: string"]
  ]],
  "service": [`export service Users {
  static readonly key = "app/Users"
  find(id: string): string!!
}
`, [
    ["export class |Users", "service |Users"],
    ["$service(|\"app/Users\")", "key = |\"app/Users\""]
  ]],
  "acquireRelease": [`export const held = Effect.acquireRelease(Effect.succeed(1), () => Effect.void)
`, [
    ["runtime.|acquireRelease(", "Effect.|acquireRelease("]
  ]],
  "error": [`export error Refused { reason: string }
`, [
    ["export class |Refused", "error |Refused"]
  ]],
  "data": [`export data Shape { Dot; Box { width: number } }
`, [
    ["export const |Shape", "data |Shape"]
  ]],
  "pipeline": [`export effect function run() {
  return try (succeed(1) |> map(%, (count) => count + 1))
}
`, [
    ["|count + 1", "|count + 1"],
    ["succeed)(|1", null, "skip"]
  ]],
  "match binding reads": [`export function settle(outcome: { _tag: "Answered"; text: string } | { _tag: "Failed"; reason: string }) {
  const settled = match (outcome) {
    when { _tag: "Answered", let text }: text;
    when { _tag: "Failed", let reason }: reason;
  }
  return settled
}
`, [
    ["const $match1 = |outcome;", "match (|outcome)"],
    ["let |text =", "let |text }"],
    ["let |reason =", "let |reason }"],
    ["get(|$match1, \"text\")", null],
    ["get(|$match1, \"reason\")", null],
    ["return |text;", "}: |text;"],
    ["return |reason;", "}: |reason;"]
  ]],
  "match": [`export function run(value: number): string {
  return match (value) { when 1: "one"; default: "other"; }
}
`, [
    ["|\"one\"", "|\"one\""],
    ["|\"other\"", "|\"other\""]
  ]]
}

const place = (text, spec, name) => {
  const offset = spec.indexOf("|")
  const needle = spec.slice(0, offset) + spec.slice(offset + 1)
  const at = text.indexOf(needle)
  assert.ok(at >= 0, `${name} has no ${needle}:\n${text}`)
  return position(text, at + offset)
}

test("each construct maps as the contract's table says", async (t) => {
  const files = {}
  const names = Object.keys(constructs)
  names.forEach((name, index) => { files[`src/c${index}.vibe`] = constructs[name][0] })
  const root = project(t, { "src/main.vibe": "export {}\n", "src/entry.mjs": "", ...files })
  await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
  const failures = []
  for (const [index, name] of names.entries()) {
    const [source, rows] = constructs[name]
    const file = join(root, `out/c${index}.js`)
    const code = readFileSync(file, "utf8")
    const map = JSON.parse(readFileSync(file + ".map", "utf8"))
    const trace = new TraceMap(map)
    const mozilla = await new SourceMapConsumer(map)
    for (const [generated, original, skip] of rows) {
      if (skip) continue
      try {
        const at = place(code, generated, "generated")
        const a = originalPositionFor(trace, at)
        const b = mozilla.originalPositionFor({ ...at, bias: SourceMapConsumer.GREATEST_LOWER_BOUND })
        assert.equal(a.line, b.line, `consumers differ on the line of ${generated}`)
        assert.equal(a.column, b.column, `consumers differ on the column of ${generated}`)
        const want = original === null ? { line: null, column: null } : place(source, original, "source")
        assert.deepEqual({ line: a.line, column: a.column }, want, `${generated} -> ${original}`)
      } catch (error) {
        failures.push(`${name}: ${error.message.split("\n").slice(0, 8).join(" ")}\n--- ${code.split("\n").slice(0, 14).join("\n")}`)
      }
    }
    mozilla.destroy()
  }
  assert.equal(failures.join("\n\n"), "")
})

const emitted = (root, name) => {
  const file = join(root, "out", name)
  return { code: readFileSync(file, "utf8"), map: JSON.parse(readFileSync(file + ".map", "utf8")) }
}

async function rows(map, code, source, table) {
  const trace = new TraceMap(map)
  for (const [generated, original] of table) {
    const found = originalPositionFor(trace, place(code, generated, "generated"))
    assert.deepEqual({ line: found.line, column: found.column }, place(source, original, "source"), `${generated} -> ${original}`)
  }
}

test(".vibex: JSX elements and names map to where they are written", async (t) => {
  const source = `export function Card(props: { title: string }) {
  const label = props.title
  return <section id="card">{label}</section>
}
`
  const config = JSON.parse(tsconfig)
  config.compilerOptions.jsx = "preserve"
  config.compilerOptions.lib.push("ES2022")
  const root = project(t, {
    "src/main.vibe": "export {}\n", "src/card.vibex": source, "tsconfig.json": JSON.stringify(config),
    "src/jsx.d.ts": "declare namespace JSX { interface IntrinsicElements { [name: string]: unknown } }\n"
  })
  await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
  const { code, map } = emitted(root, "card.jsx")
  assert.deepEqual(map.sourcesContent, [source])
  await rows(map, code, source, [
    ["return |<section", "return |<section"],
    ["{|label}", "{|label}"],
    ["const |label", "const |label"]
  ])
})

test("a module declaration's own file has a map that names the containing .vibe", async (t) => {
  const source = `import { port } from parse

module parse {
  export function port(raw: string): number {
    const parsed = Number(raw)
    return parsed
  }
}

export const answer = port("80")
`
  const root = project(t, { "src/main.vibe": source })
  await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
  const { code, map } = emitted(root, "main.vibe.parse.js")
  assert.ok(map.sources[0].endsWith("main.vibe"), map.sources[0])
  await rows(map, code, source, [
    ["const |parsed = Number", "const |parsed = Number"],
    ["return |parsed", "return |parsed"]
  ])
})

test("an empty module has a map with no segments", async (t) => {
  const root = project(t, { "src/main.vibe": "", "src/entry.mjs": "" })
  await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
  const { map } = emitted(root, "main.js")
  assert.equal(map.mappings.replaceAll(";", ""), "")
  assert.deepEqual(map.sourcesContent, [""])
})

test("a separator in a comment prints as a newline, and in a string it stays", async (t) => {
  const source = 'export const text = "a\u2028b"\n/* one\u2028two */\nexport const after = text\n'
  const root = project(t, { "src/main.vibe": source })
  await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
  const { code, map } = emitted(root, "main.js")
  assert.ok(code.includes('"a\u2028b"'), code)
  assert.ok(code.includes("/* one\ntwo */"), code)
  await rows(map, code, source, [["export const |after", "export const |after"], ["= |text;", "= |text\n"]])
})
