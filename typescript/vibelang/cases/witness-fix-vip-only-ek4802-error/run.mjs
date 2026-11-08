// rule-evidence: docs/design/src/007-tooling.md#fix-scopes | When `--fix-vip-only` refused any call, it sets `"vibe": { "severities": { "EK4802": "error" } }` in the project's config with a comment that says why, so all `EK4802` inferred Effect argument sites in the project fail to compile; the owner removes the setting once a run refuses none.
// main.vibe holds a call whose pre-VIP-1 run is unknown, so the migration
// refuses it. other.vibe, written afterwards, holds an inferred Effect
// argument in another module: a warning before the refusal, an error after.
// run-seconds: 120
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the compiler")
const other = "function take<T>(x: T): number { return 1 }\neffect function two() { return 2 }\nexport effect function g() { return take(two()) }\n"
const project = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fix-vip-only-ek4802-"))
  fs.cpSync(path.join(here, "project"), dir, { recursive: true })
  fs.symlinkSync(path.join(here, "node_modules"), path.join(dir, "node_modules"), "dir")
  return dir
}
const run = (dir, args) => {
  const r = spawnSync(binary, args, { cwd: dir, encoding: "utf8", timeout: 60000 })
  assert.equal(r.signal, null, r.stdout + r.stderr)
  return { status: r.status, out: r.stdout + r.stderr }
}
const ek4802 = out => [...out.matchAll(/^(\S+)\(\d+,\d+\): (\w+) EK4802:/gm)].map(m => m[1] + " " + m[2])
const dirs = []
try {
  // Without a refusal, the other module's inferred argument is only a warning.
  const control = project()
  dirs.push(control)
  fs.writeFileSync(path.join(control, "other.vibe"), other)
  assert.deepEqual(ek4802(run(control, ["-p", "tsconfig.json", "--pretty", "false"]).out), ["other.vibe warning"])

  console.log("a refused --fix-vip-only run makes EK4802 an error project-wide")
} finally {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true })
}
