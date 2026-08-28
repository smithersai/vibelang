import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { effectManifestSets, type EffectManifest } from "./effect-manifest.ts"
import { allPlanNodes, fanOutSteps, type PlanTemplate } from "./plan-ir.ts"
import {
  compileDurableSource,
  compileEffectManifest,
  type DurableSourceActionBinding,
  type DurableSourceFlowBinding
} from "./source-compiler.ts"
import { compileActionContract } from "./schema.ts"
import type { ActionDescriptor, DurableSchema, DurableTypeDescriptor } from "./ir.ts"

/**
 * **Step 5 of the continuation migration: the Effect Manifest cross-check.**
 *
 * The migration plan's own words for this step: "This validates the entire
 * hybrid against a working system before anything is deleted." `PR-1` — build
 * the Manifest — was adopted provisionally on the owner's behalf. The Manifest
 * is what buys back the signable pre-execution artifact and about half of
 * static version-divergence detection. If it cannot reproduce what the Plan
 * knows, that has to be discovered while the Plan still exists to disagree
 * with it.
 *
 * So this file asserts, over every `17-durable` conformance case and over the
 * durable feature surface those cases cannot reach, that the Manifest and the
 * Plan agree on the **action set**, the **capability set**, and the **contract
 * set**.
 *
 * ## Why the comparison is not circular
 *
 * The Manifest under test comes from `compileEffectManifest`, which builds its
 * own checked program and runs `deriveEffectManifest` over the authored
 * function. No `PlanNode` is constructed on that path and no `PlanTemplate` is
 * validated; `effect-manifest.ts` cannot even name those types. The Plan comes
 * from a separate `compileDurableSource` call on the same text.
 *
 * `compileDurableSource` also publishes a Manifest, from the same derivation
 * over its own checked program. Every case here asserts the embedded one is
 * byte-identical to the standalone one, which is what turns "the emitted
 * Manifest is the independent one" into a measured claim.
 *
 * ## Two things this cross-check found
 *
 * 1. **20 of the 26 cases cannot exercise it at all.** They are refusal cases:
 *    the Plan lowerer rejects them, so there is no Plan to compare against.
 *    Only 6 produce a Plan, and only one of those has more than one Action. The
 *    corpus alone is a much weaker validation of PR-1 than the migration plan's
 *    "assert … across all 22 cases" implies, which is why `manifestFeatureCase`
 *    below adds the fan-out, loop, queue, broadcast, child-Flow and
 *    branch-with-an-Action-in-each-arm programs the corpus has none of.
 * 2. **A real fail-open in the first Manifest.** On
 *    `two-error-classes-whose-durable-identities-collide-are-rejected` the Plan
 *    refused with `SMITHERS4124` and the Manifest answered `actions: []` about
 *    a Flow that performs `Pick` — the silent narrowing PR-1 forbids in as many
 *    words. `effect-manifest.ts` now fails closed there. The row below pins it.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = resolve(HERE, "../../../conformance/corpus/17-durable")

/**
 * Every durable failure identity a descriptor's error channel can carry.
 *
 * A third spelling of the walk, deliberately: `effect-manifest.ts` has its own
 * (`failureIdentities`, not exported) and the Go bridge has a third. If the
 * Manifest's failure row and this one agree over the same Actions, two
 * independently written walks over two independently derived artifacts said the
 * same thing.
 */
const descriptorFailureIdentities = (schema: DurableSchema, into: Set<string>): void => {
  if (schema.shape !== "structural") return
  const pending: DurableTypeDescriptor[] = [schema.descriptor]
  while (pending.length > 0) {
    const descriptor = pending.pop()!
    if (descriptor.kind === "error") {
      into.add(descriptor.identity)
      pending.push(descriptor.payload)
    } else if (descriptor.kind === "union") pending.push(...descriptor.variants)
    else if (descriptor.kind === "array") pending.push(descriptor.element)
    else if (descriptor.kind === "tuple") pending.push(...descriptor.items)
    else if (descriptor.kind === "object") pending.push(...descriptor.fields.map((field) => field.value))
  }
}

