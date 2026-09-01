/**
 * The step-9 vertical slice: `MIGRATION-PLAN.md` §2's `chargeOrder`, once.
 *
 * ```ts
 * const chargeOrder = durable(async function (order: Order) {
 *   const rates = Rates.context()                        // refused today
 *   const quote = await getQuote(order.sku, rates)!       // Action, journaled
 *   if (quote.cents > order.limit) return "declined"      // refused today
 *   const charge = await capture(order.id, quote.cents)!  // Action, journaled
 *   return charge.reference
 * })
 * ```
 *
 * Two Actions, one capability read, one runtime branch — and the Plan lowerer
 * refuses it twice. This module holds the ONE definition of that program so the
 * in-process assertions (`vertical-slice.test.ts`) and the real-`SIGKILL`
 * assertion (`durable-replay-crash-runner.ts`, a separate process) cannot drift
 * apart: a slice proven in one process and a different program crashed in
 * another would prove nothing about either.
 *
 * ## Where the journal keys come from
 *
 * {@link sliceProgram} does not contain a site-id literal. Both are read out of
 * the **Effect Manifest the compiler derives from {@link SLICE_SOURCE}**, keyed
 * by Action id, so the journal key a request takes is
 * `journalKey(<compiler-minted src-...>, occurrence)` and a change to the
 * program's text moves it. Hand-written site strings would make the "keyed by
 * site id" half of §2's first assertion true by construction and worth nothing;
 * `sliceSites` is what stops that.
 */

import {
  compileDurableSource,
  compileEffectManifest,
  PlanUnrepresentable,
  type DurableSourceActionBinding
} from "../../src/durable/source-compiler.ts"
import { compileActionContract } from "../../src/durable/schema.ts"
import type { EffectManifest } from "../../src/durable/effect-manifest.ts"
import { Deployment, digest, DurableStore, PlanArtifact } from "../../src/durable/index.ts"
import { __vsGet, __vsPerform, type Resumable } from "../../src/runtime/effect.ts"

export const SLICE_FILE_NAME = "flows/charge-order.sm"
export const SLICE_FLOW_ID = "test/slice/ChargeOrder"
export const GET_QUOTE_ID = "test/slice/GetQuote"
export const CAPTURE_ID = "test/slice/Capture"

/** §2's program, verbatim in this dialect's spelling. */
export const SLICE_SOURCE = `import { durable } from "smithers:flows"
import { GetQuote, Capture } from "test:slice-actions"
import { Rates } from "test:slice-capabilities"
export const ChargeOrder = durable(function ChargeOrder(order: { id: string; sku: string; limit: number }) {
  const rates = Rates.context()
  const quote = GetQuote.run({ sku: order.sku, rate: rates.multiplier })!
  if (quote.cents > order.limit) return "declined"
  const charge = Capture.run({ id: order.id, cents: quote.cents })!
  return charge.reference
})`

/**
 * The same program with the capability read removed, and with the branch
 * removed as well.
 *
 * These are the controls for "refused twice today": without them a single
 * refusal on the full program would be attributable to anything in it, and the
 * claim that it is *these two features* that the Plan lowerer cannot hold would
 * be an assertion about a diagnostic code rather than about the program.
 */
export const SLICE_SOURCE_WITHOUT_CAPABILITY = `import { durable } from "smithers:flows"
import { GetQuote, Capture } from "test:slice-actions"
export const ChargeOrder = durable(function ChargeOrder(order: { id: string; sku: string; limit: number }) {
  const quote = GetQuote.run({ sku: order.sku, rate: 1 })!
  if (quote.cents > order.limit) return "declined"
  const charge = Capture.run({ id: order.id, cents: quote.cents })!
  return charge.reference
})`

