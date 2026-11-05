import { expect, test } from "bun:test"
import fc from "fast-check"
import ts from "typescript"
import { fileURLToPath } from "node:url"
import { documentedExperimentalServiceCallProblems, experimentalServiceCallProblems, experimentalServiceMethods } from "./experimental-service-calls.mjs"

const services = experimentalServiceMethods()

test("documented experimental operations use service implementations", () => {
  expect(documentedExperimentalServiceCallProblems()).toEqual([])
})

test("experimental operation checks read the runtime declarations", () => {
  for (const [module, method] of [["Headers", "copy"], ["NodeStream", "fromWeb"], ["Request", "atUrl"], ["ChildProcess", "runInherited"]]) {
    const service = services.find(service => service.module === module)
    expect(service?.namespaceMethods).toContain(method)
    expect(service?.keyMethods).toContain(method)
  }
})

test("service lookup, pure functions and native key operations remain valid", () => {
  for (const text of [
    "try (try Experimental.Headers.Headers).copy(input)",
    "const headers = try Experimental.Headers.Headers; try headers.copy(input)",
    "Experimental.Headers.Headers.of(implementation)",
    "Experimental.Headers.layerTest(implementation)",
    "Experimental.NetAddress.isIPv6(address)",
    "Experimental.Encoding.decodeBase64Lenient(encoded)"
  ]) expect(experimentalServiceCallProblems(text, "example.md", services)).toEqual([])
})

test("generated module and key operation references require a service lookup", () => {
  const choices = services.flatMap(service => [
    ...service.namespaceMethods.map(method => ({ service, method, key: false })),
    ...service.keyMethods.map(method => ({ service, method, key: true }))
  ])
  expect(choices.length).toBeGreaterThan(0)
  fc.assert(fc.property(fc.constantFrom(...choices), fc.constantFrom("", " ", "\n", "\t"), fc.boolean(), ({ service, method, key }, spacing, called) => {
    const receiver = "Experimental." + service.module + (key ? "." + service.key : "")
    expect(experimentalServiceCallProblems(receiver + "." + method + (called ? spacing + "(value)" : ""), "generated.md", services)).toHaveLength(1)
    const valid = "try (try Experimental." + service.module + "." + service.key + ")." + method + "(value)"
    expect(experimentalServiceCallProblems(valid, "generated.md", services)).toEqual([])
  }), { numRuns: 200, seed: 3309 })
})

test("native TypeScript rejects namespace and key calls while accepting service lookup", () => {
  const file = fileURLToPath(new URL("../../packages/runtime/__docs_api_probe__.ts", import.meta.url))
  const options = {
    strict: true, noEmit: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts"]
  }
  const base = `import * as Effect from "effect/Effect"
import * as Experimental from "./src/experimental/index.js"
declare const input: globalThis.Headers
declare const request: globalThis.Request
declare const body: ReadableStream<Uint8Array>
declare const options: Experimental.NodeStream.Options
`
  const diagnostics = (text: string) => {
    const host = ts.createCompilerHost(options), getSourceFile = host.getSourceFile
    host.getSourceFile = (name, version, onError, create) => name === file
      ? ts.createSourceFile(name, base + text, version, true)
      : getSourceFile(name, version, onError, create)
    const program = ts.createProgram([file], options, host)
    return program.getSemanticDiagnostics(program.getSourceFile(file)).map(diagnostic => diagnostic.code)
  }
  expect(diagnostics(`export const a = Experimental.Headers.copy(input)
export const b = Experimental.NodeStream.fromWeb(body, options)
export const c = Experimental.Request.atUrl("https://example.test", request)
export const d = Experimental.Headers.Headers.copy(input)
export const e = Experimental.NodeStream.NodeStream.fromWeb(body, options)
export const f = Experimental.Request.Request.atUrl("https://example.test", request)
export const g = Experimental.ChildProcess.ChildProcess.runInherited("tool", [], { cwd: "." })
export const h = Experimental.Process.isRunning(0)
export const i = Experimental.Animations.nextFrameUnless(() => undefined)
`)).toEqual(Array(9).fill(2339))
  expect(diagnostics(`export const a = Effect.gen(function*() { const service = yield* Experimental.Headers.Headers; return yield* service.copy(input) })
export const b = Effect.gen(function*() { const service = yield* Experimental.NodeStream.NodeStream; return yield* service.fromWeb(body, options) })
export const c = Effect.gen(function*() { const service = yield* Experimental.Request.Request; return yield* service.atUrl("https://example.test", request) })
export const d = Effect.gen(function*() { const service = yield* Experimental.ChildProcess.ChildProcess; return yield* service.runInherited("tool", [], { cwd: "." }) })
export const e = Effect.gen(function*() { const service = yield* Experimental.Process.Process; return yield* service.isRunning(0) })
export const f = Effect.gen(function*() { const service = yield* Experimental.Animations.Animations; return yield* service.nextFrameUnless(() => undefined) })
export const pure = Experimental.NetAddress.isIPv6("::1")
`)).toEqual([])
})