/**
 * The failure set, read off the **Plan**: every failure identity reachable
 * through the error channel of every Action the Plan pins.
 *
 * The descriptors come from the Plan itself (`template.actions`, and the same
 * for every embedded child Plan) plus the caller's own Action bindings, which
 * is how the Plan's fan-out and loop nodes name Actions — they carry
 * `actionId`/`actionVersion`/`actionContractDigest` and no descriptor. An
 * Action the Plan pins with no descriptor to read is a hard failure rather than
 * a quietly smaller set: an empty answer would satisfy the comparison against a
 * Manifest that also found nothing, which is the fail-open this whole file
 * exists to catch.
 */
const planFailures = (
  plan: PlanTemplate,
  bindings: readonly DurableSourceActionBinding[],
): readonly string[] => {
  const key = (descriptor: ActionDescriptor): string =>
    `${descriptor.id}@${descriptor.version}#${descriptor.contractDigest}`
  const byKey = new Map<string, ActionDescriptor>()
  const index = (template: PlanTemplate): void => {
    for (const descriptor of template.actions) byKey.set(key(descriptor), descriptor)
    for (const child of template.childFlows ?? []) index(child)
  }
  index(plan)
  for (const binding of bindings) byKey.set(key(binding.descriptor), binding.descriptor)

  const identities = new Set<string>()
  for (const pinned of planSets(plan).actions) {
    const descriptor = byKey.get(pinned)
    if (descriptor === undefined) {
      throw new Error(`the Plan pins ${pinned} with no descriptor to read a failure channel from`)
    }
    descriptorFailureIdentities(descriptor.errorSchema, identities)
  }
  return [...identities].sort()
}

/**
 * The three set-shaped comparisons, read off the **Plan**.
 *
 * Deliberately spelled here and not in `effect-manifest.ts`: the Manifest side
 * of the comparison must not be able to reach the Plan side.
 */
const planSets = (plan: PlanTemplate): {
  readonly actions: readonly string[]
  readonly capabilities: readonly string[]
  readonly contracts: readonly string[]
} => {
  const actions = new Set<string>()
  const contracts = new Set<string>()
  const walk = (template: PlanTemplate): void => {
    for (const descriptor of template.actions) {
      actions.add(`${descriptor.id}@${descriptor.version}#${descriptor.contractDigest}`)
    }
    for (const node of allPlanNodes(template)) collect(node)
    // A parent Plan embeds its children, and `lowerChildFlowCall` copies every
    // child Action into the parent's requirement row. The comparison is over
    // the whole reachable effect set, so it descends the same way.
    for (const child of template.childFlows ?? []) walk(child)
  }
  const collect = (node: ReturnType<typeof allPlanNodes>[number]): void => {
    switch (node.kind) {
      case "signal":
        contracts.add(
          `${node.delivery === "broadcast" ? "broadcast" : "signal"}:${node.signalId}#${node.signalContractDigest}`
        )
        break
      case "queue":
        contracts.add(`queue:${node.queueId}#${node.queueContractDigest}`)
        break
      case "childFlow":
        contracts.add(`childFlow:${node.flowId}#${node.planDigest}`)
        break
      case "fanout":
        // The Plan carries pinned Action identities inside the per-item
        // template that never reach `plan.actions`; the Manifest must have
        // found them by descending into the callback.
        for (const step of fanOutSteps(node)) {
          actions.add(`${step.actionId}@${step.actionVersion}#${step.actionContractDigest}`)
        }
        break
      case "loop":
        actions.add(`${node.actionId}@${node.actionVersion}#${node.actionContractDigest}`)
        break
      default:
        break
    }
  }
  walk(plan)
  return {
    actions: [...actions].sort(),
    capabilities: [...plan.requirements].sort(),
    contracts: [...contracts].sort()
  }
}

/**
 * A third, deliberately crude reading of the same source: every identifier used
 * as `X.run(` that the file also declares as `class X extends Action<`.
 *
 * It shares no code with either the Plan lowerer or the Manifest deriver — it
 * is a regular expression over the authored text — so it can catch a Manifest
 * that silently narrowed and a Plan that silently narrowed at the same time,
 * which is the one failure the two-way comparison above cannot see. It applies
 * only to same-file Action declarations; an Action supplied as a caller binding
 * has an id the text does not contain.
 */
