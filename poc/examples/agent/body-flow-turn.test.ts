import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CodingAgent, DenoSubprocessSandbox, FlowToolContractError, InMemoryTypeScriptCompiler,
  PoisonModel, ScriptedModel, SqliteTurnJournal, callableSurfaceManifest, declareCallableSurface,
  defineComponentIdentity, flowContractFromBody, flowTool, textPrompt,
  type AgentFunctionTable, type FlowToolTarget, type JsonValue, type ModelAdapter,
} from "../../src/agent/bun.ts"
import {
  Action, CoordinatorCrash, Deployment, DurableStore, Provider, SignedDeployment, Worker,
  compileDurableBody, createAuthenticatedDurableExecutor, deploymentVerificationKey,
  generateDeploymentSigningKeyPair, type ExecuteOptions,
} from "../../src/durable/index.ts"
import { digest } from "../../src/durable/value.ts"

// This Flow deliberately needs the executable body: captured module mutation,
// a helper, a lexical Layer, and a mutable accumulator across repeated Actions.
const SOURCE = `
import { durable, Action } from "vibelang:flows"
import { Context } from "vibelang/context"
import { Layer } from "vibelang/provider"
class Rates extends Context { declare readonly extra: number }
class Step extends Action<(input: number) => Result<number, never>> {}
const captured = { initial: 1 }
captured.initial = 2
function step(value: number): Result<number, never> {
  return Step.run(value)! + Rates.context().extra
}
export const Flow = durable((count: number): Result<number, never> => {
  return Layer.provide(Layer.succeed(Rates, { extra: 3 }), (): Result<number, never> => {
    let answer = captured.initial
    for (let i = 0; i < count; i++) answer += step(i)!
    return answer
  })
})`

