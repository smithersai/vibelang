import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  Action,
  compileActionContract,
  compileDurableSource,
  CoordinatorCrash,
  Deployment,
  digest,
  DurableExecutor,
  DurableStore,
  PlanArtifact,
  Provider,
  validatePlanTemplate,
  Worker,
  type PlanTemplate
} from "./index.ts"

const auditContract = compileActionContract(`
import { Action } from "smithers:flows"
class AuditFailed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class WriteAudit extends Action<
  (input: { message: string }) => Result<{ audited: string }, AuditFailed>
> {}
`, {
  fileName: "contracts/seq-audit.sm",
  exportName: "WriteAudit",
  id: "test/seq/WriteAudit",
  version: 1
})
if (!auditContract.ok) throw new Error(JSON.stringify(auditContract.diagnostics))

const alertContract = compileActionContract(`
import { Action } from "smithers:flows"
class AlertFailed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class SendAlert extends Action<
  (input: { message: string }) => Result<{ alerted: string }, AlertFailed>
> {}
`, {
  fileName: "contracts/seq-alert.sm",
  exportName: "SendAlert",
  id: "test/seq/SendAlert",
  version: 1
})
if (!alertContract.ok) throw new Error(JSON.stringify(alertContract.diagnostics))

const WriteAudit = Action.fromDescriptor<{ message: string }, { audited: string }, { code: string }>(auditContract.descriptor)
const SendAlert = Action.fromDescriptor<{ message: string }, { alerted: string }, { code: string }>(alertContract.descriptor)

const actionBindings = Object.freeze([
  Object.freeze({ moduleSpecifier: "test:seq-actions", exportName: "WriteAudit", descriptor: WriteAudit.descriptor }),
  Object.freeze({ moduleSpecifier: "test:seq-actions", exportName: "SendAlert", descriptor: SendAlert.descriptor })
])

const source = `
import { durable, sequential } from "smithers:flows"
import { WriteAudit, SendAlert } from "test:seq-actions"

throw new Error("the authored sequential module must never execute")

export const Sequenced = durable(function Sequenced(input: { message: string }) {
  return sequential(
    WriteAudit.run({ message: input.message }),
    SendAlert.run({ message: input.message })
  )
})
`

const compileSequenced = (text = source) => compileDurableSource(text, {
  fileName: "flows/sequential.sm",
  flowId: "test/seq/Sequenced",
  flowVersion: 1,
  actions: actionBindings
})

const invocationOrder: string[] = []
let alertObservedAuditStatus = ""

const deploymentFor = (plan: PlanTemplate, id: string, store: DurableStore, executionId: string, firstNodeId: string) =>
  Deployment.build({
    id,
    flow: PlanArtifact.load(PlanArtifact.encode(plan)),
    pools: [Worker.pool("seq-worker", {
      target: "typescript-bun",
      providers: [
        Provider.provide(WriteAudit, ({ message }) => {
          invocationOrder.push(`audit:${message}`)
          return { audited: message }
        }, {
          implementationId: "seq-audit",
          implementationVersion: "1",
          recovery: { mode: "repeatable", maxAttempts: 3 }
        }),
        Provider.provide(SendAlert, ({ message }) => {
          // The durable control edge: by the time this runs, the first Action
          // must already hold a committed terminal success.
          alertObservedAuditStatus = store.getNode(executionId, firstNodeId).status
          invocationOrder.push(`alert:${message}`)
          return { alerted: message }
        }, {
          implementationId: "seq-alert",
          implementationVersion: "1",
          recovery: { mode: "repeatable", maxAttempts: 3 }
        })
      ]
    })]
  })

