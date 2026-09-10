import { expect, test } from "bun:test"
import { compileDurableBody } from "./body-compiler.ts"
import { loadDurableBody } from "./body-artifact.ts"
import { __vsInspectResult } from "../runtime/result.ts"
import { DurableStore } from "./store.ts"
import { ReplayDriver } from "./replay.ts"
import { digest } from "./value.ts"

// §Flow uses ordinary computation and §Effect Manifest follows the resolved
// callee. TS's raw view of `!` still sees a Result; the language's value view
// must identify the library method on its extracted payload instead.
const cases = [
  ["direct", "return Read.run(input)!.items.push(input)", 3],
  ["inferred", "const answer = Read.run(input)!; answer.items.push(input); return answer.items.length", 3],
  ["alias", "const answer = Read.run(input)!; const items = answer.items; return items.push(input)", 3],
  ["computed", 'const answer = Read.run(input)!; return answer["items"]["push"](input)', 3],
  ["primitive", "return Read.run(input)!.value.toString().length", 2],
  ["callback", "const answer = Read.run(input)!; return answer.items.map(item => item + input).length", 2],
] as const

for (const [name, body, expected] of cases) {
  test(`inferred Action payload methods keep their actual library identity: ${name}`, async () => {
    const compiled = compileDurableBody(`import { Action, durable } from "vibelang:flows"
class Read extends Action<(input: number) => Result<{ value: number; items: number[] }, never>> {}
export const Flow = durable((input: number): Result<number, never> => { ${body} })`, {
      fileName: `body-inferred-method-${name}.vibe`,
    })
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
    expect(compiled.body.manifest.actions).toHaveLength(1)
    expect(compiled.body.manifest.sites.filter(site => site.kind === "perform")).toHaveLength(1)
    const store = new DurableStore()
    let requests = 0
    try {
      store.initializeBodyExecution(name, compiled.body, digest({ name }), 3)
      for (let index = 0; index < 2; index++) {
        const attempt = loadDurableBody(compiled.body).create(3)
        const value = await new ReplayDriver({ mode: "on", store, executionId: name, owner: "test",
          dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
          perform: () => { requests++; return { kind: "success", value: { value: 41, items: [1, 2] } } },
        }).run(() => attempt.computation)
        expect(__vsInspectResult(value as any)).toEqual({ ok: true, value: expected })
      }
      expect(requests).toBe(1)
    } finally { store.close() }
  })
}

test("an unresolved method named push does not become a native library exemption", () => {
  const compiled = compileDurableBody(`import { durable } from "vibelang:flows"
export const Flow = durable((input: { value: number }) => {
  const opaque = (input as unknown as { items: { push(value: number): number } })
  return opaque.items.push(1)
})`, { fileName: "body-inferred-method-opaque.vibe" })
  expect(compiled.ok).toBe(false)
  if (!compiled.ok) expect(compiled.diagnostics.some(diagnostic => diagnostic.code === "VIBE4199")).toBe(true)
})

test("a Result without propagation is not treated as its payload", () => {
  const compiled = compileDurableBody(`import { Action, durable } from "vibelang:flows"
class Read extends Action<(input: number) => Result<{ items: number[] }, never>> {}
export const Flow = durable((input: number): Result<number, never> => {
  const answer = Read.run(input)
  return answer.items.push(input)
})`, { fileName: "body-inferred-method-unconsumed.vibe" })
  expect(compiled.ok).toBe(false)
  if (!compiled.ok) expect(compiled.diagnostics.some(diagnostic => diagnostic.code === "VIBE4199")).toBe(true)
})

test("an inferred array receiver does not make an effectful native callback executable", () => {
  const compiled = compileDurableBody(`import { Action, durable } from "vibelang:flows"
class Read extends Action<(input: number) => Result<{ value: number; items: number[] }, never>> {}
export const Flow = durable((input: number): Result<number, never> => {
  const answer = Read.run(input)!
  return answer.items.map((item): Result<number, never> => Read.run(item)!.value).length
})`, { fileName: "body-inferred-method-effectful-callback.vibe" })
  expect(compiled.ok).toBe(false)
  if (!compiled.ok) expect(compiled.diagnostics.some(diagnostic => diagnostic.code === "VIBE1802")).toBe(true)
})
