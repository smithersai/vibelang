import { expect, test } from "bun:test"
import { Action } from "./authoring.ts"
import { buildBodyDeployment } from "./body-deployment.ts"
import { compileDurableBody } from "./body-compiler.ts"
import { Deployment, Provider, Worker, type ProviderReuse } from "./provider.ts"
import { decodeSignedDeploymentArtifact, deploymentVerificationKey, generateDeploymentSigningKeyPair,
  SignedBodyDeployment, SignedDeployment } from "./signed-deployment.ts"
import { canonicalJson, digest, encodeCanonicalJson } from "./value.ts"
import { BodyExecutor } from "./body-executor.ts"
import { CoordinatorCrash, DurableActionDefect, DurableActionFailure, DurableExecutionAlreadyFailed, DurableExecutionCancelled } from "./errors.ts"
import { DurableStore } from "./store.ts"
import { createAuthenticatedDurableExecutor } from "./authenticated-executor.ts"

export function executableDeploymentFixture(implementation: (value: number) => number | Promise<number> = value => value * 2,
  reuse?: ProviderReuse<number>) {
  const compiled = compileDurableBody(`
import { durable, Action } from "vibelang:flows"
class Work extends Action<(n: number) => Result<number, never>> {}
export const Flow = durable((n: number): Result<number, never> => {
  let sum = 0
  for (let i = 0; i < n; i++) sum += Work.run(i)!
  return sum
})`, { fileName: "deploy/flow.vibe" })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const action = Action.fromDescriptor<number, number, never>(compiled.body.manifest.actions[0]!)
  const provider = Provider.provide(action, implementation, { implementationId: "double", implementationVersion: "1",
    recovery: { mode: "repeatable", maxAttempts: 3 }, ...(reuse === undefined ? {} : { reuse }) })
  const flow = { id: compiled.body.manifest.flowId, version: 1, body: compiled.body }
  return buildBodyDeployment({ id: "executable", flow,
    pools: [Worker.pool("worker", { target: "typescript-bun", providers: [provider] })] })
}

test("executable deployments select exact Action routes without constructing a Plan", () => {
  const deployment = executableDeploymentFixture()
  expect("plan" in deployment.flow).toBe(false)
  expect(deployment.manifest.planDigest).toBe(deployment.flow.body.digest)
  expect(deployment.manifest.routes.map(route => route.actionId)).toEqual(deployment.flow.body.manifest.actions.map(action => action.id))
  expect(() => buildBodyDeployment({ id: "missing", flow: deployment.flow, pools: [] })).toThrow("missing provider")
  expect(() => buildBodyDeployment({ id: "ambiguous", flow: deployment.flow,
    pools: [...deployment.pools.values(), Worker.pool("other", { target: "typescript-bun",
      providers: [...deployment.providers.values()] })] })).toThrow("ambiguous providers")
})

test("the normal deployment, signature and coordinator APIs select the executable body without a Plan downgrade", async () => {
  const calls: number[] = []
  const fixture = executableDeploymentFixture(n => { calls.push(n); return n * 2 })
  const pools = [...fixture.pools.values()]
  const emittedFlow = {
    ...fixture.flow, plan: { ignored: "compatibility artifacts do not select an execution engine" },
  }
  const deployment = Deployment.build({ id: "public-body", flow: emittedFlow, pools })
  expect("plan" in deployment.flow).toBe(false)
  const key = generateDeploymentSigningKeyPair()
  const trust = [deploymentVerificationKey(key)]
  const bytes = SignedDeployment.encode(deployment.flow.body, deployment.manifest, key)
  expect(SignedDeployment.decode(bytes, trust).kind).toBe("vibelang.executable-deployment")
  const proof = SignedDeployment.authenticate(deployment, bytes, trust)
  expect(SignedDeployment.requireAuthenticated(proof)).toBe(deployment)
  const store = new DurableStore()
  try {
    const first = createAuthenticatedDurableExecutor(proof, store)
    expect(first).toBeInstanceOf(BodyExecutor)
    await expect(first.execute(3, { executionId: "public", afterNodeAdopted: node => {
      throw new CoordinatorCrash(node)
    } })).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(calls).toEqual([0])
    expect(await createAuthenticatedDurableExecutor(proof, store).execute(3, { executionId: "public" })).toBe(6)
    expect(calls).toEqual([0, 1, 2])
    expect(() => createAuthenticatedDurableExecutor({ ...proof }, store)).toThrow("was not issued")
    expect(() => SignedDeployment.authenticate({ ...deployment }, bytes, trust)).toThrow("was not issued")
    let readUntrustedField = false
    const forged = { get deployment() { readUntrustedField = true; return deployment } }
    expect(() => createAuthenticatedDurableExecutor(forged as never, store)).toThrow("was not issued")
    expect(readUntrustedField).toBe(false)
  } finally { store.close() }
  const tamperedFlow = {
    ...fixture.flow, body: { ...fixture.flow.body, javascript: "tampered" }, plan: {},
  }
  expect(() => Deployment.build({ id: "no-downgrade", flow: tamperedFlow, pools })).toThrow("digest mismatch")
})

