import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCompiler } from "./check-snippets"
import { runSnippets, runTestLimit } from "./run-snippets"

const fence = String.fromCharCode(96).repeat(3)
const block = (language: string, code: string) => [fence + language, code, fence].join("\n")
test("a syntax-error example cannot hide a sibling's type error or expected diagnostic", async () => {
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.constantFrom("vibe", "ts"), fc.integer({ min: -100, max: 100 }), fc.boolean(), async (expected, language, value, reverse) => {
    const root = mkdtempSync(join(tmpdir(), "snippet-syntax-isolation-"))
    try {
      const syntax = block(language, "// expect-error: TS1109\nexport const broken = ;")
      const semantic = block(language, (expected ? "// expect-error: TS2322\n" : "") + "export const count: number = " + JSON.stringify(String(value)) + ";")
      writeFileSync(join(root, "examples.md"), (reverse ? [semantic, syntax] : [syntax, semantic]).join("\n\n"))
      const output = join(root, "report.json")
      const result = await runSnippets(root, defaultCompiler(), output)
      const report = JSON.parse(readFileSync(output, "utf8"))
      const invalidSyntax = report.pages[0].blocks[reverse ? 1 : 0]
      const invalidType = report.pages[0].blocks[reverse ? 0 : 1]
      expect(invalidSyntax.status).toBe("ok")
      expect(invalidSyntax.diagnostics.map((d: any) => d.code)).toContain("TS1109")
      expect(invalidType.diagnostics.map((d: any) => d.code)).toContain("TS2322")
      expect(invalidType.status).toBe(expected ? "ok" : "fail")
      expect(result.status).toBe(expected ? 0 : 1)
      expect(report.totals.pending).toBe(0)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { numRuns: 8, examples: [[false, "vibe", 1, false], [true, "ts", 0, true], [false, "ts", -1, true]] })
}, runTestLimit)

test("syntax checks retain global augmentation context", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-ambient-context-"))
  try {
    writeFileSync(join(root, "examples.md"), [
      block("ts", '// globals.ts\ndeclare global { var answer: number }\nexport {}'),
      block("ts", '// expect-error: TS1109\nexport const broken = ;'),
      block("ts", 'export const value: number = answer'),
    ].join("\n\n"))
    const output = join(root, "report.json")
    const result = await runSnippets(root, defaultCompiler(), output)
    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(output, "utf8")).pages[0].blocks.map((b: any) => b.status)).toEqual(["ok", "ok", "ok"])
  } finally { rmSync(root, { recursive: true, force: true }) }
}, runTestLimit)

test("an imported syntax error blocks its dependent example while independent examples stay checked", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-import-syntax-"))
  try {
    writeFileSync(join(root, "examples.md"), [
      block("vibe", '// broken.vibe\n// expect-error: TS1109\nexport const broken = ;'),
      block("vibe", 'import { broken } from "./broken.vibe"\nexport const value = broken'),
      block("vibe", 'export const independent: number = 1'),
    ].join("\n\n"))
    const output = join(root, "report.json")
    const result = await runSnippets(root, defaultCompiler(), output)
    const blocks = JSON.parse(readFileSync(output, "utf8")).pages[0].blocks
    expect(result.status).toBe(1)
    expect(blocks[0].status).toBe("ok")
    expect(blocks[1].status).toBe("fail")
    expect(blocks[1].reason).toContain("syntax error in broken.vibe")
    expect(blocks[2].status).toBe("ok")
  } finally { rmSync(root, { recursive: true, force: true }) }
}, runTestLimit)

test("type declarations retain an earlier value binding through semantic isolation", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-type-value-context-"))
  try {
    writeFileSync(join(root, "examples.md"), [
      block("vibe", 'function Token() { return 7 }'),
      block("vibe", 'type Token = number'),
      block("vibe", '// expect-error: TS1109\nexport const broken = ;'),
      block("vibe", 'const token: Token = Token()'),
    ].join("\n\n"))
    const output = join(root, "report.json")
    const result = await runSnippets(root, defaultCompiler(), output)
    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(output, "utf8")).pages[0].blocks.map((b: any) => b.status)).toEqual(["ok", "ok", "ok", "ok"])
  } finally { rmSync(root, { recursive: true, force: true }) }
}, runTestLimit)
