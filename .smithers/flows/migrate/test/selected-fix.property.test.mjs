import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-bounded-fixer.json", import.meta.url), "utf8"))
const rule = "\x60--only <files>\x60 limits ordinary \x60--fix\x60 to the listed modules"

async function verify({ selected, unselected, alias = false, end = "ok" }) {
  const directory = mkdtempSync(join(tmpdir(), "migrate-selected-fix-"))
  const root = join(directory, "repo")
  mkdirSync(root)
  const caller = alias ? join(directory, "alias") : root
  if (alias) symlinkSync(root, caller, "dir")
  try {
    const files = [...selected, ...unselected]
    const source = "export const value = 1\n"
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), source)
    }
    const compiler = join(root, "compiler.cjs")
    const receipt = join(root, "calls.jsonl")
    writeFileSync(compiler, `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
const root = ${JSON.stringify(root)}, files = ${JSON.stringify(files)}
if (process.argv.includes("--listFilesOnly")) {
 for (const file of files) console.log(path.join(root, file))
 process.exit(0)
}
const args = process.argv.slice(2), lists = [], chosen = []
for (let i=0; i<args.length; i++) if (args[i] === "--only") {
 const value = args[++i]
 if (value.startsWith("@")) { lists.push(value.slice(1)); chosen.push(...fs.readFileSync(value.slice(1),"utf8").trim().split(/\\r?\\n/)) }
 else chosen.push(...value.split(","))
}
const visited = chosen.length ? chosen.map(file => fs.realpathSync(path.resolve(file))) : files.map(file => path.join(root,file))
fs.appendFileSync(${JSON.stringify(receipt)}, JSON.stringify({ visited, lists })+"\\n")
let total = 0
for (const file of visited) {
 const text = fs.readFileSync(file,"utf8")
 if (text.includes("// fixed")) continue
 fs.writeFileSync(file,text+"// fixed\\n")
 console.log("vibelang --fix: "+path.relative(process.cwd(),file)+": 1 fix (EK4832 ×1)")
 total++
}
if (${JSON.stringify(end)} === "killed") process.kill(process.pid,"SIGKILL")
console.log("vibelang --fix: "+total+" fixes in "+total+" files.")
`)
    chmodSync(compiler, 0o755)
    let result, error
    try {
      result = await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: join(caller, "packages"), root: caller, only: selected, maxRounds: 3, log: join(root, "fix") })
    } catch (caught) { error = caught }
    const calls = existsSync(receipt) ? readFileSync(receipt, "utf8").trim().split("\n").map(JSON.parse) : []
    assert.equal(calls.length, selected.length === 0 ? 0 : end === "killed" ? 1 : 2)
    for (const call of calls) {
      assert.deepEqual(call.visited.slice().sort(), selected.map(file => resolve(root, file)).sort(), "only selected roots may reach the writable fixer")
      for (const file of call.lists) assert.equal(existsSync(file), false, "selection manifests are cleaned up after success and interruption")
    }
    if (selected.length) {
      const selection = readFileSync(join(root, "fix.scope.log"), "utf8").split("\n")
        .filter(line => line.startsWith("# fix scope ")).map(line => JSON.parse(line.slice("# fix scope ".length)))
        .find(record => record.stage === "selected")
      assert.deepEqual(selection?.selected, selected)
    }
    for (const file of unselected) assert.equal(readFileSync(join(root, file), "utf8"), source)
    if (end === "killed" && selected.length) assert.ok(error)
    else {
      assert.ifError(error)
      assert.equal(result.settled, true)
      assert.deepEqual(Object.keys(result.byFile).sort(), selected.slice().sort())
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

test("selected migration fixes quote the ordinary file-selection contract", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(rule))
})

test("Alchemy bounded fixer: selected roots bypass unrelated package repairs", async () => {
  await verify(corpus)
})

test("forty selected roots do not visit a thousand unrelated native modules", async () => {
  await verify({
    selected: Array.from({ length: 40 }, (_, i) => `packages/a/selected${i}.vibe`),
    unselected: Array.from({ length: 1000 }, (_, i) => `packages/b/retained${i}.vibe`)
  })
})

test("an empty migration batch starts no writable compiler", async () => {
  await verify({ selected: [], unselected: ["packages/a/retained.vibe"] })
})

test("selection lists preserve commas and spaces, physical identity and interrupted cleanup", async () => {
  await verify({ selected: ["packages/a/with,comma.vibe", "packages/a/has space.vibex"], unselected: ["packages/b/retained.vibe"], alias: true, end: "killed" })
})

test("property: selected work is independent of the unrelated project size and path spelling", async () => {
  await fc.assert(fc.asyncProperty(
    fc.record({ count: fc.integer({ min: 1, max: 5 }), other: fc.integer({ min: 1, max: 12 }), alias: fc.boolean(), punctuation: fc.constantFrom("plain", "with space", "with,comma", "雪") }),
    async ({ count, other, alias, punctuation }) => verify({
      selected: Array.from({ length: count }, (_, i) => `packages/a/${punctuation}${i}.${i % 2 ? "vibex" : "vibe"}`),
      unselected: Array.from({ length: other }, (_, i) => `packages/b/retained${i}.vibe`), alias
    })
  ), { seed: 350323, numRuns: 40 })
})
