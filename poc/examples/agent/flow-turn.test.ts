import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  FlowToolContractError,
  PoisonModel,
  ScriptedModel,
  SqliteTurnJournal,
  TurnJournalDivergenceError,
  callableSurfaceManifest,
  declareCallableSurface,
  defineComponentIdentity,
  defineFunction,
  flowContractFromPlan,
  flowExecutionId,
  flowTool,
  isDurableAgentFunction,
  sha256Json,
} from "../../src/agent/bun.ts"
import type { AgentFunction, FlowCallIdentity } from "../../src/agent/bun.ts"
import { CoordinatorCrash, DurableExecutor, DurableStore } from "../../src/durable/index.ts"
import {
  FLOW_TURN_SOURCE,
  FetchAction,
  buildFlowDeployment,
  createFlowAgent,
  createFlowProject,
  flowTarget,
  liveProviders,
  noteTool,
  poisonProviders,
  publishingFlow,
  publishingTool,
  type PublishingInput,
  type PublishingSuccess,
} from "./flow-demo.ts"

const root = mkdtempSync(join(tmpdir(), "vibelang-agent-flow-"))
let databaseCount = 0

function databasePath(name: string): string {
  databaseCount += 1
  return join(root, `${databaseCount}-${name}.sqlite`)
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const fetchNode = publishingFlow.plan.nodes.find(
  (node) => node.kind === "action" && node.actionId === FetchAction.descriptor.id,
)!

function executionCount(store: DurableStore): number {
  return (store.database.query("SELECT COUNT(*) AS count FROM durable_executions").get() as { count: number }).count
}

const TASK = { task: "Publish README.md as PUBLISHED.md." }

describe("compiled Flows as agent functions", () => {
  test("derives the generated-code surface and manifest identity from the Plan", () => {
    const project = createFlowProject()
    const store = new DurableStore()
    try {
      const executor = new DurableExecutor(buildFlowDeployment(liveProviders(project)), store)
      const publishDocument = publishingTool(flowTarget(executor))
      const note = noteTool([])

      const contract = flowContractFromPlan(publishingFlow.plan)
      expect(publishDocument.flowContract).toEqual(contract)
      expect(publishDocument.actionContract).toBeUndefined()
      expect(publishDocument.identity.name).toBe("flow/vibelang/agent-flow/Publishing@1")
      expect(isDurableAgentFunction(publishDocument)).toBe(true)
      // The signature is the Plan's compiler-derived Flow input/success types.
      expect(publishDocument.signature).toBe(
        '(input: { readonly "path": string; readonly "target": string }) => ' +
          'Promise<{ readonly "bytes": number; readonly "path": string; readonly "revision": number }>',
      )
      expect(declareCallableSurface({ publishDocument })).toContain(
        `compiler-derived-flow plan=${publishingFlow.plan.digest}`,
      )

      const manifest = callableSurfaceManifest({ note, publishDocument })
      expect(manifest.entries).toEqual([
        {
          exposedAs: "note",
          kind: "action",
          actionId: "vibelang/agent-flow/Note",
          actionVersion: 1,
          flowId: null,
          flowVersion: null,
          planDigest: null,
          contractDigest: note.actionContract!.contractDigest,
          durable: true,
        },
        {
          exposedAs: "publishDocument",
          kind: "flow",
          actionId: null,
          actionVersion: null,
          flowId: "vibelang/agent-flow/Publishing",
          flowVersion: 1,
          planDigest: publishingFlow.plan.digest,
          contractDigest: contract.contractDigest,
          durable: true,
        },
      ])
      expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/)
      expect(project.invocations).toEqual({ fetch: 0, publish: 0 })
    } finally {
      store.close()
    }
  })

  test("runs a real two-Action Flow from generated code and journals the attachment", async () => {
    const journalPath = databasePath("flow-turn-journal")
    const storePath = databasePath("flow-turn-store")
    const project = createFlowProject()
    const notes: string[] = []
    const store = new DurableStore(storePath)
    const journal = new SqliteTurnJournal(journalPath)
    try {
      const executor = new DurableExecutor(buildFlowDeployment(liveProviders(project)), store)
      const functions = {
        publishDocument: publishingTool(flowTarget(executor)),
        note: noteTool(notes),
      }
      const model = new ScriptedModel([`\`\`\`ts\n${FLOW_TURN_SOURCE}\n\`\`\``])
      const run = await createFlowAgent({ model, functions, journal }).run(TASK)

      expect(run.ok).toBe(true)
      expect(run.result).toEqual({
        path: "PUBLISHED.md",
        bytes: 23,
        revision: 1,
        note: "published PUBLISHED.md",
      })
      // Both durable Actions ran exactly once, inside one durable execution.
      expect(project.invocations).toEqual({ fetch: 1, publish: 1 })
      expect(project.documents.get("PUBLISHED.md")).toBe("# durable flow project\n")
      expect(notes).toEqual(["published PUBLISHED.md"])
      expect(executionCount(store)).toBe(1)

      const expectedExecutionId = flowExecutionId({
        turnId: run.turnId,
        sourceDigest: run.sourceDigest!,
        functionName: "publishDocument",
        ordinal: 1,
        flowId: "vibelang/agent-flow/Publishing",
        flowVersion: 1,
        planDigest: publishingFlow.plan.digest,
        inputDigest: sha256Json({ path: "README.md", target: "PUBLISHED.md" }),
      })
      expect(store.getExecution(expectedExecutionId).status).toBe("completed")

      const events = journal.readEvents(run.turnId)
      expect(events.map((event) => event.type)).toEqual([
        "turn.started",
        "model.requested",
        "model.responded",
        "compile.completed",
        "sandbox.started",
        "function.called",
        "flow.attached",
        "function.completed",
        "function.called",
        "function.completed",
        "sandbox.completed",
        "turn.completed",
      ])
      const attached = events.find((event) => event.type === "flow.attached")
      expect(attached?.details).toEqual({
        executionId: expectedExecutionId,
        flowId: "vibelang/agent-flow/Publishing",
        flowVersion: 1,
        planDigest: publishingFlow.plan.digest,
        inputDigest: sha256Json({ path: "README.md", target: "PUBLISHED.md" }),
        contractDigest: flowContractFromPlan(publishingFlow.plan).contractDigest,
        attachment: "started",
      })
      expect(journal.readFlowCalls(run.turnId)).toEqual([{
        turnId: run.turnId,
        sourceDigest: run.sourceDigest!,
        functionName: "publishDocument",
        ordinal: 1,
        executionId: expectedExecutionId,
        flowId: "vibelang/agent-flow/Publishing",
        flowVersion: 1,
        planDigest: publishingFlow.plan.digest,
        inputDigest: sha256Json({ path: "README.md", target: "PUBLISHED.md" }),
        recordedAt: expect.any(Number),
      }])
      // The Flow's terminal success is a recorded, replayable host call.
      expect(journal.readHostCalls(run.turnId).map((call) => `${call.functionName}#${call.ordinal}`))
        .toEqual(["note#1", "publishDocument#1"])
      expect(journal.readHostCalls(run.turnId)[1].call).toEqual({
        outcome: "success",
        output: { path: "PUBLISHED.md", bytes: 23, revision: 1 },
      })
    } finally {
      journal.close()
      store.close()
    }
  })

  test("replays a completed Flow call from the journal without touching the executor", async () => {
    const journalPath = databasePath("flow-replay-journal")
    const storePath = databasePath("flow-replay-store")
    const project = createFlowProject()
    const notes: string[] = []
    const model = new ScriptedModel([FLOW_TURN_SOURCE])

    const store = new DurableStore(storePath)
    const journal = new SqliteTurnJournal(journalPath)
    let first
    try {
      const executor = new DurableExecutor(buildFlowDeployment(liveProviders(project)), store)
      first = await createFlowAgent({
        model,
        functions: { publishDocument: publishingTool(flowTarget(executor)), note: noteTool(notes) },
        journal,
      }).run(TASK)
      expect(first.ok).toBe(true)
    } finally {
      journal.close()
      store.close()
    }

    // Restart: the executor itself is poisoned, so a replayed Flow call that
    // reached it at all would fail loudly.
    const restartedNotes: string[] = []
    const reopened = new SqliteTurnJournal(journalPath)
    const poisonedTarget = {
      plan: publishingFlow.plan,
      execute: (): never => {
        throw new Error("durable executor must not be touched during replay")
      },
    }
    try {
      const replay = await createFlowAgent({
        model: new PoisonModel(model),
        functions: {
          publishDocument: publishingTool(poisonedTarget),
          note: noteTool(restartedNotes),
        },
        journal: reopened,
      }).run(TASK)

      expect(replay.ok).toBe(true)
      expect(replay.turnId).toBe(first.turnId)
      expect(replay.result).toEqual(first.result)
      // Nothing ran a second time: no Action, no note, no durable execution.
      expect(project.invocations).toEqual({ fetch: 1, publish: 1 })
      expect(project.revision).toBe(1)
      expect(restartedNotes).toEqual([])
      // A replayed Flow call never re-attaches: the recorded outcome answers it.
      expect(reopened.readEvents(replay.turnId).filter((event) => event.type === "flow.attached"))
        .toHaveLength(1)
      expect(reopened.readEvents(replay.turnId)
        .filter((event) => event.details.source === "replay")
        .map((event) => event.type))
        .toEqual(["model.responded", "function.completed", "function.completed"])
    } finally {
      reopened.close()
    }
  })

  test("a turn that crashed mid-Flow joins the same execution and does not re-run its Actions", async () => {
    const journalPath = databasePath("flow-crash-journal")
    const storePath = databasePath("flow-crash-store")
    const project = createFlowProject()
    const notes: string[] = []
    const model = new ScriptedModel([FLOW_TURN_SOURCE, FLOW_TURN_SOURCE])

    // Attempt 1: the coordinator dies right after the Fetch Action commits.
    const store = new DurableStore(storePath)
    const journal = new SqliteTurnJournal(journalPath)
    let crashed
    let startedExecutionId: string
    try {
      const executor = new DurableExecutor(buildFlowDeployment(liveProviders(project)), store)
      const target = flowTarget(executor, {
        afterNodeAdopted: (nodeId) => {
          if (nodeId === fetchNode.id) throw new CoordinatorCrash(nodeId)
        },
      })
      crashed = await createFlowAgent({
        model,
        functions: { publishDocument: publishingTool(target), note: noteTool(notes) },
        journal,
      }).run(TASK)

      expect(crashed.ok).toBe(false)
      expect(crashed.error?.name).toBe("DurableFlowInterrupted")
      expect(project.invocations).toEqual({ fetch: 1, publish: 0 })
      expect(notes).toEqual([])
      startedExecutionId = journal.readFlowCalls(crashed.turnId)[0].executionId
      expect(store.getExecution(startedExecutionId).status).toBe("running")
      expect(store.getNode(startedExecutionId, fetchNode.id).status).toBe("succeeded")
      // The interruption is not a Flow outcome, so nothing replayable was
      // committed for the call site.
      expect(journal.readHostCalls(crashed.turnId)).toEqual([])
    } finally {
      journal.close()
      store.close()
    }

    // Attempt 2: a fresh process, a poisoned Fetch implementation, and the
    // same deployment identity. The turn replays, re-derives the same
    // execution id, and resumes the execution the crash left running.
    const restartedStore = new DurableStore(storePath)
    const reopened = new SqliteTurnJournal(journalPath)
    const restartedNotes: string[] = []
    try {
      const live = liveProviders(project)
      const restartedExecutor = new DurableExecutor(
        buildFlowDeployment(poisonProviders(live, ["fetch"])),
        restartedStore,
      )
      const replay = await createFlowAgent({
        model: new PoisonModel(model),
        functions: {
          publishDocument: publishingTool(flowTarget(restartedExecutor)),
          note: noteTool(restartedNotes),
        },
        journal: reopened,
      }).run(TASK)

      expect(replay.ok).toBe(true)
      expect(replay.turnId).toBe(crashed.turnId)
      expect(replay.result).toEqual({
        path: "PUBLISHED.md",
        bytes: 23,
        revision: 1,
        note: "published PUBLISHED.md",
      })
      // Fetch did not run again — its poisoned implementation was never
      // invoked — and exactly one durable execution exists.
      expect(project.invocations).toEqual({ fetch: 1, publish: 1 })
      expect(executionCount(restartedStore)).toBe(1)

      const attachments = reopened.readEvents(replay.turnId)
        .filter((event) => event.type === "flow.attached")
        .map((event) => event.details)
      expect(attachments).toHaveLength(2)
      expect(attachments[0]).toMatchObject({ executionId: startedExecutionId, attachment: "started" })
      expect(attachments[1]).toMatchObject({ executionId: startedExecutionId, attachment: "joined" })
      expect(reopened.readFlowCalls(replay.turnId)).toHaveLength(1)
      expect(restartedStore.getExecution(startedExecutionId).status).toBe("completed")
    } finally {
      reopened.close()
      restartedStore.close()
    }
  })

  test("a replayed Flow call site with a different input fails closed before the executor", async () => {
    const journalPath = databasePath("flow-divergence-journal")
    const storePath = databasePath("flow-divergence-store")
    const project = createFlowProject({ "README.md": "# durable flow project\n", "OTHER.md": "# other\n" })
    const model = new ScriptedModel([DIVERGENT_TURN_SOURCE, DIVERGENT_TURN_SOURCE])

    const store = new DurableStore(storePath)
    const journal = new SqliteTurnJournal(journalPath)
    let crashed
    let startedExecutionId: string
    try {
      const executor = new DurableExecutor(buildFlowDeployment(liveProviders(project)), store)
      crashed = await createFlowAgent({
        model,
        functions: {
          publishDocument: publishingTool(flowTarget(executor, {
            afterNodeAdopted: (nodeId) => {
              if (nodeId === fetchNode.id) throw new CoordinatorCrash(nodeId)
            },
          })),
          pickPath: pickPath("README.md"),
        },
        journal,
      }).run(TASK)
      expect(crashed.ok).toBe(false)
      expect(crashed.error?.name).toBe("DurableFlowInterrupted")
      startedExecutionId = journal.readFlowCalls(crashed.turnId)[0].executionId
    } finally {
      journal.close()
      store.close()
    }

    // The same call site, the same turn, but the non-replayable closure that
    // feeds the Flow now answers differently.
    const restartedStore = new DurableStore(storePath)
    const reopened = new SqliteTurnJournal(journalPath)
    try {
      const executor = new DurableExecutor(buildFlowDeployment(liveProviders(project)), restartedStore)
      const replay = await createFlowAgent({
        model: new PoisonModel(model),
        functions: {
          publishDocument: publishingTool(flowTarget(executor)),
          pickPath: pickPath("OTHER.md"),
        },
        journal: reopened,
      }).run(TASK)

      expect(replay.turnId).toBe(crashed.turnId)
      expect(replay.ok).toBe(false)
      expect(replay.error?.name).toBe("TurnJournalDivergenceError")
      expect(replay.error?.message).toContain("used a different input")
      // Nothing started: the divergent call never reached the durable store.
      expect(executionCount(restartedStore)).toBe(1)
      expect(restartedStore.getExecution(startedExecutionId).status).toBe("running")
      expect(project.invocations).toEqual({ fetch: 1, publish: 0 })
      expect(reopened.readFlowCalls(replay.turnId)).toHaveLength(1)
    } finally {
      reopened.close()
      restartedStore.close()
    }
  })

  test("invalid Flow input is rejected by the RPC codec before any execution exists", async () => {
    const journalPath = databasePath("flow-bad-input-journal")
    const storePath = databasePath("flow-bad-input-store")
    const project = createFlowProject()
    const store = new DurableStore(storePath)
    const journal = new SqliteTurnJournal(journalPath)
    try {
      const executor = new DurableExecutor(buildFlowDeployment(liveProviders(project)), store)
      const run = await createFlowAgent({
        model: new ScriptedModel([BAD_INPUT_TURN_SOURCE]),
        functions: { publishDocument: publishingTool(flowTarget(executor)) },
        journal,
      }).run(TASK)

      expect(run.ok).toBe(false)
      expect(run.error?.name).toBe("AgentRpcContractError")
      expect(run.error?.message).toContain("publishDocument input violated compiler-derived RPC contract")
      expect(project.invocations).toEqual({ fetch: 0, publish: 0 })
      expect(executionCount(store)).toBe(0)
      expect(journal.readFlowCalls(run.turnId)).toEqual([])
      expect(journal.readEvents(run.turnId).some((event) => event.type === "flow.attached")).toBe(false)
    } finally {
      journal.close()
      store.close()
    }
  })

  test("the derived execution id is a pure function of turn, call site, Plan, and input", () => {
    const base: Omit<FlowCallIdentity, "executionId"> = {
      turnId: "turn_x",
      sourceDigest: "a".repeat(64),
      functionName: "publishDocument",
      ordinal: 1,
      flowId: "vibelang/agent-flow/Publishing",
      flowVersion: 1,
      planDigest: publishingFlow.plan.digest,
      inputDigest: sha256Json({ path: "README.md" }),
    }
    const id = flowExecutionId(base)
    expect(id).toMatch(/^turnflow_[a-f0-9]{64}$/)
    expect(flowExecutionId({ ...base })).toBe(id)
    for (const changed of [
      { turnId: "turn_y" },
      { sourceDigest: "b".repeat(64) },
      { functionName: "other" },
      { ordinal: 2 },
      { planDigest: "c".repeat(64) },
      { inputDigest: sha256Json({ path: "OTHER.md" }) },
    ]) {
      expect(flowExecutionId({ ...base, ...changed })).not.toBe(id)
    }
  })

  test("the journal attachment is idempotent for one identity and fails closed otherwise", () => {
    const journal = new SqliteTurnJournal(databasePath("flow-attachment-unit"))
    try {
      const identity: FlowCallIdentity = {
        turnId: "turn_unit",
        sourceDigest: "a".repeat(64),
        functionName: "publishDocument",
        ordinal: 1,
        flowId: "vibelang/agent-flow/Publishing",
        flowVersion: 1,
        planDigest: publishingFlow.plan.digest,
        inputDigest: sha256Json({ path: "README.md" }),
        executionId: "turnflow_" + "d".repeat(64),
      }
      expect(journal.attachFlowCall(identity).attachment).toBe("started")
      expect(journal.attachFlowCall(identity)).toMatchObject({
        attachment: "joined",
        executionId: identity.executionId,
      })
      expect(() => journal.attachFlowCall({ ...identity, inputDigest: "e".repeat(64) }))
        .toThrow(TurnJournalDivergenceError)
      expect(() => journal.attachFlowCall({ ...identity, planDigest: "f".repeat(64) }))
        .toThrow("different deployed Plan")
      expect(() => journal.attachFlowCall({ ...identity, executionId: "turnflow_other" }))
        .toThrow("different durable execution id")
      // A different call site is an ordinary miss, not a divergence.
      expect(journal.attachFlowCall({ ...identity, ordinal: 2 }).attachment).toBe("started")
    } finally {
      journal.close()
    }
  })

  test("only a valid Plan artifact with its executor wiring can be exposed", () => {
    // Dropping the Flow schemas also breaks the Plan's own semantic digest, so
    // Plan validation refuses it before the contract projection is reached.
    const { flowSchemas: _dropped, ...tampered } = publishingFlow.plan
    expect(() => flowContractFromPlan(tampered as typeof publishingFlow.plan))
      .toThrow(FlowToolContractError)
    expect(() => flowContractFromPlan(tampered as typeof publishingFlow.plan))
      .toThrow("not a valid durable Plan artifact")
    expect(() => flowTool({ plan: publishingFlow.plan } as never)).toThrow("execute(input, { executionId })")
  })
})

