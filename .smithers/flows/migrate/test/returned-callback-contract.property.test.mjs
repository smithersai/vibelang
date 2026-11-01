import assert from "node:assert/strict"
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { parseStyleTree, preservedGlobalErrors } from "../lib/preserved-errors.mjs"
import { parseDiagnostics, styleProblems } from "../lib/diagnostics.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-websocket-returned-callback.json", import.meta.url)))
const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const native = { skip: !existsSync(compiler) && "build the native compiler" }
async function decision(before, after, marker = corpus.marker) {
  const at = after.indexOf(marker)
  assert.ok(at >= 0, marker)
  const lines = after.slice(0, at).split("\n")
  const diagnostic = { file: "main.vibe", line: lines.length, column: lines.at(-1).length + 1,
    code: "EK4804", category: "warning", message: "This failure is a global Error, which has no _tag for a catch or a match to tell it apart by." }
  const result = preservedGlobalErrors(await parseStyleTree(compiler, "main.ts", before),
    await parseStyleTree(compiler, "main.vibe", after), after, [diagnostic])
  return { ...result, diagnostic }
}

test("foldkit-117: a returned callback declares the private acquire's preserved Error channel", native, async () => {
  const result = await decision(corpus.before, corpus.after)
  assert.equal(result.accepted.size, 1, JSON.stringify(result.decisions))
  assert.deepEqual(styleProblems([result.diagnostic], ["main.vibe"], result.accepted), [])
  assert.match(result.decisions[0].reason, /returned callback/)
})

test("returned callback contracts support direct block returns and Effect import aliases", native, async () => {
  const before = corpus.before.replace("() => Effect.callback", "() => { return Effect.callback")
    .replace(" }) } })", " }); } } })")
  for (const source of [before,
    before.replace("import { Effect }", "import { Effect as Fx }").replaceAll("Effect.", "Fx."),
    before.replace("import { Effect } from 'effect'", "import * as Fx from 'effect/Effect'").replaceAll("Effect.", "Fx.")]) {
    const result = await decision(source, corpus.after)
    assert.equal(result.accepted.size, 1, JSON.stringify(result.decisions))
  }
})

test("returned callback contracts never borrow nested, nonreturned, ambiguous or changed channels", native, async () => {
  const call = "Effect.callback<number, Error>(resume => { resume(Effect.fail(new Error('Failed to connect to WebSocket'))) })"
  for (const [before, after] of [
    [corpus.before.replace("<number, Error>", "<number, TypeError>"), corpus.after],
    [corpus.before.replace("<number, Error>", "<number>"), corpus.after],
    [corpus.before.replace("Effect.callback", "Other.callback"), corpus.after],
    [corpus.before.replace("() => " + call, "() => { const ignored = " + call + "; return Effect.succeed(1) }"), corpus.after],
    [corpus.before.replace("() => " + call, "() => () => " + call), corpus.after],
    [corpus.before, corpus.after.replace("acquire:", "different:")],
    [corpus.before, corpus.after.replace("number!Error", "number!TypeError")],
    [corpus.before, corpus.after.replace("effect (): number!Error", "effect ()")],
    [corpus.before, "class Error {}\n" + corpus.after],
    [corpus.before.replace("export const", "const Effect = other;\nexport const"), corpus.after],
    [corpus.before, corpus.after.replace(corpus.marker, "const nested = effect (): number!Error => { " + corpus.marker + "; }; return try nested()")],
    [corpus.before, corpus.after.replace("chatSocket: {", "chatSocket: { acquire: effect (): number!Error => { throw new Error('other') },")],
    [corpus.before.replace("chatSocket: {", "chatSocket: { acquire: () => " + call + ","), corpus.after]
  ]) {
    const result = await decision(before, after)
    assert.equal(result.accepted.size, 0, JSON.stringify({ before, after, decisions: result.decisions }))
  }
})

test("callback return proofs refuse Promise and iterator wrappers", native, async () => {
  const wrapped = JSON.parse(readFileSync(new URL("./corpus/foldkit-websocket-wrapped-callback.json", import.meta.url)))
  for (const c of wrapped.cases) {
    const result = await decision(c.before, c.after)
    assert.equal(result.accepted.size, 0, JSON.stringify({ kind: c.kind, decisions: result.decisions }))
  }
})