export const SLICE_SOURCE_WITHOUT_BRANCH = `import { durable } from "smithers:flows"
import { GetQuote, Capture } from "test:slice-actions"
export const ChargeOrder = durable(function ChargeOrder(order: { id: string; sku: string; limit: number }) {
  const quote = GetQuote.run({ sku: order.sku, rate: 1 })!
  const charge = Capture.run({ id: order.id, cents: quote.cents })!
  return charge.reference
})`

const boundAction = (exportName: string, source: string, id: string): DurableSourceActionBinding => {
  const contract = compileActionContract(source, {
    fileName: `contracts/${exportName.toLowerCase()}.sm`,
    exportName,
    id,
    version: 1
  })
  if (!contract.ok) throw new Error(JSON.stringify(contract.diagnostics))
  return { moduleSpecifier: "test:slice-actions", exportName, descriptor: contract.descriptor }
}

export const SLICE_ACTIONS: readonly DurableSourceActionBinding[] = [
  boundAction(
    "GetQuote",
    `import { Action } from "smithers:flows"
class QuoteFailed extends Error { constructor(readonly code: string) { super(code) } }
export abstract class GetQuote extends Action<
  (input: { sku: string; rate: number }) => Result<{ cents: number }, QuoteFailed>
> {}`,
    GET_QUOTE_ID
  ),
  boundAction(
    "Capture",
    `import { Action } from "smithers:flows"
class CaptureFailed extends Error { constructor(readonly code: string) { super(code) } }
export abstract class Capture extends Action<
  (input: { id: string; cents: number }) => Result<{ reference: string }, CaptureFailed>
> {}`,
    CAPTURE_ID
  )
]

export const SLICE_COMPILE_OPTIONS = {
  fileName: SLICE_FILE_NAME,
  flowId: SLICE_FLOW_ID,
  flowVersion: 1,
  actions: SLICE_ACTIONS
} as const

/** The Effect Manifest of {@link SLICE_SOURCE}, derived without a Plan. */
export const sliceManifest = (source: string = SLICE_SOURCE): EffectManifest => {
  const compiled = compileEffectManifest(source, SLICE_COMPILE_OPTIONS)
  if (!compiled.ok) throw new Error(`slice manifest refused: ${JSON.stringify(compiled.diagnostics)}`)
  return compiled.manifest
}

/**
 * What the **Plan** lowerer REPORTS about a slice source. Empty means it raised
 * nothing — which since `MIGRATION-PLAN.md` step 11 is true both of a program
 * it accepted and of one it declined, so it is always read beside
 * {@link planDeclines}.
 */
export const slicePlanDiagnostics = (source: string): readonly { code: string; message: string; line: number }[] => {
  let compiled
  try {
    compiled = compileDurableSource(source, SLICE_COMPILE_OPTIONS)
  } catch (error) {
    // A declined body is not a diagnostic and must never be reported as one.
    if (error instanceof PlanUnrepresentable) return []
    throw error
  }
  return compiled.ok
    ? []
    : compiled.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      line: diagnostic.line
    }))
}

/**
 * Whether the Plan lowerer has no shape for this body.
 *
 * The replacement for "refused twice today". `true` means the Plan declined —
 * `PlanUnrepresentable`, no diagnostic — and the Flow publishes an Effect
 * Manifest instead; `false` means the Plan holds the program.
 */
export const planDeclines = (source: string): boolean => {
  try {
    compileDurableSource(source, SLICE_COMPILE_OPTIONS)
    return false
  } catch (error) {
    if (error instanceof PlanUnrepresentable) return true
    throw error
  }
}

export interface SliceSites {
  /** Content-addressed site id of the `GetQuote.run(...)` request. */
  readonly quote: string
  /** Content-addressed site id of the `Capture.run(...)` request. */
  readonly capture: string
}

/**
 * The two `perform` site ids, read out of the compiler's site table by Action
 * id.
 *
 * By id and not by position: the table is sorted by site id, which is a digest,
 * so its order is not source order and an index would silently swap the two
 * whenever the text changed.
 */