const sameFileActionNamesPerformed = (source: string): readonly string[] => {
  const declared = new Set<string>()
  for (const match of source.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)\s+extends\s+Action\s*</g)) {
    declared.add(match[1])
  }
  const performed = new Set<string>()
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*run\s*\(/g)) {
    if (declared.has(match[1])) performed.add(match[1])
  }
  return [...performed].sort()
}

const manifestActionNames = (manifest: EffectManifest): readonly string[] =>
  [...new Set(manifest.actions.map((action) => action.id.slice(action.id.lastIndexOf("#") + 1)))].sort()

/**
 * What each `17-durable` case is expected to do on both sides today.
 *
 * `"plan"` — the Plan lowers and the three sets are compared.
 * `"plan-refused"` — the Plan refuses with the pinned code and no comparison is
 *   possible; the Manifest still derives, and its reachability is checked
 *   against the textual oracle. **These are the rows step 11 flips.**
 * `"both-refused"` — neither artifact exists; the pinned pair of codes is the
 *   evidence that the Manifest refuses for a reason, not by accident.
 */
const CORPUS_EXPECTATIONS: Readonly<Record<string, readonly [
  "plan" | "plan-refused" | "both-refused",
  string | undefined,
  string | undefined
]>> = {
  "a-conditional-expression-on-a-non-boolean-durable-input-is-rejected": ["plan-refused", "SMITHERS4106", undefined],
  "a-do-while-loop-in-durable-source-is-rejected": ["plan-refused", "SMITHERS4107", undefined],
  "a-logical-or-fallback-on-a-durable-input-is-rejected": ["plan-refused", "SMITHERS4111", undefined],
  "a-nullish-coalescing-fallback-on-a-durable-input-is-rejected": ["plan-refused", "SMITHERS4111", undefined],
  "a-plain-projection-reaches-the-plan-as-an-input-expression": ["plan", undefined, undefined],
  "a-single-action-flow-lowers-to-a-static-plan": ["plan", undefined, undefined],
  "a-sleep-duration-projection-the-descriptor-does-not-have-is-rejected": ["plan-refused", "SMITHERS4110", undefined],
  "a-statement-branch-holding-an-action-in-each-arm-is-rejected": ["plan-refused", "SMITHERS4106", undefined],
  // Boundary-straddling Action success field names. Nothing about the Manifest
  // depends on descriptor field ORDER — it carries contract digests, and the
  // digest is what the order feeds — so this row is deliberately an ordinary
  // `"plan"`: the case is here to prove the cross-check still agrees on an
  // Action whose contract digest is derived from non-ASCII field names, not to
  // pin a Manifest-specific behaviour.
  "action-success-field-order-is-utf16-not-utf8": ["plan", undefined, undefined],
  "an-action-input-projection-the-descriptor-can-answer-is-accepted": ["plan", undefined, undefined],
  "an-action-input-projection-the-descriptor-does-not-have-is-rejected": ["plan-refused", "SMITHERS4110", undefined],
  "an-action-input-projection-through-a-durable-string-is-rejected": ["plan-refused", "SMITHERS4110", undefined],
  "an-actions-failure-channel-mints-one-identity-per-error-class": ["plan", undefined, undefined],
  "an-in-test-on-a-durable-input-is-rejected": ["plan-refused", "SMITHERS4111", undefined],
  "an-opaque-durable-argument-is-rejected": ["both-refused", "SMITHERS4103", "SMITHERS4103"],
  "an-optional-projection-on-a-durable-input-is-rejected": ["plan-refused", "SMITHERS4106", undefined],
  "array-isarray-on-a-durable-input-is-rejected": ["plan-refused", "SMITHERS4112", undefined],
  "logical-negation-of-a-durable-input-is-rejected": ["plan-refused", "SMITHERS4111", undefined],
  "object-is-on-a-durable-input-is-rejected": ["plan-refused", "SMITHERS4112", undefined],
  "statement-branch-fails-closed": ["plan-refused", "SMITHERS4106", undefined],
  "static-plan-shape-is-digest-pinned": ["plan", undefined, undefined],
  "strict-equality-against-a-durable-input-is-rejected": ["plan-refused", "SMITHERS4111", undefined],
  "the-retired-vibelang-flows-specifier-is-not-compiler-owned": ["both-refused", "SMITHERS4102", "SMITHERS4102"],
  // The fail-open this cross-check found. Before `effect-manifest.ts` failed
  // closed on an Action with no derivable contract, this row read
  // `["plan-refused", "SMITHERS4124", undefined]` with `actions: []`.
  "two-error-classes-whose-durable-identities-collide-are-rejected": ["both-refused", "SMITHERS4124", "SMITHERS4199"],
  "two-error-classes-with-distinct-durable-identities-compile": ["plan", undefined, undefined],
  "typeof-on-a-durable-input-is-rejected": ["plan-refused", "SMITHERS4111", undefined],
  "unrelated-local-durable-stays-ordinary": ["both-refused", "SMITHERS4102", "SMITHERS4102"]
}

