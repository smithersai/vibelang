import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = fileURLToPath(new URL("../../", import.meta.url))

function run(latest, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-site-"))
  try {
    for (const path of ["scripts/release", "bin"]) mkdirSync(join(dir, path), { recursive: true })
    copyFileSync(join(root, "scripts/release/deploy-site.sh"), join(dir, "scripts/release/deploy-site.sh"))
    const put = (path, body) => { writeFileSync(join(dir, path), body); chmodSync(join(dir, path), 0o755) }
    // npm answers the latest-tag query; deploy-docs.sh records the release override it sees.
    put("bin/npm", `#!/bin/sh\necho "$*" > "${dir}/npm.args"\necho ${latest}\n`)
    put("scripts/deploy-docs.sh", `#!/bin/sh\necho "release=\${VIBELANG_RELEASE_VERSION:-none} args=$*" > "${dir}/deployed"\n`)
    const result = spawnSync("sh", [join(dir, "scripts/release/deploy-site.sh"), "9.8.7"], {
      encoding: "utf8", env: { ...process.env, PATH: join(dir, "bin") + delimiter + process.env.PATH, ...env }
    })
    const deployed = existsSync(join(dir, "deployed")) ? readFileSync(join(dir, "deployed"), "utf8").trim() : undefined
    return { ...result, deployed, npm: readFileSync(join(dir, "npm.args"), "utf8").trim() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test("refuses to deploy while npm latest still serves another release", () => {
  const result = run("0.0.12")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /npm latest is 0\.0\.12, not 9\.8\.7/)
  assert.equal(result.deployed, undefined)
  assert.equal(result.npm, "view vibelang version --registry https://registry.npmjs.org/ --prefer-online")
})

test("deploys the site for the published release, ignoring rehearsal overrides", () => {
  const result = run("9.8.7", { VIBELANG_RELEASE_VERSION: "0.0.1", VIBELANG_REGISTRY: "http://127.0.0.1:9/" })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.deployed, "release=none args=")
  assert.match(result.npm, /--registry http:\/\/127\.0\.0\.1:9\//)
  assert.match(result.stdout, /verify-published\.sh 9\.8\.7/)
})
