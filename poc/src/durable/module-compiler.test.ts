import { expect, test } from "bun:test"
import { getNativeCompiler } from "../compiler/native.ts"
import { compileDurableModule } from "./module-compiler.ts"
import { validateDurableBodyArtifact } from "./body-artifact.ts"
import { canonicalJson, digest } from "./value.ts"
import { createOffsetSourceMap, originalPosition } from "../language/source-map.ts"

const fileName = "module.vibe"
const compile = (source: string) => {
  const result = compileDurableModule(source, { fileName })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
}
const hostDeclarations = (source: string) => {
  const native = getNativeCompiler()
  const parsed = native.inspect([{ path: fileName, text: source, scriptKind: "typescript", declarationBindings: true }]).files[0]!
  expect(parsed.diagnostics).toHaveLength(0)
  const emitted = native.transpile({ files: [{ path: "module.ts", text: source }], options: { target: "es2022" } }).files[0]!
  expect(emitted.diagnostics).toHaveLength(0)
  expect(emitted.emitSkipped).toBe(false)
  return parsed.declarationBindings!.map(binding => binding.kind === "function" ? binding.name ?? undefined
    : source.slice(binding.nameSpan!.start, binding.nameSpan!.start + binding.nameSpan!.length))
}
const evaluate = (code: string): Record<string, any> => {
  const emitted = getNativeCompiler().transpile({ files: [{ path: "module.ts", text: code }],
    options: { target: "es2022", module: "commonjs" } }).files[0]!
  expect(emitted.diagnostics).toHaveLength(0)
  expect(emitted.emitSkipped).toBe(false)
  const javascript = emitted.javascript
  const exports: Record<string, unknown> = {}
  new Function("exports", javascript)(exports)
  return exports
}

test("modules without the compiler-owned import are exact no-ops", () => {
  const source = "function durable(f: () => number) { return f() }; export const value = durable(() => 7)"
  expect(compile(source)).toEqual({ ok: true, diagnostics: [], code: source })
})

test("module materialization resolves aliases and erases only private Flow helpers", () => {
  const result = compile(`import { durable as pin, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, never>> {}
function helper(n: number): Result<number, never> { return Read.run(n)! }
function flowBody(n: number): Result<number, never> { return helper(n)! }
export const Flow = pin(flowBody)
export function main() { return Flow.manifest.flowId }`)
  expect(hostDeclarations(result.code)).toEqual(["Flow", "main"])
  const module = evaluate(result.code)
  expect(module.main()).toBe("module.vibe#Flow")
  expect(canonicalJson(module.Flow)).toBe(canonicalJson(result.flow))
  expect(validateDurableBodyArtifact(module.Flow.body).digest).toBe(result.flow!.body!.digest)
})

test("shorthand exports and export specifiers retain their private helper dependency closure", () => {
  for (const exposure of ["export const outside = { helper }", "export { helper }"]) {
    const result = compile(`import { durable } from "vibelang:flows"
function twice(n: number) { return n * 2 }
function helper(n: number) { return twice(n) + 1 }
export const Flow = durable((n: number) => helper(n))
${exposure}`)
    expect(hostDeclarations(result.code)).toContain("helper")
    expect(hostDeclarations(result.code)).toContain("twice")
    const module = evaluate(result.code)
    expect((module.helper ?? module.outside.helper)(3)).toBe(7)
  }
})

test("private helper overload declarations follow their implementation into the Flow closure", () => {
  const result = compile(`import { durable } from "vibelang:flows"
function twice(n: number): number;
function twice(n: number) { return n * 2 }
export const Flow = durable((n: number) => twice(n))`)
  expect(hostDeclarations(result.code)).toEqual(["Flow"])
  expect(validateDurableBodyArtifact(evaluate(result.code).Flow.body).digest).toBe(result.flow!.body!.digest)
})

test("exported default parameters retain the complete helper dependency closure", () => {
  for (const exposure of ["export { outside }", "export { outside as renamed }", "export const api = { outside }"]) {
    const result = compile(`import { durable } from "vibelang:flows"
function twice(n: number) { return n * 2 }
function defaultValue() { return twice(21) }
function outside(n = defaultValue()) { return n }
${exposure}
export const Flow = durable((n: number) => twice(n))`)
    expect(hostDeclarations(result.code)).toContain("twice")
    const module = evaluate(result.code)
    const outside = module.outside ?? module.renamed ?? module.api.outside
    expect(outside()).toBe(42)
    expect(outside(7)).toBe(7)
    expect(validateDurableBodyArtifact(module.Flow.body).digest).toBe(result.flow!.body!.digest)
  }
})

