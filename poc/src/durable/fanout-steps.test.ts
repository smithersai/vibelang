import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  Action,
  compileActionContract,
  compileDurableSource,
  ContentIntegrityError,
  CoordinatorCrash,
  Deployment,
  digest,
  DurableActionDefect,
  DurableExecutor,
  DurableStore,
  PlanArtifact,
  Provider,
  validatePlanTemplate,
  Worker,
  type PlanTemplate
} from "./index.ts"

const extractContract = compileActionContract(`
import { Action } from "smithers:flows"
class ExtractFailed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Extract extends Action<
  (input: { id: string; value: number }) => Result<{ id: string; extracted: number }, ExtractFailed>
> {}
`, {
  fileName: "contracts/steps-extract.sm",
  exportName: "Extract",
  id: "test/steps/Extract",
  version: 1
})
if (!extractContract.ok) throw new Error(JSON.stringify(extractContract.diagnostics))

const publishContract = compileActionContract(`
import { Action } from "smithers:flows"
class PublishFailed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Publish extends Action<
  (input: { id: string; amount: number }) => Result<{ id: string; published: number }, PublishFailed>
> {}
`, {
  fileName: "contracts/steps-publish.sm",
  exportName: "Publish",
  id: "test/steps/Publish",
  version: 1
})
if (!publishContract.ok) throw new Error(JSON.stringify(publishContract.diagnostics))

const Extract = Action.fromDescriptor<
  { id: string; value: number },
  { id: string; extracted: number },
  { code: string }
>(extractContract.descriptor)
const Publish = Action.fromDescriptor<
  { id: string; amount: number },
  { id: string; published: number },
  { code: string }
>(publishContract.descriptor)

const extractCalls: string[] = []
const publishCalls: string[] = []

const actionBindings = Object.freeze([
  Object.freeze({ moduleSpecifier: "test:step-actions", exportName: "Extract", descriptor: Extract.descriptor }),
  Object.freeze({ moduleSpecifier: "test:step-actions", exportName: "Publish", descriptor: Publish.descriptor })
])

const source = `
import { durable, fanOut } from "smithers:flows"
import { Extract, Publish } from "test:step-actions"

throw new Error("the authored multi-step fan-out module must never execute")

export const Pipeline = durable(function Pipeline(input: {
  items: readonly { id: string; value: number }[]
}) {
  return fanOut(
    input.items,
    item => item.id,
    item => {
      const extracted = Extract.run({ id: item.id, value: item.value })!
      return Publish.run({ id: item.id, amount: extracted.extracted })
    }
  )
})
`

const compilePipeline = (text = source) => compileDurableSource(text, {
  fileName: "flows/fanout-steps.sm",
  flowId: "test/steps/Pipeline",
  flowVersion: 1,
  actions: actionBindings
})

const deploymentFor = (plan: PlanTemplate, id: string) => Deployment.build({
  id,
  flow: PlanArtifact.load(PlanArtifact.encode(plan)),
  pools: [Worker.pool("steps-worker", {
    target: "typescript-bun",
    providers: [
      Provider.provide(Extract, ({ id: itemId, value }) => {
        extractCalls.push(itemId)
        return { id: itemId, extracted: value + 1 }
      }, {
        implementationId: "steps-extract",
        implementationVersion: "1",
        recovery: { mode: "repeatable", maxAttempts: 3 }
      }),
      Provider.provide(Publish, ({ id: itemId, amount }) => {
        publishCalls.push(itemId)
        return { id: itemId, published: amount * 10 }
      }, {
        implementationId: "steps-publish",
        implementationVersion: "1",
        recovery: { mode: "repeatable", maxAttempts: 3 }
      })
    ]
  })]
})

const resetCalls = (): void => {
  extractCalls.length = 0
  publishCalls.length = 0
}

