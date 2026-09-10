import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compileDurableBody } from "./body-compiler.ts"
import { loadDurableBody, validateDurableBodyArtifact } from "./body-artifact.ts"
import { DURABLE_SLEEP_KEY } from "./body-intrinsics.ts"
import { BodyDeployment } from "./body-deployment.ts"
import { BodyExecutor } from "./body-executor.ts"
import { compileDurableFlow } from "./source-compiler.ts"
import { CoordinatorCrash, DurableActionDefect, DurableExecutionCancelled } from "./errors.ts"
import { deploymentVerificationKey, generateDeploymentSigningKeyPair, SignedBodyDeployment } from "./signed-deployment.ts"
import { DurableStore } from "./store.ts"
import { ReplayDivergenceError, ReplayDriver } from "./replay.ts"
import { digest, type JsonValue } from "./value.ts"
import { Action } from "./authoring.ts"
import { Provider, Worker } from "./provider.ts"

// Timers use the existing durable suspension contract: scheduling commits one
// absolute wake time, replay keeps it, and no worker owns a lease while waiting.
// The executable body must obey the same contract without constructing a Plan.
function compile(body = "sleep(input); return input + 1", asynchronous = false) {
  const result = compileDurableBody(`import { durable, sleep } from "vibelang:flows"
export const Pause = durable(${asynchronous ? "async " : ""}(input: number) => { ${body} })`, {
    fileName: `body-timer-${asynchronous ? "async" : "sync"}.vibe`,
  })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.body
}

function authenticate(body = compile()) {
  const deployment = BodyDeployment.build({ id: "body-timer", flow: {
    id: body.manifest.flowId, version: body.manifest.flowVersion, body,
  }, pools: [] })
  const key = generateDeploymentSigningKeyPair()
  return SignedBodyDeployment.authenticate(deployment,
    SignedBodyDeployment.encode(body, deployment.manifest, key), [deploymentVerificationKey(key)])
}

const scheduled = (store: DurableStore, id: string) => store.journal(id).filter(event => event.type === "timer_scheduled")

test("executable sleep yields a Manifest-bound request without a Plan or a worker", async () => {
  const body = compile()
  expect(body.bodyVersion).toBe(2)
  expect(body.resumable).toBe(true)
  expect(body.manifest.actions).toEqual([])
  expect(body.manifest.sites.map(site => site.kind)).toEqual(["sleep"])
  const attempt = loadDurableBody(body).create(0)
  const step = await attempt.computation.next()
  expect(step.done).toBe(false)
  expect(step.value).toMatchObject({ kind: "perform", input: 0, site: body.manifest.sites[0]!.id })
  await attempt.computation.return(undefined)
})

test("timer artifacts require a versioned runtime and cannot downgrade their feature contract", () => {
  const body = compile()
  for (const bodyVersion of [1, 3]) {
    const { digest: _digest, ...fields } = { ...body, bodyVersion }
    expect(() => validateDurableBodyArtifact({ ...fields, digest: digest(fields) })).toThrow()
  }
  const prior = compile("return input + 1")
  expect(prior.bodyVersion).toBe(1)
  expect(validateDurableBodyArtifact(prior)).toEqual(prior)
})

test("timer answers preserve the declared null value in expression position", async () => {
  const proof = authenticate(compile("return sleep(input)"))
  const store = new DurableStore()
  try {
    expect(await new BodyExecutor(proof, store).execute(0, { executionId: "null" })).toBeNull()
  } finally { store.close() }
})