test("body signatures bind source, JavaScript, codecs and routing and issue nominal authentication", () => {
  const deployment = executableDeploymentFixture()
  const key = generateDeploymentSigningKeyPair()
  const trust = [deploymentVerificationKey(key)]
  const bytes = SignedBodyDeployment.encode(deployment.flow.body, deployment.manifest, key)
  expect(SignedBodyDeployment.encode(deployment.flow.body, deployment.manifest, key)).toEqual(bytes)
  expect(SignedBodyDeployment.decode(bytes, trust)).toMatchObject({ flowSourceDigest: deployment.flow.body.digest,
    effectManifest: deployment.flow.body.manifest, journalSchemaVersion: 1, routingManifest: deployment.manifest })
  const proof = SignedBodyDeployment.authenticate(deployment, bytes, trust)
  expect(SignedBodyDeployment.requireAuthenticated(proof)).toBe(deployment)
  expect(() => SignedBodyDeployment.requireAuthenticated({ ...proof })).toThrow("was not issued")
  expect(() => SignedBodyDeployment.authenticate({ ...deployment }, bytes, trust)).toThrow("was not issued")
  expect(() => SignedBodyDeployment.decode(bytes, [deploymentVerificationKey(generateDeploymentSigningKeyPair())])).toThrow("not trusted")
  expect(() => decodeSignedDeploymentArtifact(bytes, trust)).toThrow()

  const forged = JSON.parse(new TextDecoder().decode(bytes))
  forged.flowSourceDigest = digest({ untrusted: "changed executable body" })
  forged.routingManifest.planDigest = forged.flowSourceDigest
  forged.routingManifest.coordinatorDigest = digest({ planDigest: forged.flowSourceDigest,
    routes: forged.routingManifest.routes.map(({ actionId, poolId, implementationDigest, policyDigest }: any) =>
      ({ actionId, poolId, implementationDigest, policyDigest })) })
  const { digest: _manifest, ...manifestIdentity } = forged.routingManifest
  forged.routingManifest.digest = digest(manifestIdentity)
  const { digest: _artifact, ...artifactIdentity } = forged
  forged.digest = digest(artifactIdentity)
  expect(() => SignedBodyDeployment.decode(encodeCanonicalJson(forged), trust)).toThrow("signature verification failed")
})

function authenticated(deployment: ReturnType<typeof executableDeploymentFixture>) {
  const key = generateDeploymentSigningKeyPair()
  return SignedBodyDeployment.authenticate(deployment,
    SignedBodyDeployment.encode(deployment.flow.body, deployment.manifest, key), [deploymentVerificationKey(key)])
}