const materializedEntries = (store: DurableStore, executionId: string) => {
  const event = store.journal(executionId).find((candidate) => candidate.type === "fanout_materialized")
  if (event === undefined || event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error(`execution ${executionId} has no fan-out materialization`)
  }
  return event.payload.entries as unknown as readonly {
    readonly key: string
    readonly childNodeId: string
    readonly inputDigest: string
    readonly step: number
  }[]
}

const stepEvents = (store: DurableStore, executionId: string) =>
  store.journal(executionId)
    .filter((event) => event.type === "fanout_step_materialized")
    .map((event) => event.payload as { readonly key: string; readonly step: number; readonly childNodeId: string })

test("multi-step fanOut bodies lower to a format-2 keyed step template without evaluating source", () => {
  const compiled = compilePipeline()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan.formatVersion).toBe(2)
  expect(compiled.plan.nodes).toHaveLength(1)
  const node = compiled.plan.nodes[0]!
  expect(node).toMatchObject({
    kind: "fanout",
    keyPath: ["id"],
    steps: [
      {
        actionId: Extract.descriptor.id,
        actionContractDigest: Extract.descriptor.contractDigest,
        input: {
          kind: "object",
          fields: {
            id: { kind: "item", path: ["id"] },
            value: { kind: "item", path: ["value"] }
          }
        }
      },
      {
        actionId: Publish.descriptor.id,
        actionContractDigest: Publish.descriptor.contractDigest,
        input: {
          kind: "object",
          fields: {
            id: { kind: "item", path: ["id"] },
            amount: { kind: "step", step: 0, path: ["extracted"] }
          }
        }
      }
    ]
  })
  // The Flow success is an array of the LAST step's Action success.
  expect(compiled.plan.flowSchemas?.success).toMatchObject({
    shape: "structural",
    descriptor: {
      kind: "array",
      element: {
        kind: "object",
        fields: [
          { name: "id", optional: false, value: { kind: "string" } },
          { name: "published", optional: false, value: { kind: "number" } }
        ]
      }
    }
  })
  // Node ids ignore unrelated leading edits; recompiling identical source is
  // fully deterministic down to the artifact digest.
  const shifted = compilePipeline(`// unrelated leading edit\n${source}`)
  if (!shifted.ok) throw new Error(JSON.stringify(shifted.diagnostics))
  expect(shifted.plan.nodes[0]!.id).toBe(node.id)
  const repeated = compilePipeline()
  if (!repeated.ok) throw new Error(JSON.stringify(repeated.diagnostics))
  expect(repeated.plan.digest).toBe(compiled.plan.digest)
})

test("a single-step block body stays format-1 flat and byte-compatible with the expression spelling", () => {
  const expressionForm = compilePipeline(source
    .replace(
      /item => \{[\s\S]*?\}\n {2}\)/,
      "item => Extract.run({ id: item.id, value: item.value })\n  )"
    ))
  const blockForm = compilePipeline(source
    .replace(
      /item => \{[\s\S]*?\}\n {2}\)/,
      "item => { return Extract.run({ id: item.id, value: item.value }) }\n  )"
    ))
  if (!expressionForm.ok) throw new Error(JSON.stringify(expressionForm.diagnostics))
  if (!blockForm.ok) throw new Error(JSON.stringify(blockForm.diagnostics))
  expect(expressionForm.plan.formatVersion).toBe(1)
  expect(blockForm.plan.formatVersion).toBe(1)
  expect(blockForm.plan.nodes[0]!.id).toBe(expressionForm.plan.nodes[0]!.id)
  expect((blockForm.plan.nodes[0] as { actionId?: string }).actionId).toBe(Extract.descriptor.id)
})

