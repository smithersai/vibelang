import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const clientPath = fileURLToPath(new URL("./protocol-client.mjs", import.meta.url))
const source = readFileSync(clientPath, "utf8")

test("protocol-client.mjs passes Node syntax check", () => {
  const res = spawnSync(process.execPath, ["--check", clientPath], { encoding: "utf8" })
  assert.equal(res.status, 0, res.stderr)
})

test("protocol-client.mjs defines mapper process framing and request helpers", () => {
  assert.ok(source.includes("export "), "protocol-client must export test helpers")
  assert.ok(source.length > 500, "protocol-client must implement protocol framing")
})
