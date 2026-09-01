/**
 * The two programs `MIGRATION-PLAN.md` step 11 puts a *stronger obligation* on.
 *
 * Step 11 flips thirteen `17-durable` verdicts from `diagnostics` to `output`,
 * and eleven of them are discharged by a compile-time observation: the walls
 * fell, the Flow publishes an Effect Manifest, both backends agree. Two are not,
 * and the plan says so plainly:
 *
 * > the branch case must assert the *untaken* arm's Action does **not** appear
 * > in the journal; the do-while case must assert **one journal entry per
 * > round** under `siteId#n`.
 *
 * Neither is visible in an artifact. A Manifest is sound about reachability and
 * silent about everything else — it names both arms of a branch because it
 * *cannot* name one, and it carries one site for a loop because a site is a
 * position rather than a count. Which arm ran and how many rounds happened are
 * properties of an EXECUTION, so they are asserted against a real journal.
 *
 * Both failures are silent replay corruption rather than a wrong answer:
 *
 *   - an untaken arm's Action in the journal is an effect the program did not
 *     request, and on resumption the body would be answered from it at a site
 *     it never reaches — a divergence the driver cannot even name, because the
 *     entry looks legitimate;
 *   - a do-while whose rounds collapse onto one key means round two reads round
 *     one's answer. Every round after the first is silently memoized, the
 *     journal is shorter than the history, and nothing compares the two.
 *
 * ## What this module shares with the vertical slice, and why
 *
 * The same shape as `durable-vertical-slice.ts`: the compiler derives the site
 * table from `.sm`-dialect source text, and a hand-written generator stands in
 * for the emitted body until the emitter reaches Action calls. The site ids are
 * therefore never literals — a test that chose its own journal keys would make
 * "keyed by site id" true by construction and worth nothing.
 */

import { compileEffectManifest, type DurableSourceActionBinding } from "../../src/durable/source-compiler.ts"
import { compileActionContract } from "../../src/durable/schema.ts"
import type { EffectManifest } from "../../src/durable/effect-manifest.ts"
import { Deployment, digest, DurableStore, PlanArtifact } from "../../src/durable/index.ts"
import { __vsPerform, type Resumable } from "../../src/runtime/effect.ts"

export const FETCH_ID = "test/control-flow/Fetch"
export const CACHED_ID = "test/control-flow/Cached"
export const POLL_ID = "test/control-flow/Poll"

const contractSource = (exportName: string, input: string, success: string) =>
  `import { Action } from "smithers:flows"
class ${exportName}Failed extends Error { constructor(readonly code: string) { super(code) } }
export abstract class ${exportName} extends Action<
  (input: ${input}) => Result<${success}, ${exportName}Failed>
> {}`

const boundAction = (exportName: string, input: string, success: string, id: string): DurableSourceActionBinding => {
  const contract = compileActionContract(contractSource(exportName, input, success), {
    fileName: `contracts/${exportName.toLowerCase()}.sm`,
    exportName,
    id,
    version: 1
  })
  if (!contract.ok) throw new Error(JSON.stringify(contract.diagnostics))
  return { moduleSpecifier: "test:control-flow-actions", exportName, descriptor: contract.descriptor }
}

const ACTIONS: readonly DurableSourceActionBinding[] = [
  boundAction("Fetch", "{ key: string }", "{ value: string }", FETCH_ID),
  boundAction("Cached", "{ key: string }", "{ value: string }", CACHED_ID),
  boundAction("Poll", "{ round: number }", "{ done: boolean }", POLL_ID)
]

// ---------------------------------------------------------------------------
// The branch program
// ---------------------------------------------------------------------------

export const BRANCH_FLOW_ID = "test/control-flow/Branch"

/**
 * `17-durable/a-statement-branch-holding-an-action-in-each-arm-is-rejected` in
 * this dialect's spelling: one runtime branch, a DIFFERENT Action in each arm.
 *
 * That case is the reason this program is shaped this way. Its whole value as a
 * refusal was that folding the condition would drop an Action; its value as an
 * acceptance is the mirror image, and the mirror image has two halves. The
 * Manifest half — both Actions named — is observed by the corpus case. The
 * journal half is here.
 */
export const BRANCH_SOURCE = `import { durable } from "smithers:flows"
import { Fetch, Cached } from "test:control-flow-actions"
export const Branch = durable(function Branch(input: { live: boolean; key: string }) {
  if (input.live) {
    return Fetch.run({ key: input.key })!
  }
  return Cached.run({ key: input.key })!
})`

export const BRANCH_COMPILE_OPTIONS = {
  fileName: "flows/branch.sm",
  flowId: BRANCH_FLOW_ID,
  flowVersion: 1,
  actions: ACTIONS
} as const

// ---------------------------------------------------------------------------
// The do-while program
// ---------------------------------------------------------------------------

