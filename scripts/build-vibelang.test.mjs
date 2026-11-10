import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// scripts/build-vibelang.sh builds packages/compiler/native/vibelang. The case harness, smoke.sh and
// lsp-smoke.sh --no-build run typescript/built/local/tsc instead, so a build that wrote only the package's binary
// left every later case run on an earlier compiler (2026-10-31: 21 lane reports). The script runs here against a
// `go` that writes a marked stand-in binary.
const script = fileURLToPath(new URL("build-vibelang.sh", import.meta.url))

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "build vibelang test "))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  fs.mkdirSync(path.join(temp, "scripts"))
  fs.copyFileSync(script, path.join(temp, "scripts/build-vibelang.sh"))
  fs.copyFileSync(new URL("native-output.sh", import.meta.url), path.join(temp, "scripts/native-output.sh"))
  // The build regenerates the compiler's projection prelude from the mapper's before it compiles.
  fs.copyFileSync(new URL("generate-projection-prelude.mjs", import.meta.url), path.join(temp, "scripts/generate-projection-prelude.mjs"))
  fs.mkdirSync(path.join(temp, "packages/ts-mapper"), { recursive: true })
  fs.mkdirSync(path.join(temp, "packages/compiler"), { recursive: true })
  fs.writeFileSync(path.join(temp, "packages/ts-mapper/prelude.d.ts"), 'declare module "vibelang-ts-mapper/prelude" { export type Fixture = 1 }\n')
  fs.mkdirSync(path.join(temp, "typescript/tsc/cmd/tsc"), { recursive: true })
  fs.mkdirSync(path.join(temp, "bin"))
  // The stand-in records calls; the census and generator have independent exits.
  fs.writeFileSync(path.join(temp, "bin/go"), `#!/bin/sh
printf '%s\\t%s\\t%s\\t%s\\n' "$1" "\${GOOS-unset}" "\${GOARCH-unset}" "$*" >> "$BUILD_TRACE"
case "$1" in
  env) case "$2" in GOHOSTOS) echo linux ;; GOHOSTARCH) echo amd64 ;; *) exit 2 ;; esac; exit 0 ;;
  test) printf '%s\\n' "fixture grammar census" >&2; exit "\${GRAMMAR_STATUS:-0}" ;;
  run) exit 0 ;;
esac
while [ "$1" != -o ]; do shift; done
printf '#!/bin/sh\\n# build %s\\nexit 0\\n' "$$" > "$2"
chmod +x "$2"
`, { mode: 0o755 })
  return temp
}

const build = (temp, env = {}) => spawnSync("sh", [path.join(temp, "scripts/build-vibelang.sh")], {
  encoding: "utf8",
  timeout: 10000,
  env: {
    ...process.env,
    PATH: path.join(temp, "bin") + path.delimiter + process.env.PATH,
    EFFECT_NODE_MODULES: path.join(temp, "modules"),
    BUILD_TRACE: path.join(temp, "calls.tsv"),
    GRAMMAR_STATUS: "0",
    ...env,
  },
})

function calls(temp) {
  return fs.readFileSync(path.join(temp, "calls.tsv"), "utf8").trim().split("\n").map(line => {
    const [verb, os, arch, args] = line.split("\t")
    return { verb, os, arch, args }
  })
}

function effectDeclarations(temp) {
  const declaration = path.join(temp, "modules/effect/dist/Effect.d.ts")
  fs.mkdirSync(path.dirname(declaration), { recursive: true })
  fs.writeFileSync(declaration, "export declare const unit: unknown\n")
}

test("build-vibelang.sh installs the binary it builds where the case harness runs it", (t) => {
  const temp = fixture(t)
  const result = build(temp)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const native = fs.readFileSync(path.join(temp, "packages/compiler/native/vibelang"), "utf8")
  const harnessCompiler = path.join(temp, "typescript/built/local/tsc")
  assert.equal(fs.readFileSync(harnessCompiler, "utf8"), native)
  assert.ok(fs.statSync(harnessCompiler).mode & 0o100, "the harness's compiler is executable")
  assert.match(result.stdout, /build-vibelang: .*typescript\/built\/local\/tsc$/m)
})

