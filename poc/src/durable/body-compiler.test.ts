import { expect, test } from "bun:test"
import { compileDurableBody } from "./body-compiler.ts"
import { loadDurableBody, validateDurableBodyArtifact } from "./body-artifact.ts"
import { DurableStore } from "./store.ts"
import { ReplayDriver } from "./replay.ts"
import { compileDurableFlow, compileEffectManifest } from "./source-compiler.ts"
import { assertJson, digest, type JsonValue } from "./value.ts"
import { __vsInspectResult, isResult } from "../runtime/result.ts"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const source = `
import { durable, Action } from "vibelang:flows"
class Missing extends Error { constructor(readonly n: number) { super("missing") } }
class Read extends Action<(n: number) => Result<number, Missing>> {}
const bias = 2
function recurse(n: number): Result<number, Missing> {
  if (n <= 0) return bias
  return Read.run(n)! + recurse(n - 1)!
}
export const Flow = durable((n: number) => {
  const alias = recurse
  const local = (i: number): Result<number, Missing> => alias(i)!
  let sum = 0
  for (let i = 0; i < n; i++) sum += local(i)!
  return sum
})
export function main() { return [Flow.artifactSource] }
`

function compile(text: string, name: string) {
  const result = compileDurableBody(text, { fileName: `${name}.vibe` })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
}

test("the emitted body is checked as TypeScript independently of the source suffix", async () => {
  for (const fileName of ["body-entry.vibe", "body-entry.ts"]) {
    const result = compileDurableBody(`import { durable } from "vibelang:flows"
export const Flow = durable((input: number) => input + 1)`, { fileName })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
    expect(await loadDurableBody(result.body).create(1).computation.next()).toEqual({ value: 2, done: true })
  }
})

test("native Flow factories preserve authored names and default-export initialization", async () => {
  const cases = [
    ["runtime-name", "const __runtime = 41", "__runtime + input"],
    ["runtime-names", "const __runtime = 40, __runtime_1 = 1", "__runtime + __runtime_1 + input"],
    ["default-value", "export default 41", "41 + input"],
    ["default-effect", "let state = 40; export default (state += 1); state += 1", "state"],
    ["default-class", 'let seen = ""; export default class { static value = (seen = this.name) }', 'seen === "default" ? 42 : 0'],
    ["default-class-expression", 'let seen = ""; export default (class { static value = (seen = this.name) })', 'seen === "default" ? 42 : 0'],
  ] as const
  for (const [name, initialization, value] of cases) {
    const compiled = compile(`import { durable } from "vibelang:flows"\n${initialization}\nexport const Flow = durable((input: number) => ${value})`, `native-factory-${name}`)
    validateDurableBodyArtifact(compiled.body)
    const loaded = loadDurableBody(compiled.body)
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await loaded.create(1).computation.next()).toEqual({ value: 42, done: true })
    }
  }
})

test("module initialization keeps mutations, aliases, and statement order in every Flow attempt", async () => {
  const initializations = [
    'const table = new Map<string, number>(); table.set("a", 41)',
    'const table = new Map<string, number>(); const alias = table; alias.set("a", 41)',
    'const table = new Map<string, number>(); function initialize() { table.set("a", 41) }; initialize()',
    'const table = new Map<string, number>(); const unused = table.set("a", 41)',
    'const table = new Map<string, number>(); for (const value of [40, 41]) { table.set("a", value) }',
    'const table = new Map<string, number>(); class Initializer { static initialized = table.set("a", 41) }',
  ]
  for (const [index, initialization] of initializations.entries()) {
    const compiled = compile(`import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, never>> {}
${initialization}
export const Flow = durable((n: number): Result<number, never> => {
  const before = table.get("a") ?? 0
  table.set("a", before + 100)
  return before + Read.run(n)!
})
table.set("a", (table.get("a") ?? 0) + 1)
export function main() { return [Flow.artifactSource] }
`, `module-initialization-${index}`)
    const store = new DurableStore()
    let calls = 0
    try {
      store.initializeBodyExecution("initialized", compiled.body, digest({ index }), 1)
      for (let attemptIndex = 0; attemptIndex < 2; attemptIndex++) {
        const attempt = loadDurableBody(compiled.body).create(1)
        const result = await new ReplayDriver({ mode: "on", store, executionId: "initialized", owner: "test",
          dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
          perform: () => { calls++; return { kind: "success", value: 1 } },
        }).run(() => attempt.computation)
        expect(__vsInspectResult(result as never)).toEqual({ ok: true, value: 43 })
      }
      expect(calls).toBe(1)
    } finally { store.close() }
  }
})

