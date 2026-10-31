import { expect, test } from "bun:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { Context, Effect, Layer } from "effect"
import { $provideEntries, $provideService } from "vibelang-runtime"
import { checkProperty } from "../../../scripts/testing/property.mjs"

class First extends Context.Service<First, { value: number }>()("provider-order/First") {}
class Second extends Context.Service<Second, { value: number }>()("provider-order/Second") {}
class Third extends Context.Service<Third, { value: number }>()("provider-order/Third") {}
const keys = [First, Second, Third]
const quote = "Where two providers supply one service, the later wins."
const rule = "docs/design/src/005-services.md: provide is exact sugar for Effect.provide; " + quote
const regressions = new URL("./provider-order-regressions/", import.meta.url)

type Provider = { kind: "entry" | "layer"; key: number; value: number; resource: boolean }
type Input = { providers: Provider[]; fail: boolean }

function verifyRule() {
  assert.ok(readFileSync(new URL("../../../docs/design/src/005-services.md", import.meta.url), "utf8").includes(quote))
  assert.equal(JSON.parse(readFileSync(new URL("../package.json", import.meta.resolve("effect")), "utf8")).version, "4.1.0")
}

async function run(input: Input, runtime: boolean) {
  const trace: string[] = []
  const providers = input.providers.map((provider, i) => {
    const key = keys[provider.key]
    const value = { value: provider.value }
    trace.push("evaluate:" + i)
    if (provider.kind === "entry") {
      return runtime ? $provideService(key as any, "Service", value) : Layer.succeed(key as any, value)
    }
    if (!provider.resource) return Layer.succeed(key as any, value)
    return Layer.effect(key as any, Effect.acquireRelease(
      Effect.sync(() => { trace.push("build:" + i); return value }),
      () => Effect.sync(() => { trace.push("release:" + i) })
    ))
  })
  const body = Effect.gen(function*() {
    const value = yield* keys[input.providers[0].key]
    const memo = yield* Effect.serviceOption(Layer.CurrentMemoMap)
    trace.push("body")
    if (input.fail) return yield* Effect.fail("body failure")
    return { value: value.value, memo: memo._tag }
  })
  const effect = runtime ? $provideEntries(body as any, providers as any)
    : Effect.provide(body, (providers.length === 1 ? providers[0] : providers) as any)
  assert.deepEqual(trace, input.providers.map((_, i) => "evaluate:" + i), "constructing a provider block must not build layers or run its body")
  return { exit: await Effect.runPromiseExit(effect as any), trace }
}

test("provide: a later Layer overrides an earlier service entry", async () => {
  verifyRule()
  const input: Input = { providers: [
    { kind: "entry", key: 0, value: 1, resource: false },
    { kind: "layer", key: 0, value: 2, resource: false }
  ], fail: false }
  expect(await run(input, true)).toEqual(await run(input, false))
})

test("provide: mixed providers preserve native order, scope, failures and finalizers", async () => {
  verifyRule()
  await checkProperty(fc, {
    name: "provide-provider-order", rule, command: "bun test tests/provider-order.property.test.ts",
    arbitrary: fc.record({
      providers: fc.array(fc.record({
        kind: fc.constantFrom("entry" as const, "layer" as const),
        key: fc.integer({ min: 0, max: 2 }), value: fc.integer({ min: -5, max: 5 }), resource: fc.boolean()
      }), { minLength: 1, maxLength: 6 }),
      fail: fc.boolean()
    }), regressions, numRuns: 200,
    check: async (input: Input) => assert.deepEqual(await run(input, true), await run(input, false))
  })
}, 60000)
