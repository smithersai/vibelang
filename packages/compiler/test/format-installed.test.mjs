import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"

const compiler = fileURLToPath(new URL("../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(compiler, "native/vibelang")
const platform = { "linux-x64": "linux-x86_64", "linux-arm64": "linux-aarch64", "darwin-x64": "darwin-x86_64", "darwin-arm64": "darwin-aarch64", "win32-x64": "windows-x86_64", "win32-arm64": "windows-aarch64" }[process.platform + "-" + process.arch]
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vibelang-installed-format-"))
  const pkg = join(root, "package")
  mkdirSync(join(pkg, "bin"), { recursive: true })
  for (const entry of readdirSync(compiler, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith(".mjs") || entry.name === "package.json")) cpSync(join(compiler, entry.name), join(pkg, entry.name))
  }
  cpSync(join(compiler, "bin/vibelang"), join(pkg, "bin/vibelang"))
  symlinkSync(join(compiler, "node_modules"), join(pkg, "node_modules"), "dir")
  // Use the shipped manifest and its real platform-tarball checksums.
  // A made-up npm reference tests package integrity rather than resolution.
  const packed = spawnSync("npm", ["pack", "vibelang@latest", "--json", "--ignore-scripts", "--pack-destination", root], { cwd: root, encoding: "utf8", timeout: 60000 })
  assert.equal(packed.status, 0, packed.stdout + packed.stderr)
  const archive = JSON.parse(packed.stdout)[0].filename
  const manifest = spawnSync("tar", ["-xOf", join(root, archive), "package/dprint-plugin.json"], { encoding: "utf8", timeout: 60000 })
  assert.equal(manifest.status, 0, manifest.stderr)
  assert.ok(JSON.parse(manifest.stdout)[platform].reference.startsWith("npm:"))
  writeFileSync(join(pkg, "dprint-plugin.json"), manifest.stdout)
  return { root, pkg }
}

test("formatting an installed package resolves its shipped manifest without changing the package", () => {
  const { root, pkg } = fixture()
  try {
    const file = join(root, "main.vibe")
    const manifest = readFileSync(join(pkg, "dprint-plugin.json"), "utf8")
    writeFileSync(file, "export   const answer=42;\n")
    const env = { ...process.env, VIBELANG_BINARY: binary, VIBELANG_CACHE_DIR: join(root, "cache") }
    const run = mode => spawnSync(process.execPath, [join(pkg, "bin/vibelang"), "format", mode, file], { cwd: root, encoding: "utf8", env, timeout: 60000 })
    const check = run("--check")
    assert.equal(check.status, 1, check.stdout + check.stderr)
    assert.match(check.stderr, /needs formatting/)
    for (const mode of ["--write", "--check", "--write"]) {
      const result = run(mode)
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
    assert.equal(readFileSync(file, "utf8"), "export const answer = 42\n")
    assert.equal(readFileSync(join(pkg, "dprint-plugin.json"), "utf8"), manifest)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("installed formatting preserves style and idempotence with disabled or unusable caches", () => {
  const { root, pkg } = fixture()
  try {
    const blocked = join(root, "not-a-directory")
    writeFileSync(blocked, "preserve")
    fc.assert(fc.property(
      fc.constantFrom("disabled", "unwritable"),
      fc.boolean(),
      fc.integer({ min: 0, max: 1000 }),
      (cache, single, value) => {
        writeFileSync(join(root, ".prettierrc.json"), JSON.stringify({ singleQuote: single }))
        const file = join(root, "main.vibe")
        writeFileSync(file, "export   const answer= 'value" + value + "';\n")
        const env = { ...process.env, VIBELANG_BINARY: binary, VIBELANG_DISABLE_CACHE: cache === "disabled" ? "1" : "0", VIBELANG_CACHE_DIR: blocked }
        const run = () => spawnSync(process.execPath, [join(pkg, "bin/vibelang"), "format", "--write", file], { cwd: root, encoding: "utf8", env, timeout: 60000 })
        const first = run()
        assert.equal(first.status, 0, first.stdout + first.stderr)
        const text = readFileSync(file, "utf8")
        assert.equal(text, "export const answer = " + (single ? "'" : '"') + "value" + value + (single ? "'" : '"') + "\n")
        const second = run()
        assert.equal(second.status, 0, second.stdout + second.stderr)
        assert.equal(readFileSync(file, "utf8"), text)
        assert.equal(readFileSync(blocked, "utf8"), "preserve")
      }
    ), { numRuns: 8 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

