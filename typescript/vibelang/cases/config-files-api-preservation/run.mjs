// run-seconds: 180
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
const r = spawnSync(process.execPath, ["--conditions", "@typescript/source", new URL("./probe.mjs", import.meta.url).pathname], { encoding: "utf8", timeout: 120000 })
assert.equal(r.error, undefined, String(r.error))
assert.equal(r.status, 0, r.stdout + r.stderr)
process.stdout.write(r.stdout)
