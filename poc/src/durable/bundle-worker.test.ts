import { expect, test } from "bun:test"
import { DenoSubprocessSandbox } from "../agent/sandbox.ts"
import {
  Action,
  compileActionContract,
  compileActionImplementationContract,
  compileDurableSource,
  DenoBundleWorker,
  Deployment,
  DurableActionDefect,
  DurableActionFailure,
  DurableExecutor,
  DurableStore,
  PlanArtifact,
  Provider,
  Worker,
  type ActionDescriptor,
  type BuiltDeployment
} from "./index.ts"

const sandbox = (timeoutMs = 8_000): DenoSubprocessSandbox => new DenoSubprocessSandbox({
  timeoutMs,
  memoryMb: 128,
  maxOutputBytes: 256 * 1024,
  maxCalls: 1,
  maxConcurrentCalls: 1
})

const compileAction = (id: string, fileName: string): ActionDescriptor => {
  const compiled = compileActionContract(`
import { Action } from "smithers:flows"
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Work extends Action<
  (input: { value: number }) => Result<{ value: number }, Failed>
> {}
`, { fileName, exportName: "Work", id, version: 1 })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return compiled.descriptor
}

let hostCalls = 0
const hostCallback = (): never => {
  hostCalls += 1
  throw new Error("host implementation must not run on the bundle path")
}

const checkedProvider = (
  descriptor: ActionDescriptor,
  fileName: string,
  implementationId: string,
  body: string
) => {
  const contract = compileActionImplementationContract({
    action: descriptor,
    implementationId,
    implementationVersion: "1",
    entryFile: fileName,
    exportName: "work",
    implementation: hostCallback,
    sources: [{
      fileName,
      source: `
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export function work(input: { value: number }): Result<{ value: number }, Failed> {
${body}
}
`
    }]
  })
  const action = Action.fromDescriptor<{ value: number }, { value: number }, { code: string }>(descriptor)
  return Provider.provideChecked(action, hostCallback, {
    implementationId,
    implementationVersion: "1",
    implementationContract: contract,
    recovery: { mode: "repeatable", maxAttempts: 1 }
  })
}

const FIRST_FILE = "bundle-first.sm"
const SECOND_FILE = "bundle-second.sm"
const First = compileAction("test/bundle-worker/First", FIRST_FILE)
const Second = compileAction("test/bundle-worker/Second", SECOND_FILE)

const pipelinePlan = () => {
  const compiled = compileDurableSource(`
import { durable } from "smithers:flows"
import { First, Second } from "test:bundle-worker-actions"
export const Pipeline = durable(function Pipeline(input: { value: number }) {
  const first = First.run({ value: input.value })!
  return Second.run({ value: first.value })
})
`, {
    fileName: "flows/bundle-worker.sm",
    flowId: "test/bundle-worker/Pipeline",
    flowVersion: 1,
    actions: [
      Object.freeze({ moduleSpecifier: "test:bundle-worker-actions", exportName: "First", descriptor: First }),
      Object.freeze({ moduleSpecifier: "test:bundle-worker-actions", exportName: "Second", descriptor: Second })
    ]
  })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return compiled.plan
}

const buildDeployment = (
  isolated: DenoSubprocessSandbox,
  options: {
    readonly bundle?: boolean
    readonly pinIdentity?: boolean
    readonly poolId?: string
  } = {}
): BuiltDeployment<{ value: number }, { value: number }> => Deployment.build({
  id: "bundle-worker",
  flow: PlanArtifact.load(PlanArtifact.encode(pipelinePlan())),
  pools: [Worker.pool(options.poolId ?? "deno-bundle", {
    target: "typescript-deno",
    sandbox: isolated.kind,
    bundle: options.bundle ?? true,
    ...(options.pinIdentity === true ? { placement: { denoSandboxIdentity: isolated.identity } } : {}),
    providers: [
      checkedProvider(First, FIRST_FILE, "bundle-first", `
  if (input.value < -1000) throw new Failed("too-low")
  return { value: input.value + 1 }
`),
      checkedProvider(Second, SECOND_FILE, "bundle-second", `
  let total = 0
  for (let index = 0; index < input.value; index++) {
    total = (total + index) % 1000003
  }
  return { value: input.value * 2 + (total % 1) }
`)
    ]
  })]
}) as BuiltDeployment<{ value: number }, { value: number }>

