import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { spawnSync } from "node:child_process"

function deploymentFixture() {
  const dir = mkdtempSync(join(tmpdir(), "published-deploy-"))
  for (const path of ["scripts", "docs/tools", "experiments", "packages/runtime", "site", "bin"]) mkdirSync(join(dir, path), { recursive: true })
  const script = join(dir, "scripts/deploy-docs.sh")
  const calls = join(dir, "calls")
  copyFileSync(new URL("../../scripts/deploy-docs.sh", import.meta.url), script)
  const put = (name, body) => { const file = join(dir, "bin", name); writeFileSync(file, body); chmodSync(file, 0o755) }
  put("node", [
    "#!" + process.execPath,
    'const { appendFileSync, writeFileSync } = require("node:fs")',
    "const args = process.argv.slice(2)",
    'if (args.includes("--snapshot")) { writeFileSync(args.at(-1), JSON.stringify({compiler:{version:process.env.VIBELANG_RELEASE_VERSION}})); process.exit(0) }',
    'if (args[0] === "-p") { console.log(process.env.VIBELANG_RELEASE_VERSION); process.exit(0) }',
    'if (args.includes("--check")) { appendFileSync(process.env.VIBELANG_DEPLOY_TEST_LOG, "registry\\n"); process.exit(44) }',
  ].join("\n"))
  put("bun", "#!/bin/sh\nexit 0\n")
  put("npm", ['#!/bin/sh', 'case "$*" in *deploy*) echo upload >> "$VIBELANG_DEPLOY_TEST_LOG";; esac', "exit 0", ""].join("\n"))
  return {
    dir, calls,
    run: args => spawnSync("sh", [script, ...args], {
      cwd: dir, encoding: "utf8", timeout: 10000,
      env: {
        PATH: join(dir, "bin") + delimiter + process.env.PATH,
        VIBELANG_RELEASE_VERSION: "9.8.7",
        VIBELANG_DOCS_HOVERS: "0",
        VIBELANG_SKIP_RELEASE_SNIPPETS: "1",
        VIBELANG_SKIP_RELEASE_SNIPPETS_REASON: "offline candidate control-flow fixture",
        VIBELANG_DEPLOY_TEST_LOG: calls,
      },
    }),
  }
}

test("an unpublished candidate dry run builds without a live availability query", () => {
  const fixture = deploymentFixture()
  try {
    const result = fixture.run(["--dry-run"])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /nothing deployed/)
    assert.equal(existsSync(fixture.calls), false)
  } finally { rmSync(fixture.dir, { recursive: true, force: true }) }
})

test("a real upload still requires a fresh registry check, even with a candidate override", () => {
  const fixture = deploymentFixture()
  try {
    const result = fixture.run([])
    assert.equal(result.status, 44, result.stdout + result.stderr)
    assert.equal(readFileSync(fixture.calls, "utf8"), "registry\n")
  } finally { rmSync(fixture.dir, { recursive: true, force: true }) }
})