test("unsupported module initialization is diagnosed instead of silently omitted", () => {
  const compiled = compileDurableBody(`import { durable } from "vibelang:flows"
const state = { value: 0 }
class Initialize { static { state.value = 41 } }
export const Flow = durable((n: number) => state.value + n)`, { fileName: "initialization-diagnostic.vibe" })
  expect(compiled.ok).toBe(false)
  if (!compiled.ok) expect(compiled.diagnostics).toMatchObject([{ code: "VIBE1107", line: 3 }])
})

test("nested durable declarations return source diagnostics from every public compilation API", () => {
  const bodies = [
    "export function make(bias: number) { const F = durable((input: number) => bias + input); return F }",
    "if (true) { const F = durable((input: number) => input + 1) }",
    "class Factory { make(bias: number) { const F = durable((input: number) => bias + input); return F } }",
  ]
  for (const body of bodies) {
    const source = `import { durable } from "vibelang:flows"\n${body}`
    for (const compile of [compileDurableBody, compileDurableFlow, compileEffectManifest]) {
      const result = compile(source, { fileName: "nested-durable.vibe" })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.diagnostics.length).toBeGreaterThan(0)
        expect(result.diagnostics.every(issue => issue.file === "nested-durable.vibe")).toBe(true)
      }
    }
  }
})