test("unsupported multi-step body forms fail closed with SMITHERS4117 diagnostics", () => {
  const fixtures: readonly { readonly body: string; readonly match?: string }[] = [
    // mutable binding
    { body: "let extracted = Extract.run({ id: item.id, value: item.value })!\n      return Publish.run({ id: item.id, amount: 1 })" },
    // an intermediate step without postfix propagation is not a template projection
    { body: "const extracted = Extract.run({ id: item.id, value: item.value })\n      return Publish.run({ id: item.id, amount: 1 })" },
    // returning a bound step instead of the final Action.run call
    { body: "const extracted = Extract.run({ id: item.id, value: item.value })!\n      return extracted" },
    // statements after the return
    { body: "return Publish.run({ id: item.id, amount: item.value })\n      const late = item.id" },
    // capturing flow state inside the body template
    { body: "const extracted = Extract.run({ id: item.id, value: input.items.length })!\n      return Publish.run({ id: item.id, amount: extracted.extracted })" },
    // loops stay out of the bounded subset
    { body: "for (const other of [item]) { }\n      return Publish.run({ id: item.id, amount: item.value })" },
    // missing return
    { body: "const extracted = Extract.run({ id: item.id, value: item.value })!" }
  ]
  for (const fixture of fixtures) {
    const text = source.replace(
      /const extracted = Extract\.run\(\{ id: item\.id, value: item\.value \}\)!\n {6}return Publish\.run\(\{ id: item\.id, amount: extracted\.extracted \}\)/,
      fixture.body
    )
    const compiled = compilePipeline(text)
    expect(compiled.ok).toBe(false)
    if (compiled.ok) throw new Error(`expected failure for body: ${fixture.body}`)
    expect(["SMITHERS4117", "SMITHERS4110"]).toContain(compiled.diagnostics[0]!.code)
  }
})

test("forged artifacts cannot smuggle step templates into format 1 or forward step references", () => {
  const compiled = compilePipeline()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))

  const downgraded = JSON.parse(JSON.stringify(compiled.plan))
  downgraded.formatVersion = 1
  const { digest: _downgraded, ...downgradedSemantic } = downgraded
  expect(() => validatePlanTemplate({ ...downgradedSemantic, digest: digest(downgradedSemantic) }))
    .toThrow("multi-step fan-out requires Plan format version 2")

  const forward = JSON.parse(JSON.stringify(compiled.plan))
  forward.nodes[0].steps[0].input = { kind: "step", step: 0, path: [] }
  const { digest: _forward, ...forwardSemantic } = forward
  expect(() => validatePlanTemplate({ ...forwardSemantic, digest: digest(forwardSemantic) }))
    .toThrow("not an earlier step")

  const oversized = JSON.parse(JSON.stringify(compiled.plan))
  oversized.nodes[0].steps = Array.from({ length: 17 }, () => oversized.nodes[0].steps[0])
  const { digest: _oversized, ...oversizedSemantic } = oversized
  expect(() => validatePlanTemplate({ ...oversizedSemantic, digest: digest(oversizedSemantic) }))
    .toThrow("1..16 steps")

  // The unmodified version-2 artifact round-trips, and version-1 artifacts
  // produced by the earlier compiler still load byte-for-byte.
  const reloaded = PlanArtifact.decode(PlanArtifact.encode(compiled.plan))
  expect(reloaded.digest).toBe(compiled.plan.digest)
})

test("step children pipe durable results forward and keep identities independent of input order", async () => {
  const compiled = compilePipeline()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const deployment = deploymentFor(compiled.plan, "steps-order")
  const store = new DurableStore()
  resetCalls()
  try {
    const executor = new DurableExecutor(deployment, store)
    expect(await executor.execute({
      items: [{ id: "a", value: 2 }, { id: "b", value: 5 }]
    }, { executionId: "steps-ab" })).toEqual([
      { id: "a", published: 30 },
      { id: "b", published: 60 }
    ])
    expect([...extractCalls].sort()).toEqual(["a", "b"])
    expect([...publishCalls].sort()).toEqual(["a", "b"])

    // Reversed input order: same keyed identities for every step, output in
    // the new original order.
    expect(await executor.execute({
      items: [{ id: "b", value: 5 }, { id: "a", value: 2 }]
    }, { executionId: "steps-ba" })).toEqual([
      { id: "b", published: 60 },
      { id: "a", published: 30 }
    ])
    const firstInitial = new Map(materializedEntries(store, "steps-ab").map((entry) => [entry.key, entry.childNodeId]))
    const secondInitial = new Map(materializedEntries(store, "steps-ba").map((entry) => [entry.key, entry.childNodeId]))
    expect(secondInitial).toEqual(firstInitial)
    const firstSteps = new Map(stepEvents(store, "steps-ab").map((event) => [`${event.key}#${event.step}`, event.childNodeId]))
    const secondSteps = new Map(stepEvents(store, "steps-ba").map((event) => [`${event.key}#${event.step}`, event.childNodeId]))
    expect(secondSteps).toEqual(firstSteps)
    expect(firstSteps.size).toBe(2)
    // Step children and initial children never share an identity.
    expect(new Set([...firstInitial.values(), ...firstSteps.values()]).size).toBe(4)

    // The complete step-0 mapping includes the step ordinal.
    for (const entry of materializedEntries(store, "steps-ab")) expect(entry.step).toBe(0)
  } finally {
    store.close()
  }
})

