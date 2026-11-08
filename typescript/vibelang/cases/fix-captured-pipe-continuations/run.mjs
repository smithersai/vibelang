// rule-evidence: docs/design/src/007-tooling.md#fix-ownership-and-preservation
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary)
const root = mkdtempSync(join(tmpdir(), "captured-pipe-continuation-"))
try {
  symlinkSync(fileURLToPath(new URL("./node_modules", import.meta.url)), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(root, "foreign.ts"), readFileSync(new URL("./foreign.ts", import.meta.url)))
  const input = readFileSync(new URL("./input.txt", import.meta.url), "utf8")
  const config = {
    compilerOptions: { strict: true, skipLibCheck: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [], outDir: "out", declaration: true },
    files: ["native.ts"]
  }
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 120000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result
  }
  writeFileSync(join(root, "native.ts"), input)
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config))
  run(binary, ["-p", "tsconfig.json", "--pretty", "false"])
  const native = run(process.execPath, ["out/native.js"]).stdout
  assert.deepEqual(JSON.parse(native), ["build satisfies", "program satisfies", "apply satisfies", "build assertion", "program assertion", "apply assertion", "build property", "program property", "apply property", "build element", "program element", "apply element", "build binary", "program binary", "apply binary", "program binary-ok", "build conditional", "program conditional", "apply conditional", "program conditional-ok", "build unary", "program unary", "apply unary", "build argument", "program argument", "apply argument", "build parenthesized", "program parenthesized", "apply parenthesized", "build return", "program return", "apply return", "build rhs", "program rhs", "apply rhs"])
  const declaration = readFileSync(join(root, "out/native.d.ts"), "utf8")
  config.files = ["converted.vibe"]
  writeFileSync(join(root, "converted.vibe"), input)
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config))
  run(binary, ["--fix", "-p", "tsconfig.json", "--pretty", "false"])
  const fixed = readFileSync(join(root, "converted.vibe"), "utf8")
  assert.ok(!fixed.includes(".pipe("), fixed)
  assert.ok(fixed.includes("|>"), fixed)
  assert.equal(readFileSync(join(root, "out/converted.d.ts"), "utf8"), declaration)
  assert.equal(run(process.execPath, ["out/converted.js"]).stdout, native)
  run(binary, ["--fix", "-p", "tsconfig.json", "--pretty", "false"])
  assert.equal(readFileSync(join(root, "converted.vibe"), "utf8"), fixed)
  console.log("captured pipeline continuations repaired")
} finally {
  rmSync(root, { recursive: true, force: true })
}
