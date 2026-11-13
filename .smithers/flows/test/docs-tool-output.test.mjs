import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const ts = createRequire(new URL("../../../docs/tools/package.json", import.meta.url))("typescript")

async function docsCommand(root) {
  const { declaredFileCommands } = await import("../../../scripts/declared-command.mjs")
  const commands = await declaredFileCommands("docs-tools", root)
  assert.equal(commands.length, 1)
  return commands[0]
}

test("documentation failure details survive a noisy passing suite", async t => {
  const root = mkdtempSync(join(tmpdir(), "docs-output-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  symlinkSync(join(repo, ".smithers/node_modules"), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "WORKSPACE.ts"), readFileSync(join(repo, ".smithers/WORKSPACE.ts"), "utf8")
    .replaceAll("//.smithers/package.json", "//package.json"))
  for (const file of ["package.json", "bun.lock"])
    writeFileSync(join(root, file), readFileSync(join(repo, ".smithers", file)))
  mkdirSync(join(root, "docs/tools"), { recursive: true })
  const marker = "documentation-failure-detail-must-remain-visible"
  writeFileSync(join(root, "docs/tools/output.test.ts"), [
    'import { test } from "bun:test"',
    'for (let i = 0; i < 6000; i++) test("before " + i + " " + "x".repeat(180), () => {})',
    'test("middle failure", () => { throw new Error(' + JSON.stringify(marker) + ') })',
    'for (let i = 0; i < 6000; i++) test("after " + i + " " + "x".repeat(180), () => {})',
    "",
  ].join("\n"))
  writeFileSync(join(root, "PACKAGE.ts"), [
    'import { Smithers as S } from "@smthrs/targets"',
    'export const Package = S.Package({ targets: { "docs-tools": S.Shell.Test({',
    'shell: ' + JSON.stringify(await docsCommand(root)) + ', sandbox: "none", timeout: "1m",',
    'tools: [S.Host.bin("bun")], data: [S.glob("docs/tools/*.test.ts")],',
    '}) } })',
    "",
  ].join("\n"))
  const result = spawnSync(process.execPath, [
    join(repo, ".smithers/node_modules/.bin/smthrs"), "ci", "//:docs-tools",
    "--workspace", root, "--ui", "plain", "--verbose", "--jobs", "1", "--results-file", join(root, "results.json"),
  ], { encoding: "utf8", timeout: 90_000, maxBuffer: 16 * 1024 * 1024 })
  assert.ifError(result.error)
  assert.notEqual(result.status, 0, "the deliberately failing suite must stay red")
  const output = result.stdout + result.stderr
  assert.ok(output.includes("12000 pass"), "every passing control must execute")
  assert.ok(output.includes(marker), "the actual failure detail was hidden by passing-test output:\n" + output.slice(-3000))
})
