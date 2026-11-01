import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { wireOxlint } from "../lib/oxlint.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-oxlint-package-data.json", import.meta.url), "utf8"))
function run(source, helper) {
  const root = mkdtempSync(join(tmpdir(), "foldkit115-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { build: "node build-templates.mjs" } }))
    writeFileSync(join(root, "build-templates.mjs"), source)
    if (helper) writeFileSync(join(root, "helper.mjs"), helper)
    const writes = {}
    const result = wireOxlint({ root, all: ["package.json", "build-templates.mjs", ...(helper ? ["helper.mjs"] : [])], manifests: ["package.json"], ts, write: (file, text) => { writes[file] = text } })
    return { writes, result }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("foldkit-115: release dependency data is never an Oxlint command", () => {
  const { writes, result } = run(corpus.source)
  assert.equal(writes["build-templates.mjs"], undefined)
  assert.deepEqual(result.packages, [])
})
test("property: command positions redirect while package data and imported helpers stay byte-identical", () => {
  // README contract: only executable command positions are rewritten.
  fc.assert(fc.property(fc.constantFrom("spawnSync('oxlint', [])", "exec('oxlint --fix src')", "execa('oxlint', [])", "Bun.spawn(['oxlint', 'src'])", "$\x60bunx oxlint src\x60", "const command = 'oxlint'; spawn(command, [])"), fc.string({ maxLength: 40 }), (invocation, label) => {
    const data = "export const deps = ['oxlint', 'vitest', " + JSON.stringify(label) + "]\nexport const metadata = { name: 'oxlint', command: 'oxlint src' }\n"
    const helper = data + "export const unrelated = () => ['oxlint']\n"
    const source = "import { deps } from './helper.mjs'\n" + data + invocation + "\n"
    const { writes } = run(source, helper)
    assert.ok(writes["build-templates.mjs"]?.includes(data), JSON.stringify(writes))
    assert.ok(writes["build-templates.mjs"]?.includes("./.vibelang/oxlint.mjs"))
    assert.equal(writes["helper.mjs"] ?? helper, helper)
  }), { seed: 1151101, numRuns: 120 })
})

test("command arguments, shadowed bindings and logging strings remain data", () => {
  for (const source of [
    "exec('echo oxlint')",
    "spawnSync('node', ['oxlint'])",
    "console.log('oxlint src')",
    "const command = 'oxlint'; function build(command) { spawn(command, []) }",
    "let command = 'oxlint'; command = 'node'; spawn(command, [])",
    "const command = 'oxlint'; function build() { const command = 'node'; spawn(command, []) }"
  ]) {
    const { writes, result } = run(source)
    assert.equal(writes["build-templates.mjs"], undefined, source)
    assert.deepEqual(result.packages, [], source)
  }
})
