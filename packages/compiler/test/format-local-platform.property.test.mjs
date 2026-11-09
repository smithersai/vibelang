import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const compiler = fileURLToPath(new URL("../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(compiler, "native", process.platform === "win32" ? "vibelang.exe" : "vibelang")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-local-platform-format.json", import.meta.url), "utf8"))
const platforms = { "linux-x64": "linux-x86_64", "linux-arm64": "linux-aarch64", "darwin-x64": "darwin-x86_64", "darwin-arm64": "darwin-aarch64", "win32-x64": "windows-x86_64", "win32-arm64": "windows-aarch64" }
const target = process.platform + "-" + process.arch
const name = process.platform === "win32" ? "@smthrs/cli-" + target : "vibelang-" + target

function witness({ directory, value, entry, readOnly }) {
  assert.ok(existsSync(binary), "build the native compiler before testing local platform formatting")
  const root = mkdtempSync(join(tmpdir(), "vibelang-local-format-"))
  const pkg = join(root, directory, "node_modules/vibelang")
  try {
    mkdirSync(join(pkg, "bin"), { recursive: true })
    for (const file of readdirSync(compiler)) {
      if (file.endsWith(".mjs") || file === "package.json") copyFileSync(join(compiler, file), join(pkg, file))
    }
    copyFileSync(join(compiler, "bin/vibelang-format"), join(pkg, "bin/vibelang-format"))
    const modules = join(pkg, "node_modules")
    mkdirSync(modules, { recursive: true })
    for (const dependency of ["dprint", "prettier"]) symlinkSync(join(compiler, "node_modules", dependency), join(modules, dependency), "junction")
    const platform = join(modules, name)
    mkdirSync(join(platform, "bin"), { recursive: true })
    writeFileSync(join(platform, "package.json"), JSON.stringify({ name, version: "0.0.0-local-format-test" }))
    const executable = "vibelang" + (process.platform === "win32" ? ".exe" : "")
    copyFileSync(binary, join(platform, "bin", executable))
    // The registry version deliberately does not exist; the installed native
    // package must suffice, without changing the immutable shipped descriptor.
    const manifest = JSON.stringify({ schemaVersion: 2, kind: "process", name: "dprint-plugin-vibelang", version: "0.0.0-local-format-test",
      [platforms[target]]: { reference: "npm:" + name + "@0.0.0-local-format-test/bin/" + executable, checksum: "0".repeat(64) } })
    writeFileSync(join(pkg, "dprint-plugin.json"), manifest)
    if (readOnly) chmodSync(pkg, 0o555)
    const input = "export   const   value=" + value + ";\n"
    const file = join(root, "buffer.vibe")
    const module = pathToFileURL(join(pkg, "format.mjs")).href
    const script = entry === "prettier"
      ? "import prettier from " + JSON.stringify(pathToFileURL(join(modules, "prettier/index.mjs")).href) + "; import * as plugin from " + JSON.stringify(pathToFileURL(join(pkg, "prettier.mjs")).href) + "; process.stdout.write(await prettier.format(" + JSON.stringify(input) + ", {filepath:" + JSON.stringify(file) + ", plugins:[plugin]}))"
      : "import {formatSource} from " + JSON.stringify(module) + "; const result = formatSource(" + JSON.stringify(input) + ", " + JSON.stringify(file) + "); if (formatSource(result, " + JSON.stringify(file) + ") !== result) throw new Error(\"Formatting is not idempotent\"); process.stdout.write(result)"
    if (entry === "cli") writeFileSync(file, input)
    const result = spawnSync(process.execPath, entry === "cli" ? [join(pkg, "bin/vibelang-format"), "--write", file] : ["--input-type=module", "-e", script], {
      cwd: root, encoding: "utf8", timeout: 60000,
      env: { ...process.env, VIBELANG_BINARY: "", VIBELANG_DISABLE_CACHE: "1", DPRINT_CACHE_DIR: process.env.DPRINT_CACHE_DIR || join(root, "dprint-cache") }
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(entry === "cli" ? readFileSync(file, "utf8") : result.stdout, "export const value = " + value + "\n")
    assert.equal(readFileSync(join(pkg, "dprint-plugin.json"), "utf8"), manifest)
    assert.ok(!existsSync(join(pkg, "native")), "formatting must not write inside the installed package")
  } finally {
    if (existsSync(pkg)) chmodSync(pkg, 0o755)
    rmSync(root, { recursive: true, force: true })
  }
}

test("formatting uses an installed unpublished native package", () => witness(corpus))
test("local native formatting preserves text across package layouts and entrypoints", () => {
  fc.assert(fc.property(fc.record({
    directory: fc.constantFrom("app", "with spaces", "nested/app", "unicode-é"),
    value: fc.integer({ min: -1000, max: 1000 }),
    entry: fc.constantFrom("buffer", "prettier", "cli"), readOnly: fc.boolean()
  }), witness), { seed: 20261109, numRuns: 12 })
})
