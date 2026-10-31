import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { formatSource } from "../format.mjs"
import * as plugin from "../prettier.mjs"
const require = createRequire(import.meta.url)
const prettier = require("prettier")
const source = 'export function work(): string!! { return sync(() => "ok") }\n'
test("Prettier infers .vibe and produces the identical native dprint result", async () => {
  const expected = formatSource(source)
  const formatted = await prettier.format(source, { filepath: "work.vibe", plugins: [plugin] })
  assert.equal(formatted, expected)
  assert.equal(await prettier.format(formatted, { filepath: "work.vibe", plugins: [plugin] }), expected)
  assert.equal(await prettier.check(source, { filepath: "work.vibe", plugins: [plugin] }), false)
  assert.equal(await prettier.check(formatted, { filepath: "work.vibe", plugins: [plugin] }), true)
})
test("syntax failures propagate through Prettier without returning formatted output", async () => {
  await assert.rejects(prettier.format("const broken = ;", { filepath: "broken.vibe", plugins: [plugin] }), /broken|Unexpected|Expression/)
})
test("the formatter companion checks .vibe, writes it, and then passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-format-cli-"))
  const cli = new URL("../bin/vibelang-format", import.meta.url).pathname
  try {
    writeFileSync(join(dir, "work.vibe"), source)
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8" })
    const check = run("--check")
    assert.equal(check.status, 1, check.stderr)
    assert.match(check.stderr, /work.vibe/)
    assert.equal(readFileSync(join(dir, "work.vibe"), "utf8"), source)
    assert.equal(run("--write").status, 0)
    assert.equal(readFileSync(join(dir, "work.vibe"), "utf8"), formatSource(source))
    assert.equal(run("--check").status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("Prettier source locations refer to the unsaved input, including when formatting changes its length", () => {
  const parser = plugin.parsers.vibelang
  const input = "export const x       =       1;\n"
  const ast = parser.parse(input, { filepath: "unsaved.vibe" })
  assert.notEqual(ast.text.length, input.length)
  assert.equal(parser.locStart(ast), 0)
  assert.equal(parser.locEnd(ast), input.length)
})

test("Prettier --debug-check ignores source locations while comparing the formatted program", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-prettier-debug-"))
  const input = "export const probe         =        1;\n"
  try {
    writeFileSync(join(dir, "probe.vibe"), input)
    const cli = join(dirname(require.resolve("prettier/package.json")), "bin/prettier.cjs")
    const result = spawnSync(process.execPath, [cli, "--plugin", fileURLToPath(new URL("../prettier.mjs", import.meta.url)), "--debug-check", "probe.vibe"], { cwd: dir, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(readFileSync(join(dir, "probe.vibe"), "utf8"), input)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("Prettier's singleQuote and printWidth decide the .vibe file's quotes and width", async () => {
  const input = 'export const greeting = "hi"\nexport const sizes = [111111, 222222, 333333, 444444, 555555, 666666, 777777, 888888, 999999, 101010]\n'
  const expected = "export const greeting = 'hi'\nexport const sizes = [\n  111111,\n  222222,\n  333333,\n  444444,\n  555555,\n  666666,\n  777777,\n  888888,\n  999999,\n  101010,\n]\n"
  assert.equal(await prettier.format(input, { filepath: "style.vibe", plugins: [plugin], singleQuote: true, printWidth: 100 }), expected)
  assert.equal(await prettier.check(expected, { filepath: "style.vibe", plugins: [plugin], singleQuote: true, printWidth: 100 }), true)
})