const corpusCases = readdirSync(CORPUS).filter((name) => name.endsWith(".sm")).sort()

test("the 17-durable corpus is exactly the set of cases this cross-check pins", () => {
  // A new corpus case must land in the table above with a deliberate verdict,
  // rather than being skipped into a silent pass.
  expect(corpusCases.map((name) => name.replace(/\.sm$/, ""))).toEqual(Object.keys(CORPUS_EXPECTATIONS).sort())
})

for (const file of corpusCases) {
  const name = file.replace(/\.sm$/, "")
  test(`Manifest and Plan agree on 17-durable/${name}`, () => {
    const source = readFileSync(join(CORPUS, file), "utf8")
    const expectation = CORPUS_EXPECTATIONS[name]
    expect(expectation).toBeDefined()
    const [outcome, planCode, manifestCode] = expectation

    const compiled = compileDurableSource(source, { fileName: file })
    const standalone = compileEffectManifest(source, { fileName: file })

    if (outcome === "both-refused") {
      expect(compiled.ok).toBe(false)
      expect(standalone.ok).toBe(false)
      if (compiled.ok || standalone.ok) return
      expect(compiled.diagnostics[0]?.code).toBe(planCode!)
      expect(standalone.diagnostics[0]?.code).toBe(manifestCode!)
      return
    }

    // Every case from here on has a Manifest, and it must be sound about the
    // Actions the authored text performs.
    expect(standalone.ok).toBe(true)
    if (!standalone.ok) return
    expect(manifestActionNames(standalone.manifest)).toEqual(sameFileActionNamesPerformed(source))

    if (outcome === "plan-refused") {
      expect(compiled.ok).toBe(false)
      if (compiled.ok) return
      expect(compiled.diagnostics[0]?.code).toBe(planCode!)
      return
    }

    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    // The Manifest `compileDurableSource` emitted beside the Plan is exactly
    // the Manifest a compilation that never built a Plan produced.
    expect(compiled.manifestFailure).toBeUndefined()
    expect(compiled.manifest).toEqual(standalone.manifest)

    const plan = planSets(compiled.plan)
    const manifest = effectManifestSets(standalone.manifest)
    expect(manifest.actions).toEqual(plan.actions)
    expect(manifest.capabilities).toEqual(plan.capabilities)
    expect(manifest.contracts).toEqual(plan.contracts)
    expect(manifest.failures).toEqual(planFailures(compiled.plan, []))
  })
}

// ---------------------------------------------------------------------------
// The durable feature surface `17-durable` has no case for.
//
// Six of 26 corpus cases produce a Plan, and between them they cover one
// Action, two Actions, a timer, a `sequential`, a ternary with no Action in
// either arm, and one unicast signal. Fan-out, multi-step fan-out, loops,
// queues, broadcasts, child Flows, and a branch with a DIFFERENT Action in each
// arm are all unreachable from the corpus, and every one of them is a place a
// set-only Manifest could plausibly lose an Action. They are checked here, from
// the same two entry points, with the same three comparisons.
// ---------------------------------------------------------------------------

const boundAction = (
  moduleSpecifier: string,
  exportName: string,
  declaration: string,
  id: string
): DurableSourceActionBinding => {
  const contract = compileActionContract(declaration, {
    fileName: `contracts/${exportName.toLowerCase()}.sm`,
    exportName,
    id,
    version: 1
  })
  if (!contract.ok) throw new Error(JSON.stringify(contract.diagnostics))
  return { moduleSpecifier, exportName, descriptor: contract.descriptor }
}

