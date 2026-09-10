import { expect, test } from "bun:test"
import { compileDurableBody } from "./body-compiler.ts"
import { loadDurableBody } from "./body-artifact.ts"
import { __vsResultSuccess } from "../runtime/result.ts"
import { compileDurableFlow } from "./source-compiler.ts"
import { compileDurableModule } from "./module-compiler.ts"

const prelude = `import { Action, durable } from "vibelang:flows"
class Write extends Action<(input: number) => Result<number, never>> {}
`

const unsupported = [
  ["dispose", false, "class Resource { [Symbol.dispose](): void { Write.run(input).isError() } } using r = new Resource(); return input + 1"],
  ["async dispose", true, "class Resource { async [Symbol.asyncDispose](): Promise<void> { Write.run(input).isError(); await Promise.resolve() } } await using r = new Resource(); return input + 1"],
  ["iterator", false, "class Resource { [Symbol.iterator](): Iterator<number> { Write.run(input).isError(); return { next: () => ({ done: true, value: 0 }) } } } let count = 0; for (const item of new Resource()) count++; return count"],
  ["coercion", false, "class Resource { toString(): string { Write.run(input).isError(); return 'value' } } return String(new Resource())"],
  ["getter", false, "class Resource { get value(): number { Write.run(input).isError(); return 1 } } return new Resource().value"],
  ["setter", false, "class Resource { set value(value: number) { Write.run(value).isError() } } const r = new Resource(); r.value = input; return input"],
] as const

for (const [name, async, body] of unsupported) test(`a native ${name} cannot silently abandon a durable request`, () => {
  for (const compile of [compileDurableBody, compileDurableFlow, compileDurableModule]) {
    const result = compile(prelude + `export const Flow = durable(${async ? "async " : ""}(input: number) => { ${body} })`, {
      fileName: `body-native-protocol-${name.replaceAll(" ", "-")}.vibe`,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics).toMatchObject([{ code: "VIBE1802", message: expect.stringContaining("implicit") }])
  }
})

test("pure native disposal still runs before an executable Flow returns", async () => {
  const result = compileDurableBody(`import { durable } from "vibelang:flows"
export const Flow = durable((input: number) => {
  const seen: number[] = []
  class Resource { [Symbol.dispose](): void { seen.push(input) } }
  using r = new Resource()
  return seen
})`, { fileName: "body-native-protocol-pure-disposal.vibe" })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  expect(await loadDurableBody(result.body).create(1).computation.next()).toEqual({ done: true, value: [1] })
})

test("explicit finally can still suspend to issue a durable cleanup Action", async () => {
  const result = compileDurableBody(prelude + `export const Flow = durable((input: number) => {
    try { return input + 1 } finally { Write.run(input).isError() }
  })`, { fileName: "body-native-protocol-explicit-finally.vibe" })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  const attempt = loadDurableBody(result.body).create(1)
  const first = await attempt.computation.next()
  expect(first.done).toBe(false)
  if (first.done) throw new Error("cleanup Action disappeared")
  expect(first.value.kind).toBe("perform")
  expect(await attempt.computation.next(__vsResultSuccess(1))).toEqual({ done: true, value: 2 })
})