test("an unsupported import cannot hide an unknown Flow output behind a manifest-only fallback", () => {
  const source = `import { durable } from "vibelang:flows"
import { Unused } from "not:compiler-bound"
const local = { run(value: unknown) { return value } }
export const Flow = durable((input: number) => local.run(input))
void Unused`
  for (const compile of [compileDurableBody, compileDurableFlow, compileEffectManifest]) {
    const result = compile(source, { fileName: "unknown-before-fallback.vibe" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics).toMatchObject([{ code: "VIBE4110", file: "unknown-before-fallback.vibe", line: 4 }])
  }
})

test("module initialization cannot execute an Action outside the durable handler", () => {
  const source = `import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, never>> {}
function read(n: number): Result<number, never> { return Read.run(n)! }
const initial = read(1).unwrapOr(0)
export const Flow = durable((n: number) => initial + read(n).unwrapOr(0))`
  for (const compile of [compileDurableBody, compileDurableFlow]) {
    const result = compile(source, { fileName: "module-action.vibe" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics.some(issue => issue.code === "VIBE2102")).toBe(true)
  }
})

test("retired durable corpus walls execute their authored inputs and replay without another worker", async () => {
  const cases = [
    ["a-call-to-a-project-function-in-a-flow-body-is-rejected", { key: "authored" }, "authored"],
    ["a-let-binding-in-a-flow-body-is-rejected", { key: "mutable" }, "mutable"],
    ["closure-capture-of-a-module-value-in-a-flow-body-is-rejected", { key: "ignored" }, "offline"],
    ["an-action-input-projection-the-descriptor-does-not-have-is-rejected", { items: ["a", "b", "c"] }, 3],
    ["an-action-input-projection-through-a-durable-string-is-rejected", { text: "😀" }, 2],
    ["a-result-return-annotation-on-a-flow-is-rejected", { key: "annotated" }, "annotated"],
  ] as const
  for (const [name, input, key] of cases) {
    const text = readFileSync(join(import.meta.dir, "../../../conformance/corpus/17-durable", `${name}.vibe`), "utf8")
    const compiled = compileDurableFlow(text, { fileName: `${name}.vibe` })
    if (!compiled.ok || !compiled.flow.body) throw new Error(JSON.stringify(compiled))
    const artifact = compiled.flow.body
    const loaded = loadDurableBody(artifact)
    const store = new DurableStore()
    let calls = 0
    try {
      store.initializeBodyExecution(name, artifact, digest({ name }), assertJson(input, "corpus input"))
      for (let round = 0; round < 2; round++) {
        const attempt = loaded.create(input)
        const driver = new ReplayDriver({ mode: "on", store, executionId: name, owner: "corpus-body-test",
          dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
          perform: request => {
            calls++
            expect(request.input).toEqual({ key })
            return { kind: "success", value: { value: String(key) } }
          },
        })
        const value = await driver.run(() => attempt.computation)
        expect(isResult(value) ? __vsInspectResult(value) : { ok: true, value })
          .toEqual({ ok: true, value: { value: String(key) } })
      }
      expect(calls).toBe(1)
    } finally { store.close() }
  }
})

test("lowered Action requests retain their checked input type and reject invalid arity before emit", () => {
  for (const argument of ['"wrong"', '1, { schema: "not allowed" }', "", "...[1]"]) {
    const compiled = compileDurableBody(`import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, never>> {}
export const Flow = durable((n: number) => Read.run(${argument}))`, { fileName: "bad-input.vibe" })
    expect(compiled.ok).toBe(false)
    if (compiled.ok) throw new Error("expected a source diagnostic, not an emitted malformed request")
    expect(compiled.diagnostics[0]!.code).toBe(argument === '"wrong"' ? "TS2345" : "VIBE4113")
    expect(compiled.diagnostics[0]!.file).toBe("bad-input.vibe")
    expect(compiled.diagnostics[0]!.line).toBe(3)
  }
})

test("a non-finite literal cannot become a persisted request value", () => {
  const compiled = compileDurableBody(`import { durable, Action } from "vibelang:flows"
class Read extends Action<(input: { size: number }) => Result<number, never>> {}
export const Flow = durable((n: number) => Read.run({ size: -1e999 }))`, { fileName: "infinite.vibe" })
  expect(compiled.ok).toBe(false)
  if (compiled.ok) throw new Error("non-finite request literal compiled")
  expect(compiled.diagnostics).toMatchObject([{ code: "VIBE4111", file: "infinite.vibe", line: 3 }])
  expect(compile(`import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, never>> {}
export const Flow = durable((n: number) => {
  const ceiling = 1e999
  return Read.run(n < ceiling ? n : 0)
})`, "local-infinity").ok).toBe(true)
})

for (const asynchronous of [false, true]) test(`${asynchronous ? "async" : "sync"} overloaded helpers preserve their call contracts through durable execution`, async () => {
  const resultType = asynchronous ? "Promise<Result<number, never>>" : "Result<number, never>"
  const text = `import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, never>> {}
function read(n: number): ${resultType};
${asynchronous ? "async " : ""}function read(n: number): ${resultType} {
  ${asynchronous ? "await Promise.resolve()" : ""}
  return Read.run(n)!
}
export const Flow = durable(${asynchronous ? "async " : ""}(n: number): ${resultType} => (${asynchronous ? "await " : ""}read(n))!)`
  const compiled = compile(text, `overloaded-${asynchronous}`)
  const store = new DurableStore()
  let calls = 0
  try {
    store.initializeBodyExecution("overload", compiled.body, digest({ overload: asynchronous }), 3)
    for (let round = 0; round < 2; round++) {
      const attempt = loadDurableBody(compiled.body).create(3)
      const result = await new ReplayDriver({ mode: "on", store, executionId: "overload", owner: "test",
        dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
        perform: request => { calls++; expect(request.input).toBe(3); return { kind: "success", value: 6 } },
      }).run(() => attempt.computation)
      expect(__vsInspectResult(result as never)).toEqual({ ok: true, value: 6 })
    }
    expect(calls).toBe(1)
  } finally { store.close() }
  // The implementation accepts a wider input, but callers still have to match
  // the authored overload; retaining only the implementation would fail open.
  const invalid = compileDurableBody(text.replace("read(n: number):", "read(n: 1):"),
    { fileName: `overloaded-invalid-${asynchronous}.vibe` })
  expect(invalid.ok).toBe(false)
  if (!invalid.ok) expect(invalid.diagnostics.map(issue => issue.code)).toContain("TS2345")
})

test("a callback consumer cannot silently discard a suspended Action computation", () => {
  for (const statement of [
    "return items.map(n => Read.run(n).unwrapOr(0)).length",
    "const read = (n: number) => Read.run(n).unwrapOr(0); return items.map(read).length",
    "items.forEach(n => { const value = Read.run(n).unwrapOr(0); }); return 1",
    "function each<A>(xs: A[], f: (a: A) => unknown): number { for (const x of xs) f(x); return xs.length }; return each(items, n => Read.run(n).unwrapOr(0))",
  ]) {
    const text = `import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, never>> {}
export const Flow = durable((items: number[]) => { ${statement} })`
    for (const [index, compiled] of [compileDurableBody(text, { fileName: "callback.vibe" }), compileDurableFlow(text, { fileName: "callback.vibe" })].entries()) {
      expect(compiled.ok).toBe(false)
      if (compiled.ok) throw new Error("a callback computation would be discarded")
      // An unresolved function parameter is refused earlier by the Manifest;
      // the public legacy fallback reports its own type refusal for that case.
      // Native consumers reach the calling-convention guard on both paths.
      expect(compiled.diagnostics.map(issue => issue.code)).toContain(
        statement.startsWith("function each") ? index === 0 ? "VIBE4199" : "VIBE4100" : "VIBE1802")
    }
  }
  expect(compile(`import { durable } from "vibelang:flows"
export const Flow = durable((items: number[]) => items.map(n => n + 1).length)`, "pure-map").ok).toBe(true)
})

test("compiled lexical Layers supply nominal capabilities across durable suspension and replay", async () => {
  const compiled = compile(`
import { durable, Action } from "vibelang:flows"
import { Context } from "vibelang/context"
import { Layer } from "vibelang/provider"
class Rates extends Context { declare readonly multiplier: number }
class Read extends Action<(n: number) => Result<number, never>> {}
function price(n: number): Result<number, never> {
  const before = Rates.context().multiplier
  const value = Read.run(n)!
  return value * before + Rates.context().multiplier
}
export const Flow = durable((n: number): Result<number, never> => {
  return Layer.provide(Layer.succeed(Rates, { multiplier: 3 }), () => price(n))
})`, "body-layer")
  expect(compiled.body.manifest.requirements).toEqual(["body-layer.vibe#Read"])
  expect(compiled.body.manifest.sites.filter(site => site.kind === "get").map(site => site.key))
    .toEqual(["body-layer.vibe#Rates", "body-layer.vibe#Rates"])
  const loaded = loadDurableBody(compiled.body)
  const store = new DurableStore()
  let calls = 0
  try {
    store.initializeBodyExecution("layer", compiled.body, digest({ deployment: "layer" }), 4)
    for (let round = 0; round < 2; round++) {
      const attempt = loaded.create(4)
      const driver = new ReplayDriver({ mode: "on", store, executionId: "layer", owner: "test",
        dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
        perform: request => { calls++; return { kind: "success", value: assertJson(request.input, "test input") } },
      })
      expect(__vsInspectResult(await driver.run(() => attempt.computation) as never)).toEqual({ ok: true, value: 15 })
    }
    expect(calls).toBe(1)
    expect(store.journal("layer").filter(event => event.type === "node_succeeded")).toHaveLength(1)
  } finally { store.close() }
})

test("async compiled bodies delegate Actions through async and sync Result frames and replay awaited cleanup", async () => {
  const compiled = compile(`
import { durable, Action } from "vibelang:flows"
class Missing extends Error { constructor(readonly n: number) { super("missing") } }
class Read extends Action<(n: number) => Result<number, Missing>> {}
function read(n: number): Result<number, Missing> { return Read.run(n)! }
export const Flow = durable(async (n: number) => {
  const events: string[] = []
  async function inner(): Promise<Result<number, Missing>> {
    try {
      await Promise.resolve()
      return read(n)! + read(n + 1)!
    } finally {
      await Promise.resolve()
      events.push("finally")
    }
  }
  const result = await inner()
  return result.match({
    ok: value => ({ value, log: events.join(",") }),
    error: error => ({ value: error.is(Missing) ? -error.n : -100, log: events.join(",") }),
  })
})`, "body-async")
  expect(compiled.body.async).toBe(true)
  const body = loadDurableBody(compiled.body)
  const store = new DurableStore()
  const calls: number[] = []
  try {
    const run = async (n: number) => {
      const id = `async-${n}`
      store.initializeBodyExecution(id, compiled.body, digest({ deployment: "async" }), n)
      const attempt = body.create(n)
      return new ReplayDriver({ mode: "on", store, executionId: id, owner: "test",
        dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
        perform: async (request): Promise<JsonValue> => {
          await Promise.resolve()
          const value = request.input as number
          calls.push(value)
          return value === 2 ? { kind: "failure", error: { version: 1,
            identity: compiled.body.errors[0]!.durable, payload: { message: "missing", n: value } } }
            : { kind: "success", value }
        },
      }).run(() => attempt.computation)
    }
    expect(await Promise.all([run(0), run(2)])).toEqual([{ value: 1, log: "finally" }, { value: -2, log: "finally" }])
    expect([...calls].sort((left, right) => left - right)).toEqual([0, 1, 2])
    expect(await Promise.all([run(0), run(2)])).toEqual([{ value: 1, log: "finally" }, { value: -2, log: "finally" }])
    expect(calls).toHaveLength(3)
  } finally { store.close() }
})

for (const asynchronous of [false, true]) test(`${asynchronous ? "async" : "sync"} failure cleanup retains its Layer and journals cleanup Actions before recovery`, async () => {
  const compiled = compile(`
import { durable, Action } from "vibelang:flows"
import { Context } from "vibelang/context"
import { Layer } from "vibelang/provider"
class Rates extends Context { declare readonly multiplier: number }
class Missing extends Error { constructor(readonly n: number) { super("missing") } }
class Read extends Action<(n: number) => Result<number, Missing>> {}
class Cleanup extends Action<(n: number) => Result<number, never>> {}
export const Flow = durable(${asynchronous ? "async" : ""} (n: number) => {
  const events: string[] = []
  const result = ${asynchronous ? "await" : ""} Layer.provide(Layer.succeed(Rates, { multiplier: n + 1 }),
    ${asynchronous ? "async" : ""} (): ${asynchronous ? "Promise<Result<number, Missing>>" : "Result<number, Missing>"} => {
      try {
        ${asynchronous ? "await Promise.resolve()" : ""}
        return Read.run(n)! * Rates.context().multiplier
      } finally {
        ${asynchronous ? "await Promise.resolve()" : ""}
        const cleaned = Cleanup.run(Rates.context().multiplier)!
        events.push("cleaned:" + cleaned)
      }
    })
  return result.match({ ok: value => ({ value, log: events.join(",") }),
    error: error => ({ value: error.is(Missing) ? -error.n : -100, log: events.join(",") }) })
})`, `body-cleanup-${asynchronous}`)
  const loaded = loadDurableBody(compiled.body)
  const store = new DurableStore()
  const calls: unknown[] = []
  try {
    store.initializeBodyExecution("cleanup", compiled.body, digest({ deployment: "cleanup" }), 4)
    for (let round = 0; round < 2; round++) {
      const attempt = loaded.create(4)
      const driver = new ReplayDriver({ mode: "on", store, executionId: "cleanup", owner: "test",
        dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
        perform: (request): JsonValue => {
          calls.push([request.key, request.input])
          return String(request.key).endsWith("#Cleanup") ? { kind: "success", value: assertJson(request.input, "cleanup input") } :
            { kind: "failure", error: { version: 1, identity: compiled.body.errors[0]!.durable,
              payload: { message: "missing", n: 4 } } }
        },
      })
      expect(await driver.run(() => attempt.computation)).toEqual({ value: -4, log: "cleaned:5" })
    }
    expect(calls).toEqual([[`body-cleanup-${asynchronous}.vibe#Read`, 4], [`body-cleanup-${asynchronous}.vibe#Cleanup`, 5]])
    expect(store.journal("cleanup").filter(event => event.type === "node_succeeded")).toHaveLength(2)
  } finally { store.close() }
})

test("ordinary compiled Flow bodies execute closures, recursion and mutable locals and replay committed answers", async () => {
  const compiled = compile(source, "body-recurse")
  const body = loadDurableBody(compiled.body)
  const store = new DurableStore()
  const deploymentDigest = digest({ body: compiled.body.digest, implementation: "increment-v1" })
  const pinned = { planDigest: compiled.body.digest, manifestDigest: deploymentDigest }
  try {
    store.initializeBodyExecution("compiled", compiled.body, deploymentDigest, 4)
    const calls: unknown[] = []
    let attempt = body.create(4)
    const driver = new ReplayDriver({ mode: "on", store, executionId: "compiled", owner: "first", pinned,
      validateRequest: request => attempt.validateRequest(request), decodeAnswer: (request, answer) => attempt.decodeAnswer(request, answer),
      perform: request => { calls.push(request.input); return { kind: "success", value: request.input as number } },
    })
    const first = await driver.run(() => attempt.computation)
    expect(isResult(first)).toBe(true)
    expect(__vsInspectResult(first as never)).toEqual({ ok: true, value: 18 })
    expect(calls).toEqual([1, 2, 1, 3, 2, 1])
    const ids = store.journal("compiled").filter(event => event.type === "attempt_started").map(event => event.nodeId)
    const site = compiled.body.manifest.sites[0]!.id
    expect(ids).toEqual(Array.from({ length: 6 }, (_, i) => `${site}#${i}`))
    attempt = body.create(4)
    expect(__vsInspectResult(await driver.run(() => attempt.computation) as never)).toEqual({ ok: true, value: 18 })
    expect(calls).toHaveLength(6)
    expect(driver.audit).toMatchObject({ replayed: 6, dispatchedLive: 0 })
  } finally { store.close() }
})

test("live and replayed typed failures rehydrate the authored Error and abandon only the inner Result frame", async () => {
  const compiled = compile(`
import { durable, Action } from "vibelang:flows"
class Missing extends Error { constructor(readonly n: number) { super("missing") } }
class Read extends Action<(n: number) => Result<number, Missing>> {}
export const Flow = durable((n: number) => {
  const events: string[] = []
  function inner(): Result<number, Missing> {
    try { return Read.run(n)! }
    finally { events.push("finally") }
  }
  const result = inner()
  return result.match({
    ok: value => ({ value, log: events.join(",") }),
    error: error => ({ value: error.is(Missing) ? error.n : -1, log: events.join(",") }),
  })
})`, "body-failure")
  const body = loadDurableBody(compiled.body)
  const store = new DurableStore()
  const deploymentDigest = digest({ implementation: "failure-v1", body: compiled.body.digest })
  let calls = 0
  try {
    store.initializeBodyExecution("failure", compiled.body, deploymentDigest, 7)
    let attempt = body.create(7)
    const driver = new ReplayDriver({ mode: "on", store, executionId: "failure", owner: "first",
      pinned: { planDigest: compiled.body.digest, manifestDigest: deploymentDigest },
      validateRequest: request => attempt.validateRequest(request), decodeAnswer: (request, answer) => attempt.decodeAnswer(request, answer),
      perform: () => { calls++; return { kind: "failure", error: {
        version: 1, identity: compiled.body.errors[0]!.durable, payload: { message: "missing", n: 7 },
      } } },
    })
    expect(await driver.run(() => attempt.computation)).toEqual({ value: 7, log: "finally" })
    attempt = body.create(7)
    expect(await driver.run(() => attempt.computation)).toEqual({ value: 7, log: "finally" })
    expect(calls).toBe(1)
  } finally { store.close() }
})

test("body, source, codecs and manifest are all pinned before execution", () => {
  const first = compile(`import {durable} from "vibelang:flows"; export const Flow=durable((n:number)=>n+1)`, "body-pins")
  const second = compile(`import {durable} from "vibelang:flows"; export const Flow=durable((n:number)=>n+2)`, "body-pins")
  expect(first.body.manifest.digest).toBe(second.body.manifest.digest)
  expect(first.body.sourceIdentity).not.toBe(second.body.sourceIdentity)
  expect(first.body.digest).not.toBe(second.body.digest)
  expect(() => validateDurableBodyArtifact({ ...first.body, javascript: second.body.javascript })).toThrow("digest mismatch")
  const store = new DurableStore()
  try {
    const deployment = digest({ implementation: "pure" })
    store.initializeBodyExecution("pinned", first.body, deployment, 1)
    expect(() => store.initializeBodyExecution("pinned", second.body, deployment, 1)).toThrow("is pinned")
    expect(() => store.initializeBodyExecution("pinned", first.body, deployment, 2)).toThrow("different input")
    expect(store.journal("pinned")).toHaveLength(1)
  } finally { store.close() }
})

test("a do-body that returns before testing its condition has no phantom undefined output", async () => {
  const compiled = compile(`import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, Error>> {}
export const Flow = durable((n: number) => { do { return Read.run(n) } while (n) })`, "body-do")
  const store = new DurableStore()
  try {
    store.initializeBodyExecution("do", compiled.body, digest({ deployment: "do" }), 0)
    const attempt = loadDurableBody(compiled.body).create(0)
    const result = await new ReplayDriver({ mode: "on", store, executionId: "do", owner: "test",
      dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
      perform: () => ({ kind: "success", value: 42 }),
    }).run(() => attempt.computation)
    expect(__vsInspectResult(result as never)).toEqual({ ok: true, value: 42 })
    expect(compiled.body.successSchema.descriptor).toEqual({ kind: "number" })
  } finally { store.close() }
})

test("the public Flow compiler emits a pinned executable body for code outside the Plan subset", () => {
  const compiled = compileDurableFlow(source, { fileName: "body-public.vibe" })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan).toBeUndefined()
  expect(compiled.flow.body?.source.text).toBe(source)
  expect(compiled.flow.body?.manifest).toEqual(compiled.manifest)
  expect(compiled.flow.body?.javascript).toContain("function* recurse")
})

test("a worker answer that fails its derived codec is never committed", async () => {
  const compiled = compile(source, "body-malformed")
  const body = loadDurableBody(compiled.body)
  const store = new DurableStore()
  const deployment = digest({ implementation: "malformed" })
  try {
    store.initializeBodyExecution("malformed", compiled.body, deployment, 2)
    const attempt = body.create(2)
    const driver = new ReplayDriver({ mode: "on", store, executionId: "malformed", owner: "first",
      dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
      perform: () => ({ kind: "success", value: "not a number" }),
    })
    await expect(driver.run(() => attempt.computation)).rejects.toThrow("number")
    expect(store.journal("malformed").some(event => event.type === "node_succeeded")).toBe(false)
    expect(store.getExecution("malformed").status).toBe("running")
  } finally { store.close() }
})

test("module captures and nominal codecs belong to each attempt, including overlapping source versions", async () => {
  const text = (version: number) => `
import { durable, Action } from "vibelang:flows"
class Missing extends Error { constructor(readonly n: number) { super("missing") } }
class Read extends Action<(n: number) => Result<number, Missing>> {}
const state = { calls: 0 }
export const Flow = durable((n: number) => {
  state.calls++
  return Read.run(n).match({
    ok: value => value + state.calls + ${version},
    error: error => error.is(Missing) ? error.n + state.calls + ${version} : -1,
  })
})`
  const versions = [compile(text(10), "same-module"), compile(text(20), "same-module")]
  const store = new DurableStore()
  try {
    const run = async (index: number, id: string) => {
      const artifact = versions[index]!.body
      const body = loadDurableBody(artifact)
      const attempt = body.create(4)
      const deployment = digest({ body: artifact.digest })
      store.initializeBodyExecution(id, artifact, deployment, 4)
      const driver = new ReplayDriver({ mode: "on", store, executionId: id, owner: id,
        dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
        perform: async () => { await Promise.resolve(); return { kind: "failure", error: {
          version: 1, identity: artifact.errors[0]!.durable, payload: { n: 4, message: "missing" },
        } } },
      })
      return driver.run(() => attempt.computation)
    }
    expect(await Promise.all([run(0, "one"), run(1, "two"), run(0, "three")])).toEqual([15, 25, 15])
    expect(await run(0, "one")).toBe(15)
  } finally { store.close() }
})

test("a real process death after commit replays an emitted Flow body without repeating the committed Action", async () => {
  const compiled = compile(source, "body-process-crash")
  const directory = mkdtempSync(join(tmpdir(), "vibelang-compiled-body-crash-"))
  try {
    const database = join(directory, "journal.sqlite")
    const artifact = join(directory, "flow.json")
    const ledger = join(directory, "calls.log")
    writeFileSync(artifact, JSON.stringify(compiled.body))
    writeFileSync(ledger, "")
    const run = async (mode: string) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../test/fixtures/durable-body-crash-runner.ts"),
        mode, database, artifact, ledger], { stdin: "ignore", stdout: "pipe", stderr: "pipe",
        env: { PATH: process.env.PATH ?? "" } })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code, stdout, stderr }
    }
    const killed = await run("kill-after-commit")
    expect(killed.code).not.toBe(0)
    expect(killed.stderr).toBe("")
    expect(readFileSync(ledger, "utf8").trim().split("\n")).toHaveLength(1)
    const resumed = await run("resume")
    expect(resumed.stderr).toBe("")
    expect(resumed.code).toBe(0)
    expect(JSON.parse(resumed.stdout)).toEqual({ value: 18,
      audit: { requests: 6, recorded: 1, replayed: 1, dispatchedLive: 5 }, status: "completed", integrity: ["ok"] })
    const calls = readFileSync(ledger, "utf8").trim().split("\n")
    expect(calls).toHaveLength(6)
    expect(calls[0]).toStartWith("kill-after-commit:")
    expect(calls.slice(1).every(line => line.startsWith("resume:"))).toBe(true)
    expect(new Set(calls.map(line => line.split(":")[1])).size).toBe(6)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 30_000)
