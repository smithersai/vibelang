import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { compile, makeConfig, paths } from "../lib/steps.mjs"
import { styleProblems } from "../lib/diagnostics.mjs"
import { writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-native-global-error.json", import.meta.url), "utf8"))
const examples = JSON.parse(readFileSync(new URL("./corpus/foldkit-private-global-error.json", import.meta.url), "utf8"))
const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const native = { skip: !existsSync(compiler) && "build the native compiler" }
const advisory = source => {
  const offset = source.indexOf("new Error")
  const prefix = source.slice(0, offset).split("\n")
  return { file: "main.vibe", line: prefix.length, column: prefix.at(-1).length + 1, category: "warning", code: "EK4804", message: "This failure is a global Error, which has no _tag for a catch or a match to tell it apart by.", notes: [] }
}

test("foldkit-29: compile permits the written original global Error channel", native, async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-global-error-"))
  const target = join(root, "repo")
  const run = join(root, "run")
  try {
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(target, "node_modules/typescript"))
    writeJson(join(target, "package.json"), { type: "module" })
    writeJson(join(target, "tsconfig.json"), { include: ["main.vibe"] })
    writeFileSync(join(target, "main.vibe"), corpus.after)
    const d = advisory(corpus.after)
    writeFileSync(join(target, "node_modules/.bin/vibelang"), [
      "#!/usr/bin/env node",
      'const cp = require("node:child_process");',
      'if (process.argv.includes("--estree")) {',
      '  const r = cp.spawnSync(' + JSON.stringify(compiler) + ', process.argv.slice(2), { stdio: "inherit" }); process.exit(r.status ?? 1);',
      '}',
      'console.log(' + JSON.stringify("main.vibe(" + d.line + "," + d.column + "): warning EK4804: " + d.message) + ');'
    ].join("\n") + "\n", { mode: 0o755 })
    const p = paths(run)
    writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    writeJson(p.plan, { batches: [{ files: ["main.ts"] }] })
    writeJson(join(p.baseline, "compile-root.json"), [])
    mkdirSync(join(p.baseline, "dts/root"), { recursive: true })
    writeFileSync(join(p.baseline, "dts/root/main.d.ts"), corpus.before)
    const result = await compile({ run, batch: "01" })
    assert.equal(result.diagnostics.length, 1, "retain the advisory for review")
    assert.deepEqual(result.style, [])
    assert.equal(result.styleExemptions[0].exempt, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

async function decide(before, after, ds = [advisory(after)], beforeName = "main.d.ts") {
  const { parseStyleTree, preservedGlobalErrors } = await import("../lib/preserved-errors.mjs")
  const old = await parseStyleTree(compiler, beforeName, before)
  const current = await parseStyleTree(compiler, "main.vibe", after)
  return preservedGlobalErrors(old, current, after, ds)
}

test("global Error preservation follows function names, explicit channels and source positions", native, async () => {
  // Accepted foldkit ruling: "exempt the tag-advisory EK4804 ... when the written failure type is the global Error that the original declared".
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("Error", "TypeError", "never", "unknown"),
    fc.constantFrom("Error", "TypeError", "never", "unknown"),
    fc.constantFrom("const", "function", "class", "object"),
    fc.constantFrom("namespace", "import type"),
    fc.constantFrom("\n", "\r\n"),
    fc.integer({ min: 0, max: 6 }),
    async (oldError, newError, form, moduleStyle, newline, spaces) => {
      const pad = " ".repeat(spaces)
      const ret = (moduleStyle === "namespace" ? "Fx.Effect" : 'import("effect/Effect").Effect') + "<number, " + oldError + ">"
      const forms = {
        const: ['export declare const fail: () => ' + ret + ';', 'export const fail = effect (): number!' + newError + ' =>', ''],
        function: ['export declare function fail(): ' + ret + ';', 'export effect function fail(): number!' + newError, ''],
        class: ['export declare class API { fail(): ' + ret + '; }', 'export class API { effect fail(): number!' + newError, ' }'],
        object: ['export declare const api: { fail: () => ' + ret + '; };', 'export const api = { fail: effect (): number!' + newError + ' =>', ' }']
      }
      const [declaration, header, close] = forms[form]
      const before = 'import * as Fx from "effect/Effect";\n' + declaration
      const after = [header + ' {', pad + 'throw new Error("invalid origin")', '}' + close].join(newline)
      const d = advisory(after)
      const result = await decide(before, after, [d])
      assert.equal(result.accepted.has(d), oldError === "Error" && newError === "Error")
    }), { seed: 290029, numRuns: 100 })
})

test("unwritten, shadowed, unrelated and nested error contracts stay rejected", native, async () => {
  for (const [before, after] of [
    [corpus.before.replace(", Error", ", never"), corpus.after],
    [corpus.before.replace("fail:", "other:"), corpus.after],
    [corpus.before, corpus.after.replace(": number!Error", "")],
    ['import { Error } from "./custom";\n' + corpus.before, corpus.after],
    [corpus.before, "class Error {}\n" + corpus.after],
    [corpus.before, 'export const fail = effect (): number!Error => { const nested = effect () => { throw new Error("nested") }; return 1 }'],
    [corpus.before, '// number!Error\nexport const fail = effect () => { throw new Error("missing") }']
  ]) assert.equal((await decide(before, after)).accepted.size, 0, after)
})

test("preserving Error never exempts TypeScript-style forms or a configured error", native, async () => {
  const d = advisory(corpus.after)
  const other = { ...d, code: "EK4809", message: "Use native throw." }
  const result = await decide(corpus.before, corpus.after, [d, other])
  assert.deepEqual(styleProblems([d, other], ["main.vibe"], result.accepted), [other])
  assert.equal((await decide(corpus.before, corpus.after, [{ ...d, category: "error" }])).accepted.size, 0)
})

test("declaration matching keeps module paths and refuses ambiguous project outputs", async () => {
  const { declarationFor } = await import("../lib/preserved-errors.mjs")
  const root = mkdtempSync(join(tmpdir(), "migrate-error-paths-"))
  try {
    const put = file => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), "export {};\n") }
    put("other/main.d.ts")
    assert.equal(declarationFor(root, "src/main.vibe"), null)
    put("main.d.ts")
    assert.equal(declarationFor(root, "src/main.vibe"), "main.d.ts")
    put("project/src/main.d.ts")
    assert.equal(declarationFor(root, "src/main.vibe"), "project/src/main.d.ts")
    put("second/src/main.d.ts")
    assert.equal(declarationFor(root, "src/main.vibe"), null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("emitted import types and named class or object members preserve global Error", native, async () => {
  for (const [before, after] of [
    ['export declare const fail: () => import("effect/Effect").Effect<number, Error>;', corpus.after],
    ['export declare const fail: () => import("effect").Effect.Effect<number, Error>;', corpus.after],
    ['import * as Effect from "effect/Effect"; export declare class API { fail(): Effect.Effect<number, Error>; }', 'export class API { effect fail(): number!Error { throw new Error("x") } }'],
    ['import * as Effect from "effect/Effect"; export declare const api: { fail: () => Effect.Effect<number, Error>; };', 'export const api = { fail: effect (): number!Error => { throw new Error("x") } }'],
    ['import * as Effect from "effect/Effect"; export declare const api: { fail(): Effect.Effect<number, Error>; };', 'export const api = { effect fail(): number!Error { throw new Error("x") } }']
  ]) assert.equal((await decide(before, after)).accepted.size, 1, before)
})

test("a nested function cannot borrow an unrelated top-level Error contract", native, async () => {
  const before = 'import * as Effect from "effect/Effect"; export declare function fail(): Effect.Effect<number, Error>; export declare function outer(): void;'
  const after = 'export effect function fail(): number!Error { return 1 } export function outer(): void { effect function fail(): number!Error { throw new Error("nested") } }'
  assert.equal((await decide(before, after)).accepted.size, 0)
})

// drive-foldkit-examples 23:15Z and drive-foldkit-node 23:15Z: the producer of a
// preserved Error is often private, an inline catch callback, or one member of
// a union channel; none of those appears in the published declaration.
const at = (line, column) => ({ file: "main.vibe", line, column, category: "warning", code: "EK4804", message: "This failure is a global Error, which has no _tag for a catch or a match to tell it apart by.", notes: [] })
// The compiler reports the advisory at the catch callback, as the drive's result.json shows (line 5, column 12 with its comment line).
const catchAt = text => { const lines = text.split(/\r?\n/); const line = lines.findIndex(l => l.includes("catch: ")) + 1; return at(line, lines[line - 1].indexOf("catch: ") + "catch: ".length + 1) }

test("foldkit-29 (examples): the original source proves a private producer's Error channel that its declaration omits", native, async () => {
  const d = catchAt(examples.after)
  const fromSource = await decide(examples.before, examples.after, [d], "main.ts")
  assert.equal(fromSource.accepted.has(d), true, JSON.stringify(fromSource.decisions))
  assert.equal(fromSource.decisions[0].function, "load")
  const fromDeclaration = await decide(examples.declaration, examples.after, [d])
  assert.equal(fromDeclaration.accepted.size, 0, "the published declaration cannot see a private producer")
})

test("foldkit-29 (examples): an inline catch callback resolves to its producer's written contract", native, async () => {
  const d = catchAt(examples.inlineAfter)
  const result = await decide(examples.inlineBefore, examples.inlineAfter, [d], "main.ts")
  assert.equal(result.accepted.has(d), true, JSON.stringify(result.decisions))
  assert.equal(result.decisions[0].function, "load")
  // A producer that never declared Error, or declares something else now, keeps the advisory.
  assert.equal((await decide(examples.inlineBefore.replace(", Error>", ", TypeError>"), examples.inlineAfter, [d], "main.ts")).accepted.size, 0)
  assert.equal((await decide(examples.inlineBefore, examples.inlineAfter.replace("number!Error", "number!TypeError"), [d], "main.ts")).accepted.size, 0)
  const unwritten = examples.inlineAfter.replace("catch: (cause): Error =>", "catch: (cause) =>")
  assert.equal((await decide(examples.inlineBefore, unwritten, [catchAt(unwritten)], "main.ts")).accepted.size, 0, "an unannotated callback writes no contract")
})

test("foldkit-29 (node): a union channel that includes Error is preserved only as written", native, async () => {
  const before = (channel) => 'import { Effect } from "effect"\nexport class HttpError { readonly _tag = "HttpError" }\nexport const serve = (): Effect.Effect<number, ' + channel + '> => Effect.fail(new Error("x"))\n'
  // A parenthesised single name before => reads as a function type, as in TypeScript; only a union needs the parentheses.
  const channelOf = channel => channel.includes("|") ? "(" + channel + ")" : channel
  const after = (channel) => 'export class HttpError { readonly _tag = "HttpError" }\nexport const serve = effect (): number!' + channelOf(channel) + ' => { throw new Error("x") }\n'
  for (const [original, written, expected] of [
    ["Error | HttpError", "Error | HttpError", true],
    ["HttpError | Error", "Error | HttpError", true],
    ["Error | HttpError", "HttpError | Error", true],
    ["Error | HttpError", "Error", false],
    ["Error", "Error | HttpError", false],
    ["TypeError | HttpError", "TypeError | HttpError", false],
    ["Error | HttpError", "Error | TypeError", false]
  ]) {
    const source = after(written)
    const result = await decide(before(original), source, [advisory(source)], "main.ts")
    assert.equal(result.accepted.size, expected ? 1 : 0, original + " -> " + written + ": " + JSON.stringify(result.decisions))
  }
})

test("exemptions follow the written producer contract across exported, private, inline and union shapes", native, async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("Error", "Error | HttpError", "TypeError", "HttpError"),
    fc.constantFrom("Error", "Error | HttpError", "TypeError", "HttpError"),
    fc.boolean(), fc.constantFrom("named", "inline"), fc.constantFrom("\n", "\r\n"),
    async (oldChannel, newChannel, exported, catcher, newline) => {
      const head = exported ? "export const" : "const"
      const before = ['import { Effect } from "effect"', 'export class HttpError { readonly _tag = "HttpError" }', 'const toError = (cause: unknown): Error => cause instanceof Error ? cause : new Error(String(cause))',
        head + ' load = (fail: boolean): Effect.Effect<number, ' + oldChannel + '> => Effect.try({ try: (): number => 7, catch: ' + (catcher === "named" ? "toError" : "(cause): Error => toError(cause)") + ' })',
        'export const work = (fail: boolean): Effect.Effect<number> => Effect.catch(load(fail), () => Effect.succeed(0))'].join(newline)
      const after = ['export class HttpError { readonly _tag = "HttpError" }', 'const toError = (cause: unknown): Error => cause instanceof Error ? cause : new Error(String(cause))',
        head + ' load = effect (fail: boolean): number!' + (newChannel.includes("|") ? "(" + newChannel + ")" : newChannel) + ' => {', '  return try Effect.try({ try: (): number => 7, catch: ' + (catcher === "named" ? "toError" : "(cause): Error => toError(cause)") + ' })', '}',
        'export const work = effect (fail: boolean): number!! => { return load(fail) catch () => 0 }'].join(newline)
      const d = catchAt(after)
      const result = await decide(before, after, [d], "main.ts")
      const same = oldChannel.split(" | ").sort().join(" | ") === newChannel.split(" | ").sort().join(" | ")
      assert.equal(result.accepted.has(d), same && newChannel.split(" | ").includes("Error"), JSON.stringify({ oldChannel, newChannel, exported, catcher, decisions: result.decisions }))
    }), { seed: 290030, numRuns: 80 })
})

