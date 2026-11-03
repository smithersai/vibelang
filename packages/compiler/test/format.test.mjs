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

// An explicit buffer is still source when its path is excluded from file discovery.
test("text formatting processes ignored paths and reports their syntax errors", () => {
  const dir = repository({ ".gitignore": "generated/\n.cache/\nnode_modules/\n" })
  try {
    for (const folder of ["generated", ".cache", "node_modules"]) {
      const file = join(dir, folder, "pkg", "buffer.vibe")
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, "export const stored = 99\n")
      assert.equal(formatSource("export   const   value=1;\n", file), "export const value = 1\n")
      assert.throws(() => formatSource("const broken = ;", file), /broken|Unexpected|Expression/)
      assert.equal(readFileSync(file, "utf8"), "export const stored = 99\n")
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("explicit text formatting preserves content across ignored-path and whitespace mutations", async () => {
  const { default: fc } = await import("fast-check")
  const dir = repository({ ".gitignore": "generated/\n.cache/\nnode_modules/\n" })
  try {
    fc.assert(fc.property(
      fc.constantFrom("generated", ".cache", "node_modules"),
      fc.integer({ min: -10000, max: 10000 }),
      fc.integer({ min: 1, max: 8 }),
      (folder, value, spaces) => {
        const file = join(dir, folder, "pkg", "mutation.vibe")
        const input = "export" + " ".repeat(spaces) + "const   value=" + value + ";\n"
        assert.equal(formatSource(input, file), "export const value = " + value + "\n")
      }
    ), { numRuns: 24 })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("formatter file discovery respects ignored paths", () => {
  const input = "export   const   value=1;\n"
  const dir = repository({ ".gitignore": "generated/\n", "generated/ignored.vibe": input, "visible.vibe": input })
  try {
    const result = spawnSync(process.execPath, [cli, "--write"], { cwd: dir, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(readFileSync(join(dir, "visible.vibe"), "utf8"), "export const value = 1\n")
    assert.equal(readFileSync(join(dir, "generated/ignored.vibe"), "utf8"), input)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("formatting preserves pattern expressions throughout for heads", () => {
  for (const head of [
    "src is let n; n > 0; n--",
    "; it.next() is { done: false, value: let n }; ",
    "; it.next() /* subject */ is /* pattern */ { done: false, value: let n }; ",
    "; it.next() /* iteration */ is {\n  done: false,\n  value: let n\n}; ",
    "src /* subject */ is let n; n > 0; n--",
    "; ok; src is let n",
    "const ok = src is let n; ok; ",
    "const item of (src is let n) ? items : []",
    "const item in (src is let n) ? object : {}",
  ]) {
    const source = `function f(src, it) { for (${head}) out.push(() => n) }\n`
    for (const lineWidth of [40, 120]) {
      const style = { quoteStyle: "alwaysDouble", lineWidth }
      let once
      try { once = formatSource(source, "for-head.vibe", style) }
      catch (error) { throw new Error(`head ${head}, width ${lineWidth}: ${error.message}`, { cause: error }) }
      assert.match(once, /\bis\b/)
      for (const comment of source.match(/\/\*[\s\S]*?\*\//g) ?? []) assert.ok(once.includes(comment))
      assert.equal(formatSource(once, "for-head.vibe", style), once)
    }
  }
})

test("an is projection keeps a fitting line within the configured print width", () => {
  const source = "const matched = subject is let value\n"
  assert.equal(formatSource(source, "is-width.vibe", {
    quoteStyle: "alwaysDouble", lineWidth: source.trimEnd().length,
  }), source)
})

import { vibexSource } from "./vibex-format-fixture.mjs"
import fc from "fast-check"

test("formatSource and CLI discover .vibex and preserve TSX", () => {
  const formatted = formatSource(vibexSource, "view.vibex")
  assert.match(formatted, /<T,>/)
  assert.match(formatted, /\/\* c \*\//)
  assert.match(formatted, /&amp;/)
  assert.equal(formatSource(formatted, "view.vibex"), formatted)
  const dir = repository({ "view.vibex": vibexSource })
  try {
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8" })
    assert.equal(run("--check").status, 1)
    const write = run("--write")
    assert.equal(write.status, 0, write.stderr)
    assert.equal(readFileSync(join(dir, "view.vibex"), "utf8"), formatted)
    assert.equal(run("--check").status, 0)
    assert.equal(run("--check", "*.vibex").status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// VIP-39: "Tag names, attribute names, attribute strings and JSX text are JSX's alone."
// Vary nesting, names, text, entities and VibeLang expression containers together.
test("VIP-39 .vibex formatting property preserves JSX text and is idempotent", () => {
  fc.assert(fc.property(
    fc.constantFrom("div", "Box", "UI.Box", "svg:path", "effect"),
    fc.constantFrom("Hello  50%!", "A &amp; B", "|&gt; % !", "// text"),
    fc.integer({ min: 0, max: 100 }),
    fc.boolean(),
    (tag, text, n, fragment) => {
      const element = `<${tag} title="{try p} %">\n${text}{/* kept */}{${n} |> String(%)}\n</${tag}>`
      const source = `const id=${n % 2 ? "effect " : ""}<T,>(x:T)=>x\nconst el=${fragment ? "<>" + element + "</>" : element}\n`
      const once = formatSource(source, "property.vibex")
      assert.ok(once.includes("const id ="), "formatter skipped the .vibex buffer")
      assert.ok(once.includes(text), once)
      assert.ok(once.includes("/* kept */"), once)
      assert.ok(once.includes('title="{try p} %"'), once)
      assert.ok(once.includes("<T,>"), once)
      assert.equal(formatSource(once, "property.vibex"), once)
    }), { numRuns: 40, seed: 39 })
})

test("VIP-39 formatter property quote remains in the accepted proposal", () => {
  const vip = readFileSync(new URL("../../../docs/design/vips/0039-vibex.md", import.meta.url), "utf8")
  assert.ok(vip.includes("Tag names, attribute names, attribute strings and JSX text are JSX's alone."))
})
