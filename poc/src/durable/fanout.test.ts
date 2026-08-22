import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  Action,
  compileActionContract,
  compileActionImplementationContract,
  compileDurableSource,
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

const ACTION_FILE = "fanout-action.vibe"
const compiledAction = compileActionContract(`
import { Action } from "vibelang:flows"
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Transform extends Action<
  (input: { id: string; value: number }) => Result<{ id: string; doubled: number }, Failed>
> {}
`, {
  fileName: ACTION_FILE,
  exportName: "Transform",
  id: "test/fanout/Transform",
  version: 1
})
if (!compiledAction.ok) throw new Error(JSON.stringify(compiledAction.diagnostics))

const Transform = Action.fromDescriptor<
  { id: string; value: number },
  { id: string; doubled: number },
  { code: string }
>(compiledAction.descriptor)

const observedCalls: string[] = []
function transformImplementation(input: { id: string; value: number }) {
  observedCalls.push(input.id)
  return { id: input.id, doubled: input.value * 2 }
}

const implementationContract = compileActionImplementationContract({
  action: Transform.descriptor,
  implementationId: "fanout-transform",
  implementationVersion: "1",
  entryFile: ACTION_FILE,
  exportName: "transformImplementation",
  implementation: transformImplementation,
  sources: [{
    fileName: ACTION_FILE,
    source: `
      class Failed extends Error {
        constructor(readonly code: string) { super(code) }
      }
      export function transformImplementation(
        input: { id: string; value: number }
      ): Result<{ id: string; doubled: number }, Failed> {
        return { id: input.id, doubled: input.value * 2 }
      }
    `
  }]
})

const source = `
import { durable, fanOut } from "vibelang:flows"
import { Transform } from "test:fanout-actions"

throw new Error("the authored fan-out module must never execute")

export const Batch = durable(function Batch(input: {
  items: readonly { id: string; value: number }[]
}) {
  return fanOut(
    input.items,
    item => item.id,
    item => Transform.run({ id: item.id, value: item.value })
  )
})
`

const actionBinding = Object.freeze({
  moduleSpecifier: "test:fanout-actions",
  exportName: "Transform",
  descriptor: Transform.descriptor
})

const compileFanOut = (text = source) => compileDurableSource(text, {
  fileName: "flows/fanout.vibe",
  flowId: "test/fanout/Batch",
  flowVersion: 1,
  actions: [actionBinding]
})

const checkedProvider = () => Provider.provideChecked(Transform, transformImplementation, {
  implementationId: "fanout-transform",
  implementationVersion: "1",
  implementationContract
})

const deploymentFor = (plan: PlanTemplate, id: string) => Deployment.build({
  id,
  flow: PlanArtifact.load(PlanArtifact.encode(plan)),
  pools: [Worker.pool("fanout-worker", {
    target: "typescript-bun",
    providers: [checkedProvider()]
  })]
})

const materializedEntries = (store: DurableStore, executionId: string) => {
  const event = store.journal(executionId).find((candidate) => candidate.type === "fanout_materialized")
  if (event === undefined || event.payload === null || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error(`execution ${executionId} has no fan-out materialization`)
  }
  const entries = event.payload.entries
  if (!Array.isArray(entries)) throw new Error(`execution ${executionId} has invalid fan-out entries`)
  return entries as unknown as readonly {
    readonly key: string | number | boolean
    readonly childNodeId: string
    readonly inputDigest: string
  }[]
}

test("compiler-owned fanOut emits one non-executable keyed Action template", () => {
  const compiled = compileFanOut()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan.nodes).toHaveLength(1)
  const node = compiled.plan.nodes[0]
  expect(node).toMatchObject({
    kind: "fanout",
    keyPath: ["id"],
    actionId: Transform.descriptor.id,
    actionVersion: Transform.descriptor.version,
    actionContractDigest: Transform.descriptor.contractDigest,
    input: {
      kind: "object",
      fields: {
        id: { kind: "item", path: ["id"] },
        value: { kind: "item", path: ["value"] }
      }
    }
  })
  expect(compiled.plan.flowSchemas?.success).toMatchObject({
    shape: "structural",
    descriptor: { kind: "array", element: { kind: "object" } }
  })
  expect(compiled.plan.flowSchemas?.error).toEqual(Transform.descriptor.errorSchema)

  const shifted = compileFanOut(`// unrelated leading edit\n${source}`)
  if (!shifted.ok) throw new Error(JSON.stringify(shifted.diagnostics))
  expect(shifted.plan.nodes[0]!.id).toBe(node.id)

  const serialized = JSON.parse(JSON.stringify(compiled.plan))
  serialized.nodes[0].input = { kind: "input", path: [] }
  const { digest: _digest, ...semantic } = serialized
  const forged = { ...semantic, digest: digest(semantic) }
  expect(() => validatePlanTemplate(forged)).toThrow("unsupported fan-out template expression")
})