export const LOOP_FLOW_ID = "test/control-flow/Loop"

/**
 * `17-durable/a-do-while-loop-in-durable-source-is-rejected` in this dialect's
 * spelling, widened from that case's single-pass body to a real multi-round
 * loop.
 *
 * `do`/`while` is still the deliberate form: its body runs before its condition
 * is ever read, so a lowering that unrolled one pass produced something that
 * looked complete. The run-time analogue of that defect is a loop whose rounds
 * all land on one journal key, and it looks just as complete.
 */
export const LOOP_SOURCE = `import { durable } from "smithers:flows"
import { Poll } from "test:control-flow-actions"
export const Loop = durable(function Loop(input: { rounds: number }) {
  let round = 0
  do {
    const polled = Poll.run({ round })!
    round = round + 1
    if (polled.done) return round
  } while (round < input.rounds)
  return round
})`

export const LOOP_COMPILE_OPTIONS = {
  fileName: "flows/loop.sm",
  flowId: LOOP_FLOW_ID,
  flowVersion: 1,
  actions: ACTIONS
} as const

// ---------------------------------------------------------------------------
// Shared derivation
// ---------------------------------------------------------------------------

export const manifestOf = (source: string, options: typeof BRANCH_COMPILE_OPTIONS | typeof LOOP_COMPILE_OPTIONS): EffectManifest => {
  const compiled = compileEffectManifest(source, options)
  if (!compiled.ok) throw new Error(`manifest refused: ${JSON.stringify(compiled.diagnostics)}`)
  return compiled.manifest
}

/**
 * The `perform` site id the compiler minted for one Action id.
 *
 * By Action id and never by index: the site table is sorted by site id, which
 * is a digest, so its order is not source order.
 */
export const siteFor = (manifest: EffectManifest, actionId: string): string => {
  const site = manifest.sites.find((row) => row.kind === "perform" && row.key === actionId)
  if (site === undefined) throw new Error(`no perform site for ${actionId} in ${JSON.stringify(manifest.sites)}`)
  return site.id
}

/** Content-addressed site ids, so a test cannot have chosen its own journal keys. */
export const CONTENT_ADDRESSED_SITE = /^src-[0-9a-f]{24}$/

export interface BranchSites {
  readonly fetch: string
  readonly cached: string
}

/**
 * The branch program under the effect-request calling convention.
 *
 * The `if` is an ordinary JavaScript branch, which is the whole point: under
 * replay the body runs, so only one arm issues a request. Nothing here consults
 * the Manifest at run time — the untaken arm is simply not executed.
 */
export function* branchProgram(
  input: { readonly live: boolean; readonly key: string },
  sites: BranchSites
): Resumable<string> {
  if (input.live) {
    const fetched = yield* __vsPerform<{ value: string }>(FETCH_ID, { key: input.key }, sites.fetch)
    return fetched.value
  }
  const cached = yield* __vsPerform<{ value: string }>(CACHED_ID, { key: input.key }, sites.cached)
  return cached.value
}

/**
 * The do-while program under the effect-request calling convention.
 *
 * One `__vsPerform` at ONE site, executed `rounds` times. The occurrence index
 * is assigned by the driver per site — the test never supplies one — so a
 * driver that reused an occurrence would collapse the rounds here and nowhere
 * else.
 */
export function* loopProgram(
  input: { readonly rounds: number },
  site: string
): Resumable<number> {
  let round = 0
  do {
    yield* __vsPerform<{ done: boolean }>(POLL_ID, { round }, site)
    round = round + 1
  } while (round < input.rounds)
  return round
}

// ---------------------------------------------------------------------------
// Store and deployment
// ---------------------------------------------------------------------------

/**
 * A deployment whose Plan is EMPTY, exactly as the vertical slice's is: every
 * `durable_nodes` row an execution produces must then have come from the
 * driver's lazy claim, because no eager insert could have created one. A row
 * count is only evidence if nothing but the run could have written the rows.
 */
export const emptyDeployment = (id: string, flowId: string) => {
  const semantic = {
    formatVersion: 1 as const,
    flowId,
    flowVersion: 1,
    nodes: [],
    output: { kind: "literal" as const, value: null },
    requirements: [],
    actions: []
  }
  const plan = PlanArtifact.validate({ ...semantic, digest: digest(semantic) })
  const flow = PlanArtifact.load<Record<string, never>, unknown>(PlanArtifact.encode(plan))
  return Deployment.build({ id, flow, pools: [] })
}

export const openStore = (executionId: string, flowId: string, input: Record<string, string | number | boolean>): DurableStore => {
  const store = new DurableStore()
  const deployment = emptyDeployment(executionId, flowId)
  store.initializeExecution(executionId, deployment.flow.plan, deployment.manifest, input)
  return store
}
