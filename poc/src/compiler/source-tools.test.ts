import { describe, expect, test } from "bun:test"
import { getNativeCompiler } from "./native.ts"
import { decodeNativeFormat, decodeNativeToken, NATIVE_API_VERSION } from "./protocol.ts"
import { formatVibeLangSource, vibelangTokenAt } from "../language/format.ts"

const revision = "a".repeat(40)
const envelope = (result: unknown): string => JSON.stringify({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result })

describe("native source tool protocol", () => {
  test("accepts exact format success and authored refusal", () => {
    expect(decodeNativeFormat(envelope({ ok: true, code: "const x = 1\n", changed: true, diagnostics: [] }), revision, "const x=1").ok).toBe(true)
    const failure = { ok: false, code: "const =", changed: false, diagnostics: [{ severity: "error", code: "VIBE1901", message: "parse error", start: 6, line: 1, column: 7 }] }
    expect<unknown>(decodeNativeFormat(envelope(failure), revision, failure.code)).toEqual(failure)
  })
  for (const [name, mutate] of [
    ["missing output", (r: any) => { delete r.code }],
    ["wrong changed flag", (r: any) => { r.changed = true }],
    ["repaired Unicode", (r: any) => { r.code = "\ud800"; r.changed = true }],
    ["failure without reason", (r: any) => { r.ok = false }],
    ["rewritten failure", (r: any) => { r.ok = false; r.code = "changed"; r.changed = true; r.diagnostics = [{ severity: "error", code: "VIBE1901", message: "bad", start: 0, line: 1, column: 1 }] }],
    ["success with refusal", (r: any) => { r.diagnostics = [{ severity: "error", code: "VIBE1901", message: "bad", start: 0, line: 1, column: 1 }] }],
    ["unknown field", (r: any) => { r.extra = 1 }],
    ["out-of-source diagnostic", (r: any) => { r.ok = false; r.diagnostics = [{ severity: "error", code: "VIBE1901", message: "bad", start: 1000, line: 1, column: 1 }] }],
    ["zero-based diagnostic", (r: any) => { r.ok = false; r.diagnostics = [{ severity: "error", code: "VIBE1901", message: "bad", start: 0, line: 0, column: 0 }] }],
    ["unknown code", (r: any) => { r.ok = false; r.diagnostics = [{ severity: "error", code: "VIBE1002", message: "bad", start: 0, line: 1, column: 1 }] }],
  ] as const) {
    test(`format refuses ${name}`, () => {
      const result = { ok: true, code: "source", changed: false, diagnostics: [] }
      mutate(result)
      expect(() => decodeNativeFormat(envelope(result), revision, "source")).toThrow()
    })
  }
  const request = { text: "/*🐱*/ value", offset: 9 }
  const token = { kind: "Identifier", text: "value", start: 7, end: 12 }
  test("accepts exact token facts and no-token responses", () => {
    expect(decodeNativeToken(envelope({ token }), revision, request).token).toEqual(token)
    expect(decodeNativeToken(envelope({ token: null }), revision, request).token).toBeNull()
  })
  for (const [name, mutate] of [
    ["missing token", (r: any) => { delete r.token }],
    ["numeric 5.9 kind", (r: any) => { r.token.kind = 80 }],
    ["invented source", (r: any) => { r.token.text = "other" }],
    ["negative position", (r: any) => { r.token.start = -1 }],
    ["fractional position", (r: any) => { r.token.start = 7.5 }],
    ["empty token", (r: any) => { r.token.end = r.token.start }],
    ["escaping source", (r: any) => { r.token.end = 100 }],
    ["unrelated offset", (r: any) => { r.token = { kind: "Identifier", text: "v", start: 7, end: 8 } }],
    ["unknown token field", (r: any) => { r.token.parent = {} }],
  ] as const) {
    test(`token lookup refuses ${name}`, () => {
      const result = { token: { ...token } }
      mutate(result)
      expect(() => decodeNativeToken(envelope(result), revision, request)).toThrow()
    })
  }
})

describe("native formatter execution", () => {
  test("plain TypeScript executes identically before and after Go formatting", async () => {
    const source = "export default function value(){\nconst r=/a  b/g\nconst t=`line\n  tail`\nreturn [r.source,t,41+1]\n}"
    const formatted = formatVibeLangSource(source)
    expect(formatted.ok).toBe(true)
    const run = async (text: string) => {
      const result = getNativeCompiler().compile({ rootNames: ["value.ts"], files: [{ path: "value.ts", kind: "typescript", text }],
        lowering: "typescript", options: { target: "ES2022", module: "ES2022", strict: true, noEmitOnError: true } })
      expect(result.diagnostics).toEqual([])
      expect(result.emitSkipped).toBe(false)
      const artifact = result.artifacts.find(file => file.path === "value.js")!
      return (await import(`data:text/javascript;base64,${artifact.content}`)).default()
    }
    expect(await run(source)).toEqual(["a  b", "line\n  tail", 42])
    expect(await run(formatted.code)).toEqual(await run(source))
  }, 300_000)
  test("Unicode masks and comments survive the thin formatter binding", () => {
    const source = "if(const x='é猫🐱';/*keep*/x!==''){\nconsole.log(x)\n}"
    const result = formatVibeLangSource(source)
    expect(result.ok).toBe(true)
    expect(result.code).toContain("'é猫🐱'")
    expect(result.code).toContain("/*keep*/")
    expect(formatVibeLangSource(result.code).changed).toBe(false)
  })
  test("caret lookup uses native symbolic kinds and authored UTF-16 spans", () => {
    const text = "// 🐱\nvalue"
    expect(vibelangTokenAt(text, 8)).toEqual({ kind: "Identifier", text: "value", start: 6, end: 11 })
    expect(vibelangTokenAt(text, 3)).toBeUndefined()
    expect(vibelangTokenAt(text, 11)?.text).toBe("value")
  })
  test("native options and malformed requests do not select a legacy fallback", () => {
    expect(() => getNativeCompiler().format({ text: "", indentSize: 0 })).toThrow("indentSize")
    expect(() => getNativeCompiler().format({ text: "\ud800" })).toThrow("unpaired UTF-16")
    expect(() => getNativeCompiler().tokenAt({ text: "\udfff", offset: 0 })).toThrow("unpaired UTF-16")
    expect(() => getNativeCompiler().tokenAt({ text: "value", offset: NaN })).toThrow("non-finite number")
    expect(() => vibelangTokenAt("value", 0.5)).toThrow(TypeError)
  })
  test("extra host options cannot substitute different source text", () => {
    expect(formatVibeLangSource("const value=42", { text: "const injected = 0" } as any).code).toBe("const value = 42\n")
  })
})
