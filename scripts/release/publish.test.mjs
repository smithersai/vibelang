// Offline dry-run tests. Every npm invocation hits a recorder that refuses
// publication unless --dry-run is present. No registry or credentials are used.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const names = ["vibelang-linux-x64", "vibelang-runtime", "vibelang"]
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-publish-dry-test-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "scripts/release"), { recursive: true })
  for (const file of ["publish.sh", "repack.mjs"]) cpSync(join(repo, "scripts/release", file), join(root, "scripts/release", file))
  const tarballs = join(root, "dist-npm/tarballs")
  mkdirSync(tarballs, { recursive: true })
  const entries = []
  for (const name of names) {
    const source = join(root, name, "package")
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, "package.json"), JSON.stringify({ name, version: "0.0.1" }))
    const file = `${name}-0.0.1.tgz`
    execFileSync("tar", ["-czf", join(tarballs, file), "-C", dirname(source), "package"])
    entries.push({ name, version: "0.0.1", file })
  }
  writeFileSync(join(tarballs, "manifest.json"), JSON.stringify({ version: "0.0.1", packages: entries }))
  const bin = join(root, "bin")
  mkdirSync(bin)
  const calls = join(root, "calls.jsonl")
  writeFileSync(calls, "")
  writeFileSync(join(bin, "npm"), `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n")
if (args[0] === "whoami") { if(process.env.TEST_LOGGED_IN) console.log("test-user"); process.exit(process.env.TEST_LOGGED_IN ? 0 : 1) }
if (args[0] === "view") {
  if (!args[1].startsWith(process.env.TEST_EXISTING || "NO_MATCH")) process.exit(1)
  const file = ${JSON.stringify(tarballs)} + "/" + args[1].replace("@", "-") + ".tgz"
  console.log(createHash("sha1").update(readFileSync(file)).digest("hex"))
  process.exit(0)
}
if (args[0] === "publish") {
  if (!args.includes("--dry-run")) { console.error("test refuses live publication"); process.exit(99) }
  process.exit(process.env.TEST_FAIL_PUBLISH ? 1 : 0)
}
console.error("unexpected npm command"); process.exit(98)
`, { mode: 0o755 })
  return { root, tarballs, calls, bin }
}
function run(f, env = {}, args = ["--dry-run"]) {
  const result = spawnSync("sh", [join(f.root, "scripts/release/publish.sh"), ...args], {
    encoding: "utf8", timeout: 15_000, input: "",
    env: { PATH: `${f.bin}:${process.env.PATH}`, VIBELANG_REGISTRY: "http://127.0.0.1:1/unused/", ...env }
  })
  const calls = readFileSync(f.calls, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  return { ...result, calls, publishes: calls.filter((args) => args[0] === "publish") }
}

test("offline dry-run checks archives in manifest order without requiring login", (t) => {
  const f = fixture(t)
  const result = run(f)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /not logged in to npm; the dry run continues/)
  assert.match(result.stdout, /dry run passed for 0\.0\.1/)
  assert.deepEqual(result.publishes.map((args) => args[1]), names.map((name) => join(f.tarballs, `${name}-0.0.1.tgz`)))
  for (const args of result.publishes) {
    assert.deepEqual(args.slice(2), ["--registry", "http://127.0.0.1:1/unused/", "--access", "public", "--dry-run"])
  }
})

test("already published packages and comma-separated skip patterns are not published", (t) => {
  const result = run(fixture(t), { TEST_LOGGED_IN: "1", TEST_EXISTING: "vibelang@", VIBELANG_SKIP: "linux, runtime" })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.publishes.length, 0)
  assert.match(result.stdout, /skipping vibelang-linux-x64/)
  assert.match(result.stdout, /skipping vibelang-runtime/)
  assert.match(result.stdout, /vibelang@0\.0\.1 is already on npm/)
})

test("a mismatched launcher archive is rejected before invoking npm", (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, "vibelang/package/package.json"), '{"name":"vibelang","version":"0.0.2"}')
  execFileSync("tar", ["-czf", join(f.tarballs, "vibelang-0.0.1.tgz"), "-C", join(f.root, "vibelang"), "package"])
  const result = run(f)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /expected vibelang@0\.0\.1, got vibelang@0\.0\.2/)
  assert.equal(result.calls.length, 0)
  assert.equal(result.publishes.length, 0)
})

test("a failed dry-run stops immediately instead of prompting or publishing later packages", (t) => {
  const result = run(fixture(t), { TEST_FAIL_PUBLISH: "1" })
  assert.equal(result.status, 1)
  assert.equal(result.publishes.length, 1)
  assert.doesNotMatch(result.stdout, /Enter a new one-time password|dry run passed/)
})

test("an explicit --otp reaches npm alongside --dry-run in either argument order", (t) => {
  for (const args of [["--otp", "123456", "--dry-run"], ["--dry-run", "--otp", "654321"]]) {
    const result = run(fixture(t), {}, args)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.publishes.length, names.length)
    for (const call of result.publishes) {
      assert.ok(call.includes("--dry-run"))
      assert.equal(call[call.indexOf("--otp") + 1], args[args.indexOf("--otp") + 1])
    }
  }
})

test("invalid arguments stop before npm or archive processing", (t) => {
  for (const args of [["--otp"], ["--otp", "--dry-run"], ["--dryrun"], ["--unknown"]]) {
    const result = run(fixture(t), {}, args)
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.match(result.stderr, /usage:.*publish.sh/)
    assert.equal(result.calls.length, 0)
  }
})
