import { beforeAll, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getNativeCompiler } from "../compiler/native.ts"
import { AssetCompiler } from "./assets.ts"
import { compileSourceAssetModules } from "./source-assets.ts"

beforeAll(() => { getNativeCompiler() }, 300_000)

const grammarDiagnostics = (source: string, fileName: string) => {
  const result = getNativeCompiler().compile({ rootNames: [fileName], files: [{ path: fileName, text: source, kind: "vibelang" }], lowering: "internal" })
  return result.diagnostics.filter(d => /^VIBE100[01]$/.test(d.code)).map(d => {
    const prefix = source.slice(0, d.span?.start ?? 0).split(/\r\n|[\n\r\u2028\u2029]/)
    return { code: d.code, line: prefix.length, column: prefix.at(-1)!.length + 1 }
  })
}

test("when parsing blocks asset discovery, preflight uses the checker's authored grammar diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-source-grammar-"))
  const corpus = new URL("../../../conformance/corpus/19-retired-syntax/", import.meta.url)
  try {
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache"), target: "node-es2022", options: {} })
    let measured = 0
    for (const name of (await readdir(corpus)).sort()) {
      if (!name.endsWith(".expected.json")) continue
      const expected = JSON.parse(await readFile(new URL(name, corpus), "utf8"))
      if (expected.expect !== "diagnostics" || !expected.diagnostics.every((d: { code: string }) => /^VIBE100[01]$/.test(d.code))) continue
      const fileName = name.replace(/\.expected\.json$/, ".vibe")
      const source = await readFile(new URL(fileName, corpus), "utf8")
      const parsed = getNativeCompiler().inspect([{ path: fileName, text: source, scriptKind: "typescript" }]).files[0]!
      if (parsed.diagnostics.length === 0) continue
      const result = await compileSourceAssetModules({ compiler, sources: [{ fileName, source }] })
      const positions = (diagnostics: readonly { code: string; line: number; column: number }[]) =>
        diagnostics.map(({ code, line, column }) => ({ code, line, column }))
      expect([fileName, result.ok]).toEqual([fileName, false])
      expect(result.modules).toEqual([])
      expect(positions(result.diagnostics)).toEqual(expected.diagnostics)
      expect(positions(result.diagnostics)).toEqual(grammarDiagnostics(source, fileName))
      measured++
    }
    expect(measured).toBeGreaterThanOrEqual(15)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("the early grammar gate accepts ordinary keyword members and conditional declarations", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-source-grammar-positive-"))
  try {
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache"), target: "node-es2022", options: {} })
    for (const source of [
      'export function f() { const o = { try: 1, catch: 2, orelse: 3 }; return o.try + o.catch + o.orelse }',
      'export function f() { if (const value = 1; value > 0) { return value }; return 0 }',
      'export function f() { const text = `error Missing {} throws Oops`; return text }',
    ]) {
      const result = await compileSourceAssetModules({ compiler, sources: [{ fileName: "positive.vibe", source }] })
      expect(result.diagnostics).toEqual([])
      expect(result.ok).toBe(true)
    }
    const foreign = await compileSourceAssetModules({ compiler, sources: [{ fileName: "foreign.ts", source: "export const n = ;" }] })
    expect(foreign.ok).toBe(false)
    expect(foreign.diagnostics.every(d => d.code.startsWith("TS"))).toBe(true)
    const source = 'class E extends Error {}\nexport function f(): !number { throw new E() }'
    const parseable = await compileSourceAssetModules({ compiler, sources: [{ fileName: "parseable.vibe", source }] })
    expect(parseable.ok).toBe(true)
    const checked = getNativeCompiler().compile({ rootNames: ["parseable.vibe"], files: [{path:"parseable.vibe", text:source, kind:"vibelang"}], lowering:"internal" })
    expect(checked.diagnostics.map(d => d.code).sort()).toEqual(["VIBE1001", "VIBE1101"])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("native preflight preserves the corpus's conditional-form refusal before comptime", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-source-conditional-"))
  try {
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") })
    const corpus = new URL("../../../conformance/corpus/14-conditional-declarations/", import.meta.url)
    for (const name of ["conditional-declaration-with-a-braceless-branch-is-rejected", "conditional-declaration-with-var-is-rejected"]) {
      const expected = JSON.parse(await readFile(new URL(`${name}.expected.json`, corpus), "utf8"))
      const source = await readFile(new URL(`${name}.vibe`, corpus), "utf8")
      const result = await compileSourceAssetModules({ compiler, sources: [{ fileName: `${name}.vibe`, source }] })
      expect(result.ok).toBe(false)
      expect(result.modules).toEqual([])
      expect(result.diagnostics.map(({ code, line, column }) => ({ code, line, column }))).toEqual(expected.diagnostics)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
