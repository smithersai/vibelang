import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { typescriptPlugin } from "../format.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const require = createRequire(import.meta.url)
// Use the released package layout: the process manifest refers to an npm
// platform package, rather than the local zip a checkout build generates.
function project() {
  const dir = mkdtempSync(join(tmpdir(), "vibe-format-npm-"))
  const pkg = join(dir, "node_modules", "vibelang")
  mkdirSync(join(pkg, "bin"), { recursive: true })
  for (const name of readdirSync(root).filter(name => name.endsWith(".mjs"))) copyFileSync(join(root, name), join(pkg, name))
  for (const name of ["vibelang", "vibelang-format"]) copyFileSync(join(root, "bin", name), join(pkg, "bin", name))
  copyFileSync(join(root, "package.json"), join(pkg, "package.json"))
  copyFileSync(join(root, "test", "fixtures", "npm-dprint-plugin.json"), join(pkg, "dprint-plugin.json"))
  symlinkSync(dirname(require.resolve("dprint/package.json")), join(dir, "node_modules", "dprint"), "junction")
  writeFileSync(join(dir, "dprint.json"), JSON.stringify({
    plugins: [typescriptPlugin, "npm:vibelang/dprint-plugin.json"],
    typescript: { semiColons: "asi", quoteStyle: "alwaysDouble" },
  }))
  const previousCache = process.env.DPRINT_CACHE_DIR
  process.env.DPRINT_CACHE_DIR = join(dir, "dprint-cache")
  return { dir, pkg, cleanup() {
    if (previousCache === undefined) delete process.env.DPRINT_CACHE_DIR
    else process.env.DPRINT_CACHE_DIR = previousCache
    rmSync(dir, { recursive: true, force: true })
  } }
}
const run = (dir, cli, ...args) => spawnSync(process.execPath, [cli, ...args], {
  cwd: dir, encoding: "utf8", env: { ...process.env, VIBELANG_DISABLE_CACHE: "1" },
})

test("the formatter companion and Prettier resolve npm platform references like dprint", async () => {
  const { dir, pkg, cleanup } = project()
  const file = join(dir, "example.vibe")
  const source = "// retained\nexport   const message='hello';\n"
  try {
    writeFileSync(file, source)
    const expected = '// retained\nexport const message = "hello"\n'
    const cli = join(pkg, "bin", "vibelang-format")
    assert.equal(run(dir, cli, "--check", file).status, 1)
    assert.equal(readFileSync(file, "utf8"), source)
    const written = run(dir, cli, "--write", file)
    assert.equal(written.status, 0, written.stderr)
    assert.equal(readFileSync(file, "utf8"), expected)
    assert.equal(run(dir, cli, "--check", file).status, 0)
    const prettier = await import("prettier")
    const plugin = await import(pathToFileURL(join(pkg, "prettier.mjs")).href)
    assert.equal(await prettier.format(source, { filepath: file, plugins: [plugin], printWidth: 120 }), expected)
    writeFileSync(file, source)
    const control = run(dir, require.resolve("dprint/bin.cjs"), "fmt")
    assert.equal(control.status, 0, control.stderr)
    assert.equal(readFileSync(file, "utf8"), expected)
  } finally { cleanup() }
})

test("npm plugin formatting preserves comments and reaches a fixed point across text mutations", async () => {
  const { dir, pkg, cleanup } = project()
  try {
    const { formatSource } = await import(pathToFileURL(join(pkg, "format.mjs")).href)
    fc.assert(fc.property(
      fc.integer({ min: -10000, max: 10000 }), fc.integer({ min: 1, max: 8 }),
      fc.constantFrom("alwaysDouble", "alwaysSingle"), fc.integer({ min: 40, max: 120 }),
      (value, spaces, quoteStyle, lineWidth) => {
        const text = "// retained\nexport" + " ".repeat(spaces) + "const message={value:" + value + ",text:'hello'};\n"
        const style = { quoteStyle, lineWidth }
        const formatted = formatSource(text, join(dir, "buffer.vibe"), style)
        assert.match(formatted, /^\/\/ retained\n/)
        assert.match(formatted, new RegExp("value: " + value + "\\b"))
        assert.equal(formatSource(formatted, join(dir, "buffer.vibe"), style), formatted)
      },
    ), { numRuns: 20 })
  } finally { cleanup() }
})
