import { declarationFixture } from "./testing/package-declaration.mjs"
import assert from "node:assert/strict"
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"

const declarations = () => declarationFixture("PACKAGE.ts")

function target(name = "spec-tests") {
  return declarations().targets[name]
}

test("the spec gate reports Go startup and streams test events", () => {
  const spec = target()
  assert.match(spec.shell, /node \.\.\/\.\.\/scripts\/go-test-progress\.mjs go test -json /)
  assert.ok(spec.tools.includes("node"))
})

test("the spec gate invalidates its cache when its progress runner changes", () => {
  const spec = target()
  assert.ok(spec.data.some(input => input?.srcs?.includes("scripts/go-test-progress.mjs")),
    "the runner is an executable input, not just an optional diagnostic")
})

test("progress retains spec selection, fresh external oracles and the bounded deadline", () => {
  const context = declarations()
  const spec = context.targets["spec-tests"]
  assert.match(spec.shell, /-count=1(?: |$)/)
  assert.match(spec.shell, /-run /)
  for (const pkg of ["./internal/checker/", "./internal/vibelang/", "./internal/vibelangfuzz/", "./internal/effecttsgo/shim/checker/"]) {
    assert.ok(spec.shell.includes(pkg), "missing package " + pkg)
  }
  assert.match(spec.shell, /VIBELANG_FUZZ_REQUIRE=1/)
  assert.equal(spec.timeout, "10m", "the measured fast spec check retains its bounded graph deadline")
})


test("the spec command forwards required Go settings through the progress process", t => {
  const root = mkdtempSync(join(tmpdir(), "spec-progress-env-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ["typescript/tsc", "scripts", "bin"]) mkdirSync(join(root, dir), { recursive: true })
  copyFileSync(new URL("./go-test-progress.mjs", import.meta.url), join(root, "scripts/go-test-progress.mjs"))
  // Registration may precede Go execution. Exercise that real helper when the graph uses it.
  const registration = new URL("./gate-tests.mjs", import.meta.url)
  if (existsSync(registration)) copyFileSync(registration, join(root, "scripts/gate-tests.mjs"))
  for (const pkg of ["checker", "vibelang", "vibelangfuzz", "effecttsgo/shim/checker"]) {
    const dir = join(root, "typescript/tsc/internal", pkg)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "progress_test.go"), "package fixture\n//gate:spec-tests\nfunc TestProgressFixture(t *testing.T) {}\n")
  }
  const output = join(root, "settings")
  // Process/argument transport only: no compiler behavior is simulated.
  writeFileSync(join(root, "bin/go"), '#!/bin/sh\nprintf "%s\\n" "$CGO_ENABLED" "$VIBELANG_FUZZ_REQUIRE" "$EFFECT_NODE_MODULES" "$GOCACHE" > "$PROGRESS_SETTINGS_OUTPUT"\n', { mode: 0o700 })
  const env = { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH,
    HOME: join(root, "home"), PROGRESS_SETTINGS_OUTPUT: output }
  for (const name of ["CGO_ENABLED", "VIBELANG_FUZZ_REQUIRE", "EFFECT_NODE_MODULES", "GOCACHE"]) delete env[name]
  const result = spawnSync("/bin/sh", ["-c", target().shell], { cwd: root, env, encoding: "utf8", timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  const settings = readFileSync(output, "utf8").trimEnd().split("\n")
  assert.equal(settings[0], "0")
  assert.equal(settings[1], "1", "the Go suite must require its dependencies instead of silently skipping")
  assert.equal(resolve(settings[2]), join(root, "experiments/node_modules"))
  assert.equal(settings[3], join(root, "home/.cache/go-build-smthrs"))
})

test("the release runner declares the Go tool used by its real progress fixture", () => {
  assert.ok(target("release").tools.includes("go"), "native progress controls need Go in the release target's tool identity")
})

// Run the real command-contract test against independent declaration variants.
// Selecting that test in the child prevents these fixture controls recursing.
for (const [name, shared, deadline, status] of [
  ["current shared limit", "30m", "10m", 0],
  ["shorter shared limit", "15m", "10m", 0],
  ["longer shared limit", "45m", "10m", 0],
  ["stale shorter override", "30m", "15m", 1],
  ["stale longer override", "30m", "45m", 1],
  ["missing target deadline", "30m", undefined, 1],
  ["unbounded shared deadline", "0", "0", 1],
  ["invalid shared deadline", "unlimited", "unlimited", 1],
]) test("spec progress deadline contract handles " + name, t => {
  const root = mkdtempSync(join(tmpdir(), "spec-progress-deadline-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "scripts/testing"), { recursive: true })
  for (const file of ["api-inputs.ts", "build-contract-inputs.ts", "scripts/spec-progress-target.test.mjs", "scripts/testing/package-declaration.mjs"]) {
    copyFileSync(new URL("../" + file, import.meta.url), join(root, file))
  }
  const original = readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8")
  const start = original.indexOf('"spec-tests": S.Shell.Test({')
  assert.ok(start > 0, "mutate only the actual specification target")
  const entry = /timeout:\s*(?:"[^"]*"|'[^']*')/g
  const tail = original.slice(start)
  assert.equal([...tail.matchAll(entry)].length, 1, "the target's explicit deadline must remain unique")
  let source = original.slice(0, start) + tail.replace(entry,
    deadline === undefined ? "" : "timeout: " + JSON.stringify(deadline))
  const defaultEntry = /timeout\s*=\s*(?:"[^"]*"|'[^']*')/g
  assert.equal([...source.matchAll(defaultEntry)].length, 1, "the shared check default must remain unique")
  source = source.replace(defaultEntry, "timeout = " + JSON.stringify(shared))
  writeFileSync(join(root, "PACKAGE.ts"), source)
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, [
    "--test", "--test-name-pattern=^progress retains spec selection",
    join(root, "scripts/spec-progress-target.test.mjs"),
  ], { cwd: root, env, encoding: "utf8", timeout: 15000 })
  assert.ifError(result.error)
  assert.match(result.stdout, /progress retains spec selection/)
  assert.equal(result.status, status, result.stdout + result.stderr)
})

test("spec deadline fixture controls follow a later shared graph limit", t => {
  const root = mkdtempSync(join(tmpdir(), "spec-progress-next-deadline-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "scripts/testing"), { recursive: true })
  for (const file of ["api-inputs.ts", "build-contract-inputs.ts", "scripts/spec-progress-target.test.mjs", "scripts/testing/package-declaration.mjs"]) {
    copyFileSync(new URL("../" + file, import.meta.url), join(root, file))
  }
  const original = readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8")
  const start = original.indexOf('"spec-tests": S.Shell.Test({')
  assert.ok(start > 0)
  const source = original.slice(0, start).replace(/timeout\s*=\s*(?:"[^"]*"|'[^']*')/, 'timeout = "45m"') +
    original.slice(start)
  writeFileSync(join(root, "PACKAGE.ts"), source)
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, [
    "--test", "--test-name-pattern=^spec progress deadline contract handles ",
    join(root, "scripts/spec-progress-target.test.mjs"),
  ], { cwd: root, env, encoding: "utf8", timeout: 15000 })
  assert.ifError(result.error)
  assert.match(result.stdout, /spec progress deadline contract handles current shared limit/)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