const TRANSFORM = boundAction(
  "test:manifest-actions",
  "Transform",
  `import { Action } from "smithers:flows"
class TransformFailed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Transform extends Action<
  (input: { id: string; value: number }) => Result<{ id: string; doubled: number }, TransformFailed>
> {}`,
  "test/manifest/Transform"
)

const PUBLISH = boundAction(
  "test:manifest-actions",
  "Publish",
  `import { Action } from "smithers:flows"
class PublishFailed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Publish extends Action<
  (input: { id: string; amount: number }) => Result<{ published: boolean }, PublishFailed>
> {}`,
  "test/manifest/Publish"
)

const STEP = boundAction(
  "test:manifest-actions",
  "Step",
  `import { Action } from "smithers:flows"
class StepFailed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Step extends Action<
  (input: { remaining: number; total: number }) => Result<{ remaining: number; total: number }, StepFailed>
> {}`,
  "test/manifest/Step"
)

const FEATURE_ACTIONS: readonly DurableSourceActionBinding[] = [TRANSFORM, PUBLISH, STEP]

const childCompiled = compileDurableSource(
  `import { durable } from "smithers:flows"
import { Transform } from "test:manifest-actions"
export const ChildFlow = durable(function ChildFlow(input: { id: string; value: number }) {
  return Transform.run({ id: input.id, value: input.value })
})`,
  {
    fileName: "flows/manifest-child.sm",
    flowId: "test/manifest/ChildFlow",
    flowVersion: 1,
    actions: [TRANSFORM]
  }
)
if (!childCompiled.ok) throw new Error(JSON.stringify(childCompiled.diagnostics))
if (childCompiled.manifest === undefined) throw new Error(childCompiled.manifestFailure ?? "no child manifest")
const CHILD_FLOWS: readonly DurableSourceFlowBinding[] = [{
  moduleSpecifier: "test:manifest-flows",
  exportName: "ChildFlow",
  plan: childCompiled.plan,
  // The parent composes the CHILD'S MANIFEST, never the child's Plan.
  manifest: childCompiled.manifest
}]

interface FeatureCase {
  readonly name: string
  readonly fileName: string
  readonly flowId: string
  readonly source: string
  readonly actions?: readonly DurableSourceActionBinding[]
  readonly flows?: readonly DurableSourceFlowBinding[]
}