test("an executable handle starts eagerly, exposes its own audit, and keeps its execution id pinned", async () => {
  let began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const calls: number[] = []
  const proof = authenticated(executableDeploymentFixture(async input => {
    calls.push(input); began(); await pending; return input * 2
  }))
  const store = new DurableStore()
  try {
    const executor = new BodyExecutor(proof, store)
    const options = { executionId: "handle" }
    const handle = executor.start(3, options)
    options.executionId = "must-not-retarget"
    await started
    expect(Object.isFrozen(handle)).toBe(true)
    expect(handle.executionId).toBe("handle")
    expect(handle.status()).toBe("running")
    const inspection = executor.inspect("handle")
    expect(inspection.execution.status).toBe("running")
    expect(Object.isFrozen(inspection.journal)).toBe(true)
    expect(handle.audit()).toEqual({ requests: 1, dispatchedLive: 1, replayed: 0, recorded: 0 })
    release()
    expect(await handle.result()).toBe(6)
    expect(handle.status()).toBe("completed")
    expect(calls).toEqual([0, 1, 2])
    expect(handle.audit()).toEqual({ requests: 3, dispatchedLive: 3, replayed: 0, recorded: 0 })
    expect(executor.inspect("handle").execution.output).toBe(6)
    expect(() => store.getExecution("must-not-retarget")).toThrow("Unknown durable execution")
  } finally { release(); store.close() }
})

test("an executable handle resumes from persisted input and distinguishes replay from terminal attachment", async () => {
  const calls: number[] = []
  const proof = authenticated(executableDeploymentFixture(input => { calls.push(input); return input * 2 }))
  const store = new DurableStore()
  try {
    const first = new BodyExecutor(proof, store).start(3, {
      executionId: "resume-handle", afterNodeAdopted: node => { throw new CoordinatorCrash(node) },
    })
    await expect(first.result()).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(first.status()).toBe("running")
    expect(first.audit()).toEqual({ requests: 1, dispatchedLive: 1, replayed: 0, recorded: 0 })
    const next = new BodyExecutor(proof, store).resume("resume-handle")
    expect(await next.result()).toBe(6)
    expect(next.audit()).toEqual({ requests: 3, dispatchedLive: 2, replayed: 1, recorded: 1 })
    expect(calls).toEqual([0, 1, 2])
    expect(first.audit()?.requests).toBe(1)
    const terminal = new BodyExecutor(proof, store).resume("resume-handle")
    expect(await terminal.result()).toBe(6)
    expect(terminal.audit()).toBeUndefined()
    expect(calls).toEqual([0, 1, 2])
    store.database.run("UPDATE durable_executions SET input_json = '4' WHERE id = 'resume-handle'")
    expect(() => new BodyExecutor(proof, store).resume("resume-handle")).toThrow("digest verification")
  } finally { store.close() }
})

test("body inspection and resumption reject another deployment without changing its execution", () => {
  const first = executableDeploymentFixture()
  const action = Action.fromDescriptor<number, number, never>(first.flow.body.manifest.actions[0]!)
  const second = buildBodyDeployment({ id: "other-deployment", flow: first.flow,
    pools: [Worker.pool("worker", { target: "typescript-bun", providers: [Provider.provide(action, value => value, {
      implementationId: "other", implementationVersion: "2", recovery: { mode: "repeatable", maxAttempts: 3 },
    })] })] })
  const store = new DurableStore()
  try {
    store.initializeBodyExecution("pinned-handle", first.flow.body, first.manifest.digest, 3)
    const executor = new BodyExecutor(authenticated(second), store)
    expect(() => executor.inspect("pinned-handle")).toThrow("pinned to")
    expect(() => executor.resume("pinned-handle")).toThrow("pinned to")
    expect(store.getExecution("pinned-handle").status).toBe("running")
    expect(store.journal("pinned-handle").some(event => event.type === "attempt_started")).toBe(false)
    expect(() => executor.resume("unknown")).toThrow("Unknown durable execution")
    expect(() => executor.resume(" ")).toThrow("non-empty")
  } finally { store.close() }
})

