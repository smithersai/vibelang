import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const compatScript = fileURLToPath(new URL("./check-tool-compatibility.sh", import.meta.url))
const discoveryScript = fileURLToPath(new URL("./vscode-discovery.mjs", import.meta.url))

test("check-tool-compatibility.sh passes bash syntax check", () => {
  const res = spawnSync("bash", ["-n", compatScript], { encoding: "utf8" })
  assert.equal(res.status, 0, res.stderr)
})

test("vscode-discovery.mjs passes Node syntax check", () => {
  const res = spawnSync(process.execPath, ["--check", discoveryScript], { encoding: "utf8" })
  assert.equal(res.status, 0, res.stderr)
})
