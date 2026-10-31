import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const scriptPath = fileURLToPath(new URL("./check-app.sh", import.meta.url))
const script = readFileSync(scriptPath, "utf8")
const overrides = ["VIBELANG_BINARY", "VIBELANG_RUNTIME", "VIBELANG_RUNTIME_DIR", "EFFECT_NODE_MODULES"]

test("installed-package rehearsal clears checkout compiler and runtime overrides", t => {
  const dir = mkdtempSync(join(tmpdir(), "release-env-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const probe = join(dir, "probe.mjs")
  writeFileSync(probe, "console.log(JSON.stringify(Object.fromEntries(" + JSON.stringify(overrides) + ".map(name => [name, Object.hasOwn(process.env, name)]))))\n")
  const end = script.indexOf("scratch=$(mktemp -d ")
  assert.ok(end > 0, "the environment is prepared before the fresh project is created")
  const result = spawnSync("sh", ["-c", script.slice(0, end) + '\nexec "$RELEASE_ENV_NODE" "$RELEASE_ENV_PROBE"\n',
    scriptPath, "https://registry.invalid/", "0.0.0"], {
    encoding: "utf8",
    env: { ...process.env, ...Object.fromEntries(overrides.map(name => [name, "checkout-only-override"])),
      RELEASE_ENV_NODE: process.execPath, RELEASE_ENV_PROBE: probe }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), Object.fromEntries(overrides.map(name => [name, false])))
})
