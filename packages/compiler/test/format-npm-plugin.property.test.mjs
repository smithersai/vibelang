import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const compiler = fileURLToPath(new URL("../", import.meta.url))
const manifest = fileURLToPath(new URL("./format-plugin-regressions/npm-process-manifest.json", import.meta.url))

// The immutable published manifest exercises npm process references rather than
// the relative zip references produced by a development build.
function project(input, action) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-npm-format-"))
  try {
    const installed = join(root, input.directory, "node_modules", "vibelang")
    mkdirSync(installed, { recursive: true })
    for (const file of readdirSync(compiler)) {
      if (file.endsWith(".mjs") || file === "package.json") copyFileSync(join(compiler, file), join(installed, file))
    }
    copyFileSync(manifest, join(installed, "dprint-plugin.json"))
    symlinkSync(join(compiler, "node_modules"), join(installed, "node_modules"), process.platform === "win32" ? "junction" : "dir")
    const source = `export   const   value=${input.value};\n`
    const file = join(root, "unsaved.vibe")
    writeFileSync(file, "export const stored = 0\n")
    const module = pathToFileURL(join(installed, "format.mjs")).href
    const script = `import { formatSource } from ${JSON.stringify(module)};\n${action ?? `process.stdout.write(formatSource(${JSON.stringify(source)}, ${JSON.stringify(file)}))`}`
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env, NO_COLOR: "1" }
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("an installed npm process plugin formats an unsaved editor buffer", () => {
  assert.equal(project({ directory: "app", value: 42 }), "export const value = 42\n")
})

test("npm plugin resolution is independent of the package directory and source value", () => {
  fc.assert(fc.property(fc.record({
    directory: fc.constantFrom("project", "app with spaces", "nested/project", "project-é"),
    value: fc.integer({ min: -100000, max: 100000 })
  }), (input) => {
    assert.equal(project(input), `export const value = ${input.value}\n`)
  }), { seed: 110702, numRuns: 20 })
})

test("an npm process plugin reports malformed unsaved text", () => {
  const action = 'try { formatSource("export const broken = ;", "broken.vibe"); process.exit(2) } catch (error) { if (!/Expression|Unexpected/.test(error.message)) throw error; process.stdout.write("syntax error") }'
  assert.equal(project({ directory: "errors", value: 1 }, action), "syntax error")
})
