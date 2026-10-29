import { strict as assert } from "node:assert"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const launcher = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
test("forwards arguments, input, streams, working directory, and exit status", () => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-launcher-"))
  try {
    const binary = join(scratch, "native vibelang")
    writeFileSync(binary, `#!/usr/bin/env node
import fs from "node:fs"
console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), input: fs.readFileSync(0, "utf8") }))
console.error("native stderr")
process.exit(23)
`)
    chmodSync(binary, 0o755)
    const result = spawnSync(process.execPath, [launcher, "--pretty", "a b", "$literal"], {
      cwd: scratch, env: { ...process.env, VIBELANG_BINARY: binary }, input: "native stdin", encoding: "utf8"
    })
    assert.equal(result.status, 23)
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ["--pretty", "a b", "$literal"], cwd: realpathSync(scratch), input: "native stdin"
    })
    assert.equal(result.stderr, "native stderr\n")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test("explains how to supply a missing native compiler", () => {
  const result = spawnSync(process.execPath, [launcher], {
    env: { ...process.env, VIBELANG_BINARY: "/nonexistent/vibelang/vibelang" }, encoding: "utf8"
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /scripts\/build-vibelang.sh/)
  assert.match(result.stderr, /VIBELANG_BINARY/)
})

test("names the scoped Windows package when its optional dependency is missing", () => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-win32-"))
  try {
    // A copy outside the checkout finds neither native/vibelang nor a platform package.
    mkdirSync(join(scratch, "bin"))
    writeFileSync(join(scratch, "package.json"), '{"type":"module"}')
    copyFileSync(launcher, join(scratch, "bin", "vibelang"))
    const env = { ...process.env }
    delete env.VIBELANG_BINARY
    const asWindows = 'data:text/javascript,Object.defineProperty(process,"platform",{value:"win32"})'
    const result = spawnSync(process.execPath, ["--import", asWindows, join(scratch, "bin", "vibelang"), "--version"], {
      env, encoding: "utf8"
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /no native compiler is installed for win32-/)
    assert.match(result.stderr, /@vibelang\/cli-win32-/)
    assert.match(result.stderr, /VIBELANG_BINARY/)
    assert.doesNotMatch(result.stderr, /\n\s+at /)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test("preserves native termination signals", () => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-signal-"))
  try {
    const binary = join(scratch, "native vibelang")
    writeFileSync(binary, '#!/usr/bin/env node\nprocess.kill(process.pid, "SIGTERM")\n')
    chmodSync(binary, 0o755)
    const result = spawnSync(process.execPath, [launcher], { env: { ...process.env, VIBELANG_BINARY: binary } })
    assert.equal(result.signal, "SIGTERM")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test("forwards termination to a running native watcher", { timeout: 5000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-watcher-"))
  let wrapper
  let nativePid
  try {
    const binary = join(scratch, "native vibelang")
    writeFileSync(binary, '#!/usr/bin/env node\nconsole.log(process.pid)\nsetInterval(() => {}, 1000)\n')
    chmodSync(binary, 0o755)
    wrapper = spawn(process.execPath, [launcher, "--watch"], {
      env: { ...process.env, VIBELANG_BINARY: binary }, stdio: ["ignore", "pipe", "inherit"]
    })
    const [data] = await once(wrapper.stdout, "data")
    nativePid = Number(data.toString().trim())
    assert.ok(nativePid > 0)
    const closed = once(wrapper, "close")
    wrapper.kill("SIGTERM")
    const [code, signal] = await closed
    assert.equal(code, null)
    assert.equal(signal, "SIGTERM")
    assert.throws(() => process.kill(nativePid, 0), { code: "ESRCH" })
  } finally {
    wrapper?.kill("SIGKILL")
    if (nativePid) {
      try { process.kill(nativePid, "SIGKILL") } catch {}
    }
    rmSync(scratch, { recursive: true, force: true })
  }
})

// installed lays out a copy of the launcher as an installed package, with an
// optional native/vibelang beside it and an optional platform package.
function installed(scratch, { native = false, platform = false } = {}) {
  const pkg = join(scratch, "node_modules", "vibelang")
  mkdirSync(join(pkg, "bin"), { recursive: true })
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "vibelang", type: "module" }))
  copyFileSync(launcher, join(pkg, "bin", "vibelang"))
  const fake = (path, label) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(label)}, ...process.argv.slice(2))\n`)
    chmodSync(path, 0o755)
  }
  if (native) fake(join(pkg, "native", "vibelang"), "native")
  if (platform) {
    const target = join(scratch, "node_modules", `vibelang-${process.platform}-${process.arch}`)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, "package.json"), JSON.stringify({ name: `vibelang-${process.platform}-${process.arch}` }))
    fake(join(target, "bin", "vibelang"), "platform")
  }
  return join(pkg, "bin", "vibelang")
}

function withoutOverride() {
  const env = { ...process.env }
  delete env.VIBELANG_BINARY
  return env
}

test("runs the installed platform package's compiler", { skip: process.platform === "win32" }, () => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-platform-"))
  try {
    const result = spawnSync(process.execPath, [installed(scratch, { platform: true }), "--version"], { env: withoutOverride(), encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, "platform --version\n")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test("prefers native/vibelang beside the launcher, as in a checkout", { skip: process.platform === "win32" }, () => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-native-"))
  try {
    const result = spawnSync(process.execPath, [installed(scratch, { native: true, platform: true }), "-p", "."], { env: withoutOverride(), encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, "native -p .\n")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test("names the supported platforms when no compiler is installed", () => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-missing-"))
  try {
    const result = spawnSync(process.execPath, [installed(scratch)], { env: withoutOverride(), encoding: "utf8" })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /no native compiler is installed for /)
    assert.match(result.stderr, /darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-arm64, win32-x64\./)
    assert.match(result.stderr, /VIBELANG_BINARY/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})


test("native executable paths and arguments need no shell quoting", () => {
  // Node is a real executable on Windows too; shebang stand-ins are POSIX only.
  const args = ["a b", '$literal', 'a"b', "C:\\trailing\\", "#% & value"]
  const result = spawnSync(process.execPath, [launcher, "--eval", "console.log(JSON.stringify(process.argv.slice(1)))", "--", ...args], {
    env: { ...process.env, VIBELANG_BINARY: process.execPath }, encoding: "utf8"
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), args)
})
