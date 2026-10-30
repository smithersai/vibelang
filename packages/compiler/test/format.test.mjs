import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { formatSource } from "../format.mjs"

// A repository's sort-imports lint rule decides the order of the names in an
// import; the formatter keeps the order it is given.
test("formatting keeps the order of the names within an import and an export", () => {
  const source = 'import {\n  Order as EffectOrder,\n  type Equivalence as Equivalence_,\n  Function,\n} from "effect"\nimport { String, flow } from "effect"\nconst b = 1\nconst a = 2\nexport { b, a }\n'
  const formatted = formatSource(source, "order.vibe")
  assert.equal(formatted, 'import { Order as EffectOrder, type Equivalence as Equivalence_, Function } from "effect"\nimport { String, flow } from "effect"\nconst b = 1\nconst a = 2\nexport { b, a }\n')
  assert.equal(formatSource(formatted, "order.vibe"), formatted)
})

// A repository's formatter settings decide the quote style and print width of
// its .vibe files, as they do for its .ts files: the nearest Oxfmt, Prettier
// or dprint configuration supplies them, with that formatter's defaults for
// what it leaves out.
const cli = new URL("../bin/vibelang-format", import.meta.url).pathname
const repository = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-format-style-"))
  mkdirSync(join(dir, ".git")) // the search stops at the repository's root
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  return dir
}
// 104 columns: past Oxfmt's 100 and Prettier's 80, within dprint's 120.
const sizes = "export const sizes = [111111, 222222, 333333, 444444, 555555, 666666, 777777, 888888, 999999, 101010]\n"
const input = 'import { a } from "./a.js"\nexport const greeting = "it\'s" + a\n' + sizes
const wrapped = "export const sizes = [\n  111111,\n  222222,\n  333333,\n  444444,\n  555555,\n  666666,\n  777777,\n  888888,\n  999999,\n  101010,\n]\n"
for (const { name, files, file, expected } of [
  {
    name: "Oxfmt's singleQuote and printWidth, in JSON with comments",
    files: { ".oxfmtrc.jsonc": '{\n  // the style of the .ts files\n  "singleQuote": true,\n  "printWidth": 80,\n}\n' },
    file: "src/m.vibe",
    expected: "import { a } from './a.js'\nexport const greeting = \"it's\" + a\n" + wrapped,
  },
  {
    name: "Oxfmt's defaults: double quotes, width 100",
    files: { ".oxfmtrc.json": "{}" },
    file: "m.vibe",
    expected: 'import { a } from "./a.js"\nexport const greeting = "it\'s" + a\n' + wrapped,
  },
  {
    name: "Prettier's settings in package.json, width 80 by default",
    files: { "package.json": '{"prettier":{"singleQuote":true}}' },
    file: "lib/m.vibe",
    expected: "import { a } from './a.js'\nexport const greeting = \"it's\" + a\n" + wrapped,
  },
  {
    name: "dprint's typescript quoteStyle and lineWidth",
    files: { "dprint.json": '{"lineWidth":200,"typescript":{"quoteStyle":"alwaysSingle"}}' },
    file: "m.vibe",
    expected: "import { a } from './a.js'\nexport const greeting = 'it\\'s' + a\n" + sizes,
  },
  { name: "no configuration: double quotes, width 120", files: {}, file: "m.vibe", expected: input },
]) {
  test(`vibelang-format follows the repository: ${name}`, () => {
    const dir = repository({ ...files, [file]: input })
    try {
      const write = spawnSync(process.execPath, [cli, "--write"], { cwd: dir, encoding: "utf8" })
      assert.equal(write.status, 0, write.stderr)
      assert.equal(readFileSync(join(dir, file), "utf8"), expected)
      const check = spawnSync(process.execPath, [cli, "--check"], { cwd: dir, encoding: "utf8" })
      assert.equal(check.status, 0, check.stderr)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}

test("vibelang-format refuses a Prettier configuration it cannot read, naming the plugin that can", () => {
  const dir = repository({ ".prettierrc.yaml": "singleQuote: true\n", "m.vibe": input })
  try {
    const check = spawnSync(process.execPath, [cli, "--check"], { cwd: dir, encoding: "utf8" })
    assert.equal(check.status, 2)
    assert.match(check.stderr, /\.prettierrc\.yaml/)
    assert.match(check.stderr, /vibelang\/prettier/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// VIP-12 forbids a line break at a provider comma, and the formatter makes no
// semantic rewrite, so a long list keeps its line and its spelling.
test("formatting keeps a long provider list on one line and adds no Layer.mergeAll", () => {
  const long = "Provider".repeat(12)
  for (const head of [`${long}A, Key = { a: 1 }, ${long}B`, `Layer.mergeAll(${long}A, ${long}B)`]) {
    const source = `effect function f() {\n  provide ${head} {\n    try a()\n  }\n}\n`
    assert.equal(formatSource(source, "provide.vibe"), source)
  }
})
