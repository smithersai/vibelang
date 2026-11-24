import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { casesIn } from "./cases.mjs"
import { buildPrompt, exampleCases } from "./build-prompt.mjs"
import { heldoutProblems, normalizeSource } from "./check-heldout.mjs"

const hero = {
  name: "01-hero",
  input: 'import { Effect } from "effect"\nexport const answer = Effect.succeed(19)',
  expected: 'export function answer() { return 19 }'
}
const unrelated = {
  name: "01-separate",
  input: 'import { Effect } from "effect"\nexport const size = Effect.succeed(73)',
  expected: 'export function size() { return 73 }'
}
const check = (examples, prompt = "", golden = [hero]) => heldoutProblems({ golden, examples, prompt })
const fenced = (source) => `# Prompt\n\n\`\`\`ts\n${source}\n\`\`\`\n`

test("normalization ignores whitespace and line and block comments", () => {
  assert.equal(normalizeSource('const a = 1; // end\nreturn a'), normalizeSource('/* top */const\ta=1;return/* gap */a'))
})

test("normalization keeps token boundaries and multi-character operators", () => {
  assert.notEqual(normalizeSource('a b'), normalizeSource('ab'))
  assert.notEqual(normalizeSource('a + +b'), normalizeSource('a++b'))
})

test("normalization preserves spaces and comment markers in strings", () => {
  assert.notEqual(normalizeSource('return "a b"'), normalizeSource('return "ab"'))
  assert.notEqual(normalizeSource('return "https://host/* path */"'), normalizeSource('return "https:"'))
  assert.equal(normalizeSource("return 'it\\'s // text' // end"), normalizeSource("return 'it\\'s // text'"))
})

test("normalization handles nested template interpolations and their comments", () => {
  assert.equal(normalizeSource('`hello ${ /* x */ {n: 1}.n + `inner ${x}` }`'), normalizeSource('`hello ${{n:1}.n+`inner ${ x }`}`'))
  assert.notEqual(normalizeSource('`hello ${x}`'), normalizeSource('`hello${x}`'))
})

test("normalization preserves regex literals, escaped slashes and character classes", () => {
  assert.equal(normalizeSource('const r = /[/*]https?:\\/\\//g; // end'), normalizeSource('const r=/[/*]https?:\\/\\//g;'))
  assert.notEqual(normalizeSource('return /a b/'), normalizeSource('return /ab/'))
})

test("separate pairs and prompt sources pass", () => {
  assert.deepEqual(check([unrelated], fenced(unrelated.input) + fenced(unrelated.expected)), [])
})

for (const [file, field] of [["input.ts", "input"], ["expected.vibe", "expected"]]) {
  test(`a renamed example cannot reuse a golden ${file}`, () => {
    const problems = check([{ ...unrelated, name: "renamed", [field]: `/* copied */\n${hero[field]} // disguised` }])
    assert.equal(problems.length, 1)
    assert.match(problems[0], new RegExp(`examples/renamed/${file.replace('.', '\\.')}`))
    assert.match(problems[0], /golden\/01-hero/)
  })
  test(`prompt.md cannot embed a golden ${file} inside a longer code block`, () => {
    const disguised = hero[field].replaceAll(' ', '\t/* hidden */\n')
    // Do not rewrite whitespace inside the input's string literal.
    const source = field === "input" ? hero.input.replace('{ Effect }', '{/* import */Effect}').replace('answer =', 'answer\n=') : disguised
    const problems = check([unrelated], fenced(`// introduction\nconst before = 0;\n${source}\nconst after = 1;`))
    assert(problems.some((p) => p.startsWith("prompt.md overlaps")))
  })
}

test("the hero's output is held out even if placed in an example input", () => {
  assert.equal(check([{ ...unrelated, input: hero.expected }]).length, 1)
})

test("all gate cases are held out, including the last case", () => {
  assert(check([unrelated], fenced(unrelated.expected), [hero, { ...unrelated, name: "20-last" }]).some((p) => p.includes("golden/20-last/expected.vibe")))
})

