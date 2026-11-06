import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { runtimeEdges } from "../lib/emitted-imports.mjs"
const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-native-import-diagnostic.json", import.meta.url)))

function fixture(reply, action) {
  const root = mkdtempSync(join(tmpdir(), "native-import-diagnostic-")), compiler = join(root, "compiler.cjs")
  try {
    writeFileSync(compiler, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(1,' + JSON.stringify(reply.stdout ?? "") + ');require("node:fs").writeFileSync(2,' + JSON.stringify(reply.stderr ?? "") + ');' +
      (reply.signal ? 'process.kill(process.pid,"SIGTERM")' : 'process.exit(' + (reply.code ?? 1) + ')'), { mode: 0o755 })
    return action(() => runtimeEdges(corpus.source, corpus.file, undefined, compiler, root))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Smithers native import scans retain JSON parser failures on a nonzero exit", () => {
  fixture({ stdout: JSON.stringify({ error: { message: corpus.message } }), code: 1 }, scan => {
    assert.throws(scan, error => error.message.includes(corpus.file) && error.message.includes(corpus.message) && error.message.includes("exit 1"))
  })
})

test("failed and malformed native replies never authorize partial import edges or dump a tree", () => {
  const ast = { type: "Program", body: [], privateBody: "AST_BODY_SENTINEL" }
  for (const reply of [
    { code: 2, stdout: JSON.stringify({ ast }) },
    { code: 0, stdout: JSON.stringify({ ast, error: { message: "invalid syntax" } }) },
    { code: 0, stdout: "not JSON" }, { code: 0, stdout: "{}" }, { code: 0, stdout: '{"ast":null}' },
    { code: 0, stdout: '{"ast":{}}' }, { code: 0, stdout: '{"ast":{"type":"Program"}}' },
    { code: 0, stdout: '{"ast":[]}' }, { code: 0, stdout: '{"ast":1}' },
    { signal: true }, { code: 7, stdout: "" },
  ]) fixture(reply, scan => {
    assert.throws(scan, error => error.message.includes(corpus.file) && error.message.includes("exit ") && !error.message.includes("AST_BODY_SENTINEL"))
  })
})

test("plain compiler diagnostics and launch signals retain their cause", () => {
  fixture({ code: 2, stdout: "error TS5023: Unknown compiler option '--estree'.\n" }, scan => assert.throws(scan, /TS5023/))
  fixture({ code: 3, stderr: "native parser failed\n" }, scan => assert.throws(scan, /native parser failed/))
  fixture({ signal: true }, scan => assert.throws(scan, /signal SIGTERM/))
})

test("successful native syntax trees still return the source import spans", () => {
  const start = corpus.source.indexOf('"'), end = corpus.source.lastIndexOf('"') + 1
  const ast = { type: "Program", body: [{ type: "ImportDeclaration", source: { type: "Literal", value: "./native.vibe", range: [start, end] } }] }
  fixture({ code: 0, stdout: JSON.stringify({ ast }) }, scan => assert.deepEqual(scan(), [{ specifier: "./native.vibe", start: start + 1, end: end - 1 }]))
})

test("property: exit status cannot suppress a native parser diagnostic or admit its partial tree", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 9 }), fc.oneof(fc.constant(corpus.message), fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz ._:()"), { minLength: 1, maxLength: 96 }).map(parts => parts.join(""))), fc.boolean(), (code, message, structured) => {
    fixture({ code, stdout: JSON.stringify({ error: structured ? { message } : message, ast: { type: "Program", body: [] } }) }, scan => assert.throws(scan, error =>
      error.message.includes(message) && error.message.includes("exit " + code) && error.message.includes(corpus.file)))
  }), { seed: 801347, numRuns: 80 })
})

test("native compiler command failures preserve the actual diagnostic", { skip: !process.env.VIBELANG_BINARY }, () => {
  const root = mkdtempSync(join(tmpdir(), "native-import-command-")), compiler = join(root, "compiler.sh")
  try {
    const binary = resolve(process.env.VIBELANG_BINARY)
    writeFileSync(join(root, "wiki.vibe"), corpus.source)
    writeFileSync(compiler, '#!/usr/bin/env node\nconst r=require("node:child_process").spawnSync(' + JSON.stringify(binary) + ',["--singleThreaded",...process.argv.slice(2)],{input:require("node:fs").readFileSync(0),stdio:["pipe",1,2]});process.exit(r.status ?? 1)\n', { mode: 0o755 })
    assert.throws(() => runtimeEdges(corpus.source, "wiki.vibe", undefined, compiler, root), error =>
      error.message.includes("cannot read native imports (exit 1): error TS5023: Unknown compiler option '--estree'"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
