import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getNativeCompiler } from "../compiler/native.ts"
import { PlanArtifact, loadCompiledFlow } from "./artifact.ts"
import { validateEffectManifest } from "./manifest-artifact.ts"
import { Deployment } from "./provider.ts"
import { CoordinatorCrash, DurableExecutor } from "./engine.ts"
import { DurableStore } from "./store.ts"

test("Go-emitted input Plan survives restart, consumes FIFO once, and receives its broadcast", async () => {
  const source = `import { durable, dequeue, waitBroadcast } from "vibelang:flows"
export const Build = durable((input: { name: string }) => {
  const first = dequeue<string>("jobs")
  const second = dequeue<string>("jobs")
  const notice = waitBroadcast<{ version: number }>("release")
  return { name: input.name, first, second, notice }
})`
  const result = getNativeCompiler().compile({
    rootNames: ["inputs.vibe"], files: [{ path: "inputs.vibe", kind: "vibelang", text: source }],
    lowering: "internal", options: { noEmitOnError: true, vibelangEffectManifest: true },
  })
  expect(result.emitSkipped).toBe(false)
  expect(result.diagnostics).toEqual([])
  const read = (suffix: string) => {
    const files = result.artifacts.filter(file => file.path.endsWith(suffix))
    expect(files).toHaveLength(1)
    return JSON.parse(Buffer.from(files[0]!.content, "base64").toString("utf8"))
  }
  // Read data artifacts directly. Neither generated module initialization nor
  // a TypeScript compiler-library checker is involved in loading this Plan.
  const plan = PlanArtifact.validate(read(".plan.json"))
  const manifest = validateEffectManifest(read(".effect-manifest.json"))
  expect(plan.formatVersion).toBe(3)
  expect(plan.nodes.map(node => node.kind)).toEqual(["queue", "queue", "signal"])
  expect(manifest.contracts.map(row => [row.kind, row.identity])).toEqual([["broadcast", "release"], ["queue", "jobs"]])
  expect(manifest.sites).toHaveLength(3)
  const deployment = Deployment.build({ id: "native-inputs", flow: loadCompiledFlow(PlanArtifact.encode(plan)), pools: [] })
  const directory = mkdtempSync(join(tmpdir(), "vibelang-native-inputs-"))
  const filename = join(directory, "state.sqlite")
  let store: DurableStore | undefined
  try {
    store = new DurableStore(filename)
    await expect(new DurableExecutor(deployment, store).execute({ name: "worker" }, {
      executionId: "native-inputs", deadline: Date.now() + 10_000,
      afterQueueWaiting(nodeId) { throw new CoordinatorCrash(nodeId) },
    })).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(store.getNode("native-inputs", plan.nodes[0]!.id).status).toBe("pending")
    store.close()

    store = new DurableStore(filename)
    const executor = new DurableExecutor(deployment, store)
    const producer = { producerToken: executor.grantQueue("jobs").producerToken }
    for (const value of ["first", "second", "untouched"]) {
      executor.enqueue({ queueId: "jobs", idempotencyKey: value, item: value }, producer)
    }
    let subscriptions = 0
    const handle = executor.resume("native-inputs", {
      deadline: Date.now() + 10_000,
      afterSignalWaiting(_nodeId, signalId) {
        subscriptions++
        const delivered = executor.deliverBroadcast({ signalId, idempotencyKey: "release-1", payload: { version: 1 } },
          { senderToken: executor.grantBroadcast(signalId).senderToken })
        expect(delivered.notifiedExecutions).toEqual(["native-inputs"])
      },
    })
    const expected = { name: "worker", first: "first", second: "second", notice: { version: 1 } }
    expect(await handle.result()).toEqual(expected)
    expect(subscriptions).toBe(1)
    store.close()

    store = new DurableStore(filename)
    expect(await new DurableExecutor(deployment, store).resume("native-inputs", { deadline: Date.now() + 10_000 }).result()).toEqual(expected)
    expect(store.journal("native-inputs").filter(event => event.type === "queue_item_consumed")).toHaveLength(2)
    expect(store.journal("native-inputs").filter(event => event.type === "broadcast_consumed")).toHaveLength(1)
    expect(store.database.query("SELECT state,consumed_execution_id FROM durable_queue_items WHERE idempotency_key=?")
      .get("untouched")).toEqual({ state: "pending", consumed_execution_id: null })
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
