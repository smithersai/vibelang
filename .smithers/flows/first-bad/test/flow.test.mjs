import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const flowDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const smithersDir = path.resolve(flowDir, "../..")
const repoRoot = path.resolve(smithersDir, "..")
const native = process.env.VIBELANG_BINARY || path.join(repoRoot, "packages/compiler/native/vibelang")
const hasCompiler = existsSync(native)
const hasBun = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0
const hasJj = spawnSync("jj", ["--version"], { encoding: "utf8" }).status === 0

test("first-bad uses flow.vibe rather than flow.ts", () => {
  assert.ok(existsSync(path.join(flowDir, "flow.vibe")), "flow.vibe must exist")
  assert.ok(!existsSync(path.join(flowDir, "flow.ts")), "flow.ts must be replaced by flow.vibe")
})

test("first-bad/flow.vibe type-checks cleanly with vibelang", { skip: !hasCompiler && `missing ${native}` }, () => {
  const result = spawnSync(native, ["-p", path.join(flowDir, "tsconfig.json")], {
    cwd: repoRoot,
    encoding: "utf8"
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout + result.stderr, /\b(?:error|warning) (?:EK|TS)\d+/)
})

test("first-bad/flow.vibe executes end-to-end and identifies the culprit commit", {
  skip: (!hasCompiler && `missing ${native}`) || (!hasBun && "bun not available") || (!hasJj && "jj not available")
}, (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "first-bad-vibe-flow-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = path.join(root, "repo")
  const runDir = path.join(root, "run")
  mkdirSync(path.join(repo, "scripts"), { recursive: true })

  const jj = (...args) => {
    const res = spawnSync("jj", ["--no-pager", ...args], { cwd: repo, encoding: "utf8" })
    assert.equal(res.status, 0, res.stderr)
    return res.stdout.trim()
  }

  jj("git", "init")
  jj("config", "set", "--repo", "user.name", "Test")
  jj("config", "set", "--repo", "user.email", "test@example.invalid")

  const ciScript = `#!/bin/sh
set -eu
status=ran
if [ "$(cat state.txt)" = "broken" ]; then
  echo "//:demo: --- FAIL: TestBroken"
  status=failed
fi
printf '{"results":[{"label":"//:demo","status":"%s"}]}\\n' "$status" > "$CI_RESULTS"
[ "$status" = "ran" ]
`
  writeFileSync(path.join(repo, "scripts/ci.sh"), ciScript, { mode: 0o755 })
  writeFileSync(path.join(repo, "state.txt"), "good\n")
  jj("commit", "-m", "good base")
  const good = jj("log", "--no-graph", "-r", "@-", "-T", "commit_id")

  writeFileSync(path.join(repo, "note.txt"), "still good\n")
  jj("commit", "-m", "still good")

  writeFileSync(path.join(repo, "state.txt"), "broken\n")
  jj("commit", "-m", "break demo")
  const culprit = jj("log", "--no-graph", "-r", "@-", "-T", "commit_id")

  writeFileSync(path.join(repo, "note.txt"), "after break\n")
  jj("commit", "-m", "after break")
  const bad = jj("log", "--no-graph", "-r", "@-", "-T", "commit_id")

  const script = `
    import { Exit } from "effect"
    import firstBad, { layer } from "./flows/first-bad/flow.vibe"
    import { execute } from "./flows/in-process.ts"
    const exit = await execute(firstBad, layer, ${JSON.stringify({
      run: runDir,
      repo,
      good,
      bad,
      targets: "//:demo",
      tries: 2,
      jobs: 1
    })})
    if (Exit.isFailure(exit)) {
      console.error(String(exit.cause))
      process.exit(1)
    }
    console.log(JSON.stringify(exit.value))
  `
  const execResult = spawnSync("bun", ["--preload", "vibelang/bun", "-e", script], {
    cwd: smithersDir,
    encoding: "utf8",
    env: { ...process.env, VIBELANG_BINARY: native }
  })
  assert.equal(execResult.status, 0, execResult.stdout + execResult.stderr)
  const outcome = JSON.parse(execResult.stdout.trim().split("\n").at(-1))
  assert.equal(outcome.step, "report")
  assert.equal(outcome.ok, true)
  const report = JSON.parse(readFileSync(path.join(runDir, "report.json"), "utf8"))
  assert.equal(report.targets["//:demo"].state, "broken")
  assert.equal(report.targets["//:demo"].firstBad, culprit)
  assert.ok(existsSync(path.join(runDir, "report.md")), "report.md written")
  assert.ok(!existsSync(path.join(runDir, "ws")), "workspace cleaned up after report")
})
