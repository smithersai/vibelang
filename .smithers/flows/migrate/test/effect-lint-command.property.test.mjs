import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { test } from "node:test"
import { addEffectLint } from "../lib/wire.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const binary = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const config = JSON.stringify({ compilerOptions: { strict: true, types: [], target: "ES2022" }, vibe: { effectGlobals: false, effectModules: false }, files: ["main.vibe"] })
const readConfig = () => '{"rules":{"effecttsgo/floating-effect":"error"}}'
const projects = [{ dir: "packages/a", tsconfig: "tsconfig.json" }, { dir: "packages/b", tsconfig: "tsconfig.json" }]
const native = command => command.split(" && ").filter(part => part.startsWith("vibelang lint"))
const run = (root, command) => spawnSync(command.replace(/^vibelang/, "'" + binary.replaceAll("'", "'\\''") + "'"), { cwd: root, shell: true, encoding: "utf8", timeout: 30000 })

test("generated Effect lint commands run through the compiler CLI and retain project options", t => {
  const root = mkdtempSync(join(tmpdir(), "migrate-effect-lint-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ["packages/a", "packages/b"]) {
    mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, dir, "tsconfig.json"), config)
    writeFileSync(join(root, dir, "main.vibe"), "export const value: number = 1\n")
  }
  const command = addEffectLint({ lint: "oxlint -c lint.json --deny-warnings packages/a" }, readConfig, projects).lint
  const commands = native(command)
  assert.equal(commands.length, 1)
  const result = run(root, commands[0])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  writeFileSync(join(root, "packages/a/main.vibe"), 'export const value: number = "bad"\n')
  const rejected = run(root, commands[0])
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stdout + rejected.stderr, /TS2322/)
  assert.doesNotMatch(rejected.stdout + rejected.stderr, /TS5023/)
  const other = addEffectLint({ lint: "oxlint --tsconfig packages/b/tsconfig.json packages" }, readConfig, projects).lint
  assert.equal(native(other).length, 1)
  const clean = run(root, native(other)[0])
  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
})

test("setup repairs legacy Effect lint segments in grouped scripts and is idempotent", () => {
  const old = JSON.parse(readFileSync(new URL("./corpus/alchemy-effect-lint-command.json", import.meta.url), "utf8")).script
  const fixed = addEffectLint({ lint: old }, readConfig, projects)
  assert.doesNotMatch(fixed.lint, /vibelang lint -c|vibelang lint --deny-warnings/)
  assert.match(fixed.lint, /vibelang lint -p packages\/a\/tsconfig.json/)
  assert.equal(fixed.lint.match(/vibelang lint/g).length, 1)
  assert.deepEqual(addEffectLint(fixed, readConfig, projects), fixed)
  const authored = { lint: "oxlint -c lint.json && vibelang lint --project custom.json" }
  assert.deepEqual(addEffectLint(authored, readConfig, projects), authored)
})

test("property: Oxlint options stay on Oxlint while project selection stays on Effect lint", () => {
  fc.assert(fc.property(fc.constantFrom("-c lint.json", "--config lint.json", "--config=lint.json"),
    fc.boolean(), fc.constantFrom("packages/a", "packages/b", "packages"), (flag, deny, scope) => {
      const original = "oxlint " + flag + (deny ? " --deny-warnings" : "") + " " + scope
      const once = addEffectLint({ lint: original }, readConfig, projects)
      assert.ok(once.lint.startsWith(original + " && "))
      const commands = native(once.lint)
      assert.equal(commands.length, scope === "packages" ? 2 : 1)
      for (const command of commands) {
        assert.match(command, /^vibelang lint -p packages\/[ab]\/tsconfig.json$/)
        assert.doesNotMatch(command, /--deny-warnings|-c |lint.json/)
      }
      assert.deepEqual(addEffectLint(once, readConfig, projects), once)
    }), { numRuns: 64 })
})
