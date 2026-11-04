import { createApiIdentityInputs } from "../api-inputs.ts"
import assert from "node:assert/strict"
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { stripTypeScriptTypes } from "node:module"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

function target(name = "spec-tests") {
  const source = stripTypeScriptTypes(readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8"))
    .replace(/^import .*$/gm, "").replace("export const Package", "globalThis.result")
  const group = prefix => new Proxy({}, { get: (_, name) => prefix + "." + name })
  const context = {
    createApiIdentityInputs,
    process: { env: {} }, fuzzTopics: [], vibelangTopics: [], migrationSources: "migration-sources",
    S: { Generate: spec => spec, Filegroup: spec => spec, glob: glob => glob, file: file => file,
      Shell: { Test: spec => spec, Run: spec => spec, Build: spec => spec }, Host: { bin: bin => bin }, Package: spec => spec },
    Tsc: group("tsc"), Packages: group("packages"), Typescript: group("typescript"), Vibelang: group("vibelang")
  }
  runInNewContext(source, context)
  return context.result.targets[name]
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

test("progress retains spec selection, fresh external oracles and the existing deadline", () => {
  const spec = target()
  assert.match(spec.shell, /-count=1(?: |$)/)
  assert.match(spec.shell, /-run /)
  for (const pkg of ["./internal/checker/", "./internal/vibelang/", "./internal/vibelangfuzz/", "./internal/effecttsgo/shim/checker/"]) {
    assert.ok(spec.shell.includes(pkg), "missing package " + pkg)
  }
  assert.match(spec.shell, /VIBELANG_FUZZ_REQUIRE=1/)
  assert.equal(spec.timeout, "15m")
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
