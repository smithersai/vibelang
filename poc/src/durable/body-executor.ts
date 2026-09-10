import { randomUUID } from "node:crypto"
import { __vsInspectResult, isResult } from "../runtime/result.ts"
import { authenticatedWorkerFactoryFor, type AuthenticatedCoordinatorOptions } from "./authenticated-executor.ts"
import { loadDurableBody, type DurableBodyArtifact, type LoadedDurableBody } from "./body-artifact.ts"
import type { BuiltBodyDeployment } from "./body-deployment.ts"
import type { DurableExecutionHandle, ExecuteOptions } from "./engine.ts"
import { CoordinatorCrash, CoordinatorUnavailable, DurableActionDefect, DurableActionFailure, DurableExecutionAlreadyFailed, DurableExecutionCancelled } from "./errors.ts"
import { ExecutionMigratedError } from "./migration.ts"
import type { DurableWorker } from "./provider.ts"
import { providerReuseIdentity, type ProviderReuseIdentity } from "./reuse.ts"
import { ReplayDivergenceError, ReplayDriver, type DispatchedEffectRequest, type ReplayAttempt, type ReplayAudit } from "./replay.ts"
import { decodeWorkerExit, materializeDurableValue, validateDurableValue } from "./schema-runtime.ts"
import { requireAuthenticatedBodyDeployment, type AuthenticatedBodyDeployment } from "./signed-deployment.ts"
import { DurableStore, type ClaimResult, type StoredExecution } from "./store.ts"
import { assertJson, deepFreeze, digest, type DeploymentManifest, type Invocation, type JsonValue } from "./value.ts"

/** Core control surface shared with the Plan handle; body signals are not implemented yet. */
export interface DurableBodyExecutionHandle<Success = unknown>
  extends Pick<DurableExecutionHandle<Success>, "executionId" | "status" | "result" | "cancel"> {
  /** Per-attempt snapshot; undefined when attachment only reads a terminal outcome. */
  audit(): ReplayAudit | undefined
}

export interface DurableBodyInspection {
  readonly body: DurableBodyArtifact
  readonly manifest: DeploymentManifest
  readonly execution: StoredExecution
  readonly journal: ReturnType<DurableStore["journal"]>
}

interface AttemptObservation { audit?: () => ReplayAudit }

function requireExecutionId(executionId: string): void {
  if (typeof executionId !== "string" || executionId.trim() === "") throw new TypeError("Durable execution id must be non-empty")
}

/** Executes the signed ordinary body; no Plan or proxy callback participates. */
export class BodyExecutor<Input = unknown, Success = unknown> {
  readonly owner = randomUUID()
  readonly deployment: BuiltBodyDeployment<Input, Success>
  #body: LoadedDurableBody | undefined
  readonly #workers = new Map<string, DurableWorker>()
  readonly #active = new Map<string, Set<AbortController>>()

  constructor(authentication: AuthenticatedBodyDeployment<Input, Success>, readonly store: DurableStore,
    options: AuthenticatedCoordinatorOptions = {}) {
    this.deployment = requireAuthenticatedBodyDeployment(authentication)
    const factory = authenticatedWorkerFactoryFor(this.deployment, options)
    // Inspection does not even load executable JavaScript. Authenticate and
    // validate routing here; evaluate the body only when an attempt is driven.
    for (const pool of this.deployment.pools.values()) {
      const worker = factory(pool, this.deployment.manifest, this.deployment.providers)
      if (!worker || typeof worker.invoke !== "function") throw new TypeError(`invalid worker transport for ${pool.id}`)
      this.#workers.set(pool.id, worker)
    }
  }