test("compile reads the codemod journal's original source before falling back to the retained declaration", native, async () => {
  for (const journaled of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), "migrate-global-error-source-"))
    const target = join(root, "repo"), run = join(root, "run")
    try {
      mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
      symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(target, "node_modules/typescript"))
      writeJson(join(target, "package.json"), { type: "module" })
      writeJson(join(target, "tsconfig.json"), { include: ["main.vibe"] })
      writeFileSync(join(target, "main.vibe"), examples.after)
      const d = catchAt(examples.after)
      writeFileSync(join(target, "node_modules/.bin/vibelang"), [
        "#!/usr/bin/env node",
        'const cp = require("node:child_process");',
        'if (process.argv.includes("--estree")) {',
        '  const r = cp.spawnSync(' + JSON.stringify(compiler) + ', process.argv.slice(2), { stdio: "inherit" }); process.exit(r.status ?? 1);',
        '}',
        'console.log(' + JSON.stringify("main.vibe(" + d.line + "," + d.column + "): warning EK4804: " + d.message) + ');'
      ].join("\n") + "\n", { mode: 0o755 })
      const p = paths(run)
      writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
      writeJson(p.plan, { batches: [{ files: ["main.ts"] }] })
      writeJson(join(p.baseline, "compile-root.json"), [])
      mkdirSync(join(p.baseline, "dts/root"), { recursive: true })
      writeFileSync(join(p.baseline, "dts/root/main.d.ts"), examples.declaration)
      if (journaled) writeJson(p.codemodState("01"), { version: 1, phase: "fixing", files: ["main.ts"], renames: [{ from: "main.ts", to: "main.vibe" }], originals: [{ from: "main.ts", to: "main.vibe", bytes: Buffer.from(examples.before).toString("base64"), mode: 0o644 }], writes: [], attempts: [] })
      const result = await compile({ run, batch: "01" })
      assert.equal(result.diagnostics.length, 1)
      assert.equal(result.styleExemptions[0].exempt, journaled, JSON.stringify(result.styleExemptions))
      assert.equal(result.styleExemptions[0].oracle, journaled ? "source" : "declaration")
      assert.deepEqual(result.style.map(d => d.code), journaled ? [] : ["EK4804"])
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})
