import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const source = readFileSync(new URL("../packages/PACKAGE.ts", import.meta.url), "utf8")
const runtime = source.slice(source.indexOf("const runtimeTest ="))
const command = JSON.parse(/\bshell:\s*("(?:[^"\\]|\\.)*")/.exec(runtime)[1])

for (const before of [-1, 0, 130, 199, 200, 201, 260]) {
  test(before < 0 ? "runtime reporting preserves an entirely passing suite" : "runtime failures stay visible in the graph preview after " + before + " passing tests", () => {
    const root = mkdtempSync(join(tmpdir(), "vibelang-runtime-output-"))
    try {
      const tests = join(root, "packages/runtime/tests")
      mkdirSync(tests, { recursive: true })
      const lines = ['import { test, expect } from "bun:test"']
      for (let i = 0; i <= 260; i++) {
        if (i === before) lines.push('test("retains failure evidence", () => { throw new Error("runtime-regression-evidence") })')
        if (i < 260) lines.push('test("passing ' + i + '", () => expect(true).toBe(true))')
      }
      writeFileSync(join(tests, "suite.test.ts"), lines.join("\n") + "\n")
      const result = spawnSync("sh", ["-c", command], { cwd: root, encoding: "utf8", timeout: 30000 })
      assert.ifError(result.error)
      assert.equal(result.status, before < 0 ? 0 : 1, result.stdout + result.stderr)
      const output = result.stdout + result.stderr
      assert.match(output, /260 pass/, "every passing test must still execute")
      assert.match(output, before < 0 ? /0 fail/ : /1 fail/, "the complete suite must retain its result")
      const preview = output.split("\n").slice(0, 200).join("\n")
      if (before >= 0) assert.match(preview, /runtime-regression-evidence/, "the bounded graph preview must include the original failure")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