export const sliceSites = (manifest: EffectManifest = sliceManifest()): SliceSites => {
  const byKey = new Map(manifest.sites.map((site) => [site.key, site.id]))
  const quote = byKey.get(GET_QUOTE_ID)
  const capture = byKey.get(CAPTURE_ID)
  if (quote === undefined || capture === undefined || quote === capture) {
    throw new Error(`slice site table is not two distinct perform sites: ${JSON.stringify(manifest.sites)}`)
  }
  return { quote, capture }
}

/** The capability §2's first line reads. */
export abstract class Rates {
  abstract readonly multiplier: number
}

/**
 * §2's `Order`. Indexed because the store pins the execution's input as
 * canonical JSON, and a closed interface is not assignable to `JsonValue`.
 */
export interface SliceOrder {
  readonly [key: string]: string | number
  readonly id: string
  readonly sku: string
  readonly limit: number
}

/**
 * §2's program under the effect-request calling convention.
 *
 * This is what the emitter produces for {@link SLICE_SOURCE} once
 * the resumable lowering reaches Action calls: the capability read is
 * `__vsGet`, each Action is `__vsPerform`, and the `if` is an ordinary
 * JavaScript branch because under replay the body actually runs. Postfix `!`
 * needs no `__vsPropagate` here — the driver already delivers a committed
 * typed failure by throwing it back in at the suspension point, which is the
 * same observable as propagation at the same site.
 */
export function* sliceProgram(
  order: SliceOrder,
  sites: SliceSites
): Resumable<string> {
  const rates = yield* __vsGet(Rates, `${sites.quote}:rates`)
  const quote = (yield* __vsPerform<{ cents: number }>(
    GET_QUOTE_ID,
    { sku: order.sku, rate: rates.multiplier },
    sites.quote
  ))
  if (quote.cents > order.limit) return "declined"
  const charge = (yield* __vsPerform<{ reference: string }>(
    CAPTURE_ID,
    { id: order.id, cents: quote.cents },
    sites.capture
  ))
  return charge.reference
}

/**
 * The deployment the slice's execution is pinned to.
 *
 * Its Plan is EMPTY on purpose, exactly as `replay.test.ts`'s fixture is: every
 * `durable_nodes` row the slice produces then has to have come from the
 * driver's lazy claim, because no eager insert could have created one.
 */
export const sliceDeployment = () => {
  const semantic = {
    formatVersion: 1 as const,
    flowId: SLICE_FLOW_ID,
    flowVersion: 1,
    nodes: [],
    output: { kind: "literal" as const, value: null },
    requirements: [],
    actions: []
  }
  const plan = PlanArtifact.validate({ ...semantic, digest: digest(semantic) })
  const flow = PlanArtifact.load<SliceOrder, string>(PlanArtifact.encode(plan))
  return Deployment.build({ id: "vertical-slice", flow, pools: [] })
}

export const SLICE_EXECUTION_ID = "vertical-slice"

export const SLICE_ORDER: SliceOrder = { id: "order-7", sku: "sku-A", limit: 5_000 }

/** What the two Actions answer. `cents` is under `limit`, so the branch falls through. */
export const QUOTE_CENTS = 1_299
export const CHARGE_REFERENCE = "ch_slice_0001"

/**
 * Open the slice's store, initializing the execution only the first time.
 *
 * The resumed process opens the SAME database file and must not re-initialize:
 * re-pinning would reset the execution the crashed process left behind, and the
 * journal it is supposed to replay from would go with it.
 */
export const openSliceStore = (filename?: string): DurableStore => {
  const store = filename === undefined ? new DurableStore() : new DurableStore(filename)
  const existing = store.database
    .query("SELECT id FROM durable_executions WHERE id=?")
    .get(SLICE_EXECUTION_ID)
  if (existing === null) {
    const deployment = sliceDeployment()
    store.initializeExecution(SLICE_EXECUTION_ID, deployment.flow.plan, deployment.manifest, SLICE_ORDER)
  }
  return store
}