const PICK_PATH_IDENTITY = defineComponentIdentity({
  name: "demo/pick-path",
  artifact: "pick-path v1",
  config: null,
})

/**
 * A legacy JSON-only closure: never replayed, so a restart calls it again and
 * it can legitimately answer differently. That is exactly the divergence the
 * Flow attachment has to catch.
 */
function pickPath(path: string): AgentFunction<Record<string, never>, { readonly path: string }> {
  return defineFunction<Record<string, never>, { readonly path: string }>(
    "(input: {}) => Promise<{ readonly path: string }>",
    async () => ({ path }),
    "choose the document to publish",
    { identity: PICK_PATH_IDENTITY },
  )
}

const DIVERGENT_TURN_SOURCE = `
export default async function turn(functions: Functions) {
  const chosen = await functions.pickPath({})
  const published = await functions.publishDocument({ path: chosen.path, target: "PUBLISHED.md" })
  return { path: published.path, revision: published.revision }
}
`

const BAD_INPUT_TURN_SOURCE = `
export default async function turn(functions: Functions) {
  const send = functions.publishDocument as unknown as (input: unknown) => Promise<unknown>
  return send({ path: 1, target: "PUBLISHED.md" }) as Promise<never>
}
`

// Type-only anchors: the exposed tool keeps the Plan's derived shapes.
const _typedTool: (target: Parameters<typeof publishingTool>[0]) => AgentFunction<PublishingInput, PublishingSuccess> =
  publishingTool
void _typedTool
