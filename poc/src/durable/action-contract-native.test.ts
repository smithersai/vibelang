import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { compileActionContract, validateActionContractDescriptor, validateDurableTypeDescriptor, validateDurableValue } from "./schema.ts"
import { compileDurableBody } from "./body-compiler.ts"
import { loadDurableBody } from "./body-artifact.ts"
import { __vsInspectResult } from "../runtime/result.ts"
import { durableFailureIdentity } from "./site-id.ts"

const options = { fileName: "contracts/actions.vibe", exportName: "Work", id: "test/Work", version: 7 } as const
test("native Action contracts retain source identity, alias binding and exact runtime validation", () => {
  const source = `import { Action as Operation } from "vibelang:flows";
class Failed extends Error { constructor(readonly code: string) { super(code) } }
class Private extends Operation<(input: { "__proto__": number; "🐱": string }) => Result<readonly [number, string], Failed>> {}
export { Private as Work };`
  const result = compileActionContract(source, options)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  expect(validateActionContractDescriptor(result.descriptor)).toEqual(result.descriptor)
  expect(result.descriptor.version).toBe(7)
  expect(JSON.stringify(result.descriptor.errorSchema)).toContain("vibelang:contracts/actions.vibe@Failed@1")
  expect(validateDurableValue(result.descriptor.inputSchema, JSON.parse('{"__proto__":42,"🐱":"data"}'))).toEqual(JSON.parse('{"__proto__":42,"🐱":"data"}'))
  expect(() => validateDurableValue(result.descriptor.inputSchema, { "🐱": "data" })).toThrow()
  expect(Object.isFrozen(result.descriptor.inputSchema)).toBe(true)
  expect(compileActionContract(source, options)).toEqual(result)
})

for (const newline of ["\n", "\r\n", "\r", "\u2028", "\u2029"]) test(`native Action positions use authored UTF16 with ${JSON.stringify(newline)}`, () => {
  const source = [
    'import { Action } from "vibelang:flows";',
    'const emoji = "🐱"; export class Work extends Action<(input: unknown) => Result<number, never>> {}',
  ].join(newline)
  const result = compileActionContract(source, options)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error("expected a checked boundary refusal")
  const issue = result.diagnostics[0]!
  expect(issue.code).toBe("VIBE4203")
  expect(issue.line).toBe(2)
  expect(issue.column).toBe(source.split(newline)[1]!.indexOf("(input") + 1)
  expect(issue.length).toBe("(input: unknown) => Result<number, never>".length)
})

test("the standalone contract query has no ambient module resolution fallback", () => {
  for (const specifier of ["./value.ts", fileURLToPath(new URL("./value.ts", import.meta.url))]) {
    const result = compileActionContract(`import { Action } from "vibelang:flows";
import type { JsonValue } from ${JSON.stringify(specifier)};
export class Work extends Action<(input: JsonValue) => Result<number, never>> {}`, options)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics.some(issue => issue.code === "VIBE4200" && issue.message.includes("Cannot find module"))).toBe(true)
  }
})

for (const name of ["Café", "𝐁oom", "𐐀Failed", "Fail\u200Cure"]) test(`Unicode Error ${name} survives native derivation and executable-body loading`, async () => {
  const declaration = `class ${name} extends Error { constructor(readonly code: number) { super("failed") } }`
  const contract = compileActionContract(`import { Action } from "vibelang:flows"; ${declaration};
export class Work extends Action<(input: number) => Result<number, ${name}>> {}`, options)
  expect(contract.ok).toBe(true)
  if (!contract.ok) throw new Error(JSON.stringify(contract.diagnostics))
  const schema = contract.descriptor.errorSchema
  const identity = durableFailureIdentity(options.fileName, name)
  expect(validateActionContractDescriptor(contract.descriptor)).toEqual(contract.descriptor)
  expect(validateDurableValue(schema, { version: 1, identity, payload: { code: -1 } })).toEqual({ version: 1, identity, payload: { code: -1 } })
  const compiled = compileDurableBody(`import { durable } from "vibelang:flows"; ${declaration};
export const Flow = durable((n: number): Result<number, ${name}> => { if (n < 0) throw new ${name}(n); return n; });`, { fileName: options.fileName })
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const answer = await loadDurableBody(compiled.body).create(-1).computation.next()
  expect(answer.done).toBe(true)
  const result = __vsInspectResult(answer.value as never)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error("expected the authored typed failure")
  expect(result.error.constructor.name).toBe(name)
  expect((result.error as Error & { code: number }).code).toBe(-1)
})

test("nominal codec names remain identifiers, never arbitrary strings", () => {
  for (const name of ["", "1Failed", "a-b", "x.y", "Failure()", "Fail\nure", "🐱", "\ud800", "\u200CFailed"]) {
    expect(() => validateDurableTypeDescriptor({ kind: "error", identity: "test/Failed@1", name,
      payload: { kind: "object", fields: [] } })).toThrow()
  }
})