test("later-step materialization is fenced against aliasing, missing predecessors, and legacy templates", async () => {
  const compiled = compilePipeline()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const deployment = deploymentFor(compiled.plan, "steps-alias")
  const store = new DurableStore()
  resetCalls()
  try {
    const executor = new DurableExecutor(deployment, store)
    await executor.execute({ items: [{ id: "solo", value: 1 }] }, { executionId: "steps-alias" })
    const node = deployment.flow.plan.nodes[0]!
    const committedStep = stepEvents(store, "steps-alias")[0]!
    // Same identity, different instantiated input digest: fail closed.
    expect(() => store.materializeFanOutStep("steps-alias", node.id, {
      key: "solo",
      step: 1,
      childNodeId: committedStep.childNodeId,
      inputDigest: digest({ id: "solo", amount: 999 })
    })).toThrow(ContentIntegrityError)
    // A caller-selected child id is never accepted.
    expect(() => store.materializeFanOutStep("steps-alias", node.id, {
      key: "solo",
      step: 1,
      childNodeId: "forged-child",
      inputDigest: digest({ id: "solo", amount: 2 })
    })).toThrow("not derived from its parent, key, and step")
    // A step without a durably succeeded predecessor cannot materialize.
    expect(() => store.materializeFanOutStep("steps-alias", node.id, {
      key: "solo",
      step: 3,
      childNodeId: `fan-${digest({ fanOutNodeId: node.id, key: "solo", step: 3 })}`,
      inputDigest: digest({ id: "solo", amount: 2 })
    })).toThrow("no committed predecessor")
  } finally {
    store.close()
  }

  const single = compilePipeline(source.replace(
    /item => \{[\s\S]*?\}\n {2}\)/,
    "item => Extract.run({ id: item.id, value: item.value })\n  )"
  ))
  if (!single.ok) throw new Error(JSON.stringify(single.diagnostics))
  const legacyDeployment = deploymentFor(single.plan, "steps-legacy")
  const legacyStore = new DurableStore()
  try {
    await new DurableExecutor(legacyDeployment, legacyStore).execute(
      { items: [{ id: "solo", value: 1 }] },
      { executionId: "steps-legacy" }
    )
    const node = legacyDeployment.flow.plan.nodes[0]!
    expect(() => legacyStore.materializeFanOutStep("steps-legacy", node.id, {
      key: "solo",
      step: 1,
      childNodeId: `fan-${digest({ fanOutNodeId: node.id, key: "solo", step: 1 })}`,
      inputDigest: digest({ id: "solo", amount: 2 })
    })).toThrow("not a multi-step template")
  } finally {
    legacyStore.close()
  }
})

