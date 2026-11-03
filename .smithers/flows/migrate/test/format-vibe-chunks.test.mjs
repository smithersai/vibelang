import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { formatVibe } from "../lib/steps.mjs"
const require = createRequire(new URL("../../../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-setup-format-argv.json", import.meta.url)))

function fixture({ style = "fallback", count = 3000, piece = "x".repeat(48), failures = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "migrate-format-chunks-"))
  const calls = join(root, "calls.jsonl"), log = join(root, "format.log")
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
  const prefix = style === "dprint" ? "packages/core/src/" : "src/"
  const files = Array.from({ length: count }, (_, i) => prefix + String(i).padStart(4, "0") + "-" + piece + ".vibe")
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), "export const a = 1\n")
  }
  if (style === "dprint") writeFileSync(join(root, "packages/core/dprint.json"), JSON.stringify({ plugins: ["npm:vibelang/dprint-plugin.json"] }))
  const stub = '#!/usr/bin/env node\nconst fs=require("node:fs"),p=require("node:path");const out=' + JSON.stringify(calls) + ';const old=fs.existsSync(out)?fs.readFileSync(out,"utf8").trim().split("\\n").length:0;fs.appendFileSync(out,JSON.stringify({tool:p.basename(process.argv[1]),cwd:process.cwd(),args:process.argv.slice(2)})+"\\n");process.exit((' + JSON.stringify(failures) + ')[old+1]||0)\n'
  for (const tool of ["dprint", "vibelang-format"]) writeFileSync(join(root, "node_modules/.bin", tool), stub, { mode: 0o755 })
  return { root, files, log, config: { target: root, packages: [{ dir: "packages/core" }] },
    calls: () => readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse),
    dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function assertVisits(f, calls) {
  const visited = calls.flatMap(call => call.args.slice(call.tool === "dprint" ? 3 : 1).map(file => resolve(call.cwd, file)))
  assert.deepEqual(visited, f.files.map(file => join(f.root, file)), "same files, order and spelling, once each")
  for (const call of calls) {
    assert.deepEqual(call.args.slice(0, call.tool === "dprint" ? 3 : 1), call.tool === "dprint" ? ["fmt", "--config", "dprint.json"] : ["--write"])
  }
  const receipts = readFileSync(f.log, "utf8").match(/^\$ .*$/gm)
  assert.equal(receipts.length, calls.length, "aggregate log retains every chunk")
  for (const command of receipts) assert.ok(Buffer.byteLength(command) < 66_000, "shell command stays below Linux's single-argument limit")
}

for (const style of ["fallback", "dprint"]) {
  test("Alchemy setup formats a large " + style + " file list without E2BIG", async () => {
    const f = fixture({ ...corpus, style })
    try {
      assert.ok(Buffer.byteLength(f.files.join(" ")) > 131072, "the witness exceeds Linux MAX_ARG_STRLEN")
      assert.deepEqual(await formatVibe(f.config, f.files, f.log), { files: f.files, code: 0 })
      const calls = f.calls()
      assert.ok(calls.length > 1)
      assertVisits(f, calls)
    } finally { f.dispose() }
  })
}

test("formatter chunks preserve first failure and still attempt every file", async () => {
  const f = fixture({ failures: { 1: 3, 2: 5 } })
  try {
    assert.deepEqual(await formatVibe(f.config, f.files, f.log), { files: f.files, code: 3 })
    assertVisits(f, f.calls())
    const log = readFileSync(f.log, "utf8")
    assert.match(log, /# exit 3/)
    assert.match(log, /# exit 5/)
  } finally { f.dispose() }
})

test("generated quoted UTF-8 paths reach both formatters unchanged across chunk boundaries", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom("fallback", "dprint"),
    fc.constantFrom(1, 127, 511, 900),
    fc.constantFrom("plain", "with space", "quo'te", "$HOME", "$(false)", "`false`", "é", "😀"),
    fc.integer({ min: 1, max: 16 }),
    async (style, count, text, copies) => {
      const f = fixture({ style, count, piece: text.repeat(copies) })
      try {
        const ignored = ["src/missing.vibe", "src/native.ts"]
        mkdirSync(join(f.root, "src"), { recursive: true })
        writeFileSync(join(f.root, "src/native.ts"), "export const untouched = 1\n")
        assert.deepEqual(await formatVibe(f.config, [...f.files, ...ignored], f.log), { files: f.files, code: 0 })
        assertVisits(f, f.calls())
      } finally { f.dispose() }
    }), { numRuns: 24, seed: 483466 })
})

test("an empty selection does not invoke a formatter or create a log", async () => {
  const f = fixture({ count: 0 })
  try {
    assert.deepEqual(await formatVibe(f.config, ["missing.vibe", "native.ts"], f.log), { files: [], code: 0 })
    assert.equal(existsSync(f.log), false)
    assert.equal(existsSync(join(f.root, "calls.jsonl")), false)
  }
  finally { f.dispose() }
})

test("mixed configurations retain every receipt and the first formatter failure", async () => {
  const f = fixture({ style: "dprint", count: 4, failures: { 1: 3, 2: 5 } })
  try {
    mkdirSync(join(f.root, "src"))
    const fallback = "src/fallback.vibe"
    writeFileSync(join(f.root, fallback), "export const value = 1\n")
    const files = [fallback, ...f.files]
    assert.deepEqual(await formatVibe(f.config, files, f.log), { files, code: 3 })
    const calls = f.calls()
    assert.deepEqual(calls.map(call => call.tool), ["dprint", "vibelang-format"])
    assert.deepEqual(calls[0].args.slice(3), f.files.map(file => file.slice("packages/core/".length)))
    assert.deepEqual(calls[1].args, ["--write", fallback])
    assert.equal((readFileSync(f.log, "utf8").match(/^\$ /gm) ?? []).length, 2)
    assert.match(readFileSync(f.log, "utf8"), /# exit 3/)
    assert.match(readFileSync(f.log, "utf8"), /# exit 5/)
  } finally { f.dispose() }
})