test("generated return wrappers keep the callback channel inside the returned Effect", native, async () => {
  // The accepted ruling concerns a function returning Effect.callback<A, E>;
  // an async function returns a Promise, and a generator returns an iterator.
  await fc.assert(fc.asyncProperty(fc.constantFrom("plain", "async", "generator", "async-generator"),
    fc.constantFrom("Error", "Error | TypeError"), fc.constantFrom("acquire", "connect", "open"),
    async (kind, channel, name) => {
      const call = "Effect.callback<number, " + channel + ">(resume => { resume(Effect.fail(new Error('Failed to connect to WebSocket'))) })"
      const producer = kind === "plain" ? "() => " + call : kind === "async" ? "async () => " + call
        : (kind === "generator" ? "function*" : "async function*") + " () { return " + call + " }"
      const oldCall = "Effect.callback<number, Error>(resume => { resume(Effect.fail(new Error('Failed to connect to WebSocket'))) })"
      const before = corpus.before.replace("() => " + oldCall, producer).replace("acquire:", name + ":")
      const after = corpus.after.replace("number!Error", "number!" + channel).replace("acquire:", name + ":")
      const result = await decision(before, after)
      assert.equal(result.accepted.size, kind === "plain" ? 1 : 0, JSON.stringify({ kind, channel, name, decisions: result.decisions }))
    }), { seed: 11717065, numRuns: 100 })
})

test("generated callback channels, owner names and requirements preserve only the original written failure", native, async () => {
  // foldkit agent 22:20Z ruling: "a function returning Effect.callback<T, E> declares channel E";
  // 18:45Z global-Error ruling still requires the same written channel, count and owner.
  await fc.assert(fc.asyncProperty(fc.constantFrom("Error", "TypeError", "Error | TypeError", "never"),
    fc.constantFrom("Error", "TypeError", "Error | TypeError", "never"), fc.boolean(),
    fc.constantFrom("acquire", "open", "connect"), fc.boolean(), async (oldChannel, newChannel, scope, name, nested) => {
      const before = corpus.before.replace("<number, Error>", "<number, " + oldChannel + ">").replace("acquire:", name + ":")
      let after = corpus.after.replace("number!Error", "number!" + newChannel + (scope ? "!Scope" : "")).replace("acquire:", name + ":")
      if (nested) after = after.replace(corpus.marker, "const child = effect (): number!Error => { " + corpus.marker + "; }; return try child()")
      const result = await decision(before, after)
      assert.equal(result.accepted.size, !nested && oldChannel === newChannel && oldChannel.split(" | ").includes("Error") ? 1 : 0,
        JSON.stringify({ oldChannel, newChannel, scope, name, nested, decisions: result.decisions }))
    }), { seed: 11717064, numRuns: 120 })
})

test("real compiler advisories from the websocket acquisition replacement use the retained callback contract", native, async () => {
  const root = mkdtempSync(join(tmpdir(), "foldkit-returned-callback-"))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(dirname(require.resolve("effect/package.json")), join(root, "node_modules/effect"))
    symlinkSync(fileURLToPath(new URL("../../../../packages/runtime", import.meta.url)), join(root, "node_modules/vibelang-runtime"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    let diagnostics
    for (const [file, text] of [["main.ts", corpus.before], ["main.vibe", corpus.after]]) {
      writeFileSync(join(root, file), text)
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", target: "ES2022", strict: true, skipLibCheck: true, types: [] }, files: [file] }))
      const result = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
      assert.equal(result.status, 0, file + ": " + result.stdout + result.stderr)
      if (file.endsWith(".vibe")) diagnostics = parseDiagnostics(result.stdout + result.stderr)
    }
    const warnings = diagnostics.filter(d => d.code === "EK4804")
    assert.ok(warnings.length > 0)
    const result = preservedGlobalErrors(await parseStyleTree(compiler, "main.ts", corpus.before),
      await parseStyleTree(compiler, "main.vibe", corpus.after), corpus.after, warnings)
    assert.equal(result.accepted.size, warnings.length, JSON.stringify(result.decisions))
    assert.deepEqual(styleProblems(diagnostics, ["main.vibe"], result.accepted), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
