// The flows run on the durable host: `smthrs flow start` discovers each one
// under .smithers/flows/, composes its exported `layer`, and records the run
// in the project's `.flows/`, where `smthrs runs list` reads it back. Each test
// runs the real CLI in a temporary project holding a copy of these flows, so
// the repository's own `.flows/` stays untouched.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { hostGap } from "./durable-host-gap.mjs"

const smithers = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const cli = path.join(smithers, "node_modules/@smthrs/cli/package.json")

function project(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "durable-host-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(path.join(root, "package.json"), "{}\n")
  // Smithers reads a flow only inside its project, so the flows are copied;
  // the installs are linked.
  cpSync(path.join(smithers, "flows"), path.join(root, ".smithers/flows"), { recursive: true })
  cpSync(path.join(smithers, "package.json"), path.join(root, ".smithers/package.json"))
  symlinkSync(path.join(smithers, "node_modules"), path.join(root, ".smithers/node_modules"))
  mkdirSync(path.join(root, ".flows"))
  return root
}

function smthrs(root, ...args) {
  const { bin } = JSON.parse(readFileSync(cli, "utf8"))
  const entry = path.join(path.dirname(cli), typeof bin === "string" ? bin : bin.smthrs)
  const result = spawnSync(process.execPath, [entry, ...args, "--root", root, "--format", "json"], {
    cwd: root, encoding: "utf8", timeout: 240_000
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json: () => JSON.parse(result.stdout) }
}

// A run needs the native helper that @smthrs/platform-node ships. Where the
// host cannot load it, no flow can start, so the run tests skip with the
// loader's reason. Every other failure still fails them.
function probe() {
  const root = project({ after: (cleanup) => process.on("exit", cleanup) })
  const started = smthrs(root, "flow", "start", "ci-health", "--data",
    JSON.stringify({ run: path.join(root, "run"), results: path.join(root, ".smithers/flows/ci-health/fixture") }))
  return hostGap(started.stdout + started.stderr) ?? false
}
const skip = probe()

test("smthrs discovers every flow", (t) => {
  const listed = smthrs(project(t), "flow", "list")
  assert.equal(listed.status, 0, listed.stderr)
  assert.deepEqual(listed.json().items.map((flow) => flow.flowId).sort(),
    ["ci-health", "docs", "effect-bump", "first-bad", "migrate", "ts-bump"])
})

test("a ci-health run on the durable host writes its report and is listed", { skip }, (t) => {
  const root = project(t)
  const run = path.join(root, "run")
  const results = path.join(root, ".smithers/flows/ci-health/fixture")
  const started = smthrs(root, "flow", "start", "ci-health", "--data", JSON.stringify({ run, results }))
  assert.equal(started.status, 0, started.stdout + started.stderr)
  assert.ok(existsSync(path.join(run, "report.md")), "report.md")
  const runs = smthrs(root, "runs", "list")
  assert.equal(runs.status, 0, runs.stderr)
  assert.deepEqual(runs.json().items.map(({ flowId, status }) => ({ flowId, status })), [{ flowId: "ci-health", status: "completed" }])
})