test("tilde fences, longer fences, CRLF and unfenced source are checked", () => {
  for (const prompt of [`~~~ts\r\n${hero.expected}\r\n~~~`, `\`\`\`\`vibe\n${hero.expected}\n\`\`\`\``, hero.expected]) {
    assert.equal(check([], prompt).length, 1)
  }
})

test("empty golden sources fail closed", () => {
  assert.throws(() => check([], "", [{ ...hero, input: "// empty" }]), /no source tokens/)
})

test("the generated prompt contains the 10 separate examples and no gate source", () => {
  assert.equal(exampleCases().length, 10)
  assert.deepEqual(heldoutProblems({ prompt: buildPrompt() }), [])
  assert.match(buildPrompt(), /from instructions\/app.md and examples\//)
})

test("the check exits nonzero for normalized overlap on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-heldout-"))
  try {
    for (const file of ["check-heldout.mjs", "cases.mjs"]) cpSync(new URL(file, import.meta.url), join(dir, file))
    for (const [suite, entry] of [["golden", hero], ["examples", unrelated]]) {
      const pair = join(dir, suite, entry.name)
      mkdirSync(pair, { recursive: true })
      writeFileSync(join(pair, "input.ts"), entry.input)
      writeFileSync(join(pair, "expected.vibe"), entry.expected)
    }
    writeFileSync(join(dir, "prompt.md"), fenced(unrelated.input))
    const run = () => spawnSync(process.execPath, [join(dir, "check-heldout.mjs")], { encoding: "utf8" })
    assert.equal(run().status, 0)
    writeFileSync(join(dir, "examples", unrelated.name, "expected.vibe"), hero.expected.replace('return 19', 'return /* leak */\n19'))
    const result = run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /overlaps held-out golden\/01-hero\/expected.vibe/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("every real gate input and output, including the hero, is rejected under a new name", () => {
  const golden = casesIn(fileURLToPath(new URL("golden/", import.meta.url)))
  assert.equal(golden.length, 20)
  for (const entry of golden) {
    for (const field of ["input", "expected"]) {
      const source = `// copied under another name\n${entry[field]}\n/* trailing comment */`
      const problems = heldoutProblems({ golden, examples: [{ ...unrelated, name: "renamed", [field]: source }], prompt: "" })
      assert(problems.some((p) => p.includes(`golden/${entry.name}/`)), `${entry.name}/${field} must remain held out`)
    }
  }
})

test("building the prompt does not need or read golden/", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-prompt-"))
  try {
    const flow = join(dir, ".smithers/flows/convert")
    const instructions = join(dir, ".smithers/instructions")
    mkdirSync(flow, { recursive: true })
    mkdirSync(instructions, { recursive: true })
    for (const file of ["build-prompt.mjs", "cases.mjs"]) cpSync(new URL(file, import.meta.url), join(flow, file))
    const example = join(flow, "examples", unrelated.name)
    mkdirSync(example, { recursive: true })
    writeFileSync(join(example, "input.ts"), unrelated.input)
    writeFileSync(join(example, "expected.vibe"), unrelated.expected)
    writeFileSync(join(instructions, "app.md"), "## Syntax cheat sheet\n\nSeparate forms\n\n## Next\n")
    const alias = join(dir, "linked-flow")
    symlinkSync(flow, alias, "junction")
    const script = join(alias, "build-prompt.mjs")
    const prompt = join(flow, "prompt.md")
    writeFileSync(prompt, "stale")
    const stale = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" })
    assert.equal(stale.status, 1, stale.stderr)
    assert.match(stale.stderr, /prompt\.md is stale/)

    const result = spawnSync(process.execPath, [script], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    const generated = readFileSync(prompt, "utf8")
    assert.match(generated, /Separate forms/)
    assert.ok(generated.includes(unrelated.expected))

    const current = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" })
    assert.equal(current.status, 0, current.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