test("constructing a body coordinator and inspecting its journal never evaluates signed JavaScript", () => {
  const first = executableDeploymentFixture()
  const { digest: _previous, ...source } = first.flow.body
  const identity = { ...source, javascript: '(() => { throw new Error("inspection evaluated executable code") })()' }
  const body = { ...identity, digest: digest(identity) }
  const built = buildBodyDeployment({ id: "inspection", flow: { ...first.flow, body }, pools: [...first.pools.values()] })
  const store = new DurableStore()
  try {
    store.initializeBodyExecution("inspection", body, built.manifest.digest, 3)
    const executor = new BodyExecutor(authenticated(built), store)
    expect(executor.inspect("inspection").body.digest).toBe(body.digest)
    expect(executor.inspect("inspection").execution.status).toBe("running")
  } finally { store.close() }
})

test("an executable handle cancellation exposes the persisted terminal reason", async () => {
  let began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const proof = authenticated(executableDeploymentFixture(async input => { began(); await pending; return input }))
  const store = new DurableStore()
  try {
    const executor = new BodyExecutor(proof, store)
    const handle = executor.start(1, { executionId: "cancel-handle" })
    await started
    handle.cancel("handle requested cancellation")
    await expect(handle.result()).rejects.toMatchObject({ name: "DurableExecutionCancelled", reason: "handle requested cancellation" })
    expect(handle.status()).toBe("cancelled")
    const resumed = executor.resume(handle.executionId)
    await expect(resumed.result()).rejects.toMatchObject({ reason: "handle requested cancellation" })
    expect(resumed.audit()).toBeUndefined()
  } finally { release(); store.close() }
})

for (const native of [false, true]) test(`a signed ${native ? "native" : "authored"} Flow failure is codec-pinned even without an Action`, async () => {
  const compiled = compileDurableBody(`
import { durable } from "vibelang:flows"
class Missing extends Error { constructor(readonly n: number) { super("missing") } }
export const Flow = durable(async (n: number): Promise<Result<number, ${native ? "Error" : "Missing"}>> => {
  await Promise.resolve()
  throw ${native ? "new Error(\"missing\")" : "new Missing(n)"}
})`, { fileName: `failures/${native}.vibe` })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const identity = native ? "javascript:Error@1" : compiled.body.errors.find(error => error.durable.endsWith("/Missing@1"))?.durable ?? compiled.body.errors[0]!.durable
  expect(compiled.body.manifest.failures).toContain(identity)
  const deployment = buildBodyDeployment({ id: "failure", flow: { id: compiled.body.manifest.flowId, version: 1, body: compiled.body }, pools: [] })
  const proof = authenticated(deployment)
  const store = new DurableStore()
  try {
    const executor = new BodyExecutor(proof, store)
    await expect(executor.execute(7, { executionId: "failed" })).rejects.toBeInstanceOf(DurableActionFailure)
    expect(store.getExecution("failed").error).toEqual({ category: "failure", error: {
      version: 1, identity, payload: native ? { message: "missing" } : { message: "missing", n: 7 },
    } })
    await expect(executor.execute(7, { executionId: "failed" })).rejects.toBeInstanceOf(DurableExecutionAlreadyFailed)
    const corrupted = { category: "failure", error: { version: 1, identity, payload: { message: 9 } } }
    store.database.run("UPDATE durable_executions SET error_json = ?, error_digest = ? WHERE id = ?",
      [canonicalJson(corrupted), digest(corrupted), "failed"])
    await expect(executor.execute(7, { executionId: "failed" })).rejects.toThrow("message")
  } finally { store.close() }
})

test("the authenticated executor runs compiler-emitted locals and loops through routed workers and resumes after commit", async () => {
  const calls: number[] = []
  const deployment = executableDeploymentFixture(value => { calls.push(value); return value * 2 })
  const proof = authenticated(deployment)
  const store = new DurableStore()
  try {
    const first = new BodyExecutor(proof, store)
    await expect(first.execute(4, { executionId: "restart", afterNodeAdopted: nodeId => { throw new CoordinatorCrash(nodeId) } })).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(calls).toEqual([0])
    expect(store.getExecution("restart").status).toBe("running")
    const resumed = new BodyExecutor(proof, store)
    expect(await resumed.execute(4, { executionId: "restart" })).toBe(12)
    expect(calls).toEqual([0, 1, 2, 3])
    expect(store.getExecution("restart").status).toBe("completed")
    expect(await resumed.execute(4, { executionId: "restart" })).toBe(12)
    expect(calls).toHaveLength(4)
    expect(() => new BodyExecutor({ ...proof }, store)).toThrow("was not issued")
  } finally { store.close() }
})

