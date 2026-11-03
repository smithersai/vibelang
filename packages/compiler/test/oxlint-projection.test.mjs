// vibelang/oxlint: how a report on the projection reaches the source, and which
// reports never do. The CLI half mirrors vibelang --estree's contract.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { canonicalRule, printProjectedConfig, isProjectionArtifact, lineAndColumn, lintProjected, mapDiagnostic, sourceSpan, virtualConfig } from "../oxlint.mjs"

const packageDir = fileURLToPath(new URL("..", import.meta.url))
const repository = join(packageDir, "../..")
const compiler = join(packageDir, "bin/vibelang")
const projection = (file, text) => spawnSync(process.execPath, [compiler, "--ts-projection", file], { input: text, encoding: "utf8" })

function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-oxlint-test-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  symlinkSync(join(packageDir, "node_modules"), join(root, "node_modules"))
  for (const [file, text] of Object.entries({ "package.json": '{"name":"p","type":"module"}', ...files })) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}
const lint = async (t, files, config, options = {}) => {
  const root = project(t, files)
  return (await lintProjected({ config, base: root, cwd: root, compiler, ...options })).output
}
const reports = (output) => output.diagnostics.map((d) => `${d.filename}:${d.labels[0]?.span.line}:${d.labels[0]?.span.column} ${d.code ?? "parse"}`)