test("fanOut rejects index keys, captures, nested templates, and unrelated spellings", () => {
  const fixtures = [
    source.replace("item => item.id,", "(item, index) => index,"),
    source.replace("item => item.id,", "item => input.items[0].id,"),
    source.replace(
      "item => Transform.run({ id: item.id, value: item.value })",
      "item => fanOut(input.items, nested => nested.id, nested => Transform.run({ id: nested.id, value: nested.value }))"
    ),
    source
      .replace("import { durable, fanOut } from \"vibelang:flows\"", "import { durable, fanOut as compilerFanOut } from \"vibelang:flows\"\nconst fanOut = (...values: unknown[]) => values")
      .replace("return fanOut(", "void compilerFanOut\n  return fanOut(")
  ]
  for (const fixture of fixtures) {
    const compiled = compileFanOut(fixture)
    expect(compiled.ok).toBe(false)
  }
})

test("fanOut composes with persisted timers and selected branch fragments", async () => {
  const compiled = compileFanOut(`
import { durable, fanOut, sleep } from "vibelang:flows"
import { Transform } from "test:fanout-actions"
export const Batch = durable(function Batch(input: {
  run: boolean
  items: readonly { id: string; value: number }[]
}) {
  sleep(0)
  return input.run
    ? fanOut(input.items, item => item.id, item => Transform.run({ id: item.id, value: item.value }))
    : []
})
  `)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan.nodes.map((node) => node.kind)).toEqual(["timer", "branch"])
  const branch = compiled.plan.nodes[1]!
  if (branch.kind !== "branch") throw new Error("expected branch after timer")
  expect(branch.whenTrue.nodes[0]?.kind).toBe("fanout")
  expect(branch.controlDependencies).toEqual([compiled.plan.nodes[0]!.id])

  const store = new DurableStore()
  observedCalls.length = 0
  try {
    const executor = new DurableExecutor(deploymentFor(compiled.plan, "fanout-timer-branch"), store)
    expect(await executor.execute({ run: false, items: [{ id: "skip", value: 1 }] }, {
      executionId: "fanout-branch-skipped"
    })).toEqual([])
    expect(observedCalls).toHaveLength(0)
    expect(store.journal("fanout-branch-skipped").some((event) => event.type === "fanout_materialized")).toBe(false)

    expect(await executor.execute({ run: true, items: [{ id: "selected", value: 4 }] }, {
      executionId: "fanout-branch-selected"
    })).toEqual([{ id: "selected", doubled: 8 }])
    expect(observedCalls).toEqual(["selected"])
    expect(store.journal("fanout-branch-selected").some((event) => event.type === "timer_scheduled")).toBe(true)
    expect(store.journal("fanout-branch-selected").some((event) => event.type === "fanout_materialized")).toBe(true)
  } finally {
    store.close()
  }
})

