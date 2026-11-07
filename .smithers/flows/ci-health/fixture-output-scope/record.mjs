import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = fileURLToPath(new URL("./", import.meta.url))
const reporters = [["//packages:compiler-test-2", "node-failures.mjs"], ["//packages:migrate-test", "migrate-progress.mjs"]]
for (let i = 1; i <= 4; i++) {
  const failing = i % 2 === 1
  const env = { ...process.env, CI_HEALTH_OUTPUT_OWNER: i <= 2 ? "expected" : "actual", CI_HEALTH_WITNESS_STATE: failing ? "fail" : "pass", NODE_OPTIONS: "", FORCE_COLOR: "0" }
  delete env.NODE_TEST_CONTEXT
  const results = [], logs = []
  for (const [label, file] of reporters) {
    const reporter = fileURLToPath(new URL("../../../../scripts/testing/" + file, import.meta.url))
    const key = createHash("sha256").update(readFileSync(new URL("case.mjs", import.meta.url))).update(readFileSync(reporter)).digest("hex")
    const started = performance.now()
    const child = spawnSync(process.execPath, ["--test", "--test-reporter=" + reporter, "case.mjs"], { cwd: here, env, encoding: "utf8", timeout: 10000 })
    assert.ifError(child.error)
    assert.equal(child.status, failing ? 1 : 0, child.stdout + child.stderr)
    results.push({ label, status: failing ? "failed" : "ran", key, durationMs: performance.now() - started })
    const output = (child.stdout + child.stderr).replaceAll(pathToFileURL(here).href, "file:///<fixture>/").replaceAll(here, "<fixture>/")
    logs.push(output.split("\n").map(line => label + ": " + line).join("\n"))
  }
  const stem = "run-0" + i + "-graph"
  writeFileSync(new URL(stem + ".json", import.meta.url), JSON.stringify({ results }, null, 2) + "\n")
  writeFileSync(new URL(stem + ".log", import.meta.url), logs.join("\n"))
}
