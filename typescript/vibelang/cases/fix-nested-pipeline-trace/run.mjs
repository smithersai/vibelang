// rule-evidence: docs/design/src/007-tooling.md#fix-ownership-and-preservation
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import * as Effect from "effect/Effect"
const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const root = mkdtempSync(join(tmpdir(), "nested-pipeline-trace-"))
try {
  symlinkSync(fileURLToPath(new URL("./node_modules", import.meta.url)), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(root, "rewrite.vibe"), readFileSync(new URL("./input.txt", import.meta.url)))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out" },
    files: ["rewrite.vibe"]
  }))
  const fixed = spawnSync(binary, ["--fix", "-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], {
    cwd: root, encoding: "utf8", timeout: 120000,
    env: { ...process.env, VIBELANG_FIX_EDIT_TRACE: "1" }
  })
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
  const records = fixed.stderr.split("\n").filter(line => line.startsWith("[fix-edit-plan]")).join("\n")
  assert.match(records, /\[fix-edit-plan\] compose .*nested=[1-9]/)
  assert.doesNotMatch(records, /Effect\.flatMap|yield\*|return value;/)
  const source = readFileSync(join(root, "rewrite.vibe"), "utf8")
  assert.ok(!source.includes(".pipe("), "nested repair survives its outer capture")
  assert.match(source, /\breturn value(?:;|\s*\n)/, "the following return survives")
  const actual = await import(pathToFileURL(join(root, "out/rewrite.js")).href)
  assert.equal(Effect.runSync(actual.run()), 2)
  console.log("nested pipeline repaired")
} finally {
  rmSync(root, { recursive: true, force: true })
}