const FEATURE_CASES: readonly FeatureCase[] = [
  {
    name: "a single-Action fan-out over a runtime-sized collection",
    fileName: "flows/manifest-fanout.sm",
    flowId: "test/manifest/Batch",
    source: `import { durable, fanOut } from "smithers:flows"
import { Transform } from "test:manifest-actions"
export const Batch = durable(function Batch(input: { items: readonly { id: string; value: number }[] }) {
  return fanOut(
    input.items,
    item => item.id,
    item => Transform.run({ id: item.id, value: item.value })
  )
})`
  },
  {
    name: "a multi-step fan-out whose second Action reads the first step",
    fileName: "flows/manifest-fanout-steps.sm",
    flowId: "test/manifest/Pipeline",
    source: `import { durable, fanOut } from "smithers:flows"
import { Transform, Publish } from "test:manifest-actions"
export const Pipeline = durable(function Pipeline(input: { items: readonly { id: string; value: number }[] }) {
  return fanOut(
    input.items,
    item => item.id,
    item => {
      const doubled = Transform.run({ id: item.id, value: item.value })!
      return Publish.run({ id: item.id, amount: doubled.doubled })
    }
  )
})`
  },
  {
    name: "a round-budgeted durable loop",
    fileName: "flows/manifest-loop.sm",
    flowId: "test/manifest/Countdown",
    source: `import { durable, loopWhile } from "smithers:flows"
import { Step } from "test:manifest-actions"
export const Countdown = durable(function Countdown(input: { count: number }) {
  return loopWhile(
    { remaining: input.count, total: 0 },
    state => state.remaining > 0,
    state => Step.run({ remaining: state.remaining, total: state.total }),
    5
  )
})`
  },
  {
    name: "a durable queue consumer",
    fileName: "flows/manifest-queue.sm",
    flowId: "test/manifest/Consume",
    source: `import { durable, dequeue } from "smithers:flows"
export const Consume = durable(function Consume(input: { worker: string }) {
  const job = dequeue<{ jobId: string; amount: number }>("jobs.pending")
  return { worker: input.worker, job: job }
})`
  },
  {
    name: "a broadcast wait, whose contract identity differs from a unicast one",
    fileName: "flows/manifest-broadcast.sm",
    flowId: "test/manifest/Rollout",
    source: `import { durable, waitBroadcast } from "smithers:flows"
export const Rollout = durable(function Rollout(input: { service: string }) {
  const notice = waitBroadcast<{ version: string }>("deploy.rolled")
  return { service: input.service, notice: notice }
})`
  },
  {
    name: "a unicast signal beside a timer and a sequential pair",
    fileName: "flows/manifest-signal.sm",
    flowId: "test/manifest/Approve",
    source: `import { durable, sequential, sleep, waitSignal } from "smithers:flows"
import { Transform, Publish } from "test:manifest-actions"
export const Approve = durable(function Approve(input: { id: string; value: number }) {
  sleep(25)
  const pair = sequential(
    Transform.run({ id: input.id, value: input.value }),
    Publish.run({ id: input.id, amount: input.value })
  )
  const approval = waitSignal<{ approved: boolean }>("build.approval")
  return { approval: approval, pair: pair }
})`
  },
  {
    name: "a conditional expression with a DIFFERENT Action in each arm",
    fileName: "flows/manifest-branch.sm",
    flowId: "test/manifest/Choose",
    source: `import { durable } from "smithers:flows"
import { Transform, Publish } from "test:manifest-actions"
export const Choose = durable(function Choose(input: { id: string; value: number; live: boolean }) {
  const chosen = input.live
    ? Transform.run({ id: input.id, value: input.value })!
    : Publish.run({ id: input.id, amount: input.value })!
  return { chosen: chosen }
})`
  },
  {
    name: "a child-Flow boundary beside an Action",
    fileName: "flows/manifest-parent.sm",
    flowId: "test/manifest/Parent",
    flows: CHILD_FLOWS,
    source: `import { durable } from "smithers:flows"
import { ChildFlow } from "test:manifest-flows"
import { Publish } from "test:manifest-actions"
export const Parent = durable(function Parent(input: { id: string; value: number }) {
  const child = ChildFlow.run({ id: input.id, value: input.value })
  return Publish.run({ id: input.id, amount: child.doubled })
})`
  }
]

for (const featureCase of FEATURE_CASES) {
  test(`Manifest and Plan agree on ${featureCase.name}`, () => {
    const options = {
      fileName: featureCase.fileName,
      flowId: featureCase.flowId,
      flowVersion: 1,
      actions: featureCase.actions ?? FEATURE_ACTIONS,
      flows: featureCase.flows ?? []
    }
    const compiled = compileDurableSource(featureCase.source, options)
    const standalone = compileEffectManifest(featureCase.source, options)
    expect(compiled.ok ? [] : compiled.diagnostics).toEqual([])
    expect(standalone.ok ? [] : standalone.diagnostics).toEqual([])
    if (!compiled.ok || !standalone.ok) return
    expect(compiled.manifestFailure).toBeUndefined()
    expect(compiled.manifest).toEqual(standalone.manifest)

    const plan = planSets(compiled.plan)
    const manifest = effectManifestSets(standalone.manifest)
    expect(manifest.actions).toEqual(plan.actions)
    expect(manifest.capabilities).toEqual(plan.capabilities)
    expect(manifest.contracts).toEqual(plan.contracts)
    expect(manifest.failures).toEqual(planFailures(compiled.plan, options.actions))
    // A Manifest that found nothing would satisfy three equalities against a
    // Plan that also found nothing. Every feature case reaches at least one
    // Action or one external-input contract, and this says so.
    expect(manifest.actions.length + manifest.contracts.length).toBeGreaterThan(0)
  })
}

