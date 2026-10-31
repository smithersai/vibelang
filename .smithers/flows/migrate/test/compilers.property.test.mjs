import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { addCompilerScripts, replaceTsc, typeScriptCompilers } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
// README, setup: what setup changes in the scripts.
const quote = "It does the same in every owned package that reaches a migrated one through workspace dependencies"

// A script of commands joined by shell separators; each command is a
// compiler with flags or another word, which may only look like one.
const lookalikes = ["tsc-alias", "tscx", "./tsc", "my-tsrs", "tsgo2", "vitest", "pnpm", "bun", "node"]
const command = fc.record({
  word: fc.oneof(fc.constantFrom(...typeScriptCompilers), fc.constantFrom(...lookalikes)),
  flags: fc.constantFrom("", " -b", " -b -w", " -p tsconfig.build.json", " --noEmit", " -b --clean")
})
const script = fc.array(fc.tuple(command, fc.constantFrom(" && ", "; ", " || ", " & ")), { minLength: 1, maxLength: 5 })

function render(parts) {
  return parts.map(([c, sep], i) => c.word + c.flags + (i < parts.length - 1 ? sep : "")).join("")
}

test("alchemy-32: setup makes every TypeScript compiler command in a script vibelang, and nothing else", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote), "update the quoted setup contract")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-root-tsrs.json", import.meta.url), "utf8"))
  assert.deepEqual(replaceTsc(corpus.scripts), corpus.expected)
  fc.assert(fc.property(script, (parts) => {
    const out = replaceTsc({ s: render(parts) }).s
    const want = render(parts.map(([c, sep]) => [{ ...c, word: typeScriptCompilers.includes(c.word) ? "vibelang" : c.word }, sep]))
    assert.equal(out, want)
  }), { numRuns: 200 })
})

test("a package whose scripts run a compiler compiles with vibelang and depends on it; any other is left alone", () => {
  const compiler = "file:../.vibelang-toolchain/vibelang-0.0.11.tgz"
  assert.deepEqual(addCompilerScripts({ name: "cloudflare", scripts: { build: "tsrs -b", test: "vitest" }, devDependencies: { typescript: "7.1.0" } }, compiler), {
    name: "cloudflare", scripts: { build: "vibelang -b", test: "vitest" }, devDependencies: { typescript: "7.1.0", vibelang: compiler }
  })
  const docs = { name: "docs", scripts: { build: "vite build" } }
  assert.deepEqual(addCompilerScripts(docs, compiler), docs)
  assert.deepEqual(addCompilerScripts({ name: "empty" }, compiler), { name: "empty" })
})