test("the documented command prints the projection and its span map", () => {
  for (const page of ["docs/user/src/setup/developer-tools.md", "packages/compiler/skills/vibelang/SKILL.md"]) {
    assert.match(readFileSync(join(repository, page), "utf8"), /vibelang --ts-projection src\/app\.vibe < src\/app\.vibe/, page)
  }
  const source = "export function f() {\n  return 1\n}\n"
  const result = projection("src/app.vibe", source)
  assert.equal(result.status, 0, result.stderr)
  const { text, extension, mappings } = JSON.parse(result.stdout)
  assert.equal(extension, ".ts")
  assert.match(text, /\$gen\(function\* \(\)/)
  // The source's lines keep their numbers; the prelude import comes last.
  assert.ok(text.split("\n")[0].startsWith("export function f()"), text)
  assert.match(text.trimEnd().split("\n").at(-1), /^import \{.*vibelang-ts-mapper\/prelude/)
  for (const [virtualStart, virtualLength, originalStart, originalLength, kind] of mappings) {
    if (kind === 0) assert.equal(text.slice(virtualStart, virtualStart + virtualLength), source.slice(originalStart, originalStart + originalLength))
  }
})

test("--ts-projection takes one file, as --estree does", () => {
  const result = spawnSync(process.execPath, [compiler, "--ts-projection"], { input: "", encoding: "utf8" })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /usage: vibelang --ts-projection <file>/)
})

test("a .vibex file's JSX parses, and an undecidable pipe topic lowers", () => {
  const jsx = JSON.parse(projection("a.vibex", "export const a = <div key=\"a\" />\n").stdout)
  assert.match(jsx.text, /<div key="a" \/>/)
  for (const source of ["export const a = (s: S) => f(s) |> g(%)\n", "export function m() { return try (f(1) |> g(%)) }\n", "export const a = (s: S): infer _ => f(s)\n  |> g<T>({ a: 1 })(%)\n"]) {
    const { text } = JSON.parse(projection("a.vibe", source).stdout)
    assert.doesNotMatch(text, /\|>/, source)
  }
})

test("a report on generated code is dropped and counted", async (t) => {
  const output = await lint(t, { "a.vibe": "export function f() {\n  return 1\n}\n" }, { plugins: ["eslint"], categories: { correctness: "off" }, rules: { "eslint/require-yield": "error", "eslint/no-unused-vars": "error" } })
  assert.deepEqual(output.diagnostics, [])
  assert.ok(output.dropped["eslint(require-yield)"] >= 1, JSON.stringify(output.dropped))
  assert.ok(output.dropped["eslint(no-unused-vars)"] >= 1, JSON.stringify(output.dropped))
})

test("a rule reports at the source line inside a lowered function, past multi-byte text", async (t) => {
  const source = "// é first\nerror Bad { id: string }\nexport function f(x: number) {\n  const s = \"é\"; const y = x * 0\n  return y + s.length\n}\n"
  const output = await lint(t, { "a.vibe": source }, { plugins: ["oxc"], categories: { correctness: "off" }, rules: { "oxc/erasing-op": "error" } })
  assert.deepEqual(reports(output), ["a.vibe:4:29 oxc(erasing-op)"])
  const span = output.diagnostics[0].labels[0].span
  assert.equal(Buffer.from(source).subarray(span.offset, span.offset + span.length).toString(), "x * 0")
})

test("overrides, ignorePatterns and .gitignore select as for the TypeScript twin", async (t) => {
  const bad = "export const a = 3.141\n"
  const output = await lint(t, {
    "src/on.vibe": bad,
    "src/x.test.vibe": bad,
    "src/off/a.vibe": bad,
    "ignored/a.vibe": bad,
    "built/a.vibe": bad,
    ".gitignore": "built/\n",
  }, {
    plugins: ["oxc"],
    categories: { correctness: "off" },
    rules: { "oxc/approx-constant": "error" },
    ignorePatterns: ["ignored/**"],
    overrides: [{ files: ["src/off/**", "**/*.test.vibe"], rules: { "oxc/approx-constant": "off" } }],
  })
  assert.deepEqual(reports(output), ["src/on.vibe:1:18 oxc(approx-constant)"])
})

test("disable comments apply on the source's lines", async (t) => {
  const output = await lint(t, {
    "a.vibe": "// oxlint-disable-next-line oxc/approx-constant\nexport const a = 3.141\nexport const b = 3.141 // eslint-disable-line oxc/approx-constant\nexport const c = 3.141\n/* oxlint-disable oxc/approx-constant */\nexport const d = 3.141\n",
  }, { plugins: ["oxc"], categories: { correctness: "off" }, rules: { "oxc/approx-constant": "error" } })
  assert.deepEqual(reports(output), ["a.vibe:4:18 oxc(approx-constant)"])
})

test("a real unused name and a real declaration merge still report; their projection forms do not", async (t) => {
  const config = { plugins: ["typescript"], categories: { correctness: "off" }, rules: { "eslint/no-unused-vars": "error", "typescript/no-unsafe-declaration-merging": "error" } }
  const output = await lint(t, {
    "service.vibe": "import * as Effect from \"effect/Effect\"\nimport type * as Context from \"effect/Context\"\nimport { Option,\n  Stream } from \"effect\"\nexport service Users {\n  find(id: string): string!!\n}\n",
    "real.vibe": "import { unused } from \"./service.js\"\nexport interface M { a: string }\nexport class M {}\n",
  }, config)
  assert.deepEqual(reports(output).filter((line) => line.startsWith("service")), [])
  const real = reports(output).filter((line) => line.startsWith("real")).sort()
  assert.ok(real.includes("real.vibe:1:10 eslint(no-unused-vars)"), real.join())
  assert.ok(real.some((line) => line.endsWith("typescript(no-unsafe-declaration-merging)")), real.join())
})

test("a rule another pass runs is off here, in overrides too; JS plugin rules never reach Oxlint", async (t) => {
  const config = {
    plugins: ["oxc"], jsPlugins: ["./missing-plugin.ts"], categories: { correctness: "off" },
    rules: { "oxc/approx-constant": "error", "oxc/erasing-op": "error", "house/rule": "error" },
    overrides: [{ files: ["**/*.ts"], rules: { "oxc/approx-constant": "error", "house/other": "error" } }],
  }
  const output = await lint(t, { "a.vibe": "export function f(x: number): number {\n  return 3.141 + x * 0\n}\n" }, config, { elsewhere: ["oxc/approx-constant", "house/rule"] })
  assert.deepEqual(reports(output), ["a.vibe:2:18 oxc(erasing-op)"])
})

test("printProjectedConfig shows what the pass runs", (t) => {
  const root = project(t, {})
  const printed = JSON.parse(printProjectedConfig({ base: root, elsewhere: ["oxc/approx-constant"], config: { plugins: ["oxc"], categories: { correctness: "off" }, jsPlugins: ["./gone.ts"], rules: { "oxc/approx-constant": "error", "oxc/erasing-op": "error", "house/own": "error" } } }))
  const on = Object.entries(printed.rules).filter(([, value]) => !["off", "allow"].includes([value].flat()[0])).map(([name]) => name)
  assert.deepEqual(on, ["oxc/erasing-op"])
})

test("a module with no statements stays empty for no-empty-file; a leading directive stays leading", async (t) => {
  const output = await lint(t, { "empty.vibe": "", "comment.vibe": "// nothing\n", "ref.vibe": "/// <reference path=\"./a.d.ts\" />\nexport const a = 1\n" }, { plugins: ["unicorn", "typescript"], categories: { correctness: "off" }, rules: { "unicorn/no-empty-file": "error", "typescript/triple-slash-reference": "error" } })
  assert.deepEqual(reports(output).sort(), ["comment.vibe:1:1 unicorn(no-empty-file)", "empty.vibe:1:1 unicorn(no-empty-file)", "ref.vibe:1:1 typescript(triple-slash-reference)"].sort())
})

test("a module the projection leaves unparsable is reported, never skipped in silence", () => {
  const segments = [[0, 3, 0, 3, 0]]
  const mapped = mapDiagnostic({ message: "Unexpected token", severity: "error", labels: [{ span: { offset: 100, length: 1 } }] }, segments, Buffer.from("abc"), "a.vibe")
  assert.ok(mapped, "kept")
  assert.equal(mapped.filename, "a.vibe")
})

test("a report on a pipe, a member or a cast of an effect block maps to its own line", async (t) => {
  const source = "export const a = effect {\n  return 1\n}\n  .pipe(f)\nexport const b = effect {\n  const y = 2 * 0\n  return y\n} as any!!\nexport const c = effect { return 1 } |> f(%)\n"
  const output = await lint(t, { "a.vibe": source }, { plugins: ["oxc"], categories: { correctness: "off" }, rules: { "oxc/erasing-op": "error" } })
  assert.deepEqual(reports(output), ["a.vibe:6:13 oxc(erasing-op)"])
})

test("a module the compiler cannot project is a warning on that module; the rest still lint", async (t) => {
  const root = project(t, { "good.vibe": "export const a = 3.141\n", "bad.vibe": "export const b = 3.141\n" })
  const failing = join(root, "failing-compiler.mjs")
  writeFileSync(failing, `#!/usr/bin/env node
if (process.argv[3].endsWith("bad.vibe")) { console.error("panic: nope"); process.exit(2) }
const { spawnSync } = await import("node:child_process")
const run = spawnSync(process.execPath, [${JSON.stringify(compiler)}, ...process.argv.slice(2)], { input: (await import("node:fs")).readFileSync(0), encoding: "utf8" })
process.stdout.write(run.stdout)
`)
  const { output, status } = await lintProjected({ config: { plugins: ["oxc"], categories: { correctness: "off" }, rules: { "oxc/approx-constant": "warn" } }, base: root, cwd: root, compiler: failing })
  assert.equal(status, 0)
  assert.deepEqual(reports(output), ["bad.vibe:1:1 vibelang(unprojected)", "good.vibe:1:18 oxc(approx-constant)"])
  assert.match(output.diagnostics[0].message, /the compiler failed on .*bad\.vibe: panic: nope/)
})

test("isProjectionArtifact reads the source around the span", () => {
  const artifact = (code, source, word) => isProjectionArtifact(code, Buffer.from(source), { start: source.indexOf(word), length: word.length })
  assert.equal(artifact("eslint(no-unused-vars)", 'import * as Effect from "effect/Effect"\n', "Effect"), true)
  assert.equal(artifact("eslint(no-unused-vars)", 'import { a,\n  b } from "effect"\n', "b"), true)
  assert.equal(artifact("eslint(no-unused-vars)", 'import * as Effect from "./effect.js"\n', "Effect"), false)
  assert.equal(artifact("eslint(no-unused-vars)", 'import a from "effect-extras"\n', "a"), false)
  assert.equal(artifact("eslint(no-unused-vars)", 'import a from "./a.js"\nconst Effect = 1\n', "Effect"), false)
  assert.equal(artifact("typescript(no-unsafe-declaration-merging)", "service Users {}\n", "Users"), true)
  assert.equal(artifact("typescript(no-unsafe-declaration-merging)", "interface Users {}\nclass Users {}\n", "Users"), false)
  assert.equal(artifact("eslint(no-debugger)", "debugger\n", "debugger"), false)
  assert.equal(artifact("eslint(no-unexpected-multiline)", "f()\n  try (g())\n", "(g"), true)
  assert.equal(artifact("eslint(no-unexpected-multiline)", "f()\n  (g())\n", "(g"), false)
  assert.equal(artifact("eslint(no-unused-expressions)", "  when { a: 1 }: undefined;\n", "undefined"), true)
  assert.equal(artifact("eslint(no-unused-expressions)", "  a.b;\n", "a.b"), false)
})

test("canonicalRule spells each pass's name as Oxlint does; virtualConfig retargets globs", () => {
  assert.equal(canonicalRule("no-debugger"), "eslint/no-debugger")
  assert.equal(canonicalRule("@typescript-eslint/no-this-alias"), "typescript/no-this-alias")
  assert.equal(canonicalRule("vibelang/no-unused-vars"), "eslint/no-unused-vars")
  assert.equal(canonicalRule("oxc/erasing-op"), "oxc/erasing-op")
  const config = virtualConfig({ ignorePatterns: ["**/*.vibe", "a.{vibe,vibex}"], overrides: [{ files: ["src/*.vibex"], rules: {} }], options: { reportUnusedDisableDirectives: "error" } })
  assert.deepEqual(config.ignorePatterns, ["**/*.ts", "a.{ts,tsx}"])
  assert.deepEqual(config.overrides[0].files, ["src/*.tsx"])
  assert.equal(config.options, undefined)
})

// Segments in virtual order with gaps of synthesized text between them.
const segmentsArbitrary = fc.array(fc.record({ gap: fc.nat(5), length: fc.integer({ min: 1, max: 9 }), originalGap: fc.nat(5), originalLength: fc.integer({ min: 1, max: 9 }), kind: fc.constantFrom(0, 1, 2) }), { maxLength: 8 }).map((list) => {
  let virtual = 0, original = 0
  return list.map(({ gap, length, originalGap, originalLength, kind }) => {
    virtual += gap; original += originalGap
    const size = kind === 0 ? length : originalLength
    const segment = [virtual, length, original, size, kind]
    virtual += length; original += size
    return segment
  })
})

test("sourceSpan: synthesized text has no source, a verbatim position maps exactly, a span stays in the source", () => {
  fc.assert(fc.property(segmentsArbitrary, fc.nat(80), fc.nat(12), (segments, start, length) => {
    const span = sourceSpan(segments, start, length)
    const home = segments.find(([from, size]) => start >= from && start < from + size)
    if (home === undefined) return assert.equal(span, undefined)
    assert.ok(span, "a position in a segment maps")
    const originalEnd = segments.length ? segments.at(-1)[2] + segments.at(-1)[3] : 0
    assert.ok(span.start >= home[2] && span.start <= originalEnd && span.length >= 0 && span.start + span.length <= originalEnd)
    if (home[4] === 0) assert.equal(span.start, home[2] + start - home[0])
    else assert.equal(span.start, home[2])
    if (home[4] === 0 && start + length <= home[0] + home[1]) assert.equal(span.length, length)
  }))
})

test("lineAndColumn counts lines and byte columns from a byte offset, as Oxlint does", () => {
  const source = Buffer.from("é\n  €x\n")
  assert.deepEqual(lineAndColumn(source, 0), { line: 1, column: 1 })
  assert.deepEqual(lineAndColumn(source, source.indexOf("x")), { line: 2, column: 6 })
})