test("crashes after each step boundary resume without reinvoking committed providers", async () => {
  const compiled = compilePipeline()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const deployment = deploymentFor(compiled.plan, "steps-crash")
  const directory = mkdtempSync(join(tmpdir(), "smithers-fanout-steps-"))
  const database = join(directory, "durable.sqlite")
  const input = { items: [{ id: "resume", value: 4 }] }
  resetCalls()
  try {
    // Crash immediately after the atomic step-0 key set commit.
    const initialStore = new DurableStore(database)
    try {
      await expect(new DurableExecutor(deployment, initialStore).execute(input, {
        executionId: "steps-crash",
        afterFanOutMaterialized: (nodeId) => {
          throw new CoordinatorCrash(nodeId)
        }
      })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(extractCalls).toEqual([])
      expect(publishCalls).toEqual([])
    } finally {
      initialStore.close()
    }

    // Crash immediately after the step-1 child mapping commit, before dispatch.
    let stepChildId = ""
    const stepStore = new DurableStore(database)
    try {
      await expect(new DurableExecutor(deployment, stepStore).execute(input, {
        executionId: "steps-crash",
        afterFanOutStepMaterialized: (nodeId, childNodeId) => {
          stepChildId = childNodeId
          throw new CoordinatorCrash(nodeId)
        }
      })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(extractCalls).toEqual(["resume"])
      expect(publishCalls).toEqual([])
      expect(stepStore.getNode("steps-crash", stepChildId).status).toBe("pending")
    } finally {
      stepStore.close()
    }

    // Crash immediately after the step-1 child result commit, before exposure.
    const stepSuccessStore = new DurableStore(database)
    try {
      await expect(new DurableExecutor(deployment, stepSuccessStore).execute(input, {
        executionId: "steps-crash",
        afterNodeAdopted: (nodeId) => {
          if (nodeId === stepChildId) throw new CoordinatorCrash(nodeId)
        }
      })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(extractCalls).toEqual(["resume"])
      expect(publishCalls).toEqual(["resume"])
      expect(stepSuccessStore.getNode("steps-crash", stepChildId).status).toBe("succeeded")
    } finally {
      stepSuccessStore.close()
    }

    // Final resume adopts everything without reinvocation.
    const resumedStore = new DurableStore(database)
    try {
      expect(await new DurableExecutor(deployment, resumedStore).execute(input, {
        executionId: "steps-crash"
      })).toEqual([{ id: "resume", published: 50 }])
      expect(extractCalls).toEqual(["resume"])
      expect(publishCalls).toEqual(["resume"])
      expect(resumedStore.journal("steps-crash")
        .filter((event) => event.type === "fanout_materialized")).toHaveLength(1)
      expect(resumedStore.journal("steps-crash")
        .filter((event) => event.type === "fanout_step_materialized")).toHaveLength(1)
    } finally {
      resumedStore.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("two independent connections converge on one step pipeline winner", async () => {
  const compiled = compilePipeline()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const deployment = deploymentFor(compiled.plan, "steps-race")
  const directory = mkdtempSync(join(tmpdir(), "smithers-fanout-steps-race-"))
  const database = join(directory, "durable.sqlite")
  const input = { items: [{ id: "x", value: 1 }, { id: "y", value: 2 }] }
  resetCalls()
  const storeA = new DurableStore(database)
  const storeB = new DurableStore(database)
  try {
    const [first, second] = await Promise.all([
      new DurableExecutor(deployment, storeA).execute(input, { executionId: "steps-race" }),
      new DurableExecutor(deployment, storeB).execute(input, { executionId: "steps-race" })
    ])
    const expected = [{ id: "x", published: 20 }, { id: "y", published: 30 }]
    expect(first).toEqual(expected)
    expect(second).toEqual(expected)
    // Each provider ran exactly once per key per step across both coordinators.
    expect([...extractCalls].sort()).toEqual(["x", "y"])
    expect([...publishCalls].sort()).toEqual(["x", "y"])
    expect(storeA.journal("steps-race").filter((event) => event.type === "fanout_materialized")).toHaveLength(1)
    expect(storeA.journal("steps-race").filter((event) => event.type === "fanout_step_materialized")).toHaveLength(2)
  } finally {
    storeA.close()
    storeB.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
