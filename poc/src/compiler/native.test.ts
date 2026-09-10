import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { copyFileSync, mkdtempSync, rmSync, appendFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NativeCompiler, getNativeCompiler } from "./native.ts"
import { NativeTypeScriptCompiler, InMemoryTypeScriptCompiler, CliTypeScriptCompiler } from "../agent/compiler.ts"

describe("native generated-agent compiler", () => {
  let compiler: NativeTypeScriptCompiler
  let native: NativeCompiler
  const temporary = mkdtempSync(join(tmpdir(), "vibelang-native-client-test-"))
  beforeAll(() => { native = getNativeCompiler(); compiler = new NativeTypeScriptCompiler() }, 300_000)
  afterAll(() => rmSync(temporary, { recursive: true, force: true }))

  test("compatibility names select the same Go implementation", () => {
    expect(InMemoryTypeScriptCompiler).toBe(NativeTypeScriptCompiler)
    expect(CliTypeScriptCompiler).toBe(NativeTypeScriptCompiler)
    expect(compiler.identity.name).toBe("typescript-go/in-memory")
    expect(native.identity.compilerVersion).toMatch(/^7\./)
    expect(Object.isFrozen(native.identity)).toBe(true)
    expect(Object.isFrozen(native)).toBe(true)
    expect(native.identity.sha256).toMatch(/^[a-f0-9]{64}$/)
  })
  test("the emitted JavaScript actually calls the typed host table", async () => {
    const result = await compiler.compile("export default async (f: Functions) => f.double(21)",
      "interface Functions { double(value: number): Promise<number> }")
    expect(result.ok).toBe(true)
    expect(result.compiler).toContain("native Go")
    const module = await import(`data:text/javascript;base64,${Buffer.from(result.javascript!).toString("base64")}`)
    expect(await module.default({ double: async (value: number) => value * 2 })).toBe(42)
  })
  test("native type checking rejects incompatible callable arguments", async () => {
    const result = await compiler.compile('export default (f: Functions) => f.double("bad")',
      "interface Functions { double(value: number): number }")
    expect(result.ok).toBe(false)
    expect(result.javascript).toBeUndefined()
    expect(result.diagnostics.some((item) => item.code === 2345)).toBe(true)
  })
  test("inspection separates syntax from checking and reports erased module forms", () => {
    const result = native.inspect([
      { path: "good.ts", text: `type X = import("types-only").X; const y: Missing = unknownName`, scriptKind: "typescript" },
      { path: "bad.ts", text: "export const = ;", scriptKind: "typescript" },
    ])
    expect(result.files[0]?.diagnostics).toEqual([])
    expect(result.files[0]?.moduleSyntax[0]?.kind).toBe("import-type")
    expect(result.files[1]?.diagnostics.length).toBeGreaterThan(0)
  })
  for (const text of ["\ud800", "\udfff", "\udc00\ud800"]) {
    test(`both native host operations refuse malformed Unicode ${JSON.stringify(text)}`, () => {
      expect(() => native.compile({ rootNames: ["bad.ts"], files: [{ path: "bad.ts", text: `export const value = "${text}"`, kind: "typescript" }],
        lowering: "typescript" })).toThrow("unpaired UTF-16 surrogate")
      expect(() => native.inspect([{ path: "bad.ts", text, scriptKind: "typescript" }])).toThrow("unpaired UTF-16 surrogate")
    })
  }
  for (const [sourceValue, expected] of [["\\ud800", "\ud800"], ["\\udfff", "\udfff"], ["\\ud83d\\udc31", "🐱"], ["🐱", "🐱"], ["�", "�"]]) {
    test(`ordinary native emit executes the exact Unicode value ${JSON.stringify(sourceValue)}`, async () => {
      const result = native.compile({ rootNames: ["value.ts"], files: [{ path: "value.ts", text: `export default "${sourceValue}"`, kind: "typescript" }],
        lowering: "typescript", options: { target: "ES2022", module: "ES2022", noCheck: true } })
      expect(result.emitSkipped).toBe(false)
      expect(result.diagnostics).toEqual([])
      const javascript = result.artifacts.find(file => file.path === "value.js")!
      expect((await import(`data:text/javascript;base64,${javascript.content}`)).default).toBe(expected)
    })
  }
  for (const [name, bad] of [["escaped surrogate", Buffer.from('"\\ud800"')], ["invalid UTF8", Buffer.from([0x22, 0xff, 0x22])]] as const) {
    for (const operation of ["compile", "inspect"] as const) {
      test(`the standalone Go ${operation} decoder refuses ${name}`, () => {
        const sourceField = operation === "compile" ? '"kind":"typescript"' : '"scriptKind":"typescript"'
        const prefix = operation === "compile" ? '"rootNames":["bad.ts"],"lowering":"typescript",' : ""
        const input = Buffer.concat([Buffer.from(`{${prefix}"files":[{"path":"bad.ts",${sourceField},"text":`), bad, Buffer.from("}]}")])
        const processResult = spawnSync(native.executable, operation === "compile" ? [] : ["--inspect"], { input, encoding: "utf8" })
        expect(processResult.status).toBe(0)
        const response = JSON.parse(processResult.stdout)
        expect(response.error?.message).toMatch(/unpaired UTF-16 surrogate|invalid UTF-8/)
        if (operation === "compile") {
          expect(response.result.emitSkipped).toBe(true)
          expect(response.result.artifacts).toEqual([])
        } else expect(response.result.files).toEqual([])
      })
    }
  }
  test("inspection does not replace an unpaired surrogate in a cooked module name", () => {
    expect(() => native.inspect([{ path: "module.ts", text: 'import("./\\ud800.js")', scriptKind: "typescript" }]))
      .toThrow("module specifier with an unpaired UTF-16 surrogate")
    expect(native.inspect([{ path: "module.ts", text: 'import("./\\ud83d\\udc31.js")', scriptKind: "typescript" }])
      .files[0]?.moduleSyntax[0]?.specifier).toBe("./🐱.js")
  })
  for (const newline of ["\n", "\r\n", "\r", "\u2028", "\u2029"]) {
    test(`native policy positions survive ${JSON.stringify(newline)}`, async () => {
      const source = '// 🦀' + newline + 'export default () => /* 🦀 */ eval("42")'
      const result = await compiler.compile(source, "interface Functions {}")
      expect(result.ok).toBe(false)
      const item = result.diagnostics.find((item) => item.code === 91001)
      expect(item?.file).toBe("turn.ts")
      expect(item?.line).toBe(2)
      expect(item?.column).toBe('export default () => /* 🦀 */ '.length + 1)
    })
  }
  test("a copied native executable works independently of its build location", () => {
    const copied = join(temporary, process.platform === "win32" ? "native.exe" : "native")
    copyFileSync(native.executable, copied)
    const detached = new NativeCompiler({ executable: copied })
    expect(detached.identity).toEqual(native.identity)
    const request = { rootNames: ["main.ts"], files: [{ path: "main.ts", kind: "typescript" as const, text: "export const value: number = 42" }],
      lowering: "typescript" as const, options: { target: "ES2022", module: "ES2022", types: [] } }
    expect(detached.compile(request).emitSkipped).toBe(false)
    appendFileSync(copied, "tamper")
    expect(() => detached.compile(request)).toThrow("changed after its identity")
  })
  test("an unavailable explicit executable never falls back", () => {
    expect(() => new NativeCompiler({ executable: join(temporary, "missing") })).toThrow("unavailable")
  })
  for (const timeoutMs of [0, -1, 0.5, 300_001, Infinity]) {
    test(`rejects invalid timeout ${timeoutMs}`, () => {
      expect(() => new NativeCompiler({ timeoutMs })).toThrow("timeoutMs")
    })
  }
})