test("private const function literals can occupy any part of a retained declaration list", () => {
  const helper = "read = (n: number): Result<number, never> => Read.run(n)!"
  for (const declarations of [helper, `${helper}, before = 1`, `before = 1, ${helper}`,
    `before = 1, ${helper}, after = 2`, `${helper}, second = (n: number) => n, before = 1`]) {
    const result = compile(`import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, never>> {}
const ${declarations}
export const Flow = durable((n: number): Result<number, never> => read(n)!)`)
    expect(hostDeclarations(result.code)).not.toContain("read")
    if (declarations.includes("before")) expect(hostDeclarations(result.code)).toContain("before")
    if (declarations.includes("after")) expect(hostDeclarations(result.code)).toContain("after")
    // The unrelated function literal stays, even though the emitted Flow does
    // not need it. This is closure extraction, not whole-module dead-code removal.
    if (declarations.includes("second")) expect(hostDeclarations(result.code)).toContain("second")
    expect(validateDurableBodyArtifact(evaluate(result.code).Flow.body).digest).toBe(result.flow!.body!.digest)
  }
})

test("materializing a descriptor preserves an own __proto__ schema field as data", () => {
  const result = compile(`import { durable, Action } from "vibelang:flows"
class Read extends Action<(input: { __proto__: number }) => Result<number, never>> {}
export const Flow = durable((input: { __proto__: number }) => Read.run(input))`)
  const flow = evaluate(result.code).Flow
  expect(canonicalJson(flow)).toBe(canonicalJson(result.flow))
  expect(validateDurableBodyArtifact(flow.body).digest).toBe(result.flow!.body!.digest)
  expect(flow.body.inputSchema.descriptor.fields.map((field: { name: string }) => field.name)).toEqual(["__proto__"])
  const literal = compile(`import { durable } from "vibelang:flows"
export const Flow = durable((__proto__: number) => { return { __proto__ } })`)
  const literalFlow = evaluate(literal.code).Flow
  expect(Object.hasOwn(literalFlow.plan.output.fields, "__proto__")).toBe(true)
  expect(canonicalJson(literalFlow)).toBe(canonicalJson(literal.flow))
})

test("the descriptor is unmapped while surviving host tokens retain exact authored locations", () => {
  const source = `import { durable } from "vibelang:flows"
export const Flow = durable((n: number) => n + 1)
export const marker = 123`
  const result = compile(source)
  const positionOf = (text: string, search: string) => {
    // The pinned source is also serialized inside the descriptor. Locate the
    // surviving authored declaration, not that deliberately unmapped string.
    const lines = text.slice(0, text.lastIndexOf(search)).split("\n")
    return { line: lines.length - 1, column: lines.at(-1)!.length }
  }
  const generated = positionOf(result.code, "marker")
  expect(originalPosition(result.sourceMap!, generated.line, generated.column))
    .toEqual({ source: fileName, ...positionOf(source, "marker") })
  const glue = positionOf(result.code, '"bodyVersion"')
  expect(originalPosition(result.sourceMap!, glue.line, glue.column)).toBeUndefined()
})

test("earlier lowering pins authored source and sites plus its tracked-input identity", () => {
  const source = `import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, never>> {}
export const Flow = durable((n: number) => Read.run(n))`
  const prefix = "// removed by an earlier compiler stage\n"
  const authored = prefix + source
  const sourceMap = createOffsetSourceMap({ derivedText: source, authoredText: authored,
    runs: [{ derivedStart: 0, authoredStart: prefix.length, length: source.length }],
    sourceName: fileName, fileName: `${fileName}.stage.ts` })
  const origin = { text: authored, sourceMap, loweringIdentity: digest({ tracked: 1 }) }
  const result = compileDurableModule(source, { fileName, sourceOrigin: origin })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  const body = result.flow!.body!
  expect(body.source).toEqual({ fileName, text: authored })
  expect(body.sourceIdentity).toBe(digest(body.source))
  expect(body.loweringIdentity).toBe(origin.loweringIdentity)
  expect(body.manifest.sites.map(site => site.anchor)).toEqual([`3:${source.split("\n")[2]!.indexOf("Read.run")}`])
  expect(validateDurableBodyArtifact(body).digest).toBe(body.digest)

  const changed = compileDurableModule(source, { fileName,
    sourceOrigin: { ...origin, loweringIdentity: digest({ tracked: 2 }) } })
  if (!changed.ok) throw new Error(JSON.stringify(changed.diagnostics))
  expect(changed.flow!.body!.javascript).toBe(body.javascript)
  expect(changed.flow!.body!.digest).not.toBe(body.digest)
  for (const invalid of [{ ...origin, text: "wrong authored source" },
    { ...origin, loweringIdentity: "not a digest" }, { ...origin, sourceMap: "malformed" }]) {
    const refused = compileDurableModule(source, { fileName, sourceOrigin: invalid })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.diagnostics[0]!.code).toBe("VIBE4101")
  }
  const unmapped = compileDurableModule(source, { fileName, sourceOrigin: { ...origin,
    sourceMap: createOffsetSourceMap({ derivedText: source, authoredText: authored,
      runs: [], sourceName: fileName, fileName: `${fileName}.stage.ts` }),
  } })
  expect(unmapped.ok).toBe(false)
  if (!unmapped.ok) expect(unmapped.diagnostics[0]!.message).toContain("no authored location")
})
