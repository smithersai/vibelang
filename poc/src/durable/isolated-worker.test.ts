import { expect, test } from "bun:test"
import {
  Action,
  createDenoIsolatedWorkerArtifact,
  Deployment,
  DenoIsolatedWorker,
  DurableActionDefect,
  DurableExecutor,
  DurableStore,
  Flow,
  Provider,
  Worker
} from "./index.ts"
import { DenoSubprocessSandbox } from "../agent/sandbox.ts"

const sandbox = (timeoutMs = 2_000): DenoSubprocessSandbox => new DenoSubprocessSandbox({
  timeoutMs,
  memoryMb: 64,
  maxOutputBytes: 64 * 1024,
  maxCalls: 1,
  maxConcurrentCalls: 1
})

test("the durable coordinator executes a pinned artifact in a fresh no-authority process", async () => {
  const isolated = sandbox()
  const artifact = createDenoIsolatedWorkerArtifact({
    poolId: "isolated",
    sandbox: isolated,
    functionExpression: `async (invocation) => ({
      kind: "success",
      value: {
        doubled: invocation.input.value * 2,
        authority: {
          deno: globalThis.Deno === undefined,
          process: globalThis.process === undefined,
          fetch: globalThis.fetch === undefined,
          randomBlocked: (() => { try { Math.random(); return false } catch { return true } })(),
          clockBlocked: (() => { try { Date.now(); return false } catch { return true } })()
        }
      }
    })`
  })
  const Work = Action.define<{ value: number }, {
    doubled: number
    authority: { deno: boolean; process: boolean; fetch: boolean; randomBlocked: boolean; clockBlocked: boolean }
  }>({ id: "test/Isolated", version: 1 })
  const Program = Flow.define<{ value: number }, {
    doubled: number
    authority: { deno: boolean; process: boolean; fetch: boolean; randomBlocked: boolean; clockBlocked: boolean }
  }>({ id: "test/IsolatedFlow", version: 1 }, (input) => Work.run({ value: input.value }))
  let hostCalls = 0
  const Live = Provider.provide(Work, () => {
    hostCalls += 1
    throw new Error("host implementation must not run")
  }, {
    implementationId: "isolated-worker-artifact",
    implementationVersion: "1",
    dependencyDigests: [artifact.digest],
    recovery: { mode: "repeatable", maxAttempts: 1 }
  })
  const deployment = Deployment.build({
    id: "isolated-worker",
    flow: Program,
    pools: [Worker.pool("isolated", {
      target: "typescript-deno",
      sandbox: isolated.kind,
      providers: [Live]
    })]
  })
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store, {
    workerFactory: (pool, manifest, providers) => new DenoIsolatedWorker(
      pool,
      manifest,
      providers,
      { artifact, sandbox: isolated }
    )
  })
  expect(await executor.execute({ value: 7 }, { executionId: "isolated" })).toEqual({
    doubled: 14,
    authority: {
      deno: true,
      process: true,
      fetch: true,
      randomBlocked: true,
      clockBlocked: true
    }
  })
  expect(hostCalls).toBe(0)
  expect(store.journal("isolated").some((event) => event.type === "node_succeeded")).toBe(true)
  store.close()
})

