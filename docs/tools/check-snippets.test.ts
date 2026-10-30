import { expect, test } from "bun:test"
import { blockFilenames, classify, defaultCompiler, extract, linkModules, markdownPages, normalizeOutput, parseDiagnostics, runBlock, writeProject } from "./check-snippets"

const block = extract('```ts\nconst answer = 42\n```')[0]
const diagnostic = (code: string, message = "example") => ({ code, message })
test("extracts vibe and ts fences, skips unnamed TypeScript examples, and preserves lines and directives", () => {
  const blocks = extract('heading\n```ts\n// TypeScript (.ts)\nconst ignored = 1\n```\n~~~vibe es\n// expect-error: EK9201 TS2322\nfunction f() {}\n~~~\n```json\n{}\n```\n```vibe\n// compiler-gap: return contract\nfunction g() {}\n```')
  expect(blocks.map(b => [b.number, b.line, b.firstLine])).toEqual([[2, 7, "function f() {}"], [3, 14, "function g() {}"]])
  expect(blocks[0].expected).toEqual(["EK9201", "TS2322"])
  expect(blocks[1].gap).toBe("return contract")
})
test("extracts Effect comparison fences and keeps explicit fragment markers", () => {
  const blocks = extract(["```ts effect", "// fragment", "const x = yield* work", "```", "```vibe es", "const x = work()", "```"].join("\n"))
  expect(blocks.map(b => [b.number, b.comparison, b.fragment])).toEqual([[1, true, true], [2, false, false]])
})

