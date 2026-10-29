// Exercise the real publisher with local tarballs and a fake npm. No publication.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const names = ["vibelang-linux-x64", "@vibelang/cli-win32-x64", "@vibelang/cli-win32-arm64", "vibelang"]

function fixture(t, mode, target = names[0]) {
  const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "vibelang-publish-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const scripts = join(root, "scripts/release")
  const tarballs = join(root, "dist-npm/tarballs")
  const bin = join(root, "bin")
  for (const dir of [scripts, tarballs, bin, join(root, "source/package")]) mkdirSync(dir, { recursive: true })
  for (const file of ["publish.sh", "repack.mjs"]) cpSync(join(repo, "scripts/release", file), join(scripts, file))
  const packages = names.map(name => {
    writeFileSync(join(root, "source/package/package.json"), JSON.stringify({ name, version: "0.0.6" }))
    const file = name.replace("@", "").replace("/", "-") + "-0.0.6.tgz"
    execFileSync("tar", ["-czf", join(tarballs, file), "-C", join(root, "source"), "package"])
    return { name, version: "0.0.6", file }
  })
  writeFileSync(join(tarballs, "manifest.json"), JSON.stringify({ version: "0.0.6", packages }))
  writeFileSync(join(bin, "npm"), `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs")
const { createHash } = require("node:crypto")
const { join } = require("node:path")
const args = process.argv.slice(2)
appendFileSync(process.env.CALLS, JSON.stringify(args) + "\\n")
if (args[0] === "whoami") console.log("fixture-owner")
else if (args[0] === "view") {
  const name = args[1].slice(0, args[1].lastIndexOf("@"))
  if (process.env.MODE === "missing" || (process.env.MODE === "later-mismatch" && name !== process.env.TARGET)) process.exit(1)
  if (args[2] === "version") console.log("0.0.6")
  else if (name === process.env.TARGET && ["mismatch", "later-mismatch"].includes(process.env.MODE)) console.log("0".repeat(40))
  else if (name === process.env.TARGET && process.env.MODE === "empty") {}
  else console.log(createHash("sha1").update(readFileSync(join(process.env.TARBALLS, name.replace("@", "").replace("/", "-") + "-0.0.6.tgz"))).digest("hex"))
} else if (args[0] !== "publish") process.exit(2)
`, { mode: 0o755 })
  return {
    run: () => spawnSync("sh", [join(scripts, "publish.sh"), "--dry-run"], {
      encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PATH: bin + ":" + process.env.PATH, CALLS: join(root, "calls"),
        TARBALLS: tarballs, MODE: mode, TARGET: target, VIBELANG_SKIP: "", NPM_OTP: "",
        VIBELANG_REGISTRY: "https://fixture.invalid/" }
    }),
    calls: () => readFileSync(join(root, "calls"), "utf8").trim().split("\n").map(line => JSON.parse(line))
  }
}

test("identical registry tarballs are verified and skipped", t => {
  const f = fixture(t, "match")
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /identical tarball/)
  assert.equal(f.calls().filter(args => args[0] === "publish").length, 0)
  for (const name of names) {
    assert.ok(f.calls().some(args => args[0] === "view" && args[1] === name + "@0.0.6" &&
      args[2] === "dist.shasum" && args.includes("https://fixture.invalid/")))
  }
})

for (const name of names) {
  test(name + ": a different registry tarball aborts before any publish", t => {
    const f = fixture(t, "later-mismatch", name)
    const result = f.run()
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /checksum mismatch/)
    assert.ok(result.stderr.includes(name + "@0.0.6"))
    assert.match(result.stderr, /registry dist.shasum=.*local sha1=/)
    assert.equal(f.calls().filter(args => args[0] === "publish").length, 0)
  })
}

test("an existing version without a registry checksum is refused", t => {
  const f = fixture(t, "empty")
  const result = f.run()
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /checksum mismatch/)
  assert.equal(f.calls().filter(args => args[0] === "publish").length, 0)
})

test("missing versions are queued and checked with npm publish --dry-run", t => {
  const f = fixture(t, "missing")
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const publishes = f.calls().filter(args => args[0] === "publish")
  assert.equal(publishes.length, names.length)
  assert.ok(publishes.every(args => args.includes("--dry-run") && args.includes("https://fixture.invalid/")))
})