test("build-vibelang.sh replaces a link at the harness's path instead of writing through it", (t) => {
  const temp = fixture(t)
  const elsewhere = path.join(temp, "elsewhere-tsc")
  fs.writeFileSync(elsewhere, "another checkout's compiler\n")
  fs.mkdirSync(path.join(temp, "typescript/built/local"), { recursive: true })
  fs.symlinkSync(elsewhere, path.join(temp, "typescript/built/local/tsc"))
  const result = build(temp)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const harnessCompiler = path.join(temp, "typescript/built/local/tsc")
  assert.ok(!fs.lstatSync(harnessCompiler).isSymbolicLink(), "a regular file, the graph's declared output")
  assert.equal(fs.readFileSync(harnessCompiler, "utf8"), fs.readFileSync(path.join(temp, "packages/compiler/native/vibelang"), "utf8"))
  assert.equal(fs.readFileSync(elsewhere, "utf8"), "another checkout's compiler\n")
})

test("the grammar census runs before Effect generation and compiler installation", t => {
  const temp = fixture(t)
  effectDeclarations(temp)
  const result = build(temp)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const trace = calls(temp)
  assert.deepEqual(trace.map(call => call.verb), ["env", "env", "test", "run", "build"])
  assert.match(trace[2].args, /-count=1/)
  assert.match(trace[2].args, /-p 8/)
  assert.match(trace[2].args, /-run \^TestTableAccountsForEveryHook\$/)
  assert.match(trace[2].args, /\.\/internal\/vibelangfuzz\/grammaradmission\/$/)
  assert.match(trace[3].args, /internal\/effectglobals\/gen/)
  assert.match(result.stdout, /build-vibelang: checking grammar admission/)
})

for (const status of [1, 2, 17]) {
  test("a failed grammar census preserves existing outputs and its exit status: " + status, t => {
    const temp = fixture(t)
    effectDeclarations(temp)
    const native = path.join(temp, "packages/compiler/native/vibelang")
    const harness = path.join(temp, "typescript/built/local/tsc")
    const manifest = path.join(temp, "packages/compiler/dprint-plugin.json")
    for (const file of [native, harness, manifest]) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, "previous output\n")
    }
    const result = build(temp, { GRAMMAR_STATUS: String(status) })
    assert.equal(result.status, status, result.stdout + result.stderr)
    assert.match(result.stderr, /fixture grammar census/)
    assert.deepEqual(calls(temp).map(call => call.verb), ["env", "env", "test"])
    for (const file of [native, harness, manifest]) assert.equal(fs.readFileSync(file, "utf8"), "previous output\n")
  })
}

for (const [os, arch] of [["windows", "amd64"], ["linux", "arm64"], ["darwin", "arm64"]]) {
  test("the census uses the host while the compiler retains its target: " + os + "/" + arch, t => {
    const temp = fixture(t)
    const result = build(temp, { GOOS: os, GOARCH: arch })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const trace = calls(temp)
    assert.deepEqual(trace.map(call => call.verb), ["env", "env", "test", "build"])
    assert.equal(trace[2].os, "linux")
    assert.equal(trace[2].arch, "amd64")
    assert.equal(trace[3].os, os)
    assert.equal(trace[3].arch, arch)
  })
}

test("the preflight also precedes an alternate compiler command", t => {
  const temp = fixture(t)
  fs.mkdirSync(path.join(temp, "typescript/tsc/cmd/vibelang"))
  const result = build(temp)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const trace = calls(temp)
  assert.deepEqual(trace.map(call => call.verb), ["env", "env", "test", "build"])
  assert.match(trace[3].args, /\.\/cmd\/vibelang$/)
})

test("build-vibelang.sh regenerates the compiler's projection prelude from the mapper's", t => {
  const temp = fixture(t)
  const run = build(temp)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(
    fs.readFileSync(path.join(temp, "packages/compiler/prelude.d.ts"), "utf8"),
    "// Generated by scripts/generate-projection-prelude.mjs from packages/ts-mapper/prelude.d.ts. Do not edit.\n" +
      'declare module "vibelang/prelude" { export type Fixture = 1 }\n',
  )
})