test("sequential lowers to a format-1 control edge with no data dependency", () => {
  const compiled = compileSequenced()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan.formatVersion).toBe(1)
  expect(compiled.plan.nodes.map((node) => node.kind)).toEqual(["action", "action"])
  const [first, second] = compiled.plan.nodes
  expect(first!.controlDependencies).toEqual([])
  expect(second!.dependencies).toEqual([])
  expect(second!.controlDependencies).toEqual([first!.id])
  // The tuple output carries both success schemas.
  expect(compiled.plan.flowSchemas?.success).toMatchObject({
    shape: "structural",
    descriptor: {
      kind: "tuple",
      items: [
        { kind: "object", fields: [{ name: "audited", optional: false, value: { kind: "string" } }] },
        { kind: "object", fields: [{ name: "alerted", optional: false, value: { kind: "string" } }] }
      ]
    }
  })
  // Node ids ignore unrelated leading edits; recompilation is deterministic.
  const shifted = compileSequenced(`// unrelated leading edit\n${source}`)
  if (!shifted.ok) throw new Error(JSON.stringify(shifted.diagnostics))
  expect(shifted.plan.nodes.map((node) => node.id)).toEqual(compiled.plan.nodes.map((node) => node.id))
  const repeated = compileSequenced()
  if (!repeated.ok) throw new Error(JSON.stringify(repeated.diagnostics))
  expect(repeated.plan.digest).toBe(compiled.plan.digest)
})

test("sequential works in statement position and chains later work after the second Action", () => {
  const compiled = compileSequenced(`
import { durable, sequential } from "smithers:flows"
import { WriteAudit, SendAlert } from "test:seq-actions"
export const Fire = durable(function Fire(input: { message: string }) {
  sequential(WriteAudit.run({ message: input.message }), SendAlert.run({ message: "second" }))
  return WriteAudit.run({ message: "after" })
})
`)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan.nodes).toHaveLength(3)
  const [first, second, after] = compiled.plan.nodes
  expect(second!.controlDependencies).toEqual([first!.id])
  // Later source work observes the completed pair.
  expect(after!.controlDependencies).toEqual([second!.id])
  expect(after!.dependencies).toEqual([])
})

test("sequential projections and non-Action arguments are handled exactly", () => {
  const projected = compileSequenced(`
import { durable, sequential } from "smithers:flows"
import { WriteAudit, SendAlert } from "test:seq-actions"
export const Projected = durable(function Projected(input: { message: string }) {
  const pair = sequential(
    WriteAudit.run({ message: input.message }),
    SendAlert.run({ message: input.message })
  )
  return pair[1]
})
`)
  if (!projected.ok) throw new Error(JSON.stringify(projected.diagnostics))
  expect(projected.plan.flowSchemas?.success).toMatchObject({
    shape: "structural",
    descriptor: {
      kind: "object",
      fields: [{ name: "alerted", optional: false, value: { kind: "string" } }]
    }
  })

  const fixtures = [
    // literals are not Action calls
    source.replace("WriteAudit.run({ message: input.message }),", "\"not an action\","),
    // postfix propagation is not the sequential spelling
    source.replace(
      "WriteAudit.run({ message: input.message }),",
      "WriteAudit.run({ message: input.message })!,"
    ),
    // exactly two arguments
    source.replace(
      "SendAlert.run({ message: input.message })\n  )",
      "SendAlert.run({ message: input.message }),\n    SendAlert.run({ message: \"third\" })\n  )"
    )
  ]
  for (const fixture of fixtures) {
    const compiled = compileSequenced(fixture)
    expect(compiled.ok).toBe(false)
    if (compiled.ok) throw new Error("expected sequential lowering failure")
    expect(compiled.diagnostics[0]!.code).toBe("SMITHERS4119")
  }

  // A local function named sequential is never an intrinsic.
  const unrelated = compileSequenced(`
import { durable, sequential as compilerSequential } from "smithers:flows"
import { WriteAudit, SendAlert } from "test:seq-actions"
const sequential = (...values: unknown[]) => values
export const Sequenced = durable(function Sequenced(input: { message: string }) {
  void compilerSequential
  return sequential(WriteAudit.run({ message: input.message }), SendAlert.run({ message: input.message }))
})
`)
  expect(unrelated.ok).toBe(false)
  if (unrelated.ok) throw new Error("expected unrelated sequential spelling to fail")
  expect(unrelated.diagnostics[0]!.code).not.toBe("SMITHERS4119")
})

