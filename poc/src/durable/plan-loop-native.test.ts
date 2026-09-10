import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getNativeCompiler } from "../compiler/native.ts"
import { PlanArtifact, loadCompiledFlow } from "./artifact.ts"
import { Action } from "./authoring.ts"
import { validateEffectManifest } from "./manifest-artifact.ts"
import { Deployment, Provider, Worker } from "./provider.ts"
import { CoordinatorCrash, DurableActionDefect, DurableExecutionAlreadyFailed, DurableExecutor } from "./engine.ts"
import { DurableStore } from "./store.ts"

test("Go-emitted bounded loop resumes committed rounds and enforces its pinned ceiling", async () => {
  const source = readFileSync(new URL("../../../compiler/testdata/durable-loop.vibe", import.meta.url), "utf8")
  const compiled = getNativeCompiler().compile({
    rootNames: ["main.vibe"], files: [{ path: "main.vibe", kind: "vibelang", text: source }],
    lowering: "internal", options: { noEmitOnError: true, vibelangEffectManifest: true },
  })
  expect(compiled.emitSkipped).toBe(false)
  expect(compiled.diagnostics).toEqual([])
  const read = (suffix: string) => {
    const artifacts = compiled.artifacts.filter(file => file.path.endsWith(suffix))
    expect(artifacts).toHaveLength(1)
    return JSON.parse(Buffer.from(artifacts[0]!.content, "base64").toString("utf8"))
  }
  const plan = PlanArtifact.validate(read(".plan.json"))
  const manifest = validateEffectManifest(read(".effect-manifest.json"))
  expect(manifest.actions.map(action => action.contractDigest)).toEqual(plan.actions.map(action => action.contractDigest))
  expect(plan.formatVersion).toBe(2)
  expect(plan.nodes).toHaveLength(1)
  const loop = plan.nodes[0]!
  expect(loop.kind).toBe("loop")
  type State = { remaining: number; total: number }
  const Step = Action.fromDescriptor<State, State, Error>(plan.actions[0]!)
  const calls: State[] = []
  const deployment = Deployment.build({
    id: "native-loop", flow: loadCompiledFlow(PlanArtifact.encode(plan)),
    pools: [Worker.pool("native-loop-worker", {
      target: "typescript-bun",
      providers: [Provider.provide(Step, input => {
        calls.push({ ...input })
        return { remaining: input.remaining - 1, total: input.total + input.remaining }
      }, { implementationId: "native-loop-step", implementationVersion: "1", recovery: { mode: "repeatable", maxAttempts: 2 } })],
    })],
  })
  const directory = mkdtempSync(join(tmpdir(), "vibelang-native-loop-"))
  const filename = join(directory, "state.sqlite")
  let store: DurableStore | undefined
  try {
    store = new DurableStore(filename)
    await expect(new DurableExecutor(deployment, store).execute({ count: 3 }, {
      executionId: "loop", deadline: Date.now() + 10_000,
      afterNodeAdopted(nodeId) {
        if (nodeId !== loop.id && calls.length === 1) throw new CoordinatorCrash(nodeId)
      },
    })).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(calls).toEqual([{ remaining: 3, total: 0 }])
    store.close()

    store = new DurableStore(filename)
    const executor = new DurableExecutor(deployment, store)
    expect(await executor.resume("loop", { deadline: Date.now() + 10_000 }).result()).toEqual({ remaining: 0, total: 6 })
    expect(calls).toEqual([{ remaining: 3, total: 0 }, { remaining: 2, total: 3 }, { remaining: 1, total: 5 }])
    expect(store.journal("loop").filter(event => event.type === "loop_round_materialized")).toHaveLength(3)
    expect(await executor.resume("loop").result()).toEqual({ remaining: 0, total: 6 })
    expect(calls).toHaveLength(3)
    expect(await executor.execute({ count: 0 }, { executionId: "zero" })).toEqual({ remaining: 0, total: 0 })
    expect(calls).toHaveLength(3)

    await expect(executor.execute({ count: 6 }, { executionId: "ceiling", deadline: Date.now() + 10_000 }))
      .rejects.toBeInstanceOf(DurableActionDefect)
    expect(calls).toHaveLength(8)
    expect(store.getNode("ceiling", loop.id).status).toBe("defect")
    expect(store.getExecution("ceiling").status).toBe("failed")
    await expect(executor.resume("ceiling").result()).rejects.toBeInstanceOf(DurableExecutionAlreadyFailed)
    expect(calls).toHaveLength(8)
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 20_000)
