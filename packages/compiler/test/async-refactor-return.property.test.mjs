import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Connection } from "../../../typescript/vibelang/lsp-connection.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const runtime = join(repo, "packages/runtime")
const require = createRequire(join(runtime, "package.json"))
const fc = require("fast-check")
const { Effect } = require("effect")
const ts = require(join(modules, "typescript"))
const skip = [compiler, join(runtime, "dist/index.js")].some(p => !existsSync(p)) && "build compiler and runtime first"
const rule = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
const tick = String.fromCharCode(96)
const source = [
  "export const trace: string[] = []",
  "export const __asyncValue = 101",
  "export async function echo(input: number) { return input }",
  "export const arrow = async (input: number) => input",
  "export async function awaited(input: Promise<number>) { return await input }",
  "export async function generic<T extends number>(input: T) { return input }",
  "export class Loader { static async load(input: number) { return input } }",
  "export const object = { async read(input: number) { return input } }",
  "export async function strict(input: number) { 'use strict'; return input }",
  "export async function globalValue() { return __asyncValue }",
  "export async function template(input: number) { const text = " + tick + "line\n  exact" + tick + "; trace.push(text); return input }",
  "export async function closing(input: number, items: Iterable<number>) { for (const item of items) { return input }; return 0 }",
  "export const receiver = { value: 3, async receive(input: number) { trace.push(\"this:\" + this.value); return input } }",
  "class Parent { get offset(): number { trace.push(\"super\"); return 0 } }; export class Child extends Parent { async loadInherited(input: number) { return super.offset === 0 ? input : 0 } }",
  "export const awaitedArrow = async (input: Promise<number>) => await input",
  ""
].join("\n")

function position(text, index) {
  const prefix = text.slice(0, index)
  return { line: prefix.split("\n").length - 1, character: index - prefix.lastIndexOf("\n") - 1 }
}
function offset(text, point) {
  const lines = text.split("\n")
  return lines.slice(0, point.line).reduce((n, line) => n + line.length + 1, 0) + point.character
}
function apply(text, edits) {
  const spans = edits.map(e => ({ start: offset(text, e.range.start), end: offset(text, e.range.end), text: e.newText }))
  // LSP places an insertion before a replacement sharing its start.
  spans.sort((a, b) => a.start - b.start || a.end - b.end)
  let result = "", last = 0
  for (const span of spans) {
    assert.ok(span.start >= last, "overlapping refactor edits")
    result += text.slice(last, span.start) + span.text
    last = span.end
  }
  return result + text.slice(last)
}
function inputOf({ kind, value, delta }, trace) {
  if (kind === "primitive") return value
  const boxed = Object.assign(value, {})
  let reads = 0
  if (kind !== "boxed") Object.defineProperty(boxed, "then", { get() {
    trace.push("get:" + ++reads)
    if (kind === "getter-throws") throw new Error("getter")
    if (kind === "two-reads" && reads === 1) return undefined
    return (resolve, reject) => {
      trace.push("call")
      if (kind === "reject") reject("rejected")
      else resolve(value + delta)
    }
  } })
  return boxed
}
function iterable(trace) {
  return { [Symbol.iterator]() {
    let read = false
    return {
      next() { if (read) return { done: true }; read = true; return { done: false, value: 1 } },
      return() { trace.push("close"); return { done: true } }
    }
  } }
}
function normalized(exit, input, trace) {
  if (exit._tag === "Success") return {
    tag: "Success", type: typeof exit.value, value: Number(exit.value),
    sameInput: Object.is(exit.value, input), trace: [...trace]
  }
  return {
    tag: exit._tag, trace: [...trace],
    cause: JSON.stringify(exit.cause, (_, value) => value instanceof Error
      ? { name: value.name, message: value.message, cause: value.cause } : value)
  }
}

