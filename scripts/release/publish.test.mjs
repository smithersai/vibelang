// Offline dry-run tests. Every npm invocation hits a recorder that refuses
// publication unless --dry-run is present. No registry or credentials are used.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { fixtureCheckout, fixtureRevision, fixtureDprint } from "./fixture-checkout.mjs"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const names = ["vibelang-linux-x64", "vibelang-runtime", "vibelang"]
const realNpm = execFileSync("sh", ["-c", "command -v npm"], { encoding: "utf8" }).trim()
const platformNames = (all) => all.filter((name) => /-(?:darwin|linux|win32)-/.test(name))
function fixture(t, names = ["vibelang-linux-x64", "vibelang-runtime", "vibelang"], manifest = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-publish-dry-test-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "scripts/release"), { recursive: true })
  for (const file of ["publish.sh", "repack.mjs", "revision.mjs"]) cpSync(join(repo, "scripts/release", file), join(root, "scripts/release", file))
  const checkout = fixtureCheckout(root)
  const tarballs = join(root, "dist-npm/tarballs")
  mkdirSync(tarballs, { recursive: true })
  const entries = []
  for (const name of names) {
    const source = join(root, name, "package")
    mkdirSync(source, { recursive: true })
    const optionalDependencies = name === "vibelang" ? Object.fromEntries(platformNames(names).map((platform) => [platform, "0.0.1"])) : undefined
    writeFileSync(join(source, "package.json"), JSON.stringify({ name, version: "0.0.1", optionalDependencies }))
    if (name === "vibelang") {
      writeFileSync(join(source, "dprint-plugin.json"), JSON.stringify(fixtureDprint(names, "0.0.1")))
      chmodSync(join(source, "dprint-plugin.json"), 0o644)
    }
    // npm pack normalizes modes; repack verifies its output against the input.
    chmodSync(join(source, "package.json"), 0o644)
    const file = `${name.replace("@", "").replace("/", "-")}-0.0.1.tgz`
    execFileSync("tar", ["-czf", join(tarballs, file), "-C", dirname(source), "package"])
    entries.push({ name, version: "0.0.1", file })
  }
  writeFileSync(join(tarballs, "manifest.json"), JSON.stringify({ version: "0.0.1", revision: fixtureRevision, clean: true, ...manifest, packages: entries }))
  const bin = join(root, "bin")
  mkdirSync(bin)
  const calls = join(root, "calls.jsonl")
  writeFileSync(calls, "")
  writeFileSync(join(bin, "npm"), `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
const args = process.argv.slice(2)
// repack.mjs packs locally; only registry commands are recorded and faked.
if (args[0] === "pack") process.exit(spawnSync(${JSON.stringify(realNpm)}, args, { stdio: "inherit" }).status ?? 1)
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n")
const startupDelay = Number(process.env.TEST_NPM_DELAY_MS || 0)
if (startupDelay > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, startupDelay)
if (args[0] === "whoami") { if(process.env.TEST_LOGGED_IN) console.log("test-user"); process.exit(process.env.TEST_LOGGED_IN ? 0 : 1) }
if (args[0] === "view") {
  if (!args[1].startsWith(process.env.TEST_EXISTING || "NO_MATCH")) process.exit(1)
  const file = ${JSON.stringify(tarballs)} + "/" + args[1].replace("@", "-") + ".tgz"
  console.log(createHash("sha1").update(readFileSync(file)).digest("hex"))
  process.exit(0)
}
if (args[0] === "publish") {
  const file = args[1].slice(args[1].lastIndexOf("/") + 1)
  const original = readFileSync(${JSON.stringify(tarballs)} + "/" + file)
  if (!readFileSync(args[1]).equals(original)) { console.error("staged bytes changed"); process.exit(97) }
  if (!args.includes("--dry-run")) { console.error("test refuses live publication"); process.exit(99) }
  process.exit(process.env.TEST_FAIL_PUBLISH ? 1 : 0)
}
console.error("unexpected npm command"); process.exit(98)
`, { mode: 0o755 })
  return { root, tarballs, calls, bin, checkout }
}
// The offline child chain needs room to start under load; a stalled probe
// still fails with process state and recorded command stages.
function run(f, env = {}, args = ["--dry-run"], timeout = 60_000) {
  const started = performance.now()
  const result = spawnSync("sh", [join(f.root, "scripts/release/publish.sh"), ...args], {
    encoding: "utf8", timeout, input: "",
    env: { HOME: f.root, PATH: `${f.checkout.bin}:${f.bin}:${process.env.PATH}`, VIBELANG_REGISTRY: "http://127.0.0.1:1/unused/", ...env }
  })
  const calls = readFileSync(f.calls, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  if (result.error || result.signal || result.status === null) {
    throw new Error("offline publish probe failed: " + JSON.stringify({
      code: result.error?.code ?? "NO_EXIT_STATUS", status: result.status, signal: result.signal,
      elapsedMs: Math.round(performance.now() - started), commands: calls.map(([command]) => command)
    }))
  }
  return { ...result, calls, publishes: calls.filter((args) => args[0] === "publish") }
}

test("offline dry-run checks archives in manifest order without requiring login", (t) => {
  const f = fixture(t)
  const result = run(f)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /not logged in to npm; the dry run continues/)
  assert.match(result.stdout, /dry run passed for 0\.0\.1/)
  assert.deepEqual(result.publishes.map((args) => basename(args[1])), names.map((name) => `${name}-0.0.1.tgz`))
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


test("slow offline probes still stop at the first failed publish", (t) => {
  const started = performance.now()
  const result = run(fixture(t), { TEST_FAIL_PUBLISH: "1", TEST_NPM_DELAY_MS: "5500" })
  const diagnostic = JSON.stringify({
    error: result.error?.code, signal: result.signal, elapsedMs: Math.round(performance.now() - started),
    commands: result.calls.map(([command]) => command)
  })
  assert.equal(result.status, 1, diagnostic)
  assert.equal(result.publishes.length, 1)
  assert.doesNotMatch(result.stdout, /Enter a new one-time password|dry run passed/)
})

test("an offline probe timeout reports process failure and recorded stages", (t) => {
  const f = fixture(t)
  assert.throws(() => run(f, { TEST_NPM_DELAY_MS: "250" }, ["--dry-run"], 100),
    /offline publish probe failed: .*ETIMEDOUT.*commands/)
})

// Release integrity: a skip run must not strip what a later run publishes.
const withWindows = ["vibelang-linux-x64", "@smthrs/cli-win32-x64", "@smthrs/cli-win32-arm64", "vibelang"]
const optional = (f) => Object.keys(JSON.parse(execFileSync("tar", ["-xOzf", join(f.tarballs, "vibelang-0.0.1.tgz"), "package/package.json"], { encoding: "utf8" })).optionalDependencies ?? {})
test("a dry run with VIBELANG_SKIP does not strip the vibelang tarball a later run publishes", (t) => {
  const f = fixture(t, withWindows)
  const skipped = run(f, { VIBELANG_SKIP: "win32" })
  assert.equal(skipped.status, 0, skipped.stderr)
  assert.deepEqual(optional(f), ["vibelang-linux-x64"])
  assert.deepEqual(skipped.publishes.map((args) => basename(args[1])), ["vibelang-linux-x64", "vibelang"].map((name) => `${name}-0.0.1.tgz`))
  writeFileSync(f.calls, "")
  const full = run(f)
  assert.equal(full.status, 0, full.stderr)
  assert.equal(full.publishes.length, withWindows.length)
  assert.deepEqual(optional(f), withWindows.slice(0, 3), "vibelang lists every platform package this run publishes")
})

test("a vibelang tarball that lacks a platform package being published is refused before npm runs", (t) => {
  const f = fixture(t, withWindows)
  const source = join(f.root, "vibelang/package/package.json")
  writeFileSync(source, JSON.stringify({ name: "vibelang", version: "0.0.1", optionalDependencies: { "vibelang-linux-x64": "0.0.1" } }))
  execFileSync("tar", ["-czf", join(f.tarballs, "vibelang-0.0.1.tgz"), "-C", join(f.root, "vibelang"), "package"])
  const result = run(f)
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stderr, /lists optionalDependencies \[vibelang-linux-x64\], but manifest\.json has the platform packages/)
  assert.equal(result.calls.length, 0)
})

for (const [name, change, message] of [
  ["tarballs from another revision", (f) => f.checkout.set({ revision: "9c".repeat(20) }), /assembled from revision 5a5a.*but this checkout is 9c9c/],
  ["a checkout with uncommitted changes", (f) => f.checkout.set({ clean: false }), /changes that are not in a commit/],
  ["a manifest without a revision", (f) => rewrite(f, (manifest) => { delete manifest.revision }), /records no source revision/],
  ["tarballs assembled with --skip-build", (f) => rewrite(f, (manifest) => { manifest.rehearsalOnly = ["--skip-build"] }), /assembled with --skip-build, for rehearsal only/],
  ["a tree that is no checkout", (f) => rmSync(join(f.root, ".jj"), { recursive: true }), /not a jj or git checkout/],
]) {
  test(`${name}: refused before repacking or invoking npm`, (t) => {
    for (const args of [["--dry-run"], ["--otp", "123456"]]) {
      const f = fixture(t)
      change(f)
      const before = readFileSync(join(f.tarballs, "manifest.json"))
      const result = run(f, { TEST_LOGGED_IN: "1" }, args)
      assert.equal(result.status, 1, result.stdout)
      assert.match(result.stderr, message)
      assert.equal(result.calls.length, 0)
      assert.deepEqual(readFileSync(join(f.tarballs, "manifest.json")), before)
    }
  })
}
function rewrite(f, change) {
  const path = join(f.tarballs, "manifest.json")
  const manifest = JSON.parse(readFileSync(path, "utf8"))
  change(manifest)
  writeFileSync(path, JSON.stringify(manifest))
}

test("publication stages identical bytes outside the publisher home and bundle, then cleans up", (t) => {
  const f = fixture(t)
  // A caller-controlled temp directory under HOME must not affect staging.
  const result = run(f, { HOME: f.root, TMPDIR: f.root })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.publishes.length, names.length)
  for (const [, file] of result.publishes) {
    assert.ok(!file.includes(f.root), "npm must not receive the publisher home or bundle path")
    assert.match(file, /^(?:\/private)?\/tmp\/vibelang-publish\.[^/]+\//)
    assert.equal(existsSync(dirname(file)), false, "staging is removed on success")
  }
})

test("failed publication removes staging and a rerun resumes with identical packages skipped", (t) => {
  const f = fixture(t)
  const failed = run(f, { TEST_FAIL_PUBLISH: "1" })
  assert.equal(failed.status, 1, failed.stderr)
  assert.equal(existsSync(dirname(failed.publishes[0][1])), false)
  writeFileSync(f.calls, "")
  const resumed = run(f, { TEST_EXISTING: "vibelang-linux-x64@" })
  assert.equal(resumed.status, 0, resumed.stderr)
  assert.deepEqual(resumed.publishes.map((args) => basename(args[1])),
    ["vibelang-runtime-0.0.1.tgz", "vibelang-0.0.1.tgz"])
})

test("a staging path containing HOME is refused with one reason before publication", (t) => {
  const f = fixture(t)
  const result = run(f, { HOME: "/tmp" })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /^publish: refusing .*home path\n$/)
  assert.equal(result.publishes.length, 0)
})

for (const segment of ["Users", "home"]) {
  test(segment + ": resolved staging paths with a home-directory segment are refused", (t) => {
    const f = fixture(t)
    const stage = join(f.root, segment, "publisher", "stage")
    mkdirSync(stage, { recursive: true })
    writeFileSync(join(f.bin, "mktemp"), "#!/bin/sh\nprintf '%s\\n' '" + stage + "'\n", { mode: 0o755 })
    const result = run(f, { HOME: join(f.root, "unrelated") })
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /^publish: refusing .*home path\n$/)
    assert.equal(result.publishes.length, 0)
    assert.equal(existsSync(stage), false)
  })
}
