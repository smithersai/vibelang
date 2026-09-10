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

test.each(["emit", "query"] as const)("Go %s keyed fan-out resumes between steps and preserves input order without re-keying children", async profile => {
  const source = readFileSync(new URL("../../../compiler/testdata/durable-fanout-steps.vibe", import.meta.url), "utf8")
  const compileArtifacts = (): { plan: unknown; manifest: unknown } => {
    if (profile === "query") {
      const compiled = getNativeCompiler().compilePlanSource({
        source, fileName: "main.vibe", flowId: "", flowVersion: 1, mode: "plan",
      })
      expect(compiled.status).toBe("plan")
      expect(compiled.diagnostics).toEqual([])
      expect(compiled.manifestFailure).toBe("")
      return { plan: JSON.parse(compiled.planJson), manifest: JSON.parse(compiled.manifestJson) }
    }
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
    return { plan: read(".plan.json"), manifest: read(".effect-manifest.json") }
  }
  const artifacts = compileArtifacts()
  const plan = PlanArtifact.validate(artifacts.plan)
  const manifest = validateEffectManifest(artifacts.manifest)
  expect(manifest.actions.map(action => action.contractDigest)).toEqual(plan.actions.map(action => action.contractDigest))
  expect(plan.formatVersion).toBe(2)
  expect(plan.nodes).toHaveLength(1)
  const fanout = plan.nodes[0]!
  expect(fanout.kind).toBe("fanout")
  type Item = { id: string; value: number }
  const Read = Action.fromDescriptor<Item, Item, Error>(plan.actions.find(action => action.id === "main.vibe#Read")!)
  const Publish = Action.fromDescriptor<Item, { id: string; done: boolean }, Error>(plan.actions.find(action => action.id === "main.vibe#Publish")!)
  const calls: string[] = []
  const published: Item[] = []
  const deployment = Deployment.build({
    id: "native-fanout", flow: loadCompiledFlow(PlanArtifact.encode(plan)),
    pools: [Worker.pool("native-fanout-worker", {
      target: "typescript-bun",
      providers: [
        Provider.provide(Read, input => {
          calls.push(`read:${input.id}`)
          return { id: input.id, value: input.value * 2 }
        }, { implementationId: "native-fanout-read", implementationVersion: "1", recovery: { mode: "repeatable", maxAttempts: 2 } }),
        Provider.provide(Publish, input => {
          calls.push(`publish:${input.id}`)
          published.push({ ...input })
          return { id: input.id, done: true }
        }, { implementationId: "native-fanout-publish", implementationVersion: "1", recovery: { mode: "repeatable", maxAttempts: 2 } }),
      ],
    })],
  })
  const directory = mkdtempSync(join(tmpdir(), "vibelang-native-fanout-"))
  const filename = join(directory, "state.sqlite")
  let store: DurableStore | undefined
  try {
    store = new DurableStore(filename)
    await expect(new DurableExecutor(deployment, store).execute({ items: [{ id: "resume", value: 3 }] }, {
      executionId: "resume", deadline: Date.now() + 10_000,
      afterNodeAdopted(nodeId) {
        if (nodeId !== fanout.id && calls.length === 1) throw new CoordinatorCrash(nodeId)
      },
    })).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(calls).toEqual(["read:resume"])
    expect(published).toEqual([])
    store.close()

    store = new DurableStore(filename)
    const executor = new DurableExecutor(deployment, store)
    expect(await executor.resume("resume", { deadline: Date.now() + 10_000 }).result())
      .toEqual([{ id: "resume", done: true }])
    expect(calls).toEqual(["read:resume", "publish:resume"])
    expect(published).toEqual([{ id: "resume", value: 6 }])
    expect(await executor.resume("resume").result()).toEqual([{ id: "resume", done: true }])
    expect(calls).toHaveLength(2)

    const items = [{ id: "a", value: 2 }, { id: "b", value: 5 }]
    expect(await executor.execute({ items }, { executionId: "ab" }))
      .toEqual([{ id: "a", done: true }, { id: "b", done: true }])
    expect(await executor.execute({ items: [...items].reverse() }, { executionId: "ba" }))
      .toEqual([{ id: "b", done: true }, { id: "a", done: true }])
    expect(calls).toHaveLength(10)
    expect(published.slice(1).sort((left, right) => left.id.localeCompare(right.id)))
      .toEqual([{ id: "a", value: 4 }, { id: "a", value: 4 }, { id: "b", value: 10 }, { id: "b", value: 10 }])
    const children = (executionId: string) => {
      const entries = new Map<string, string>()
      for (const event of store!.journal(executionId)) {
        if (event.type === "fanout_materialized") {
          const payload = event.payload as { entries: { key: string; step: number; childNodeId: string }[] }
          for (const entry of payload.entries) entries.set(`${entry.key}#${entry.step}`, entry.childNodeId)
        } else if (event.type === "fanout_step_materialized") {
          const payload = event.payload as { key: string; step: number; childNodeId: string }
          entries.set(`${payload.key}#${payload.step}`, payload.childNodeId)
        }
      }
      return entries
    }
    expect(children("ab").size).toBe(4)
    expect(new Set(children("ab").values()).size).toBe(4)
    expect(children("ba")).toEqual(children("ab"))
    expect(await executor.execute({ items: [] }, { executionId: "empty" })).toEqual([])
    expect(calls).toHaveLength(10)
    await expect(executor.execute({ items: [{ id: "duplicate", value: 1 }, { id: "duplicate", value: 2 }] }, {
      executionId: "duplicate",
    })).rejects.toBeInstanceOf(DurableActionDefect)
    expect(store.getExecution("duplicate").status).toBe("failed")
    expect(store.journal("duplicate").some(event => event.type === "fanout_materialized")).toBe(false)
    await expect(executor.resume("duplicate").result()).rejects.toBeInstanceOf(DurableExecutionAlreadyFailed)
    expect(calls).toHaveLength(10)
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 20_000)