test("the Manifest is sets and tables only, with no control flow in it", () => {
  // PR-1's discipline, asserted rather than trusted: "no control-flow edges, no
  // branch structure, no execution counts. The moment it acquires an edge, a
  // branch, or a count, it has started growing back into a plan."
  const options = {
    fileName: "flows/manifest-branch.sm",
    flowId: "test/manifest/Choose",
    flowVersion: 1,
    actions: FEATURE_ACTIONS
  }
  const branchCase = FEATURE_CASES.find((entry) => entry.flowId === "test/manifest/Choose")!
  const standalone = compileEffectManifest(branchCase.source, options)
  expect(standalone.ok).toBe(true)
  if (!standalone.ok) return
  const serialized = JSON.stringify(standalone.manifest)
  for (const forbidden of ["dependencies", "controlDependencies", "whenTrue", "whenFalse", "condition", "nodeId"]) {
    expect(serialized.includes(forbidden)).toBe(false)
  }
  expect(Object.keys(standalone.manifest).sort()).toEqual([
    "actions",
    "contracts",
    "digest",
    "failures",
    "flowId",
    "flowVersion",
    "manifestVersion",
    "requirements",
    "sites"
  ])
  // Both arms are in the Manifest, and nothing in it says which is which.
  expect(standalone.manifest.actions.map((action) => action.id).sort())
    .toEqual(["test/manifest/Publish", "test/manifest/Transform"])
})

const FAILURE_CASE = "an-actions-failure-channel-mints-one-identity-per-error-class.sm"

test("the Manifest carries a failure row and a site table", () => {
  const source = readFileSync(join(CORPUS, FAILURE_CASE), "utf8")
  const standalone = compileEffectManifest(source, { fileName: FAILURE_CASE })
  expect(standalone.ok).toBe(true)
  if (!standalone.ok) return
  // Pinned, so the failure cross-check above cannot pass by comparing two
  // empty sets: this case really does put two identities in the row.
  expect(standalone.manifest.failures.length).toBe(2)
  expect(standalone.manifest.sites.length).toBe(1)
  expect(standalone.manifest.sites[0].kind).toBe("perform")
  expect(standalone.manifest.sites[0].id.startsWith("src-")).toBe(true)

  const compiled = compileDurableSource(source, { fileName: FAILURE_CASE })
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) return
  expect([...standalone.manifest.failures].sort()).toEqual(planFailures(compiled.plan, []))
})

/**
 * The failure row is a file name and a class name, so it is the Manifest row
 * most exposed to a non-portable logical name — and until 2026-08-28 the
 * durable compilers reached it through helpers that only stripped path
 * traversal. An absolute `fileName` therefore produced
 * `smithers:Users/someone/checkout/orders.sm#Failed@1`: a different identity,
 * a different `contractDigest`, a different `plan.digest` and a different
 * Manifest digest on every machine, for byte-identical source.
 *
 * Two checkout paths, one relative spelling, one answer.
 */
test("failure identities and both digests do not depend on how the file was addressed", () => {
  const source = readFileSync(join(CORPUS, FAILURE_CASE), "utf8")
  const spellings = [
    "orders.sm",
    "./orders.sm",
    "/private/tmp/checkout-a/orders.sm",
    "/Users/someone/a-completely-different-checkout/orders.sm"
  ]
  const observed = spellings.map((fileName) => {
    const standalone = compileEffectManifest(source, { fileName, flowId: "test/Portable", flowVersion: 1 })
    if (!standalone.ok) throw new Error(JSON.stringify(standalone.diagnostics))
    const compiled = compileDurableSource(source, { fileName, flowId: "test/Portable", flowVersion: 1 })
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
    return {
      failures: [...standalone.manifest.failures],
      manifestDigest: standalone.manifest.digest,
      planDigest: compiled.plan.digest,
      actions: compiled.plan.actions.map((action) => `${action.id}@${action.version}#${action.contractDigest}`),
      sites: standalone.manifest.sites.map((site) => site.id)
    }
  })
  // `#` is outside `stableIdentity`'s accepted character set and normalizes to `_`.
  expect(observed[0].failures).toEqual(["smithers:orders.sm_Denied@1", "smithers:orders.sm_Failed@1"])
  for (const answer of observed.slice(1)) expect(answer).toEqual(observed[0])
})
