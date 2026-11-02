import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extract, defaultCompiler, linkModules } from "./check-snippets"
import { annotateRegions, fixPage, preserveDirectives, replaceBlocks } from "./fix-snippets"

test("replaces repeated blocks by span and preserves CRLF, fences, prose and output", () => {
  const markdown = "intro\r\n~~~vibe\r\nconst x = 1\r\n~~~\r\n\r\n```output\r\n1\r\n```\r\n```vibe\r\nconst x = 1\r\n```\r\nend\r\n"
  const result = replaceBlocks(markdown, extract(markdown), new Map([[2, "const x = () => 1"]]))
  expect(result).toBe(markdown.replace("```vibe\r\nconst x = 1", "```vibe\r\nconst x = () => 1"))
})

test("replacing an empty block preserves its closing fence", () => {
  const markdown = "```vibe\n```\nprose\n"
  expect(replaceBlocks(markdown, extract(markdown), new Map([[1, "const x = 1"]])))
    .toBe("```vibe\nconst x = 1\n```\nprose\n")
})

test("S0 migration-only fixes preserve existing style examples", async () => {
  const temp = mkdtempSync(join(tmpdir(), "fix-snippets-noop-"))
  try {
    linkModules(temp)
    const dir = join(temp, "page")
    mkdirSync(dir)
    const markdown = '```vibe\nimport { Effect } from "effect"\nexport function read(): Effect.Effect<number> { return Effect.succeed(1) }\n```\n'
    expect(await fixPage(markdown, dir, defaultCompiler())).toEqual({ markdown, changed: 0, blocks: 1 })
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, 60000)

test("plain-TypeScript directives survive byte for byte", () => {
  const source = "  // Plain TypeScript inside this hatch, not VibeLang.\n  // sync's first argument is plain TypeScript, not VibeLang."
  expect(() => preserveDirectives(source, source)).not.toThrow()
  expect(() => preserveDirectives(source, source.replace("  //", " //"))).toThrow("plain-TypeScript comment changed")
  expect(() => preserveDirectives(source, "")).toThrow()
  const inline = "const x = sync(() => 1) // sync's first argument is plain TypeScript, not VibeLang."
  expect(() => preserveDirectives(inline, inline.replace("const x", "const renamed"))).not.toThrow()
})

test("new hatches and modules carry the documented comments, idempotently", () => {
  const source = 'const x = sync(() => 1)\nmodule helper {\n  export const value = 1\n}\nconst y = try(() => {\n  return 1\n})'
  const annotated = annotateRegions(source)
  expect(annotated).toContain("// sync's first argument is plain TypeScript, not VibeLang.")
  expect(annotated).toContain("// Plain TypeScript inside this hatch, not VibeLang.")
  expect(annotated).toContain("// Plain TypeScript inside this module, not VibeLang.")
  expect(annotateRegions(annotated)).toBe(annotated)
})

// A compiler wrapper injects a plausible but incorrect fix. The real compiler
// then checks and runs it: the page transaction must refuse the changed output.
test("refuses a type-correct fix whose expected stdout changes", async () => {
  const temp = mkdtempSync(join(tmpdir(), "fix-snippets-test-"))
  try {
    linkModules(temp)
    const wrapper = join(temp, "compiler")
    writeFileSync(wrapper, `#!/usr/bin/env bun\nimport { readFileSync, writeFileSync } from "node:fs";\nimport { dirname, join } from "node:path";\nconst args = process.argv.slice(2);\nif (args.includes("--fix")) { const dir = dirname(args[args.indexOf("-p") + 1]); const path = join(dir, "block-1.vibe"); writeFileSync(path, readFileSync(path, "utf8").replace('Console.log("before")', 'Console.log("after")')); }\nconst child = Bun.spawn([${JSON.stringify(defaultCompiler())}, ...args.filter(arg => arg !== "--fix")], { stdout: "inherit", stderr: "inherit" }); process.exit(await child.exited);\n`, { mode: 0o755 })
    const dir = join(temp, "page")
    mkdirSync(dir)
    const markdown = '```vibe\nexport function main() { Console.log("before") }\n// Output: before\n```\n'
    await expect(fixPage(markdown, dir, wrapper, 10000, true)).rejects.toThrow("expected output changed")
    expect(readFileSync(join(dir, "fix/block-1.vibe"), "utf8")).toContain('Console.log("after")')
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, 60000)

test("migrates pipe look-ahead and checks its marked output, idempotently", async () => {
  const temp = mkdtempSync(join(tmpdir(), "fix-snippets-pipe-"))
  try {
    linkModules(temp)
    const markdown = '```vibe\n// run: Console.log(value())\nfunction value() { return pipe(() => 5, Effect.map(n => n + 1)) }\n// Output: 6\n```\n'
    const result = await fixPage(markdown, join(temp, "first"), defaultCompiler())
    expect(result.changed).toBe(1)
    expect(result.markdown).not.toContain("pipe(")
    expect((await fixPage(result.markdown, join(temp, "second"), defaultCompiler())).changed).toBe(0)
    await expect(fixPage(markdown.replace("Output: 6", "Output: 7"), join(temp, "wrong"), defaultCompiler())).rejects.toThrow("expected output changed")
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, 60000)

test("moves a block after an Effect dual to its program parameter, idempotently", async () => {
  const temp = mkdtempSync(join(tmpdir(), "fix-snippets-dual-"))
  try {
    linkModules(temp)
    const markdown = '```vibe\n// run: Console.log(traced())\nfunction traced() {\n  return withSpan("load") {\n    return "done"\n  }\n}\n// Output: done\n```\n'
    const result = await fixPage(markdown, join(temp, "first"), defaultCompiler())
    expect(result.changed).toBe(1)
    expect(result.markdown).toContain('return withSpan(() => {\n    return "done"\n  }, "load")')
    expect((await fixPage(result.markdown, join(temp, "second"), defaultCompiler())).changed).toBe(0)
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, 60000)

test("migrates a fork of a function literal and checks its marked output, idempotently", async () => {
  const temp = mkdtempSync(join(tmpdir(), "fix-snippets-fork-"))
  try {
    linkModules(temp)
    const markdown = '```vibe\n// run: Console.log(value())\nfunction value() {\n  const f = fork(() => Effect.succeed(5))\n  return join f\n}\n// Output: 5\n```\n'
    const result = await fixPage(markdown, join(temp, "first"), defaultCompiler())
    expect(result.changed).toBe(1)
    expect(result.markdown).toContain("const f = fork Effect.succeed(5)")
    expect((await fixPage(result.markdown, join(temp, "second"), defaultCompiler())).changed).toBe(0)
    await expect(fixPage(markdown.replace("Output: 5", "Output: 6"), join(temp, "wrong"), defaultCompiler())).rejects.toThrow("expected output changed")
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, 60000)

test("migrates a run marker's fork beside its block, on one line", async () => {
  const temp = mkdtempSync(join(tmpdir(), "fix-snippets-run-"))
  try {
    linkModules(temp)
    const markdown = '```vibe\n// run: const f = fork(() => value()); Console.log(join f)\nfunction value() { return 5 }\n// Output: 5\n```\n'
    const result = await fixPage(markdown, join(temp, "first"), defaultCompiler())
    expect(result.changed).toBe(1)
    expect(result.markdown).toContain("// run: const f = fork value(); Console.log(join f)\n")
    expect((await fixPage(result.markdown, join(temp, "second"), defaultCompiler())).changed).toBe(0)
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, 60000)