test("runtime keys preserve child identity across ordering and reject aliases before invocation", async () => {
  const compiled = compileFanOut()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const deployment = deploymentFor(compiled.plan, "fanout-ordering")
  const store = new DurableStore()
  observedCalls.length = 0
  try {
    const executor = new DurableExecutor(deployment, store)
    expect(await executor.execute({
      items: [{ id: "a", value: 2 }, { id: "b", value: 3 }]
    }, { executionId: "fanout-order-ab" })).toEqual([
      { id: "a", doubled: 4 },
      { id: "b", doubled: 6 }
    ])
    expect(await executor.execute({
      items: [{ id: "b", value: 5 }, { id: "a", value: 7 }]
    }, { executionId: "fanout-order-ba" })).toEqual([
      { id: "b", doubled: 10 },
      { id: "a", doubled: 14 }
    ])
    const firstIds = new Map(materializedEntries(store, "fanout-order-ab")
      .map((entry) => [entry.key, entry.childNodeId]))
    const secondIds = new Map(materializedEntries(store, "fanout-order-ba")
      .map((entry) => [entry.key, entry.childNodeId]))
    expect(secondIds).toEqual(firstIds)
    expect(firstIds.get("a")).not.toBe(firstIds.get("b"))

    const beforeDuplicate = observedCalls.length
    try {
      await executor.execute({
        items: [{ id: "duplicate", value: 1 }, { id: "duplicate", value: 2 }]
      }, { executionId: "fanout-duplicate" })
      throw new Error("expected duplicate fan-out key rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(DurableActionDefect)
      expect((error as DurableActionDefect).defect).toMatchObject({ _tag: "FanOutDuplicateKeyDefect" })
    }
    expect(observedCalls).toHaveLength(beforeDuplicate)
    expect(store.journal("fanout-duplicate").some((event) => event.type === "fanout_materialized")).toBe(false)
  } finally {
    store.close()
  }
})

test("runtime rejects non-scalar keys even if hostile Plan bytes pass structural validation", async () => {
  const compiled = compileFanOut()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const serialized = JSON.parse(JSON.stringify(compiled.plan))
  serialized.nodes[0].keyPath = []
  const { digest: _digest, ...semantic } = serialized
  const hostile = validatePlanTemplate({ ...semantic, digest: digest(semantic) })
  const store = new DurableStore()
  observedCalls.length = 0
  try {
    const executor = new DurableExecutor(deploymentFor(hostile, "fanout-hostile-key"), store)
    await expect(executor.execute({
      items: [{ id: "object-key", value: 1 }]
    }, { executionId: "fanout-hostile-key" })).rejects.toBeInstanceOf(DurableActionDefect)
    expect(observedCalls).toHaveLength(0)
  } finally {
    store.close()
  }

  const malformedInputPlan = JSON.parse(JSON.stringify(compiled.plan))
  malformedInputPlan.nodes[0].input = {
    kind: "object",
    fields: {
      id: { kind: "item", path: ["id"] },
      value: { kind: "literal", value: "not-a-number" }
    }
  }
  const { digest: _malformedDigest, ...malformedSemantic } = malformedInputPlan
  const hostileInput = validatePlanTemplate({
    ...malformedSemantic,
    digest: digest(malformedSemantic)
  })
  const malformedStore = new DurableStore()
  observedCalls.length = 0
  try {
    const executor = new DurableExecutor(deploymentFor(hostileInput, "fanout-hostile-input"), malformedStore)
    await expect(executor.execute({
      items: [{ id: "valid-first", value: 1 }, { id: "invalid-second", value: 2 }]
    }, { executionId: "fanout-hostile-input" })).rejects.toBeInstanceOf(DurableActionDefect)
    expect(observedCalls).toHaveLength(0)
    expect(malformedStore.journal("fanout-hostile-input")
      .some((event) => event.type === "fanout_materialized")).toBe(false)
  } finally {
    malformedStore.close()
  }

  const canonicalStore = new DurableStore()
  try {
    const deployment = deploymentFor(compiled.plan, "fanout-noncanonical-key")
    canonicalStore.initializeExecution(
      "fanout-noncanonical-key",
      deployment.flow.plan,
      deployment.manifest,
      { items: [] },
      Date.now() + 10_000
    )
    const fanOutNode = deployment.flow.plan.nodes[0]!
    expect(() => canonicalStore.materializeFanOut("fanout-noncanonical-key", fanOutNode.id, [{
      key: -0,
      childNodeId: "noncanonical-child",
      inputDigest: digest({ id: "zero", value: 0 })
    }])).toThrow("canonical string, number, or boolean")
    expect(() => canonicalStore.materializeFanOut("fanout-noncanonical-key", fanOutNode.id, [{
      key: "forged",
      childNodeId: "caller-selected-child",
      inputDigest: digest({ id: "forged", value: 0 })
    }])).toThrow("not derived from its parent and canonical key")
  } finally {
    canonicalStore.close()
  }
})

test("a committed keyed child survives coordinator crash and resumes without reinvocation", async () => {
  const compiled = compileFanOut()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const deployment = deploymentFor(compiled.plan, "fanout-restart")
  const directory = mkdtempSync(join(tmpdir(), "vibe-fanout-"))
  const database = join(directory, "durable.sqlite")
  observedCalls.length = 0
  const input = { items: [{ id: "resume", value: 9 }] }
  let crashedChild = ""
  try {
    const firstStore = new DurableStore(database)
    try {
      await expect(new DurableExecutor(deployment, firstStore).execute(input, {
        executionId: "fanout-restart",
        afterFanOutMaterialized: (nodeId, childNodeIds) => {
          crashedChild = childNodeIds[0]!
          throw new CoordinatorCrash(nodeId)
        }
      })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(observedCalls).toEqual([])
      expect(firstStore.getNode("fanout-restart", crashedChild).status).toBe("pending")
    } finally {
      firstStore.close()
    }

    const childCrashStore = new DurableStore(database)
    try {
      await expect(new DurableExecutor(deployment, childCrashStore).execute(input, {
        executionId: "fanout-restart",
        afterNodeAdopted: (nodeId) => {
          if (nodeId === crashedChild) throw new CoordinatorCrash(nodeId)
        }
      })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(observedCalls).toEqual(["resume"])
      expect(childCrashStore.getNode("fanout-restart", crashedChild).status).toBe("succeeded")
    } finally {
      childCrashStore.close()
    }

    const resumedStore = new DurableStore(database)
    try {
      expect(await new DurableExecutor(deployment, resumedStore).execute(input, {
        executionId: "fanout-restart"
      })).toEqual([{ id: "resume", doubled: 18 }])
      expect(observedCalls).toEqual(["resume"])
      expect(materializedEntries(resumedStore, "fanout-restart")).toEqual([{
        key: "resume",
        childNodeId: crashedChild,
        inputDigest: digest({ id: "resume", value: 9 })
      }])
      expect(resumedStore.journal("fanout-restart")
        .filter((event) => event.type === "fanout_materialized")).toHaveLength(1)
    } finally {
      resumedStore.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