test("async refactoring adopts completed primitive-typed returns and closes iterators first", { skip, timeout: 120000 }, async t => {
  assert.ok(readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8").includes(rule))
  const root = realpathSync(mkdtempSync(join(tmpdir(), "async-refactor-adoption-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(modules, "effect")), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, declaration: true, types: [], outDir: "out" },
    files: ["candidate.vibe"]
  }))
  writeFileSync(join(root, "candidate.vibe"), source)
  const client = new Connection(compiler, ["--lsp", "--stdio"], root)
  t.after(() => client.close())
  const uri = pathToFileURL(join(root, "candidate.vibe")).href
  await client.request("initialize", {
    processId: process.pid, rootUri: pathToFileURL(root).href,
    capabilities: { general: { positionEncodings: ["utf-16"] }, workspace: { configuration: true, workspaceEdit: { documentChanges: true } } }
  })
  client.notify("initialized", {})
  client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibe", version: 1, text: source } })
  let changed = source, version = 1
  for (const needle of [
    "async function echo", "async (input", "async function awaited", "async function generic",
    "async load", "async read", "async function strict", "async function globalValue",
    "async function template", "async function closing", "async receive", "async loadInherited", "async (input: Promise<number>)"
  ]) {
    const at = changed.indexOf(needle)
    assert.ok(at >= 0, needle)
    const point = position(changed, at)
    const actions = await client.request("textDocument/codeAction", {
      textDocument: { uri }, range: { start: point, end: point },
      context: { diagnostics: [], only: ["refactor"] }
    })
    const action = actions?.find(a => a.title === "Convert to a VibeLang function")
    assert.ok(action, "missing required refactor at " + needle)
    changed = apply(changed, action.edit?.changes?.[uri] ?? [])
    writeFileSync(join(root, "candidate.vibe"), changed)
    client.notify("textDocument/didChange", { textDocument: { uri, version: ++version }, contentChanges: [{ text: changed }] })
  }
  const compiled = spawnSync(compiler, ["-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 60000 })
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
  const control = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  writeFileSync(join(root, "out/control.js"), control)
  const original = await import(pathToFileURL(join(root, "out/control.js")))
  const converted = await import(pathToFileURL(join(root, "out/candidate.js")))
  const cases = [
    ["echo", (m, input) => m.echo(input)],
    ["arrow", (m, input) => m.arrow(input)],
    ["awaited", (m, input) => m.awaited(input), true],
    ["awaited arrow", (m, input) => m.awaitedArrow(input), true],
    ["generic", (m, input) => m.generic(input)],
    ["static", (m, input) => m.Loader.load(input)],
    ["object", (m, input) => m.object.read(input)],
    ["strict", (m, input) => m.strict(input)],
    ["global", (m) => m.globalValue()],
    ["template", (m, input) => m.template(input)],
    ["closing", (m, input) => m.closing(input, iterable(m.trace))],
    ["receiver", (m, input) => m.receiver.receive(input)],
    ["super", (m, input) => new m.Child().loadInherited(input)]
  ]
  await fc.assert(fc.asyncProperty(fc.record({
    kind: fc.constantFrom("primitive", "boxed", "resolve", "reject", "getter-throws", "two-reads"),
    value: fc.integer({ min: -10000, max: 10000 }), delta: fc.integer({ min: -50, max: 50 })
  }), async value => {
    for (const [name, call, awaiting] of cases) {
      original.trace.length = 0
      converted.trace.length = 0
      const a = inputOf(value, original.trace)
      const first = awaiting ? Promise.resolve(a) : a
      const expected = await Effect.runPromise(Effect.exit(Effect.tryPromise(() => call(original, first))))
      // Build the second input only after the reference finishes. Attaching a
      // discarded catch creates another Promise adoption of a boxed value.
      const b = inputOf(value, converted.trace)
      const second = awaiting ? Promise.resolve(b) : b
      const actual = await Effect.runPromise(Effect.exit(call(converted, second)))
      assert.deepEqual(normalized(actual, b, converted.trace), normalized(expected, a, original.trace),
        name + ": " + JSON.stringify(value))
    }
  }), {
    seed: 381901, numRuns: 60,
    examples: ["primitive", "boxed", "resolve", "reject", "getter-throws", "two-reads"]
      .map(kind => [{ kind, value: 1, delta: 6 }])
  })
})

test("isolated async return refactoring discovers its implicit Effect module", { skip, timeout: 60000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "async-refactor-isolated-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(modules, "effect")), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], outDir: "out" },
    files: ["isolated.vibe"]
  }))
  // No imported or implicit Effect module occurs in the original program.
  const text = "export async function load(input: number) { return input }\n"
  writeFileSync(join(root, "isolated.vibe"), text)
  const client = new Connection(compiler, ["--lsp", "--stdio"], root)
  t.after(() => client.close())
  const uri = pathToFileURL(join(root, "isolated.vibe")).href
  await client.request("initialize", {
    processId: process.pid, rootUri: pathToFileURL(root).href,
    capabilities: { general: { positionEncodings: ["utf-16"] }, workspace: { configuration: true } }
  })
  client.notify("initialized", {})
  client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibe", version: 1, text } })
  const point = position(text, text.indexOf("async"))
  const actions = await client.request("textDocument/codeAction", {
    textDocument: { uri }, range: { start: point, end: point },
    context: { diagnostics: [], only: ["refactor"] }
  })
  const action = actions?.find(a => a.title === "Convert to a VibeLang function")
  assert.ok(action, "isolated async conversion must not depend on another prelude use")
  writeFileSync(join(root, "isolated.vibe"), apply(text, action.edit?.changes?.[uri] ?? []))
  const compiled = spawnSync(compiler, ["-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
  const converted = await import(pathToFileURL(join(root, "out/isolated.js")))
  const value = () => Object.assign(1, { then(resolve) { resolve(7) } })
  const expected = await Effect.runPromise(Effect.exit(Effect.tryPromise(() => Promise.resolve(value()))))
  const actual = await Effect.runPromise(Effect.exit(converted.load(value())))
  assert.deepEqual(actual, expected)
})