test("the durable order holds at runtime and across a crash after the first commit", async () => {
  const compiled = compileSequenced()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const [firstNode, secondNode] = compiled.plan.nodes
  const directory = mkdtempSync(join(tmpdir(), "smithers-sequential-"))
  const database = join(directory, "durable.sqlite")
  invocationOrder.length = 0
  alertObservedAuditStatus = ""
  try {
    const crashStore = new DurableStore(database)
    const crashDeployment = deploymentFor(compiled.plan, "seq-crash", crashStore, "seq-run", firstNode!.id)
    try {
      // Crash after the first Action's terminal commit, before the second runs.
      await expect(new DurableExecutor(crashDeployment, crashStore).execute({ message: "hello" }, {
        executionId: "seq-run",
        afterNodeAdopted: (nodeId) => {
          if (nodeId === firstNode!.id) throw new CoordinatorCrash(nodeId)
        }
      })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(invocationOrder).toEqual(["audit:hello"])
      expect(crashStore.getNode("seq-run", firstNode!.id).status).toBe("succeeded")
      expect(crashStore.getNode("seq-run", secondNode!.id).status).toBe("pending")
    } finally {
      crashStore.close()
    }

    const resumedStore = new DurableStore(database)
    const resumedDeployment = deploymentFor(compiled.plan, "seq-crash", resumedStore, "seq-run", firstNode!.id)
    try {
      expect(await new DurableExecutor(resumedDeployment, resumedStore).execute({ message: "hello" }, {
        executionId: "seq-run"
      })).toEqual([{ audited: "hello" }, { alerted: "hello" }])
      // The first Action was not reinvoked, and the second observed its
      // durable committed success before running.
      expect(invocationOrder).toEqual(["audit:hello", "alert:hello"])
      expect(alertObservedAuditStatus).toBe("succeeded")
    } finally {
      resumedStore.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("two independent connections preserve the explicit order and converge", async () => {
  const compiled = compileSequenced()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const [firstNode] = compiled.plan.nodes
  const directory = mkdtempSync(join(tmpdir(), "smithers-sequential-race-"))
  const database = join(directory, "durable.sqlite")
  invocationOrder.length = 0
  alertObservedAuditStatus = ""
  const storeA = new DurableStore(database)
  const storeB = new DurableStore(database)
  try {
    const deploymentA = deploymentFor(compiled.plan, "seq-race", storeA, "seq-race", firstNode!.id)
    const deploymentB = deploymentFor(compiled.plan, "seq-race", storeB, "seq-race", firstNode!.id)
    const [first, second] = await Promise.all([
      new DurableExecutor(deploymentA, storeA).execute({ message: "race" }, { executionId: "seq-race" }),
      new DurableExecutor(deploymentB, storeB).execute({ message: "race" }, { executionId: "seq-race" })
    ])
    const expected = [{ audited: "race" }, { alerted: "race" }]
    expect(first).toEqual(expected)
    expect(second).toEqual(expected)
    // One committed winner per node across both coordinators, in order.
    expect(invocationOrder).toEqual(["audit:race", "alert:race"])
    expect(alertObservedAuditStatus).toBe("succeeded")
  } finally {
    storeA.close()
    storeB.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("a forged artifact cannot reference an unavailable control dependency", () => {
  const compiled = compileSequenced()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const forged = JSON.parse(JSON.stringify(compiled.plan))
  // Reverse the node order so the control edge points forward.
  forged.nodes = [forged.nodes[1], forged.nodes[0]]
  const { digest: _forged, ...semantic } = forged
  expect(() => validatePlanTemplate({ ...semantic, digest: digest(semantic) }))
    .toThrow("reference to unavailable node")

  const dangling = JSON.parse(JSON.stringify(compiled.plan))
  dangling.nodes[1].controlDependencies = [digest({ unknown: true }).slice(0, 8)]
  const { digest: _dangling, ...danglingSemantic } = dangling
  expect(() => validatePlanTemplate({ ...danglingSemantic, digest: digest(danglingSemantic) }))
    .toThrow("reference to unavailable node")
})
