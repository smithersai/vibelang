import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/" + (process.platform === "win32" ? "vibelang.exe" : "vibelang"), import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-intermediate-refusal.json", import.meta.url), "utf8"))
function check(input) {
 const root = mkdtempSync(join(tmpdir(), "fix-audit-"))
 try {
  const source = input.prefix + corpus.source.replace("42", String(input.value))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(fileURLToPath(new URL("../../runtime/node_modules/effect", import.meta.url)), join(root, "node_modules/effect"), "dir")
  writeFileSync(join(root, "main.vibe"), source)
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", types: [], noEmit: true }, files: ["main.vibe"] }))
  const audit = join(root, "audit")
  const result = spawnSync(native, ["-p", ".", "--fix", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_FIX_AUDIT_DIR: audit }, timeout: 90000 })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.match(result.stdout, /refused site:/)
  const fixed = readFileSync(join(root, "main.vibe"), "utf8")
  assert.notEqual(fixed, source, "an earlier producer repair must create a new source state")
  const runs = readdirSync(audit)
  assert.equal(runs.length, 1)
  const run = join(audit, runs[0])
  const entries = readFileSync(join(run, "refusals.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
  const receipt = entries.find(entry => entry.code === corpus.code)
  assert.ok(receipt)
  const snapshot = readFileSync(join(run, receipt.source))
  assert.equal(receipt.source, createHash("sha256").update(snapshot).digest("hex") + ".source")
  assert.notEqual(snapshot.toString(), source, "the receipt must retain the intermediate state")
  assert.equal(snapshot.subarray(receipt.start, receipt.end).toString(), "try {\n    yield n\n  } finally {\n  }")
  const preceding = snapshot.subarray(0, receipt.start).toString()
  assert.equal(receipt.line, preceding.split("\n").length)
  assert.equal(receipt.column, preceding.slice(preceding.lastIndexOf("\n") + 1).length + 1)
  assert.ok(receipt.phase)
  assert.equal(typeof receipt.round, "number")
  assert.doesNotMatch(result.stdout + result.stderr, /export function\* plain/)
 } finally { rmSync(root, { recursive: true, force: true }) }
}
test(corpus.key + ": a native refusal has a recoverable source and exact byte span", () => check({ prefix: "", value: 42 }))
test("refusal audits preserve Unicode, newline and return-value neighbourhoods", () => {
 fc.assert(fc.property(fc.record({ prefix: fc.constantFrom("", "// λ\n", "// 😀\r\n", "\n\n"), value: fc.integer({ min: -10, max: 1000 }) }), check), { seed: 260, numRuns: 12 })
})