test("isolated artifacts and sandbox identities must be transitively pinned by every provider", () => {
  const firstSandbox = sandbox()
  const artifact = createDenoIsolatedWorkerArtifact({
    poolId: "isolated-pin",
    sandbox: firstSandbox,
    functionExpression: `async () => ({ kind: "success", value: {} })`
  })
  const Work = Action.define<{}, {}>({ id: "test/IsolatedPin", version: 1 })
  const Program = Flow.define<{}, {}>(
    { id: "test/IsolatedPinFlow", version: 1 },
    () => Work.run({})
  )
  const Unpinned = Provider.provide(Work, () => ({}), {
    implementationId: "isolated-unpinned",
    implementationVersion: "1"
  })
  const unpinnedDeployment = Deployment.build({
    id: "isolated-unpinned",
    flow: Program,
    pools: [Worker.pool("isolated-pin", {
      target: "typescript-deno",
      sandbox: firstSandbox.kind,
      providers: [Unpinned]
    })]
  })
  const store = new DurableStore()
  expect(() => new DurableExecutor(unpinnedDeployment, store, {
    workerFactory: (pool, manifest, providers) => new DenoIsolatedWorker(
      pool,
      manifest,
      providers,
      { artifact, sandbox: firstSandbox }
    )
  })).toThrow("does not pin isolated artifact")

  const Pinned = Provider.provide(Work, () => ({}), {
    implementationId: "isolated-pinned",
    implementationVersion: "1",
    dependencyDigests: [artifact.digest]
  })
  const pinnedDeployment = Deployment.build({
    id: "isolated-pinned",
    flow: Program,
    pools: [Worker.pool("isolated-pin", {
      target: "typescript-deno",
      sandbox: firstSandbox.kind,
      providers: [Pinned]
    })]
  })
  const differentlyConfiguredSandbox = sandbox(1_000)
  expect(() => new DurableExecutor(pinnedDeployment, store, {
    workerFactory: (pool, manifest, providers) => new DenoIsolatedWorker(
      pool,
      manifest,
      providers,
      { artifact, sandbox: differentlyConfiguredSandbox }
    )
  })).toThrow("artifact/runtime does not match")

  const tampered = { ...artifact, functionExpression: `async () => ({ kind: "success", value: { forged: true } })` }
  expect(() => new DurableExecutor(pinnedDeployment, store, {
    workerFactory: (pool, manifest, providers) => new DenoIsolatedWorker(
      pool,
      manifest,
      providers,
      { artifact: tampered, sandbox: firstSandbox }
    )
  })).toThrow("artifact digest mismatch")
  store.close()
})

test("isolated timeout and hostile exits become persisted defects, never cache successes", async () => {
  for (const scenario of [
    {
      name: "timeout",
      timeoutMs: 75,
      source: `async () => { while (true) {} }`,
      expected: "SandboxTimeout"
    },
    {
      name: "protocol",
      timeoutMs: 2_000,
      source: `async () => ({ kind: "success", value: { forged: true }, extra: true })`,
      expected: "SuccessCodecDefect"
    }
  ] as const) {
    const isolated = sandbox(scenario.timeoutMs)
    const artifact = createDenoIsolatedWorkerArtifact({
      poolId: `isolated-${scenario.name}`,
      sandbox: isolated,
      functionExpression: scenario.source
    })
    const Work = Action.define<{}, { value: number }>({
      id: `test/IsolatedHostile/${scenario.name}`,
      version: 1
    })
    const Program = Flow.define<{}, { value: number }>(
      { id: `test/IsolatedHostileFlow/${scenario.name}`, version: 1 },
      () => Work.run({})
    )
    const Live = Provider.provide(Work, () => ({ value: 1 }), {
      implementationId: `isolated-hostile-${scenario.name}`,
      implementationVersion: "1",
      dependencyDigests: [artifact.digest],
      reuse: { kind: "content", invalidationSalt: "hostile" },
      recovery: { mode: "manual", maxAttempts: 1 }
    })
    const deployment = Deployment.build({
      id: `isolated-hostile-${scenario.name}`,
      flow: Program,
      pools: [Worker.pool(`isolated-${scenario.name}`, {
        target: "typescript-deno",
        sandbox: isolated.kind,
        providers: [Live]
      })]
    })
    const store = new DurableStore()
    const executor = new DurableExecutor(deployment, store, {
      workerFactory: (pool, manifest, providers) => new DenoIsolatedWorker(
        pool,
        manifest,
        providers,
        { artifact, sandbox: isolated }
      )
    })
    try {
      await executor.execute({}, { executionId: scenario.name, leaseMs: 500 })
      throw new Error("expected isolated worker defect")
    } catch (error) {
      expect(error).toBeInstanceOf(DurableActionDefect)
      expect(JSON.stringify((error as DurableActionDefect).defect)).toContain(scenario.expected)
    }
    const cacheCount = store.database.query("SELECT COUNT(*) AS count FROM durable_content_cache")
      .get() as { count: number }
    expect(cacheCount.count).toBe(0)
    expect(store.getExecution(scenario.name).status).toBe("failed")
    store.close()
  }
})
