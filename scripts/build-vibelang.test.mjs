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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "build-vibelang-test-"))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  fs.mkdirSync(path.join(temp, "scripts"))
  fs.copyFileSync(script, path.join(temp, "scripts/build-vibelang.sh"))
  fs.copyFileSync(new URL("native-output.sh", import.meta.url), path.join(temp, "scripts/native-output.sh"))
  fs.mkdirSync(path.join(temp, "typescript/tsc/cmd/tsc"), { recursive: true })
  fs.mkdirSync(path.join(temp, "bin"))
  // `go build -o OUT ENTRY` writes a binary that answers --write-dprint-plugin and names its build.
  fs.writeFileSync(path.join(temp, "bin/go"), `#!/bin/sh
while [ "$1" != -o ]; do shift; done
printf '#!/bin/sh\\n# build %s\\nexit 0\\n' "$$" > "$2"
chmod +x "$2"
`, { mode: 0o755 })
  return temp
}

const build = (temp) => spawnSync("sh", [path.join(temp, "scripts/build-vibelang.sh")], {
  encoding: "utf8",
  env: { ...process.env, PATH: path.join(temp, "bin") + path.delimiter + process.env.PATH },
})

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