const compiled = compileDurableBody(SOURCE, { fileName: "agent/executable-flow.vibe" })
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
const body = compiled.body
const root = mkdtempSync(join(tmpdir(), "vibelang-agent-body-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const TASK = { task: "Compute the total for three inputs." }
// Generated programs are ordinary TypeScript: await the RPC, never VibeLang !.
const TURN = `export default async function turn(functions: Functions) {
  const value = await functions.calculate(3)
  return { value }
}`

function deployment(implementation: (input: number) => number, version = "1") {
  const action = Action.fromDescriptor<number, number, never>(body.manifest.actions[0]!)
  const provider = Provider.provide(action, implementation, {
    implementationId: "agent-body-step", implementationVersion: version,
    recovery: { mode: "repeatable", maxAttempts: 2 },
  })
  return Deployment.build<number, number>({ id: "agent-body", flow: {
    id: body.manifest.flowId, version: body.manifest.flowVersion, body,
  }, pools: [Worker.pool("agent-body-worker", { target: "typescript-bun", providers: [provider] })] })
}

function executor(store: DurableStore, implementation: (input: number) => number, version = "1") {
  const built = deployment(implementation, version)
  const key = generateDeploymentSigningKeyPair()
  const proof = SignedDeployment.authenticate(built,
    SignedDeployment.encode(built.flow.body, built.manifest, key), [deploymentVerificationKey(key)])
  return createAuthenticatedDurableExecutor(proof, store)
}

function expose(target: FlowToolTarget) {
  return flowTool<number, number>(target, {
    implementationId: "agent-body-coordinator", implementationVersion: "1",
  })
}

function agent(model: ModelAdapter, functions: AgentFunctionTable, journal: SqliteTurnJournal) {
  return CodingAgent.make<typeof TASK, JsonValue>({ model, functions, journal,
    prompt: textPrompt({ system: "Return an ordinary TypeScript module.", task: ({ task }) => task }),
    compiler: new InMemoryTypeScriptCompiler(), sandbox: new DenoSubprocessSandbox({ timeoutMs: 20_000 }),
    maxRepairs: 0,
  })
}

function target(coordinator: ReturnType<typeof executor>, hooks: Omit<ExecuteOptions, "executionId"> = {}) {
  return { body: coordinator.deployment.flow.body, deployment: coordinator.deployment,
    execute: (input: unknown, options: { executionId: string }) =>
      coordinator.execute(input as number, { ...hooks, ...options }),
  }
}

function executionCount(store: DurableStore): number {
  return (store.database.query("SELECT COUNT(*) AS n FROM durable_executions").get() as { n: number }).n
}

test("agent body contract inspection never evaluates the executable and never falls back to a Plan", () => {
  const { digest: _old, ...identity } = body
  const code = { ...identity, javascript: "(() => { throw new Error('inspection evaluated code') })()" }
  const inert = { ...code, digest: digest(code) }
  const calculate = expose({ body: inert, execute() { throw new Error("inspection invoked executor") } })
  expect(calculate.signature).toBe("(input: number) => Promise<number>")
  expect(calculate.flowContract).toEqual(flowContractFromBody(inert))
  expect(declareCallableSurface({ calculate })).toContain(`plan=${inert.digest}`)
  expect(callableSurfaceManifest({ calculate }).entries[0]).toMatchObject({
    kind: "flow", durable: true, planDigest: inert.digest,
  })
  expect(() => flowTool({ body: { ...body, javascript: "tampered" }, plan: {}, execute() {} } as never))
    .toThrow(FlowToolContractError)
  expect(() => flowTool({ body: undefined, plan: {}, execute() {} } as never)).toThrow(FlowToolContractError)
})

test("an agent executes a signed body in the real sandbox and replays without a model or executor call", async () => {
  const storePath = join(root, "complete-store.sqlite")
  const journalPath = join(root, "complete-turn.sqlite")
  const calls: number[] = []
  const store = new DurableStore(storePath)
  const journal = new SqliteTurnJournal(journalPath)
  const model = new ScriptedModel([TURN])
  let first: Awaited<ReturnType<ReturnType<typeof agent>["run"]>>
  try {
    // Direct authenticated coordinator, not a test adapter or a compatibility Plan.
    const coordinator = executor(store, input => { calls.push(input); return input + 1 })
    const calculate = expose(coordinator)
    first = await agent(model, { calculate }, journal).run(TASK)
    expect(first.ok).toBe(true)
    expect(first.result).toEqual({ value: 17 })
    expect(calls).toEqual([0, 1, 2])
    expect(executionCount(store)).toBe(1)
    const attachment = journal.readFlowCalls(first.turnId)[0]!
    expect(attachment.planDigest).toBe(body.digest)
    expect(store.getExecution(attachment.executionId).status).toBe("completed")
    expect(journal.readHostCalls(first.turnId)).toHaveLength(1)
  } finally { journal.close(); store.close() }

  const reopened = new SqliteTurnJournal(journalPath)
  let invoked = false
  try {
    const calculate = expose({ body, deployment: deployment(input => input + 1),
      execute(): never { invoked = true; throw new Error("replay invoked executor") } })
    const replay = await agent(new PoisonModel(model), { calculate }, reopened).run(TASK)
    expect(replay.ok).toBe(true)
    expect(replay.turnId).toBe(first!.turnId)
    expect(replay.result).toEqual(first!.result)
    expect(invoked).toBe(false)
    expect(calls).toEqual([0, 1, 2])
    expect(reopened.readFlowCalls(replay.turnId)).toHaveLength(1)
  } finally { reopened.close() }
})

test("an interrupted agent turn reattaches to the same executable body and does not repeat its committed Action", async () => {
  const storePath = join(root, "restart-store.sqlite")
  const journalPath = join(root, "restart-turn.sqlite")
  const model = new ScriptedModel([TURN, TURN])
  const calls: number[] = []
  let executionId = ""
  let turnId = ""
  const store = new DurableStore(storePath)
  const journal = new SqliteTurnJournal(journalPath)
  try {
    const coordinator = executor(store, input => { calls.push(input); return input + 1 })
    const calculate = expose(target(coordinator, { afterNodeAdopted: key => { throw new CoordinatorCrash(key) } }))
    const run = await agent(model, { calculate }, journal).run(TASK)
    expect(run.ok).toBe(false)
    expect(run.error?.name).toBe("DurableFlowInterrupted")
    expect(calls).toEqual([0])
    turnId = run.turnId
    executionId = journal.readFlowCalls(turnId)[0]!.executionId
    expect(store.getExecution(executionId).status).toBe("running")
    expect(journal.readHostCalls(turnId)).toEqual([])
  } finally { journal.close(); store.close() }

  const reopenedStore = new DurableStore(storePath)
  const reopenedJournal = new SqliteTurnJournal(journalPath)
  try {
    const coordinator = executor(reopenedStore, input => {
      if (input === 0) throw new Error("committed Action was invoked again")
      calls.push(input)
      return input + 1
    })
    const run = await agent(new PoisonModel(model), { calculate: expose(coordinator) }, reopenedJournal).run(TASK)
    expect(run.ok).toBe(true)
    expect(run.turnId).toBe(turnId)
    expect(run.result).toEqual({ value: 17 })
    expect(calls).toEqual([0, 1, 2])
    expect(executionCount(reopenedStore)).toBe(1)
    expect(reopenedJournal.readFlowCalls(turnId)).toHaveLength(1)
    expect(reopenedStore.getExecution(executionId).status).toBe("completed")
    expect(reopenedJournal.readEvents(turnId).filter(event => event.type === "flow.attached")
      .map(event => event.details.attachment)).toEqual(["started", "joined"])
  } finally { reopenedJournal.close(); reopenedStore.close() }
})

test("executable Flow RPC input is validated before the coordinator or durable journal is touched", async () => {
  const store = new DurableStore()
  const journal = new SqliteTurnJournal(join(root, "invalid-turn.sqlite"))
  let invoked = false
  try {
    const coordinator = executor(store, (): never => { throw new Error("invalid input reached worker") })
    const calculate = expose({ body, execute(input: unknown, options: { executionId: string }) {
      invoked = true
      return coordinator.execute(input as number, options)
    } })
    const invalid = TURN.replace("calculate(3)", "calculate(\"invalid\" as unknown as number)")
    const run = await agent(new ScriptedModel([invalid]), { calculate }, journal).run(TASK)
    expect(run.ok).toBe(false)
    expect(run.error?.name).toBe("AgentRpcContractError")
    expect(invoked).toBe(false)
    expect(executionCount(store)).toBe(0)
    expect(journal.readFlowCalls(run.turnId)).toEqual([])
  } finally { journal.close(); store.close() }
})

test("agent function identity includes deployed provider routing, not just the executable body", () => {
  const before = deployment(input => input + 1, "1")
  const after = deployment(input => input + 2, "2")
  expect(before.flow.body.digest).toBe(after.flow.body.digest)
  expect(before.manifest.digest).not.toBe(after.manifest.digest)
  const left = expose({ deployment: before, execute() {} })
  const right = expose({ deployment: after, execute() {} })
  expect(left.identity).not.toEqual(right.identity)
  expect(callableSurfaceManifest({ calculate: left }).digest).not.toBe(callableSurfaceManifest({ calculate: right }).digest)
  // An explicit identity does not waive the separately pinned Flow contract.
  const identity = defineComponentIdentity({ name: "test/same-explicit-identity", artifact: "v1", config: null })
  const explicitBefore = flowTool({ deployment: before, execute() {} }, { identity })
  const explicitAfter = flowTool({ deployment: after, execute() {} }, { identity })
  expect(explicitBefore.identity).toEqual(explicitAfter.identity)
  expect(explicitBefore.flowContract!.contractDigest).not.toBe(explicitAfter.flowContract!.contractDigest)
  expect(callableSurfaceManifest({ calculate: explicitBefore }).digest)
    .not.toBe(callableSurfaceManifest({ calculate: explicitAfter }).digest)
  expect(() => expose({ deployment: { ...before, manifest: { ...before.manifest, digest: "0".repeat(64) } }, execute() {} }))
    .toThrow(FlowToolContractError)
  expect(() => expose({ deployment: { flow: before.flow }, execute() {} } as never)).toThrow(FlowToolContractError)
})

test("a changed signed provider deployment cannot replay a completed old turn's answer", async () => {
  const store = new DurableStore()
  const journal = new SqliteTurnJournal(join(root, "redeployed-turn.sqlite"))
  const model = new ScriptedModel([TURN, TURN])
  const beforeCalls: number[] = []
  const afterCalls: number[] = []
  try {
    const before = executor(store, input => { beforeCalls.push(input); return input + 1 })
    const first = await agent(model, { calculate: expose(before) }, journal).run(TASK)
    expect(first.ok).toBe(true)
    expect(first.result).toEqual({ value: 17 })
    const after = executor(store, input => { afterCalls.push(input); return input + 2 }, "2")
    const next = await agent(model, { calculate: expose(after) }, journal).run(TASK)
    expect(next.ok).toBe(true)
    expect(next.result).toEqual({ value: 20 })
    expect(next.turnId).not.toBe(first.turnId)
    expect(beforeCalls).toEqual([0, 1, 2])
    expect(afterCalls).toEqual([0, 1, 2])
    expect(model.requests).toHaveLength(2)
    expect(executionCount(store)).toBe(2)
  } finally { journal.close(); store.close() }
})
