import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const testDir = new URL("./", import.meta.url)

test("ts-mapper shell harnesses pass bash syntax check", () => {
  for (const script of ["e2e.sh", "runtime-fixture.sh", "parity/run.sh"]) {
    const path = fileURLToPath(new URL(script, testDir))
    const res = spawnSync("bash", ["-n", path], { encoding: "utf8" })
    assert.equal(res.status, 0, `${script}: ${res.stderr}`)
  }
})

test("ts-mapper parity suite has non-empty test cases", () => {
  const entries = readdirSync(new URL("parity/", testDir))
  assert.ok(entries.length >= 5, "parity directory should contain multiple parity fixtures")
})