test("the fence decides the language: vibe is VibeLang, ts is TypeScript", () => {
  const blocks = extract([
    "```vibe", "const a = 1", "```",
    "```ts", "const b: number = 2", "```",
    "```vibe es", "// main.vibe", "const c = 3", "```",
    "```ts", "// TypeScript (.ts)", "// helper.ts", "export const d = 4", "```",
    "```tsx", "const e = <div />", "```"
  ].join("\n"))
  expect(blocks.map(b => [b.number, b.language, b.filename])).toEqual([[1, "vibe", undefined], [2, "ts", undefined], [3, "vibe", "main.vibe"], [4, "ts", "helper.ts"]])
  expect([...blockFilenames(blocks).values()]).toEqual(["block-1.vibe", "block-2.ts", "main.vibe", "helper.ts"])
})
test("a filename caption must name a file of its fence's language", () => {
  expect(() => extract("```ts\n// main.vibe\nconst a = 1\n```")).toThrow("A ts fence names main.vibe")
  expect(() => extract("```vibe\n// helper.ts\nconst a = 1\n```")).toThrow("A vibe fence names helper.ts")
})
test("only unresolved names and local imports are automatic fragments", () => {
  expect(classify(block, []).status).toBe("ok")
  expect(classify(block, [diagnostic("TS2304")]).status).toBe("fragment")
  expect(classify(block, [diagnostic("TS2552")]).status).toBe("fragment")
  expect(classify(block, [diagnostic("TS2307", "Cannot find module './fixture.vibe' or its corresponding type declarations.")]).status).toBe("fragment")
  expect(classify(block, [diagnostic("TS2307", "Cannot find module 'missing-package'")]).status).toBe("fail")
  expect(classify(block, [diagnostic("TS2304"), diagnostic("TS2322")]).status).toBe("fail")
})
test("expected diagnostics must occur and do not hide other errors", () => {
  const expected = { ...block, expected: ["EK9201"] }
  expect(classify(expected, []).status).toBe("fail")
  expect(classify(expected, [diagnostic("EK9201")]).status).toBe("ok")
  expect(classify(expected, [diagnostic("EK9201"), diagnostic("TS2322")]).status).toBe("fail")
})
test("explicit gaps remain checked, and stale markers fail", () => {
  const gap = { ...block, gap: "D56 program conversion" }
  expect(classify(gap, [diagnostic("TS2345")]).status).toBe("compiler-gap")
  expect(classify(gap, []).status).toBe("fail")
  expect(classify({ ...gap, expected: ["EK9201"] }, []).status).toBe("compiler-gap")
  expect(classify({ ...gap, expected: ["EK9201"] }, [diagnostic("EK9201")]).status).toBe("fail")
  expect(classify(gap, [diagnostic("TS2304")]).status).toBe("fail")
  expect(classify({ ...block, fragment: true }, [diagnostic("TS1005")]).status).toBe("fragment")
})
test("parses native ES and TS errors and ignores notes and warnings", () => {
  expect(parseDiagnostics("block-2.vibe(4,8): error EK9201: failure escapes\n  Widen the contract.\nblock-3.vibe(1,1): warning EK9204: unreachable\nerror TS18003: No inputs were found")).toEqual([
    { file: "block-2.vibe", diagnostic: { code: "EK9201", message: "failure escapes", line: 4, column: 8 } },
    { diagnostic: { code: "TS18003", message: "No inputs were found" } }
  ])
})

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { tmpdir } from "node:os"
import { hangingBlockDeadline, runSnippets, runTestLimit } from "./run-snippets"
const compiler = defaultCompiler()
test.skipIf(!existsSync(compiler))("checks shared declarations, schema type/value names, captions, and expected errors together", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-check-test-"))
  try {
    writeFileSync(join(root, "page.md"), [
      "```vibe", "// descriptor.vibe", "export const Item = Schema.Struct({ name: Schema.String })", "```",
      "```vibe", "type Item = typeof Item.Type", "function read(input: unknown) { return Schema.decodeUnknownEffect(Item)(input) }", "```",
      "```vibe", "import { Item } from './descriptor.vibe'", "const sample = { name: 'Ada' } satisfies typeof Item.Type", "```",
      "```vibe", "// expect-error: TS2322", "const invalid: number = 'text'", "```"
    ].join("\n"))
    const output = join(root, "report.json")
    const child = Bun.spawn(["bun", join(import.meta.dir, "check-snippets.ts"), "--root", root, "--compiler", relative(process.cwd(), compiler), "--json", output], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect({ status, stderr, failures: stdout.split("\n").filter(l => l.includes("fail")) }).toEqual({ status: 0, stderr: "", failures: [expect.stringContaining('"fail":0')] })
    expect(JSON.parse(readFileSync(output, "utf8")).totals).toMatchObject({ blocks: 4, ok: 4, fail: 0, fragment: 0 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test.skipIf(!existsSync(compiler))("an explicit fragment's syntax error hides no other block's error", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-check-test-"))
  const check = async (lines: string[]) => {
    writeFileSync(join(root, "page.md"), lines.join("\n"))
    const output = join(root, "report.json")
    const child = Bun.spawn(["bun", join(import.meta.dir, "check-snippets.ts"), "--root", root, "--compiler", relative(process.cwd(), compiler), "--json", output], { stdout: "pipe", stderr: "pipe" })
    const status = await child.exited
    const [page] = JSON.parse(readFileSync(output, "utf8")).pages
    return { status, blocks: page.blocks.map((b: any) => [b.status, b.diagnostics.map((d: any) => d.code)]) }
  }
  try {
    expect(await check([
      "```vibe", "const invalid: number = 'text'", "```",
      "```vibe", "// fragment", "export function name() { ... }", "```"
    ])).toEqual({ status: 1, blocks: [["fail", ["TS2322"]], ["fragment", []]] })
    expect(await check(["```vibe", "// fragment", "const = ;", "```"])).toEqual({ status: 0, blocks: [["fragment", []]] })
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test("filename captions include TypeScript companions and only use the first two lines", () => {
  const blocks = extract([
    "```ts", "// TypeScript (.ts)", "// launch-options.ts", "export const code = 2", "```",
    "```vibe", "// main.vibe", "import { code } from './launch-options.ts'", "```",
    "```vibe", "// prose", "// nested/helper.vibe", "export const answer = 42", "```",
    "```vibe", "// prose", "// more prose", "// ignored.vibe", "const value = 1", "```"
  ].join("\n"))
  expect(blocks.map(b => b.filename)).toEqual(["launch-options.ts", "main.vibe", "nested/helper.vibe", undefined])
  expect([...blockFilenames(blocks).values()]).toEqual(["launch-options.ts", "main.vibe", "nested/helper.vibe", "block-4.vibe"])
  expect(() => extract("```ts\n// ../escape.ts\n``` ")).toThrow("Invalid snippet filename")
})

test("a data declaration's name reaches later blocks, as an error declaration's does (D307)", () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-data-test-"))
  try {
    const blocks = extract([
      "```vibe", "export data Delivery {", "  Waiting", "  Sent { tracking: string }", "}", "error Lost", "```",
      "```vibe", "const sent = Delivery.Sent({ tracking: 'parcel-8' })", "const lost = new Lost()", "```"
    ].join("\n"))
    const { filenames } = writeProject(join(root, "project"), blocks)
    const second = readFileSync(join(root, "project", filenames.get(blocks[1].number)!), "utf8")
    expect(second).toContain(`import { Delivery, Lost } from "./${filenames.get(blocks[0].number)}"`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("repeated captions stay independent and cannot overwrite a named file", () => {
  const blocks = extract("```vibe\n// main.vibe\nconst a = 1\n```\n```vibe\n// main.vibe\nconst a = 2\n```\n```vibe\n// block-1.vibe\nconst b = 3\n```")
  expect([...blockFilenames(blocks).values()]).toEqual(["block-1-2.vibe", "block-2.vibe", "block-1.vibe"])
})

test.skipIf(!existsSync(compiler))("checks named TypeScript companions and maps named-file errors to Markdown", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-named-test-"))
  try {
    writeFileSync(join(root, "page.md"), [
      "```ts", "// TypeScript (.ts)", "// launch-options.ts", "export const launchOptions: { code: number } = { code: 2 }", "```",
      "```vibe", "// main.vibe", "import { launchOptions } from './launch-options.ts'", "const code: number = launchOptions.code", "```",
      "```ts", "// TypeScript (.ts)", "// invalid.ts", "// expect-error: TS2322", "export const invalid: number = 'text'", "```",
      "```vibe", "// nested/check.vibe", "// expect-error: TS2322", "const wrong: number = 'text'", "```"
    ].join("\n"))
    const output = join(root, "report.json")
    const child = Bun.spawn(["bun", join(import.meta.dir, "check-snippets.ts"), "--root", root, "--compiler", compiler, "--json", output], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" })
    const report = JSON.parse(readFileSync(output, "utf8"))
    expect(report.totals).toMatchObject({ blocks: 4, ok: 4, fragment: 0, fail: 0 })
    expect(report.pages[0].blocks[2].diagnostics[0].line).toBe(15)
    expect(report.pages[0].blocks[3].diagnostics[0].line).toBe(20)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test.skipIf(!existsSync(compiler))("compiles a vibe fence as VibeLang and a ts fence as TypeScript", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-language-test-"))
  try {
    writeFileSync(join(root, "page.md"), [
      "```vibe", "error Missing { id: string }", "```",
      "```ts", "// expect-error: TS1434", "error Missing { id: string }", "```"
    ].join("\n"))
    const output = join(root, "report.json")
    const child = Bun.spawn(["bun", join(import.meta.dir, "check-snippets.ts"), "--root", root, "--compiler", compiler, "--json", output], { stdout: "pipe", stderr: "pipe" })
    const [, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" })
    expect(JSON.parse(readFileSync(output, "utf8")).totals).toMatchObject({ blocks: 2, ok: 2, fail: 0 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("markdownPages skips the built site, which holds each page's Markdown copy", () => {
  const root = mkdtempSync(join(tmpdir(), "check-snippets-pages-"))
  try {
    for (const path of ["a.md", "guide/b.md", "site/a.md", "site/spec/c.md", "guide/site/d.md"]) {
      mkdirSync(join(root, path, ".."), { recursive: true })
      writeFileSync(join(root, path), "# Page\n")
    }
    expect(markdownPages(root).map(p => relative(root, p))).toEqual(["a.md", "guide/b.md", "guide/site/d.md"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})


test("extracts exact output fences and inline output, with optional run expressions", () => {
  const blocks = extract([
    "```vibe", "// run: Console.log(greet())", "function greet() { return 'hello' }", "```", "",
    "~~~output", "hello", "  indented  ", "~~~",
    "```vibe", "export function main() { Console.log('a'); Console.log('b') }", "// Output: a", "// Output: b", "```",
    "```vibe", "const silent = 1", "// Output:", "```",
    "```vibe", "const displayOnly = 1", "```", "```out", "not checked", "```"
  ].join("\n"))
  expect(blocks.map(b => [b.run, b.output])).toEqual([
    ["Console.log(greet())", "hello\n  indented  "], [undefined, "a\nb"], [undefined, ""], [undefined, undefined]
  ])
})

test("rejects ambiguous output and run markers without an assertion", () => {
  expect(() => extract("```vibe\n// Output: a\n```\n```output\na\n```")).toThrow("both")
  expect(() => extract("```vibe\n// run: work()\nfunction work() {}\n```")).toThrow("output")
})

// Exercise the real compiler, emitted JavaScript, local runtime, and Node.
// Intentionally wrong output and a live fiber must fail instead of passing a
// compile-only check. An unrelated expected error must not block emission.
test.skipIf(!existsSync(compiler))("runs marked blocks and reports output mismatches, exits, timeouts, and unrun fragments", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-run-test-"))
  try {
    const pages: Record<string, string[]> = {
      "pass": [
        "```vibe", "// expect-error: TS2322", "const wrong: number = 'text'", "```",
        "```vibe", "import { missingFixture } from './missing.vibe'", "function incomplete() { return missingFixture() }", "```",
        "```vibe", "// names.vibe", "function salutation() { return 'Hello' }", "export function name() { return 'Ada' }", "```",
        "```vibe", "// run: Console.log(greet())", "function greet() { return `${salutation()}, ${name()}!` }", "```",
        "```output", "Hello, Ada!", "```",
        "```vibe", "export function main() { Console.log('native entry') }", "// Output: native entry", "```",
        "```ts", "// TypeScript (.ts)", "// plain.ts", "console.log('plain entry')", "// Output: plain entry", "```"
      ],
      "pending": ["```ts", "// TypeScript (.ts)", "// pending.ts", "// run: return new Promise<void>(() => {})", "export const value = 1", "// Output:", "```"],
      "mismatch": ["```vibe", "export function main() { Console.log('actual') }", "// Output: claimed", "```"],
      "exit": ["```vibe", "export function main() { Effect.die('failure') }", "// Output:", "```"],
      "fragment": ["```vibe", "// fragment", "missing()", "// Output: impossible", "```"],
      "expected": ["```vibe", "// expect-error: TS2322", "const invalid: number = 'text'", "// Output:", "```"],
      "compile": ["```vibe", "// run: missing()", "const valid = 1", "// Output:", "```"]
    }
    for (const [name, lines] of Object.entries(pages)) writeFileSync(join(root, `${name}.md`), lines.join("\n"))
    const output = join(root, "report.json")
    const { stdout, stderr, status } = await runSnippets(root, compiler, output)
    expect({ status, stderr }).toEqual({ status: 1, stderr: "" })
    const report = JSON.parse(readFileSync(output, "utf8"))
    const page = (name: string) => report.pages.find((p: any) => p.page.endsWith(`/${name}.md`)).blocks
    if (page("pass").some((b: any) => b.status === "fail")) console.log(JSON.stringify(page("pass").map((b: any) => ({ number: b.number, reason: b.reason, execution: b.execution })), null, 2))
    expect(page("pass").map((b: any) => b.status)).toEqual(["ok", "fragment", "ok", "ok", "ok", "ok"])
    expect(page("pass").slice(3).map((b: any) => b.execution.stdout)).toEqual(["Hello, Ada!\n", "native entry\n", "plain entry\n"])
    expect(page("pending")[0]).toMatchObject({ status: "fail", execution: { phase: "run", status: "failed" } })
    expect(page("pending")[0].execution.exitCode).not.toBe(0)
    expect(page("mismatch")[0]).toMatchObject({ status: "fail", reason: expect.stringContaining("stdout mismatch"), execution: { stdout: "actual\n", expectedStdout: "claimed" } })
    expect(page("exit")[0]).toMatchObject({ status: "fail", execution: { exitCode: 1 } })
    expect(page("fragment")[0]).toMatchObject({ status: "fail", reason: expect.stringContaining("cannot run") })
    expect(page("expected")[0]).toMatchObject({ status: "fail", reason: expect.stringContaining("cannot run") })
    expect(page("compile")[0]).toMatchObject({ status: "fail", execution: { phase: "compile" } })
    expect(stdout).toContain('"passed":3')
    // Give real entries the normal startup budget. Only the deliberate live
    // fiber uses a short timeout; busy CI hosts can take over three seconds
    // to load a native entry's platform runtime.
    writeFileSync(join(root, "timeout.md"), ["```vibe", "export function main() { Effect.never() }", "// Output:", "```"].join("\n"))
    const timeoutReport = join(root, "timeout.json")
    const { stderr: timeoutStderr, status: timeoutStatus } = await runSnippets(root, compiler, timeoutReport, { filter: "timeout.md", deadline: hangingBlockDeadline })
    expect({ status: timeoutStatus, stderr: timeoutStderr }).toEqual({ status: 1, stderr: "" })
    expect(JSON.parse(readFileSync(timeoutReport, "utf8")).pages[0].blocks[0]).toMatchObject({ status: "fail", execution: { timedOut: true } })
  } finally { rmSync(root, { recursive: true, force: true }) }
}, runTestLimit)


test("output normalization preserves spaces and extra blank lines", () => {
  expect(normalizeOutput("one\r\ntwo\r\n")).toBe("one\ntwo")
  expect(normalizeOutput("one \n\n")).toBe("one \n")
  expect(normalizeOutput("  one  ")).toBe("  one  ")
  expect(normalizeOutput("")).toBe("")
})

test.skipIf(!existsSync(compiler))("runs Effect Vitest snippets, shared assertions, and run headers in a test context", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-vitest-test-"))
  try {
    writeFileSync(join(root, "pass.md"), [
      "```vibe", 'import { assert, it } from "@effect/vitest"', 'import { TestClock } from "effect/testing"',
      'function check(value: number) { assert.strictEqual(value, 42) }',
      'it.effect("virtual sleep") { const worker = fork { sleep("1 hour"); return 42 }; TestClock.adjust("1 hour"); check(join worker) }',
      '// Output:', "```",
      "```vibe", '// run: check(42); Console.log("checked")', 'function example() { return 42 }', '// Output: checked', "```"
    ].join("\n"))
    writeFileSync(join(root, "failure.md"), [
      "```vibe", 'import { assert, it } from "@effect/vitest"',
      'it.effect("reports assertion failures") { assert.strictEqual(1, 2) }', '// Output:', "```"
    ].join("\n"))
    writeFileSync(join(root, "literal.md"), [
      "```ts", "// TypeScript (.ts)", "// literal.ts", 'console.log("@effect/vitest")', '// Output: @effect/vitest', "```"
    ].join("\n"))
    const output = join(root, "report.json")
    const { stderr, status } = await runSnippets(root, compiler, output)
    expect({ status, stderr }).toEqual({ status: 1, stderr: "" })
    const report = JSON.parse(readFileSync(output, "utf8"))
    const pass = report.pages.find((p: any) => p.page.endsWith("/pass.md")).blocks
    expect(pass.map((b: any) => [b.execution.status, b.reason])).toEqual([["passed", undefined], ["passed", undefined]])
    expect(pass[1].execution.stdout).toBe("checked\n")
    const literal = report.pages.find((p: any) => p.page.endsWith("/literal.md")).blocks[0]
    expect(literal.execution.status).toBe("passed")
    expect(literal.execution.stdout).toBe("@effect/vitest\n")
    const failure = report.pages.find((p: any) => p.page.endsWith("/failure.md")).blocks[0]
    expect(failure.execution.exitCode).not.toBe(0)
    expect(failure.execution.stderr).toContain("AssertionError")
    // Only this block hangs, so only its run has the short deadline.
    writeFileSync(join(root, "pending.md"), [
      "```ts", "// TypeScript (.ts)", "// pending.ts", '// run: return new Promise<void>(() => {})',
      'import { it } from "@effect/vitest"', 'import { Effect } from "effect"',
      'it.effect("baseline", () => Effect.void)', '// Output:', "```"
    ].join("\n"))
    const pendingReport = join(root, "pending.json")
    const hanging = await runSnippets(root, compiler, pendingReport, { filter: "pending.md", deadline: hangingBlockDeadline })
    expect({ status: hanging.status, stderr: hanging.stderr }).toEqual({ status: 1, stderr: "" })
    const pending = JSON.parse(readFileSync(pendingReport, "utf8")).pages[0].blocks[0]
    expect(pending.execution).toMatchObject({ phase: "run", status: "failed", timedOut: true })
    expect(pending.execution.exitCode).not.toBe(0)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, runTestLimit)

test("onboarding pages include the starter and check their inline wrapper examples", () => {
  const repo = resolve(import.meta.dir, "../..")
  const pages = markdownPages(join(repo, "docs/user"))
  for (const file of ["docs/user/llms-essentials.md", "templates/app/AGENTS.md"]) {
    expect(pages).toContain(join(repo, file))
    const blocks = extract(readFileSync(join(repo, file), "utf8"), { inlineExamples: true })
    const wrappers = blocks.filter(b => b.firstLine.startsWith("try tryPromise(") || b.firstLine.startsWith("try Effect.try("))
    expect(wrappers).toHaveLength(2)
    expect(wrappers.every(b => b.pending?.includes("VIP-4"))).toBe(true)
    expect(blocks.some(b => b.filename === "wrapper-input.ts")).toBe(true)
  }
})

test("snippet projects share the Effect resolved from an npm-installed runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-installed-runtime-"))
  const previous = process.env.VIBELANG_RUNTIME_DIR
  try {
    const runtime = join(root, "node_modules/vibelang-runtime")
    const effect = join(root, "node_modules/effect")
    mkdirSync(join(runtime, "dist"), { recursive: true })
    mkdirSync(effect, { recursive: true })
    writeFileSync(join(runtime, "package.json"), '{"name":"vibelang-runtime","type":"module","exports":{".":"./dist/index.js"}}')
    writeFileSync(join(runtime, "dist/index.d.ts"), "export {}")
    writeFileSync(join(effect, "package.json"), '{"name":"effect","version":"4.0.5"}')
    process.env.VIBELANG_RUNTIME_DIR = runtime
    const project = join(root, "page")
    linkModules(project)
    expect(realpathSync(join(project, "node_modules/effect"))).toBe(realpathSync(effect))
    expect(realpathSync(join(project, "node_modules/vibelang-runtime"))).toBe(realpathSync(runtime))

    const conflicting = join(root, "conflicting")
    mkdirSync(join(conflicting, "node_modules"), { recursive: true })
    const other = join(root, "other-effect")
    mkdirSync(other)
    writeFileSync(join(other, "package.json"), '{"name":"effect","version":"4.0.5"}')
    symlinkSync(other, join(conflicting, "node_modules/effect"))
    expect(() => linkModules(conflicting)).toThrow(/Conflicting Effect copies/)
  } finally {
    if (previous === undefined) delete process.env.VIBELANG_RUNTIME_DIR
    else process.env.VIBELANG_RUNTIME_DIR = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test("Node ambient types are opt-in through a snippet header", () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-types-test-"))
  try {
    const defaults = join(root, "defaults")
    writeProject(defaults, extract("```vibe\nfunction sample() { return 1 }\n```"))
    expect(JSON.parse(readFileSync(join(defaults, "tsconfig.json"), "utf8")).compilerOptions.types).toEqual([])
    const node = join(root, "node")
    writeProject(node, extract('```vibe\n// types: node\nmodule files { import { lstatSync } from "node:fs"; export const stat = lstatSync }\n```'))
    expect(JSON.parse(readFileSync(join(node, "tsconfig.json"), "utf8")).compilerOptions.types).toEqual(["node"])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a pending-decision line holds a block out with its topic beside its VIPs", () => {
  const [both, decision] = extract([
    "```vibe", "// pending: VIP-13", "// pending-decision: error-extends", "error A { code: string }", "```",
    "```vibe", "// pending-decision: catch-precedence", "const x = 1", "```"
  ].join("\n"))
  expect(both.pending).toEqual(["VIP-13", "decision:error-extends"])
  expect(decision.pending).toEqual(["decision:catch-precedence"])
  expect(decision.fragment).toBe(true)
})

test("a block importing a pending block's module waits for the same VIPs", () => {
  const blocks = extract([
    "```vibe", "// src/notifications.vibe", "// pending: VIP-1, VIP-5", "export effect notify() { return 1 }", "```",
    "```ts", "// src/host.ts", 'import { notify } from "./notifications.js"', "export const run = notify", "```",
    "```ts", "// src/other.ts", "export const two = 2", "```",
    "```ts", "// src/build.ts", 'export const load = () => import("./notifications.js")', "```"
  ].join("\n"))
  expect(blocks[1].pending).toEqual(["VIP-1", "VIP-5"])
  expect(blocks[1].fragment).toBe(true)
  expect(blocks[2].pending).toBeUndefined()
  expect(blocks[3].pending).toEqual(["VIP-1", "VIP-5"])
})

test("a block marked pending names its VIPs, stays out of the program and reports pending", () => {
  const [pending, ready] = extract(["```vibe", "// main.vibe", "// pending: VIP-1, VIP-5", "effect load(id: string) { return try fetchUser(id) }", "// Output: Ada", "```", "```vibe", "const x = 1", "```"].join("\n"))
  expect(pending.pending).toEqual(["VIP-1", "VIP-5"])
  expect(pending.filename).toBe("main.vibe")
  expect(ready.pending).toBeUndefined()
  expect(classify(pending, [diagnostic("TS1005")]).status).toBe("pending")
  const dir = join(mkdtempSync(join(tmpdir(), "pending-")), "project")
  writeProject(dir, [pending, ready], { omitFragments: true })
  const files: string[] = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8")).files
  expect(files.includes("main.vibe")).toBe(false)
  expect(files.length).toBe(1)
})

test.skipIf(!existsSync(compiler))("late-start documentation runs expose timer readiness and accept Deferred readiness", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-late-start-"))
  const previous = process.env.VIBELANG_LATE_START
  try {
    process.env.VIBELANG_LATE_START = "1"
    linkModules(root)
    const blocks = extract([
      "```vibe",
      "// run: try Console.log(try cleanup(false)); try Console.log(try cleanup(true))",
      'import { Deferred, Effect, Fiber } from "effect"',
      "effect function cleanup(wait: boolean) {",
      "  const started = try Deferred.make<void>()",
      "  let cleaned = false",
      "  const worker = try Effect.forkChild(Effect.ensuring(effect {",
      "    try Deferred.succeed(started, undefined)",
      "    try Effect.never()",
      "  }, Effect.sync(() => { cleaned = true })))",
      "  if (wait) try Deferred.await(started)",
      '  else try Effect.sleep("5 millis")',
      "  try Fiber.interrupt(worker)",
      "  return cleaned",
      "}",
      "// Output: false",
      "// Output: true",
      "```"
    ].join("\n"))
    // runBlock bounds both compilation and execution, including child cleanup.
    const result = await runBlock(join(root, "run"), blocks,
      { ...blocks[0], status: "ok", diagnostics: [] }, compiler, 60_000)
    if (result.status !== "ok") console.log(result.reason, result.execution)
    expect(result.status).toBe("ok")
    expect(result.execution).toMatchObject({
      status: "passed", exitCode: 0, timedOut: false, stdout: "false\ntrue\n"
    })
  } finally {
    if (previous === undefined) delete process.env.VIBELANG_LATE_START
    else process.env.VIBELANG_LATE_START = previous
    rmSync(root, { recursive: true, force: true })
  }
}, 150_000)