test("sleep symbol identity survives named aliases, namespaces, parentheses and helper calls", async () => {
  const sources = [
    ['import { durable, sleep as nap } from "vibelang:flows"', "nap(input)"],
    ['import * as Flow from "vibelang:flows"', "Flow.sleep(input)"],
    ['import { durable, sleep } from "vibelang:flows"', "(sleep)(input)"],
  ]
  for (const [index, [imports, request]] of sources.entries()) {
    const callee = imports!.includes("import *") ? "Flow.durable" : "durable"
    const result = compileDurableBody(`${imports}
function pause(input: number) { return ${request} }
export const Pause = ${callee}((input: number) => { pause(input); return 7 })`, { fileName: `timer-alias-${index}.vibe` })
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
    const store = new DurableStore()
    try {
      expect(await new BodyExecutor(authenticate(result.body), store).execute(0, { executionId: "alias" })).toBe(7)
      expect(scheduled(store, "alias")).toHaveLength(1)
    } finally { store.close() }
  }
})

for (const asynchronous of [false, true]) {
  test(`${asynchronous ? "async" : "sync"} executable timer loops preserve occurrence identity and replay`, async () => {
    const body = compile("let count = 0; for (let i = 0; i < input; i++) { sleep(0); count++ } return count", asynchronous)
    const proof = authenticate(body)
    const store = new DurableStore()
    try {
      let commits = 0
      await expect(new BodyExecutor(proof, store).execute(3, { executionId: "loop", afterNodeAdopted: node => {
        if (++commits === 2) throw new CoordinatorCrash(node)
      } })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(scheduled(store, "loop").map(event => event.nodeId)).toEqual([
        `${body.manifest.sites[0]!.id}#0`, `${body.manifest.sites[0]!.id}#1`,
      ])
      const resumed = new BodyExecutor(proof, store).resume("loop")
      expect(await resumed.result()).toBe(3)
      expect(resumed.audit()).toEqual({ requests: 3, replayed: 2, dispatchedLive: 1, recorded: 2 })
      expect(scheduled(store, "loop")).toHaveLength(3)
    } finally { store.close() }
  })
}

test("a restart after scheduling keeps the persisted wake time and acquires no early lease", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-body-timer-"))
  const path = join(directory, "journal.sqlite")
  const proof = authenticate()
  let store = new DurableStore(path)
  let wakeAt = 0
  let timerId = ""
  try {
    await expect(new BodyExecutor(proof, store).execute(20, { executionId: "restart", afterTimerScheduled: (node, wake) => {
      timerId = node
      wakeAt = wake
      const row = store.database.query("SELECT node_kind,status,owner,lease_until,attempt FROM durable_nodes WHERE execution_id=? AND node_id=?")
        .get("restart", node)
      expect(row).toEqual({ node_kind: "timer", status: "pending", owner: null, lease_until: null, attempt: 0 })
      expect(store.claimNode("restart", node, "too-early", 100, wake - 1)).toEqual({ kind: "busy", leaseExpiresAt: wake })
      throw new CoordinatorCrash(node)
    } })).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(store.getExecution("restart").status).toBe("running")
    store.close()
    store = new DurableStore(path)
    expect(store.getNode("restart", timerId).wakeAt).toBe(wakeAt)
    const resumed = new BodyExecutor(proof, store).resume("restart", {
      afterTimerScheduled: () => { throw new Error("a replayed timer must not be scheduled again") },
    })
    expect(await resumed.result()).toBe(21)
    expect(scheduled(store, "restart")).toHaveLength(1)
    expect(resumed.audit()).toEqual({ requests: 1, replayed: 0, dispatchedLive: 1, recorded: 1 })
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})

test("cancellation during timer suspension keeps its reason and never starts a worker attempt", async () => {
  const proof = authenticate()
  const store = new DurableStore()
  try {
    const executor = new BodyExecutor(proof, store)
    const reason = { name: "StopTimer", message: "cancelled during suspension" }
    await expect(executor.execute(3_600_000, { executionId: "cancel", afterTimerScheduled: () => executor.cancel("cancel", reason) }))
      .rejects.toMatchObject({ reason })
    expect(store.getExecution("cancel").status).toBe("cancelled")
    expect(store.journal("cancel").filter(event => event.type === "attempt_started")).toEqual([])
    await expect(new BodyExecutor(proof, store).execute(3_600_000, { executionId: "cancel" }))
      .rejects.toBeInstanceOf(DurableExecutionCancelled)
  } finally { store.close() }
})

test("concurrent timer coordinators share one schedule and one committed answer", async () => {
  const proof = authenticate()
  const store = new DurableStore()
  try {
    const first = new BodyExecutor(proof, store).execute(20, { executionId: "compete", leaseMs: 5 })
    const second = new BodyExecutor(proof, store).execute(20, { executionId: "compete", leaseMs: 5 })
    expect(await Promise.all([first, second])).toEqual([21, 21])
    expect(scheduled(store, "compete")).toHaveLength(1)
    expect(store.journal("compete").filter(event => event.type === "node_succeeded")).toHaveLength(1)
  } finally { store.close() }
})

test("invalid timer durations fail before a schedule or lease is persisted", async () => {
  const proof = authenticate()
  const store = new DurableStore()
  try {
    for (const [index, input] of [-1, 0.5, Number.MAX_SAFE_INTEGER].entries()) {
      const id = `invalid-${index}`
      await expect(new BodyExecutor(proof, store).execute(input, { executionId: id })).rejects.toBeInstanceOf(DurableActionDefect)
      expect(scheduled(store, id)).toEqual([])
      expect(store.journal(id).filter(event => event.type === "attempt_started")).toEqual([])
    }
  } finally { store.close() }
})

test("invalid timer spellings and known invalid durations cannot downgrade to a Plan", () => {
  for (const request of ["sleep(-1)", "sleep(0.5)", "sleep(1e309)", "sleep?.(1)", "sleep(1, 2)", "sleep(...[1])"]) {
    const source = `import { durable, sleep } from "vibelang:flows"
export const Pause = durable((input: number) => { ${request}; return input })`
    for (const frontend of [compileDurableBody, compileDurableFlow]) {
      const result = frontend(source, { fileName: "invalid-timer.vibe" })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.diagnostics.some(issue => issue.code === "VIBE4116")).toBe(true)
    }
  }
  const source = `import { durable, sleep } from "vibelang:flows"
sleep(0)
export const Pause = durable((input: number) => input)`
  for (const frontend of [compileDurableBody, compileDurableFlow]) {
    const result = frontend(source, { fileName: "unbound-timer.vibe" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics).toMatchObject([{ code: "VIBE4199", line: 2 }])
  }
})

test("an execution deadline ends a timer wait without committing its answer", async () => {
  const proof = authenticate()
  const store = new DurableStore()
  try {
    const handle = new BodyExecutor(proof, store).start(3_600_000, { executionId: "deadline", deadline: Date.now() + 25 })
    await expect(handle.result()).rejects.toBeInstanceOf(DurableActionDefect)
    expect(handle.status()).toBe("failed")
    expect(store.journal("deadline").filter(event => event.type === "node_succeeded")).toEqual([])
    expect(store.journal("deadline").filter(event => event.type === "attempt_started")).toEqual([])
  } finally { store.close() }
})

test("the timer request codec rejects wrong keys, site kinds, inputs and replay answers", () => {
  const body = compile()
  const attempt = loadDurableBody(body).create(0)
  const request = { kind: "perform" as const, key: DURABLE_SLEEP_KEY, input: 0,
    site: body.manifest.sites[0]!.id, occurrence: 0, journalKey: `${body.manifest.sites[0]!.id}#0` }
  expect(() => attempt.validateRequest(request)).not.toThrow()
  expect(attempt.decodeAnswer(request, null)).toBeNull()
  for (const change of [{ key: "forged" }, { site: "forged" }, { kind: "get" as const },
    { input: -1 }, { input: 0.5 }, { input: "0" }, { input: NaN }]) {
    expect(() => attempt.validateRequest({ ...request, ...change })).toThrow(TypeError)
  }
  const wrongAnswers: readonly JsonValue[] = [false, 0, {}, { kind: "success", value: null }]
  for (const answer of wrongAnswers) {
    expect(() => attempt.decodeAnswer(request, answer)).toThrow("timer answer must be null")
  }
})

test("lazy timer scheduling checks the pin, running state, kind and request identity atomically", () => {
  const body = compile()
  const store = new DurableStore()
  const pinned = { planDigest: body.digest, manifestDigest: digest("timer-store") }
  const id = "timer-store"
  const node = `${body.manifest.sites[0]!.id}#0`
  const creation = { requestDigest: digest({ duration: 40 }) }
  const rows = () => store.database.query("SELECT COUNT(*) AS count FROM durable_nodes WHERE execution_id=?").get(id)
  try {
    store.initializeBodyExecution(id, body, pinned.manifestDigest, 0)
    expect(() => store.scheduleTimer(id, node, 40, 1000, pinned)).toThrow("Unknown durable node")
    expect(() => store.scheduleTimer(id, node, 40, 1000, { ...pinned, planDigest: digest("old") }, creation)).toThrow()
    expect(() => store.scheduleTimer(id, node, 40, 1000, pinned, { requestDigest: "bad" })).toThrow("SHA-256")
    expect(rows()).toEqual({ count: 0 })
    expect(store.scheduleTimer(id, node, 40, 1000, pinned, creation))
      .toEqual({ kind: "waiting", wakeAt: 1040, newlyScheduled: true })
    expect(store.scheduleTimer(id, node, 40, 5000, pinned, creation))
      .toEqual({ kind: "waiting", wakeAt: 1040, newlyScheduled: false })
    expect(() => store.scheduleTimer(id, node, 50, 5000, pinned, { requestDigest: digest({ duration: 50 }) })).toThrow()
    expect(store.getNode(id, node).wakeAt).toBe(1040)
    expect(scheduled(store, id)).toHaveLength(1)
    const collision = `${body.manifest.sites[0]!.id}#1`
    store.claimNode(id, collision, "action", 1000, Date.now(), pinned, { nodeKind: "action", requestDigest: creation.requestDigest })
    expect(() => store.scheduleTimer(id, collision, 40, Date.now(), pinned, creation)).toThrow()
    expect(scheduled(store, id)).toHaveLength(1)
    store.cancelExecution(id, { name: "Stopped" })
    expect(() => store.scheduleTimer(id, `${body.manifest.sites[0]!.id}#2`, 0, Date.now(), pinned, creation))
      .toThrow(DurableExecutionCancelled)
    expect(rows()).toEqual({ count: 2 })
  } finally { store.close() }
})

test("a scheduled but unclaimed timer participates in replay divergence and pins its duration", async () => {
  const body = compile()
  const store = new DurableStore()
  const pinned = { planDigest: body.digest, manifestDigest: digest("timer-divergence") }
  const id = "timer-divergence"
  try {
    store.initializeBodyExecution(id, body, pinned.manifestDigest, 1000)
    const driver = (input: number) => {
      const attempt = loadDurableBody(body).create(input)
      return { attempt, replay: new ReplayDriver({ mode: "on", store, executionId: id, owner: "probe", pinned,
        dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
        requestDigest: request => digest({ kind: request.kind, key: request.key, input: request.input }),
        journalNode: request => ({ kind: "timer", durationMs: request.input as number }),
        perform: () => { throw new Error("the timer must never be dispatched in this probe") },
        afterTimerScheduled: () => { throw new CoordinatorCrash("timer scheduled") },
      }) }
    }
    const first = driver(1000)
    await expect(first.replay.run(() => first.attempt.computation)).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(store.journal(id).filter(event => event.type === "attempt_started")).toEqual([])
    const changed = driver(1001)
    await expect(changed.replay.run(() => changed.attempt.computation)).rejects.toBeInstanceOf(ReplayDivergenceError)
    const shortened = new ReplayDriver({ mode: "on", store, executionId: id, owner: "probe", pinned, perform: () => null })
    await expect(shortened.run(function* () { return null })).rejects.toThrow("journal entry unconsumed")
    expect(store.getExecution(id).status).toBe("running")
    expect(scheduled(store, id)).toHaveLength(1)
  } finally { store.close() }
})

test("the unchanged corpus duration-projection body executes and replays its computed value", async () => {
  const name = "a-sleep-duration-projection-the-descriptor-does-not-have-is-rejected.vibe"
  const result = compileDurableBody(readFileSync(new URL(`../../../conformance/corpus/17-durable/${name}`, import.meta.url), "utf8"), { fileName: name })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  const action = Action.fromDescriptor<{ key: string }, { value: string }, Error>(result.body.manifest.actions[0]!)
  let calls = 0
  const provider = Provider.provide(action, input => { calls++; return { value: input.key } }, {
    implementationId: "timer-projection", implementationVersion: "1", recovery: { mode: "repeatable", maxAttempts: 1 },
  })
  const body = result.body
  const deployment = BodyDeployment.build({ id: "timer-projection", flow: { id: body.manifest.flowId, version: 1, body },
    pools: [Worker.pool("worker", { target: "typescript-bun", providers: [provider] })] })
  const key = generateDeploymentSigningKeyPair()
  const proof = SignedBodyDeployment.authenticate(deployment, SignedBodyDeployment.encode(body, deployment.manifest, key),
    [deploymentVerificationKey(key)])
  const store = new DurableStore()
  try {
    await expect(new BodyExecutor(proof, store).execute({ key: "answer", items: ["a", "b"] }, {
      executionId: "projection", afterNodeAdopted: node => { if (calls === 1) throw new CoordinatorCrash(node) },
    })).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(calls).toBe(1)
    const resumed = new BodyExecutor(proof, store).resume("projection")
    expect(await resumed.result()).toEqual({ value: "answer" })
    expect(resumed.audit()).toEqual({ requests: 2, recorded: 2, replayed: 2, dispatchedLive: 0 })
    expect(calls).toBe(1)
    expect(scheduled(store, "projection")[0]!.payload).toMatchObject({ durationMs: 2 })
  } finally { store.close() }
})

test("a real SIGKILL after timer scheduling resumes a signed executable body in a fresh process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-body-timer-process-"))
  try {
    const body = compile()
    const deployment = BodyDeployment.build({ id: "body-timer", flow: {
      id: body.manifest.flowId, version: body.manifest.flowVersion, body,
    }, pools: [] })
    const key = generateDeploymentSigningKeyPair()
    const artifact = join(directory, "body.json")
    const signature = join(directory, "signature.json")
    const trust = join(directory, "trust.json")
    const database = join(directory, "journal.sqlite")
    writeFileSync(artifact, JSON.stringify(body))
    writeFileSync(signature, SignedBodyDeployment.encode(body, deployment.manifest, key))
    writeFileSync(trust, JSON.stringify([deploymentVerificationKey(key)]))
    const run = async (mode: string) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../test/fixtures/durable-body-timer-crash-runner.ts"),
        mode, database, artifact, signature, trust], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "" } })
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code, stdout, stderr }
    }
    const killed = await run("kill-after-schedule")
    expect(killed.code).not.toBe(0)
    expect(killed.stdout).toBe("")
    expect(killed.stderr).toBe("")
    const interrupted = new DurableStore(database)
    let schedules
    try {
      expect(interrupted.getExecution("process-timer").status).toBe("running")
      schedules = scheduled(interrupted, "process-timer").map(event => event.payload)
      expect(schedules).toHaveLength(1)
      expect(interrupted.journal("process-timer").filter(event => event.type === "attempt_started")).toEqual([])
    } finally { interrupted.close() }
    const resumed = await run("resume")
    expect(resumed.stderr).toBe("")
    expect(resumed.code).toBe(0)
    expect(JSON.parse(resumed.stdout)).toEqual({ value: 11, status: "completed", timers: schedules, integrity: ["ok"],
      audit: { requests: 1, recorded: 1, replayed: 0, dispatchedLive: 1 } })
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 30_000)
