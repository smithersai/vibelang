/** One authored program, shared by the in-process and real-SIGKILL tests. */
import { Action } from "../../src/durable/authoring.ts"
import { compileDurableBody } from "../../src/durable/body-compiler.ts"
import { buildBodyDeployment } from "../../src/durable/body-deployment.ts"
import { BodyExecutor } from "../../src/durable/body-executor.ts"
import { Provider, Worker } from "../../src/durable/provider.ts"
import { generateDeploymentSigningKeyPair, deploymentVerificationKey, SignedBodyDeployment } from "../../src/durable/signed-deployment.ts"
import { DurableStore } from "../../src/durable/store.ts"
import type { EffectManifest } from "../../src/durable/effect-manifest.ts"

export const SLICE_FILE_NAME = "flows/charge-order.vibe"
export const SLICE_FLOW_ID = "test/slice/ChargeOrder"
export const GET_QUOTE_ID = `${SLICE_FILE_NAME}#GetQuote`
export const CAPTURE_ID = `${SLICE_FILE_NAME}#Capture`
export const SLICE_EXECUTION_ID = "vertical-slice"
export const QUOTE_CENTS = 1_299
export const CHARGE_REFERENCE = "ch_slice_0001"
export interface SliceOrder { readonly id: string; readonly sku: string; readonly limit: number }
export const SLICE_ORDER: SliceOrder = { id: "order-7", sku: "sku-A", limit: 5_000 }

// Every symbol is checked. The Layer belongs to the pinned source closure.
export const SLICE_SOURCE = `import { durable, Action } from "vibelang:flows"
import { Context } from "vibelang/context"
import { Layer } from "vibelang/provider"
abstract class Rates extends Context { abstract readonly multiplier: number }
class QuoteFailed extends Error { constructor(readonly code: string) { super(code) } }
class CaptureFailed extends Error { constructor(readonly code: string) { super(code) } }
class GetQuote extends Action<(input: { sku: string; rate: number }) => Result<{ cents: number }, QuoteFailed>> {}
class Capture extends Action<(input: { id: string; cents: number }) => Result<{ reference: string }, CaptureFailed>> {}
export const ChargeOrder = durable(async (order: { id: string; sku: string; limit: number }) => {
  return await Layer.provide(Layer.succeed(Rates, { multiplier: 1 }),
    async (): Promise<Result<string, QuoteFailed | CaptureFailed>> => {
      await Promise.resolve()
      const rates = Rates.context()
      const quote = GetQuote.run({ sku: order.sku, rate: rates.multiplier })!
      if (quote.cents > order.limit) return "declined"
      const charge = Capture.run({ id: order.id, cents: quote.cents })!
      return charge.reference
    })
})`

export const SLICE_COMPILE_OPTIONS = { fileName: SLICE_FILE_NAME, flowId: SLICE_FLOW_ID, flowVersion: 1 } as const
export const compileSlice = (source = SLICE_SOURCE) => {
  const result = compileDurableBody(source, SLICE_COMPILE_OPTIONS)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.body
}
let cached: ReturnType<typeof compileSlice> | undefined
export const sliceBody = () => cached ??= compileSlice()
export const sliceManifest = (): EffectManifest => sliceBody().manifest
export const sliceSites = (manifest = sliceManifest()) => {
  const quote = manifest.sites.find(site => site.kind === "perform" && site.key === GET_QUOTE_ID)?.id
  const capture = manifest.sites.find(site => site.kind === "perform" && site.key === CAPTURE_ID)?.id
  if (!quote || !capture || quote === capture) throw new Error("expected two distinct compiler-minted Action sites")
  return { quote, capture }
}

export type SliceObserver = (actionId: string, nodeId: string) => void
export const sliceDeployment = (observe: SliceObserver = () => {}) => {
  const body = sliceBody()
  const quote = Action.fromDescriptor<{ sku: string; rate: number }, { cents: number }, Error>(
    body.manifest.actions.find(action => action.id === GET_QUOTE_ID)!)
  const capture = Action.fromDescriptor<{ id: string; cents: number }, { reference: string }, Error>(
    body.manifest.actions.find(action => action.id === CAPTURE_ID)!)
  const providers = [
    Provider.provide(quote, (input, context) => {
      observe(GET_QUOTE_ID, context.invocation.nodeId)
      return { cents: QUOTE_CENTS * input.rate }
    }, { implementationId: "slice-quote", implementationVersion: "1", recovery: { mode: "repeatable", maxAttempts: 3 } }),
    Provider.provide(capture, (_input, context) => {
      observe(CAPTURE_ID, context.invocation.nodeId)
      return { reference: CHARGE_REFERENCE }
    }, { implementationId: "slice-capture", implementationVersion: "1", recovery: { mode: "repeatable", maxAttempts: 3 } }),
  ]
  return buildBodyDeployment<SliceOrder, string>({ id: "vertical-slice",
    flow: { id: SLICE_FLOW_ID, version: 1, body }, pools: [Worker.pool("slice", { target: "typescript-bun", providers })] })
}

export const sliceExecutor = (store: DurableStore, observe?: SliceObserver) => {
  const deployment = sliceDeployment(observe)
  const signer = generateDeploymentSigningKeyPair()
  const bytes = SignedBodyDeployment.encode(deployment.flow.body, deployment.manifest, signer)
  const proof = SignedBodyDeployment.authenticate(deployment, bytes, [deploymentVerificationKey(signer)])
  return new BodyExecutor(proof, store)
}
export const openSliceStore = (filename?: string) => filename === undefined ? new DurableStore() : new DurableStore(filename)