test("long-running body requests renew their lease and competing coordinators adopt one winner", async () => {
  let began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  const calls: number[] = []
  const proof = authenticated(executableDeploymentFixture(async value => {
    calls.push(value); began(); await Bun.sleep(65); return value * 2
  }))
  const store = new DurableStore()
  try {
    const first = new BodyExecutor(proof, store).execute(2, { executionId: "lease", leaseMs: 15 })
    await started
    const second = new BodyExecutor(proof, store).execute(2, { executionId: "lease", leaseMs: 15 })
    expect(await Promise.all([first, second])).toEqual([2, 2])
    expect(calls).toEqual([0, 1])
    expect(store.journal("lease").filter(event => event.type === "attempt_lease_stolen")).toEqual([])
  } finally { store.close() }
})

test("a heartbeat storage exception abandons the attempt without persisting a Flow defect", async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  const proof = authenticated(executableDeploymentFixture(async value => {
    if (calls++ === 0) await pending
    return value * 2
  }))
  const store = new DurableStore()
  const heartbeat = store.heartbeat.bind(store)
  const unavailable = new Error("injected storage unavailability")
  store.heartbeat = () => { throw unavailable }
  try {
    await expect(new BodyExecutor(proof, store).execute(2, { executionId: "heartbeat-unavailable", leaseMs: 15 })).rejects
      .toMatchObject({ name: "CoordinatorUnavailable", cause: unavailable })
    expect(store.getExecution("heartbeat-unavailable").status).toBe("running")
    expect(store.journal("heartbeat-unavailable").some(event => event.type === "node_succeeded")).toBe(false)
    store.heartbeat = heartbeat
    release()
    expect(await new BodyExecutor(proof, store).execute(2, { executionId: "heartbeat-unavailable", leaseMs: 15 })).toBe(2)
    expect(calls).toBe(3)
  } finally { release(); store.close() }
})

test("routed worker defects follow the signed retry policy and never become Flow success", async () => {
  let calls = 0
  const proof = authenticated(executableDeploymentFixture(() => { calls++; return "invalid" as never }))
  const store = new DurableStore()
  try {
    await expect(new BodyExecutor(proof, store).execute(1, { executionId: "defect" })).rejects.toBeInstanceOf(DurableActionDefect)
    expect(calls).toBe(3)
    expect(store.getExecution("defect").status).toBe("failed")
    expect(store.journal("defect").filter(event => event.type === "attempt_retry_scheduled")).toHaveLength(2)
    expect(store.journal("defect").filter(event => event.type === "node_succeeded")).toEqual([])
  } finally { store.close() }
})

test("a persisted worker defect retains its optional stack and stays readable on reattach", async () => {
  const defect = { name: "WorkerFailure", message: "worker failed", stack: "WorkerFailure: worker failed\n    at worker:1" }
  const proof = authenticated(executableDeploymentFixture(() => {
    throw Object.assign(new Error(defect.message), defect)
  }))
  const store = new DurableStore()
  try {
    await expect(new BodyExecutor(proof, store).execute(1, { executionId: "stack" })).rejects
      .toMatchObject({ name: "DurableActionDefect", defect })
    expect(store.getExecution("stack").error).toEqual({ category: "defect", error: defect })
    for (let attach = 0; attach < 2; attach++) {
      await expect(new BodyExecutor(proof, store).execute(1, { executionId: "stack" })).rejects
        .toMatchObject({ name: "DurableExecutionAlreadyFailed", storedError: { category: "defect", error: defect } })
    }
    for (const invalid of [{ ...defect, stack: 7 }, { ...defect, extra: "unrecognized" }]) {
      const storedError = { category: "defect", error: invalid }
      store.database.run("UPDATE durable_executions SET error_json = ?, error_digest = ? WHERE id = ?",
        [canonicalJson(storedError), digest(storedError), "stack"])
      await expect(new BodyExecutor(proof, store).execute(1, { executionId: "stack" })).rejects.toThrow("Invalid persisted Flow defect")
    }
  } finally { store.close() }
})

