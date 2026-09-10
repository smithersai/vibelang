/**
 * Shared fixture for the alpha-0 executable-body demo.
 *
 * Both the orchestrator (demo.ts) and the crash child (crash-child.ts) build
 * the deployment from this module, so their pinned digests agree byte-for-byte
 * (implementation digests derive from declared identity, not function source).
 *
 * Run via `bun poc/examples/alpha0/demo.ts` — never a test runner.
 */
import { appendFileSync } from "node:fs"
import {
  Action,
  buildBodyDeployment,
  compileDurableBody,
  Provider,
  Worker,
  type BuiltBodyDeployment
} from "../../src/durable/index.ts"

/**
 * A small .vibe Flow: one Action (Fetch), a loop with a mutable accumulator,
 * and a Layer-provided nominal Context capability (Rates) read across
 * durable suspensions.
 */
export const FLOW_SOURCE = `
import { durable, Action } from "vibelang:flows"
import { Context } from "vibelang/context"
import { Layer } from "vibelang/provider"
class Rates extends Context { declare readonly multiplier: number }
class Fetch extends Action<(n: number) => Result<number, never>> {}
function scaled(n: number): Result<number, never> {
  return Fetch.run(n)! * Rates.context().multiplier
}
export const Flow = durable((n: number): Result<number, never> => {
  return Layer.provide(Layer.succeed(Rates, { multiplier: 10 }), (): Result<number, never> => {
    let sum = 0
    for (let i = 0; i < n; i++) sum += scaled(i)!
    return sum
  })
})`

export const FLOW_FILE_NAME = "alpha0/rates.vibe"
export const DEMO_INPUT = 4
/** Provider computes i + 1; Flow scales by 10: (1+2+3+4) * 10. */
export const EXPECTED_OUTPUT = 100

export function compileDemoBody() {
  const compiled = compileDurableBody(FLOW_SOURCE, { fileName: FLOW_FILE_NAME })
  if (!compiled.ok) {
    throw new Error(`alpha0 flow failed to compile: ${JSON.stringify(compiled.diagnostics, null, 2)}`)
  }
  return compiled
}

/**
 * Builds the executable deployment with a real local provider. Every provider
 * invocation is appended to `ledgerPath` ("owner:actionId:input"), which is how
 * the demo proves committed steps replay without re-invoking the provider.
 */
export function buildDemoDeployment(ledgerPath: string, owner: string): BuiltBodyDeployment<number, number> {
  const compiled = compileDemoBody()
  const descriptor = compiled.body.manifest.actions[0]
  if (!descriptor) throw new Error("compiled body declares no Actions")
  const fetch = Action.fromDescriptor<number, number, never>(descriptor)
  const provider = Provider.provide(fetch, (value: number) => {
    appendFileSync(ledgerPath, `${owner}:${descriptor.id}:${value}\n`)
    return value + 1
  }, {
    implementationId: "alpha0-fetch-plus-one",
    implementationVersion: "1",
    recovery: { mode: "repeatable", maxAttempts: 3 }
  })
  const flow = { id: compiled.body.manifest.flowId, version: compiled.body.manifest.flowVersion, body: compiled.body }
  return buildBodyDeployment({
    id: "alpha0-demo",
    flow,
    pools: [Worker.pool("alpha0-pool", { target: "typescript-bun", providers: [provider] })]
  }) as BuiltBodyDeployment<number, number>
}
