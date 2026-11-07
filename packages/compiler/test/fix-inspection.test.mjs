import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
function inspect(args, project) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-fix-inspect-"))
  try {
    if (project) {
      writeFileSync(join(root, "tsconfig.json"), '{ "compilerOptions": { "notACompilerOption": true }, "files": ["main.vibe"] }\n')
      writeFileSync(join(root, "main.vibe"), "export type Held = Effect.Effect<number>\n")
    }
    const before = Object.fromEntries(readdirSync(root).map(name => [name, readFileSync(join(root, name), "utf8")]))
    const run = spawnSync(native, args, { cwd: root, encoding: "utf8", timeout: 20000 })
    assert.equal(run.status, 0, JSON.stringify(args) + "\n" + run.stdout + run.stderr)
    assert.equal(run.stderr, "")
    assert.match(run.stdout, args.some(arg => /^--?v(ersion)?$/i.test(arg)) ? /VibeLang/ : /--fix/)
    const after = Object.fromEntries(readdirSync(root).map(name => [name, readFileSync(join(root, name), "utf8")]))
    assert.deepEqual(after, before, "inspection must not repair source or configuration")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
for (const flag of ["--help", "-h", "-?", "--all", "--version", "-v"]) {
  for (const project of [false, true]) {
    test("--fix " + flag + (project ? " ignores an invalid project without writing" : " works outside a project"), () => {
      inspect(["--fix", flag], project)
      inspect([flag, "--fix"], project)
    })
  }
}

test("help and version retain compiler option parsing rather than matching raw arguments", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-fix-option-value-"))
  try {
    const run = spawnSync(native, ["--fix", "--project", "--help"], { cwd: root, encoding: "utf8", timeout: 20000 })
    assert.notEqual(run.status, 0)
    assert.doesNotMatch(run.stdout, /COMMON COMMANDS/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test("configuration inspection and initialization do not repair existing source", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-fix-config-inspect-"))
  try {
    writeFileSync(join(root, "tsconfig.json"), '{ "compilerOptions": { "types": [] }, "files": ["main.vibe"] }\n')
    const source = "export type Held = Effect.Effect<number>\n"
    writeFileSync(join(root, "main.vibe"), source)
    const original = readFileSync(join(root, "tsconfig.json"), "utf8")
    for (const flag of ["--showConfig", "--init"]) {
      const run = spawnSync(native, ["--fix", flag], { cwd: root, encoding: "utf8", timeout: 20000 })
      assert.equal(run.status, 0, run.stdout + run.stderr)
      if (flag === "--showConfig") assert.deepEqual(JSON.parse(run.stdout).files, ["./main.vibe"])
      else assert.match(run.stdout, /TS5054/)
      assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), source)
      assert.equal(readFileSync(join(root, "tsconfig.json"), "utf8"), original)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