for (const requestCancellation of [false, true]) test(`a failed winner beats ${requestCancellation ? "local cancellation" : "a fenced late answer"}`, async () => {
  let began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const proof = authenticated(executableDeploymentFixture(async value => { began(); await pending; return value }))
  const store = new DurableStore()
  try {
    const executor = new BodyExecutor(proof, store)
    const observed = executor.execute(1, { executionId: "race" }).then(value => ({ value }), error => ({ error }))
    await started
    const defect = { name: "WinningFailure", message: "committed by another coordinator" }
    expect(store.failExecution("race", "defect", defect).changed).toBe(true)
    if (requestCancellation) executor.cancel("race", "late cancellation")
    release()
    expect(await observed).toMatchObject({ error: {
      name: "DurableExecutionAlreadyFailed", storedError: { category: "defect", error: defect },
    } })
    expect(store.getExecution("race").status).toBe("failed")
    await expect(executor.execute(1, { executionId: "race" })).rejects.toBeInstanceOf(DurableExecutionAlreadyFailed)
  } finally { release(); store.close() }
})

test("live cancellation and reattachment expose the same committed reason", async () => {
  const proof = authenticated(executableDeploymentFixture())
  const store = new DurableStore()
  try {
    const reason = { name: "Stopped", message: "requested by caller" }
    store.initializeBodyExecution("cancel-reason", proof.deployment.flow.body, proof.deployment.manifest.digest, 1)
    const executor = new BodyExecutor(proof, store)
    executor.cancel("cancel-reason", reason)
    await expect(executor.execute(1, { executionId: "cancel-reason" })).rejects
      .toMatchObject({ name: "DurableExecutionCancelled", reason })
  } finally { store.close() }
})

test("cancellation abandons a live body request and fences its late worker result", async () => {
  let began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const proof = authenticated(executableDeploymentFixture(async value => { began(); await pending; return value }))
  const store = new DurableStore()
  try {
    const executor = new BodyExecutor(proof, store)
    const result = executor.execute(2, { executionId: "cancelled" })
    const observed = result.then(value => ({ value }), error => ({ error }))
    await started
    executor.cancel("cancelled")
    expect(await observed).toMatchObject({ error: expect.any(DurableExecutionCancelled) })
    release()
    await Bun.sleep(5)
    expect(store.getExecution("cancelled").status).toBe("cancelled")
    expect(store.journal("cancelled").some(event => event.type === "node_succeeded")).toBe(false)
  } finally { release(); store.close() }
})

for (const reuse of [
  { kind: "memo", scope: "test", generation: "1", keyVersion: "1", key: (n: number) => String(n) },
  { kind: "content" },
] satisfies ProviderReuse<number>[]) {
  test(`${reuse.kind} reuse atomically adopts a canonical Result answer and survives a crash`, async () => {
    const calls: number[] = []
    const proof = authenticated(executableDeploymentFixture(n => { calls.push(n); return n * 2 }, reuse))
    const store = new DurableStore()
    try {
      const executor = new BodyExecutor(proof, store)
      expect(await executor.execute(3, { executionId: "populate" })).toBe(6)
      await expect(executor.execute(3, { executionId: "reuse", afterNodeAdopted: id => { throw new CoordinatorCrash(id) } })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(await new BodyExecutor(proof, store).execute(3, { executionId: "reuse" })).toBe(6)
      expect(calls).toEqual([0, 1, 2])
      const events = store.journal("reuse").filter(event => event.type === "node_succeeded")
      expect(events).toHaveLength(3)
      for (const event of events) expect(store.getNode("reuse", event.nodeId!).exit).toMatchObject({ kind: "success", value: { kind: "success" } })
    } finally { store.close() }
  })
}