test("one bundle serves every Action in the pool inside the zero-permission Deno sandbox", async () => {
  hostCalls = 0
  const isolated = sandbox()
  const deployment = buildDeployment(isolated, { pinIdentity: true })
  const bundle = deployment.bundles.get("deno-bundle")!
  expect(bundle.actionIds).toEqual(["test/bundle-worker/First", "test/bundle-worker/Second"])
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store, {
    workerFactory: (pool, manifest, providers) =>
      new DenoBundleWorker(pool, manifest, providers, { bundle, sandbox: isolated })
  })
  // First: 7 + 1 = 8; Second: 8 * 2 = 16. Both dispatched through ONE bundle.
  expect(await executor.execute({ value: 7 }, { executionId: "bundle-two-actions", deadline: Date.now() + 60_000, leaseMs: 20_000 }))
    .toEqual({ value: 16 })
  expect(hostCalls).toBe(0)
  const succeeded = store.journal("bundle-two-actions").filter((event) => event.type === "node_succeeded")
  expect(succeeded.length).toBeGreaterThanOrEqual(2)
  store.close()
})

test("a bundle-executed typed failure round-trips as the exact durable wire envelope", async () => {
  hostCalls = 0
  const isolated = sandbox()
  const deployment = buildDeployment(isolated)
  const bundle = deployment.bundles.get("deno-bundle")!
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store, {
    workerFactory: (pool, manifest, providers) =>
      new DenoBundleWorker(pool, manifest, providers, { bundle, sandbox: isolated })
  })
  try {
    await executor.execute({ value: -2000 }, { executionId: "bundle-typed", deadline: Date.now() + 60_000, leaseMs: 20_000 })
    throw new Error("expected a typed durable failure")
  } catch (error) {
    expect(error).toBeInstanceOf(DurableActionFailure)
    expect((error as DurableActionFailure).failure).toEqual({
      version: 1,
      identity: "smithers:bundle-first.sm@Failed@1",
      payload: { code: "too-low" }
    })
  }
  expect(hostCalls).toBe(0)
  store.close()
})

test("bundle admission is digest-exact against the signed manifest", () => {
  const isolated = sandbox()
  const deployment = buildDeployment(isolated)
  const bundle = deployment.bundles.get("deno-bundle")!
  const providers = deployment.providers
  const pool = deployment.pools.get("deno-bundle")!

  // Tampered bytes fail bundle validation before any pool comparison.
  expect(() => new DenoBundleWorker(pool, deployment.manifest, providers, {
    bundle: { ...bundle, javascript: `${bundle.javascript}\n// tampered` },
    sandbox: isolated
  })).toThrow("does not match its bytes")

  // A pool built without bundle emission cannot admit a bundle worker.
  const withoutBundle = buildDeployment(isolated, { bundle: false })
  expect(() => new DenoBundleWorker(
    withoutBundle.pools.get("deno-bundle")!,
    withoutBundle.manifest,
    withoutBundle.providers,
    { bundle, sandbox: isolated }
  )).toThrow("pins no bundleDigest")

  // A valid bundle whose digest is not the manifest's pinned digest is refused.
  const foreign = buildDeployment(isolated, { poolId: "foreign-deno-bundle" })
  const foreignBundle = foreign.bundles.get("foreign-deno-bundle")!
  expect(foreignBundle.digest).not.toBe(bundle.digest)
  expect(() => new DenoBundleWorker(
    deployment.pools.get("deno-bundle")!,
    deployment.manifest,
    deployment.providers,
    { bundle: foreignBundle, sandbox: isolated }
  )).toThrow("bundle digest mismatch")

  // A signed placement-pinned sandbox identity must match the local runtime.
  const pinned = buildDeployment(isolated, { pinIdentity: true })
  const differentlyConfigured = sandbox(2_000)
  expect(() => new DenoBundleWorker(
    pinned.pools.get("deno-bundle")!,
    pinned.manifest,
    pinned.providers,
    { bundle: pinned.bundles.get("deno-bundle")!, sandbox: differentlyConfigured }
  )).toThrow("signed sandbox identity does not match")
})

test("bundle execution limits are preserved: a spinning Action becomes a timeout defect", async () => {
  hostCalls = 0
  const isolated = sandbox(600)
  const deployment = buildDeployment(isolated)
  const bundle = deployment.bundles.get("deno-bundle")!
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store, {
    workerFactory: (pool, manifest, providers) =>
      new DenoBundleWorker(pool, manifest, providers, { bundle, sandbox: isolated })
  })
  try {
    // First succeeds fast (value + 1); Second spins ~3e9 rounds and must be
    // forcibly terminated by the sandbox timeout, never cached as success.
    await executor.execute(
      { value: 2_999_999_999 },
      { executionId: "bundle-timeout", deadline: Date.now() + 60_000, leaseMs: 30_000 }
    )
    throw new Error("expected a sandbox timeout defect")
  } catch (error) {
    expect(error).toBeInstanceOf(DurableActionDefect)
    expect(JSON.stringify((error as DurableActionDefect).defect)).toContain("SandboxTimeout")
  }
  expect(hostCalls).toBe(0)
  expect(store.getExecution("bundle-timeout").status).toBe("failed")
  store.close()
})
