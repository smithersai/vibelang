import { strict as assert } from "node:assert"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, symlinkSync, linkSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, delimiter, relative } from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { compilerCommand } from "../project.mjs"

const launcher = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
const binaryModule = fileURLToPath(new URL("../binary.mjs", import.meta.url))
const overrideModule = fileURLToPath(new URL("../compiler-override.mjs", import.meta.url))
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
    copyFileSync(binaryModule, join(scratch, "binary.mjs"))
    if (existsSync(overrideModule)) copyFileSync(overrideModule, join(scratch, "compiler-override.mjs"))
    const env = { ...process.env }
    delete env.VIBELANG_BINARY
    const asWindows = 'data:text/javascript,Object.defineProperty(process,"platform",{value:"win32"})'
    const result = spawnSync(process.execPath, ["--import", asWindows, join(scratch, "bin", "vibelang"), "--version"], {
      env, encoding: "utf8"
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /no native compiler is installed for win32-/)
    assert.match(result.stderr, /@smthrs\/cli-win32-/)
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

test("forwards termination to a running native watcher", { timeout: 5000 }, async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-watcher-"))
  let wrapper
  let nativePid
  // A timeout does not settle once(stdout, "data"), so finally would never
  // run if startup stopped before the ready message. Hooks run on cancellation.
  t.after(async () => {
    if (wrapper && wrapper.exitCode === null && wrapper.signalCode === null) {
      const closed = once(wrapper, "close")
      wrapper.kill("SIGTERM")
      await closed
    }
    if (nativePid) {
      try { process.kill(nativePid, "SIGKILL") } catch {}
    }
    rmSync(scratch, { recursive: true, force: true })
  })
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
})

// installed lays out a copy of the launcher as an installed package, with an
// optional native/vibelang beside it and an optional platform package.
function installed(scratch, { native = false, platform = false } = {}) {
  const pkg = join(scratch, "node_modules", "vibelang")
  mkdirSync(join(pkg, "bin"), { recursive: true })
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "vibelang", type: "module" }))
  copyFileSync(launcher, join(pkg, "bin", "vibelang"))
  copyFileSync(binaryModule, join(pkg, "binary.mjs"))
  if (existsSync(overrideModule)) copyFileSync(overrideModule, join(pkg, "compiler-override.mjs"))
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


test("rejects recursive launcher overrides before starting any child compiler", async () => {
  function check({ name, kind }) {
    const scratch = mkdtempSync(join(tmpdir(), "vibelang-override-"))
    try {
      const wrapper = installed(scratch, { native: true })
      const module = pathToFileURL(join(dirname(wrapper), "../binary.mjs")).href
      let selected = wrapper
      if (kind === "relative") selected = relative(scratch, wrapper)
      else if (kind === "symlink" || kind === "path") {
        selected = join(scratch, name)
        symlinkSync(wrapper, selected, "file")
      } else if (kind === "hardlink") {
        selected = join(scratch, name)
        linkSync(wrapper, selected)
      }
      const env = { ...process.env, VIBELANG_BINARY: kind === "path" ? name : selected,
        PATH: scratch + delimiter + (process.env.PATH ?? "") }
      // Calling the finder directly proves rejection before exercising the
      // real launcher. A regression cannot recursively spawn compiler children.
      const probe = spawnSync(process.execPath, ["--input-type=module", "--eval",
        `import {findBinary} from ${JSON.stringify(module)};try {console.log(findBinary())} catch(error) {console.error(error.message);process.exitCode=1}`
      ], { cwd: scratch, env, encoding: "utf8", timeout: 5000 })
      assert.equal(probe.status, 1, probe.stdout + probe.stderr)
      assert.match(probe.stderr, /VIBELANG_BINARY.*JavaScript launcher/)
      assert.match(probe.stderr, /native compiler/)
      assert.doesNotMatch(probe.stderr, /\n\s+at /)
      const actual = spawnSync(process.execPath, [wrapper, "--version"], { cwd: scratch, env, encoding: "utf8", timeout: 5000 })
      assert.equal(actual.status, 1, actual.stdout + actual.stderr)
      assert.equal(actual.stdout, "")
      assert.match(actual.stderr, /VIBELANG_BINARY.*JavaScript launcher/)
      assert.doesNotMatch(actual.stderr, /\n\s+at /)
    } finally { rmSync(scratch, { recursive: true, force: true }) }
  }
  const kinds = process.platform === "win32" ? ["absolute", "relative", "hardlink"] : ["absolute", "relative", "symlink", "hardlink", "path"]
  for (const kind of kinds) check({ name: "compiler-雪 %20", kind })
  await checkProperty(fc, {
    name: "launcher-override-aliases",
    rule: "VIBELANG_BINARY selects the native compiler executable; selecting a JavaScript launcher must fail without starting another compiler.",
    arbitrary: fc.record({
      name: fc.array(fc.constantFrom("a", "é", "日", " ", "%", "2"), { minLength: 1, maxLength: 12 }).map(chars => "compiler-" + chars.join("")),
      kind: fc.constantFrom(...kinds)
    }),
    numRuns: 24, check,
    command: "node --test test/launcher.test.mjs"
  })
})

test("project compiler commands reject a self-referential launcher override", () => {
  const before = process.env.VIBELANG_BINARY
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-command-override-"))
  try {
    const wrapper = installed(scratch, { native: true })
    for (const selected of [wrapper, join(dirname(wrapper), "..", "bin", "vibelang")]) {
      process.env.VIBELANG_BINARY = selected
      assert.throws(() => compilerCommand(wrapper, ["--version"]), /VIBELANG_BINARY.*JavaScript launcher/)
    }
    process.env.VIBELANG_BINARY = process.execPath
    assert.deepEqual(compilerCommand(wrapper, ["--version"]), [process.execPath, ["--version"]])
  } finally {
    if (before === undefined) delete process.env.VIBELANG_BINARY
    else process.env.VIBELANG_BINARY = before
    rmSync(scratch, { recursive: true, force: true })
  }
})


test("a custom Node compiler in a package bin directory keeps its executable meaning", () => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-custom-override-"))
  const before = process.env.VIBELANG_BINARY
  try {
    const wrapper = installed(scratch, { native: true })
    const custom = join(scratch, "custom", "bin", "vibelang")
    mkdirSync(dirname(custom), { recursive: true })
    writeFileSync(join(dirname(custom), "../package.json"), '{"name":"vibelang","type":"module"}')
    writeFileSync(custom, '#!/usr/bin/env node\nconsole.log("custom compiler")\n')
    chmodSync(custom, 0o755)
    process.env.VIBELANG_BINARY = custom
    assert.deepEqual(compilerCommand(wrapper, ["--version"]), [custom, ["--version"]])
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval",
      `import {findBinary} from ${JSON.stringify(pathToFileURL(join(dirname(wrapper), "../binary.mjs")).href)};console.log(findBinary())`
    ], { env: process.env, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), custom)
  } finally {
    if (before === undefined) delete process.env.VIBELANG_BINARY
    else process.env.VIBELANG_BINARY = before
    rmSync(scratch, { recursive: true, force: true })
  }
})