  get #pinned() {
    return { planDigest: this.deployment.flow.body.digest, manifestDigest: this.deployment.manifest.digest }
  }

  async execute(input: Input, options: ExecuteOptions): Promise<Success> {
    return this.#execute(input, options)
  }

  start(input: Input, options: ExecuteOptions): DurableBodyExecutionHandle<Success> {
    const executionId = options?.executionId
    requireExecutionId(executionId)
    const observation: AttemptObservation = {}
    const run = this.#execute(input, options, observation)
    // A handle may be inspected/cancelled without immediately awaiting result.
    // Keep the original rejection available without an unhandled rejection.
    run.catch(() => {})
    return Object.freeze({ executionId,
      status: () => this.store.getExecution(executionId, this.#pinned).status,
      result: () => run,
      cancel: (reason?: JsonValue) => this.cancel(executionId, reason),
      audit: () => observation.audit?.(),
    })
  }

  resume(executionId: string, options: Omit<ExecuteOptions, "executionId"> = {}): DurableBodyExecutionHandle<Success> {
    requireExecutionId(executionId)
    this.store.getExecution(executionId, this.#pinned)
    const input = this.store.getExecutionInput(executionId)
    return this.start(input as Input, { ...options, executionId })
  }

  inspect(executionId: string): DurableBodyInspection {
    requireExecutionId(executionId)
    // One read snapshot: a concurrent commit cannot pair a stale status with
    // a newer journal, or combine records from different deployment pins.
    return this.store.database.transaction(() => deepFreeze({
      body: this.deployment.flow.body, manifest: this.deployment.manifest,
      execution: this.store.getExecution(executionId, this.#pinned),
      journal: this.store.journal(executionId),
    }))()
  }

  async #execute(input: Input, options: ExecuteOptions, observation?: AttemptObservation): Promise<Success> {
    // A caller mutating its options after start must not retarget later claims,
    // callbacks or commits to a different execution.
    options = { ...options, ...(options.traceContext === undefined ? {} : { traceContext: { ...options.traceContext } }) }
    const leaseMs = options.leaseMs ?? 30_000
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new TypeError("leaseMs must be a positive safe integer")
    if (options.wakeupSweepMs !== undefined && (!Number.isSafeInteger(options.wakeupSweepMs) || options.wakeupSweepMs <= 0)) {
      throw new TypeError("wakeupSweepMs must be a positive safe integer")
    }
    const checkedInput = validateDurableValue(this.deployment.flow.body.inputSchema, input, "Flow input")
    const execution = this.store.initializeBodyExecution(options.executionId, this.deployment.flow.body,
      this.deployment.manifest.digest, checkedInput, options.deadline ?? Date.now() + 60_000)
    if (execution.status !== "running") return this.#terminal(execution)
    const controller = new AbortController()
    const active = this.#active.get(options.executionId) ?? new Set<AbortController>()
    active.add(controller)
    this.#active.set(options.executionId, active)
    try {
      const attempt = (this.#body ??= loadDurableBody(this.deployment.flow.body)).create(checkedInput)
      const reuse = new Map<string, ProviderReuseIdentity | undefined>()
      const driver = new ReplayDriver({ mode: "on", store: this.store, executionId: options.executionId,
        owner: this.owner, pinned: this.#pinned, leaseMs, deadline: execution.deadline, signal: controller.signal,
        dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
        requestDigest: request => digest({ kind: request.kind, key: request.key, input: request.input }),
        journalNode: request => this.deployment.flow.body.manifest.sites.some(site => site.id === request.site && site.kind === "sleep")
          ? { kind: "timer", durationMs: request.input as number } : { kind: "action" },
        wakeupSweepMs: options.wakeupSweepMs,
        afterTimerScheduled: (request, wakeAt) => options.afterTimerScheduled?.(request.journalKey, wakeAt),
        perform: (request, claim) => this.#perform(request, claim, options, execution.deadline, reuse),
        commitAnswer: (request, claim, answer) => this.#commit(request, claim, answer, options.executionId, reuse.get(request.journalKey)),
        afterCommit: request => options.afterNodeAdopted?.(request.journalKey),
      })
      if (observation) observation.audit = () => driver.audit
      const result = await driver.run(() => attempt.computation)
      const inspected = isResult(result) ? __vsInspectResult(result) : { ok: true as const, value: result }
      if (!inspected.ok) {
        const error = attempt.encodeFailure(inspected.error)
        const committed = this.store.failExecution(options.executionId, "failure", error, this.#pinned)
        if (!committed.changed) return this.#terminal(committed.execution)
        throw new DurableActionFailure("$execution", error)
      }
      const value = validateDurableValue(this.deployment.flow.body.successSchema, inspected.value, "Flow output")
      return this.#terminal(this.store.completeExecution(options.executionId, value, this.#pinned).execution)
    } catch (error) {
      if (error instanceof CoordinatorCrash || error instanceof CoordinatorUnavailable || error instanceof ReplayDivergenceError || error instanceof ExecutionMigratedError ||
        error instanceof DurableActionFailure || error instanceof DurableExecutionAlreadyFailed) throw error
      if (error instanceof DurableExecutionCancelled) {
        const winner = this.store.getExecution(options.executionId)
        if (winner.status !== "running") return this.#terminal(winner)
        throw error
      }
      const defect = error instanceof DurableActionDefect ? error.defect : {
        name: error instanceof Error ? error.name : "CoordinatorDefect",
        message: error instanceof Error ? error.message : "executable Flow raised a non-Error defect",
      }
      const committed = this.store.failExecution(options.executionId, "defect", defect, this.#pinned)
      if (!committed.changed) return this.#terminal(committed.execution)
      throw error instanceof DurableActionDefect ? error : new DurableActionDefect("$execution", defect)
    } finally {
      active.delete(controller)
      if (!active.size) this.#active.delete(options.executionId)
    }
  }

  cancel(executionId: string, reason: JsonValue = { name: "Cancelled", message: "Cancelled by caller" }): void {
    const checked = assertJson(reason, "execution cancellation")
    this.store.cancelExecution(executionId, checked)
    for (const controller of this.#active.get(executionId) ?? []) controller.abort(new DurableExecutionCancelled(checked))
  }

  #terminal(execution: StoredExecution): Success {
    if (execution.status === "completed") return materializeDurableValue(this.deployment.flow.body.successSchema,
      execution.output, "persisted Flow output") as Success
    if (execution.status === "failed") {
      const failure = assertJson(execution.error, "persisted Flow failure")
      if (!failure || typeof failure !== "object" || Array.isArray(failure) ||
        Object.keys(failure).sort().join(",") !== "category,error") throw new TypeError("Invalid persisted Flow failure envelope")
      if (failure.category === "failure") validateDurableValue(this.deployment.flow.body.failureSchema,
        failure.error, "persisted Flow error")
      else if (failure.category !== "defect" || !failure.error || typeof failure.error !== "object" || Array.isArray(failure.error) ||
        Object.keys(failure.error).sort().join(",") !== (failure.error.stack === undefined ? "message,name" : "message,name,stack") ||
        typeof failure.error.name !== "string" || typeof failure.error.message !== "string" ||
        (failure.error.stack !== undefined && typeof failure.error.stack !== "string")) throw new TypeError("Invalid persisted Flow defect")
      throw new DurableExecutionAlreadyFailed(failure)
    }
    if (execution.status === "cancelled") {
      const cancellation = assertJson(execution.error, "persisted Flow cancellation")
      if (!cancellation || typeof cancellation !== "object" || Array.isArray(cancellation) ||
        Object.keys(cancellation).sort().join(",") !== "category,reason" || cancellation.category !== "cancelled") {
        throw new TypeError("Invalid persisted Flow cancellation envelope")
      }
      throw new DurableExecutionCancelled(cancellation.reason!)
    }
    throw new Error("execution has not reached a terminal state")
  }

  #commit(request: DispatchedEffectRequest, claim: Extract<ClaimResult, { kind: "claimed" }>, answer: JsonValue,
    executionId: string, reuse: ProviderReuseIdentity | undefined) {
    if (reuse && answer && typeof answer === "object" && !Array.isArray(answer) && answer.kind === "success") {
      const route = this.deployment.manifest.routes.find(route => route.actionId === request.key)!
      const encoding = { encoding: "worker-exit" as const, schema: route.schemas.success }
      const outcome = reuse.kind === "memo"
        ? this.store.commitMemoSuccess(executionId, request.journalKey, this.owner, claim.fencingToken,
          reuse.scope, reuse.generation, reuse.key, answer.value!, encoding)
        : this.store.commitContentSuccess(executionId, request.journalKey, this.owner, claim.fencingToken,
          reuse.key, reuse.inputDigest, answer.value!, encoding)
      return outcome.kind === "lost" ? outcome : { kind: "committed" as const,
        value: { kind: "success", value: outcome.value } }
    }
    return this.store.commitSuccess(executionId, request.journalKey, this.owner, claim.fencingToken, answer)
      ? { kind: "committed" as const, value: answer } : { kind: "lost" as const }
  }

  async #perform(request: DispatchedEffectRequest, claim: ReplayAttempt, options: ExecuteOptions, deadline: number,
    reuseTable: Map<string, ProviderReuseIdentity | undefined>): Promise<JsonValue> {
    if (this.deployment.flow.body.manifest.sites.some(site => site.id === request.site && site.kind === "sleep")) return null
    const route = this.deployment.manifest.routes.find(route => route.actionId === request.key)
    if (!route) return claim.fail({ name: "MissingActionRoute", message: `No signed route at ${request.site}` })
    const input = validateDurableValue(route.schemas.input, request.input, "Action input")
    if (!reuseTable.has(request.journalKey)) reuseTable.set(request.journalKey,
      providerReuseIdentity(this.deployment.providers.get(route.actionId)!, route, input))
    const reuse = reuseTable.get(request.journalKey)
    const cached = reuse?.kind === "memo" ? this.store.memoGet(reuse.scope, reuse.generation, reuse.key) :
      reuse?.kind === "content" ? this.store.contentGet(reuse.key, reuse.inputDigest) : undefined
    if (cached !== undefined) return { kind: "success", value: validateDurableValue(route.schemas.success, cached, "cached Action success") }
    const recovery = route.policy.recovery
    if (claim.stolen && recovery.mode === "manual") {
      return claim.fail({ name: "AmbiguousCompletion", message: `${route.actionId} needs manual recovery at attempt ${claim.attempt}` })
    }
    if (claim.attempt > recovery.maxAttempts) return claim.fail({ name: "AttemptsExhausted", message: `${route.actionId} attempt ${claim.attempt}` })
    const invocation: Invocation = deepFreeze({ schemaVersion: 1, executionId: options.executionId, nodeId: request.journalKey,
      attempt: claim.attempt, actionId: route.actionId, actionVersion: route.actionVersion,
      actionContractDigest: route.actionContractDigest, implementationDigest: route.implementationDigest,
      input, deadline,
      downstreamIdempotencyKey: digest({ executionId: options.executionId, nodeId: request.journalKey }),
      capabilityGrant: route.policy.capabilityGrant, lease: { owner: this.owner, expiresAt: claim.leaseExpiresAt },
      budget: { expiresAt: deadline }, fencingToken: claim.fencingToken, traceContext: options.traceContext ?? {},
    })
    const worker = this.#workers.get(route.poolId)!
    let raw: unknown
    try { raw = await worker.invoke(invocation, claim.signal) }
    catch { raw = { kind: "defect", defect: { name: "WorkerTransportDefect", message: "worker transport rejected the invocation" } } }
    const exit = decodeWorkerExit(route, raw, { label: "worker", protocolDefectName: "WorkerProtocolCodecDefect" })
    if (exit.kind !== "success" && recovery.mode !== "manual" && claim.attempt < recovery.maxAttempts &&
      (exit.kind === "defect" || recovery.retryTypedFailures === true) && Date.now() < deadline) {
      return claim.retry(exit, Math.min(deadline, Date.now() + (recovery.delayMs ?? 0)))
    }
    if (exit.kind === "defect") return claim.fail(exit.defect)
    return assertJson(exit, "worker answer")
  }
}
