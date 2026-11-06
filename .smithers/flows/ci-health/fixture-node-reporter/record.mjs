// Regenerate these logs with the actual reporter. Each command and source is
// identical; the controlled external state alternates failure and success.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = fileURLToPath(new URL("./", import.meta.url))
const reporter = fileURLToPath(new URL("../../../../scripts/testing/node-failures.mjs", import.meta.url))
const key = createHash("sha256").update(readFileSync(new URL("case.mjs", import.meta.url))).update(readFileSync(reporter)).digest("hex")
for (let i = 1; i <= 4; i++) {
  const failing = i % 2 === 1
  const env = { ...process.env, CI_HEALTH_WITNESS_STATE: failing ? "fail" : "pass", NODE_OPTIONS: "", FORCE_COLOR: "0" }
  delete env.NODE_TEST_CONTEXT
  const started = performance.now()
  const child = spawnSync(process.execPath, ["--test", "--test-reporter=" + reporter, "case.mjs"], { cwd: here, env, encoding: "utf8", timeout: 10000 })
  assert.ifError(child.error)
  assert.equal(child.status, failing ? 1 : 0, child.stdout + child.stderr)
  const id = "run-0" + i + "-graph"
  const output = (child.stdout + child.stderr).replaceAll(pathToFileURL(here).href, "file:///<fixture>/").replaceAll(here, "<fixture>/")
  writeFileSync(new URL(id + ".log", import.meta.url), output.split("\n").map(line => "//packages:compiler-test-2: " + line).join("\n"))
  writeFileSync(new URL(id + ".json", import.meta.url), JSON.stringify({ results: [{
    label: "//packages:compiler-test-2", status: failing ? "failed" : "ran", key, durationMs: performance.now() - started
  }] }, null, 2) + "\n")
}
