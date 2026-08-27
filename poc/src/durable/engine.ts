import { randomUUID } from "node:crypto"
import {
  assertJson,
  canonicalJson,
  deepFreeze,
  digest,
  fanOutSteps,
  type ActionNode,
  type ChildFlowNode,
  type DeploymentManifest,
  type FanOutNode,
  type FanOutStep,
  type FanOutTemplateExpr,
  fragmentNodeIds,
  type Invocation,
  type JsonValue,
  type LoopNode,
  type LoopTemplateExpr,
  type PlanFragment,
  type PlanNode,
  type PlanTemplate,
  type QueueNode,
  type SignalNode,
  type ValueExpr,
  type WorkerExit
} from "./ir.ts"
import type { BuiltDeployment, DurableWorker, WorkerPool } from "./provider.ts"
import { LocalWorker } from "./provider.ts"
import {
  ContentIntegrityError,
  DurableStore,
  type BroadcastContractExpectation,
  type BroadcastDeliveryRequest,
  type BroadcastDeliveryResult,
  type ExecutionStatus,
  type QueueContractExpectation,
  type QueueEnqueueRequest,
  type QueueEnqueueResult,
  type SignalContractExpectation,
  type SignalDeliveryAuthorization,
  type SignalDeliveryRequest,
  type SignalDeliveryResult,
  type StoredNodeExit
} from "./store.ts"
import { ExecutionMigratedError, planExecutionMigration, type MigrationPlan } from "./migration.ts"
import { decodeWorkerExit, validateDurableValue, type WorkerExitSurface } from "./schema.ts"
import {
  CoordinatorCrash,
  DurableActionDefect,
  DurableActionFailure,
  DurableExecutionAlreadyFailed,
  DurableExecutionCancelled
} from "./errors.ts"

/**
 * The coordinator failure identities. They are defined in `./errors.ts` — a
 * leaf module with no store dependency — so a caller that only needs to
 * recognize one (the agent sandbox deciding whether a failure is replayable)
 * can import it without dragging `bun:sqlite` in through `./store.ts`. They
 * are re-exported here because this is where callers of the executor expect
 * to find them, and the identity is the same class either way.
 */
export {
  CoordinatorCrash,
  DurableActionDefect,
  DurableActionFailure,
  DurableExecutionAlreadyFailed,
  DurableExecutionCancelled
} from "./errors.ts"

export interface ExecuteOptions {
  readonly executionId: string
  readonly deadline?: number
  readonly leaseMs?: number
  /**
   * Fallback sweep interval (ms) for suspended timer/signal waits. The sweep
   * is the correctness bound — a wait re-reads committed state at least this
   * often — while same-process wakeup notifications provide the fast path.
   */
  readonly wakeupSweepMs?: number
  readonly traceContext?: Readonly<Record<string, string>>
  /** Runs after the absolute timer wake time is durably committed. */
  readonly afterTimerScheduled?: (nodeId: string, wakeAt: number) => void | Promise<void>
  /** Runs once after a signal wait is durably visible and holds no worker lease. */
  readonly afterSignalWaiting?: (nodeId: string, signalId: string) => void | Promise<void>
  /** Test seam: fires after a queue consumer durably records that it is waiting. */
  readonly afterQueueWaiting?: (nodeId: string, queueId: string) => void | Promise<void>
  /** Runs after the complete fan-out key/child set is durably committed. */
  readonly afterFanOutMaterialized?: (nodeId: string, childNodeIds: readonly string[]) => void | Promise<void>
  /** Runs after one later fan-out step child is durably materialized and before it is dispatched. */
  readonly afterFanOutStepMaterialized?: (nodeId: string, childNodeId: string) => void | Promise<void>
  /** Runs after one loop round is durably materialized and before it is dispatched. */
  readonly afterLoopRoundMaterialized?: (nodeId: string, childNodeId: string, round: number) => void | Promise<void>
  /** Runs after a childFlow node's execution linkage is durably committed. */
  readonly afterChildFlowLinked?: (nodeId: string, childExecutionId: string) => void | Promise<void>
  /** Runs after the durable terminal commit and before the result is exposed. */
  readonly afterNodeAdopted?: (nodeId: string) => void | Promise<void>
}

export interface DurableExecutorOptions {
  /** Deployment/runtime seam for process, sandbox, or remote worker transports. */
  readonly workerFactory?: (
    pool: WorkerPool,
    manifest: DeploymentManifest,
    providers: BuiltDeployment["providers"]
  ) => DurableWorker
}

/** Provisional handle-side delivery options: exact fields, no identity authority. */
export interface DurableSignalOptions {
  readonly idempotencyKey: string
  readonly payload: unknown
}

/**
 * Provisional minted delivery evidence for exactly one (execution, signal)
 * pair. `senderToken` is opaque local-trust evidence (HMAC under the store's
 * persisted secret), not remote-network authentication.
 */
export interface SignalDeliveryGrant {
  readonly executionId: string
  readonly nodeId: string
  readonly signalId: string
  readonly senderToken: string
}

/**
 * Provisional typed control handle over one durable execution. Every method
 * addresses only the handle's own execution id — a handle carries no
 * cross-execution authority — and a handle can be re-obtained after process
 * restart from the execution id and store alone via `DurableExecutor.resume`.
 */
export interface DurableExecutionHandle<Success = unknown> {
  readonly executionId: string
  /** The durable execution status as committed in the store right now. */
  status(): ExecutionStatus
  /**
   * Resolves with the typed Flow success once terminal; rejects with the
   * typed failure (`DurableActionFailure`/`DurableExecutionAlreadyFailed`),
   * cancellation, or defect exactly as `execute` would.
   */
  result(): Promise<Success>
  cancel(reason?: JsonValue): void
  /**
   * Delivers one external signal to this execution through the authenticated
   * exact-identity path: the handle mints a sender token bound to its own
   * (executionId, signalId) and never addresses another execution.
   */
  signal(signalId: string, options: DurableSignalOptions): SignalDeliveryResult
  /**
   * Delivers to a signal inside an ATTACHED child execution, addressed by the
   * chain of `childFlow` node ids from this handle's own execution. It mints no
   * transferable capability: the durable parent -> child linkage is the only
   * authority, and a child not attached along that path fails closed.
   */
  signalChild(
    childNodePath: readonly string[],
    signalId: string,
    options: DurableSignalOptions
  ): SignalDeliveryResult
}

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_FAN_OUT_ITEMS = 10_000
/**
 * Default fallback sweep for suspended waits. Deliberately much longer than
 * the old 25 ms poll: the sweep only bounds how late a wakeup can be when the
 * in-process notification fast path did not fire (another connection, another
 * process); it is never the mechanism a same-process wakeup depends on.
 */
const DEFAULT_WAKEUP_SWEEP_MS = 250

/** Names the coordinator's own worker transport to the shared exit decoder. */
const WORKER_EXIT_SURFACE: WorkerExitSurface = {
  label: "worker",
  protocolDefectName: "WorkerProtocolCodecDefect"
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.min(MAX_TIMER_DELAY_MS, Math.max(0, milliseconds))))

const delayUntil = async (timestamp: number): Promise<void> => {
  while (Date.now() < timestamp) {
    await delay(timestamp - Date.now())
  }
}

const cancellationReason = (storedError: JsonValue): JsonValue => {
  if (
    storedError !== null && typeof storedError === "object" && !Array.isArray(storedError) &&
    storedError.category === "cancelled" && Object.hasOwn(storedError, "reason")
  ) {
    return storedError.reason
  }
  return storedError
}

const traceContext = (value: unknown): Readonly<Record<string, string>> => {
  const normalized = assertJson(value ?? {}, "durable trace context")
  if (
    normalized === null || Array.isArray(normalized) || typeof normalized !== "object" ||
    Object.values(normalized).some((entry) => typeof entry !== "string")
  ) {
    throw new TypeError("Durable trace context must be an object of strings")
  }
  return Object.freeze({ ...normalized }) as Readonly<Record<string, string>>
}

const pathValue = (value: JsonValue, path: readonly string[], description: string): JsonValue => {
  let current: JsonValue = value
  for (const part of path) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(part)) {
        throw new DurableActionDefect(description, { _tag: "ProjectionDefect", path: [...path] })
      }
      const index = Number(part)
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) {
        throw new DurableActionDefect(description, { _tag: "ProjectionDefect", path: [...path] })
      }
      current = current[index]
      continue
    }
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) {
      throw new DurableActionDefect(description, { _tag: "ProjectionDefect", path: [...path] })
    }
    current = current[part]
  }
  return current
}

const booleanValue = (value: JsonValue, description: string): boolean => {
  if (typeof value !== "boolean") {
    throw new DurableActionDefect(description, { _tag: "ExpressionTypeDefect", expected: "boolean", value })
  }
  return value
}

const numberValue = (value: JsonValue, description: string): number => {
  if (typeof value !== "number") {
    throw new DurableActionDefect(description, { _tag: "ExpressionTypeDefect", expected: "number", value })
  }
  return value
}

const timerDurationValue = (value: JsonValue, description: string): number => {
  const durationMs = numberValue(value, description)
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new DurableActionDefect(description, {
      _tag: "TimerDurationDefect",
      expected: "non-negative safe integer milliseconds",
      value
    })
  }
  return durationMs
}

const stringValue = (value: JsonValue, description: string): string => {
  if (typeof value !== "string") {
    throw new DurableActionDefect(description, { _tag: "ExpressionTypeDefect", expected: "string", value })
  }
  return value
}

const fanOutKeyValue = (value: JsonValue, description: string): string | number | boolean => {
  if (
    (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") ||
    (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0)))
  ) {
    throw new DurableActionDefect(description, {
      _tag: "FanOutKeyDefect",
      expected: "canonical string, number, or boolean",
      value
    })
  }
  return value
}

const instantiateFanOutTemplate = (
  expression: FanOutTemplateExpr,
  item: JsonValue,
  stepResults: readonly JsonValue[],
  description: string
): JsonValue => {
  switch (expression.kind) {
    case "item": return pathValue(item, expression.path, description)
    case "step": {
      const prior = stepResults[expression.step]
      if (prior === undefined) {
        throw new DurableActionDefect(description, { _tag: "FanOutStepReferenceDefect", step: expression.step })
      }
      return pathValue(prior, expression.path, description)
    }
    case "literal": return expression.value
    case "array": return expression.items.map((entry) => instantiateFanOutTemplate(entry, item, stepResults, description))
    case "object": return Object.fromEntries(Object.entries(expression.fields)
      .map(([name, entry]) => [name, instantiateFanOutTemplate(entry, item, stepResults, description)]))
  }
}

/**
 * Pure, deterministic evaluation of a loop template over one durable state
 * value: identical inputs replay to identical outputs on every coordinator.
 */
const evaluateLoopTemplate = (
  expression: LoopTemplateExpr,
  state: JsonValue,
  description: string
): JsonValue => {
  switch (expression.kind) {
    case "state": return pathValue(state, expression.path, description)
    case "literal": return expression.value
    case "array": return expression.items.map((entry) => evaluateLoopTemplate(entry, state, description))
    case "object": return Object.fromEntries(Object.entries(expression.fields)
      .map(([name, entry]) => [name, evaluateLoopTemplate(entry, state, description)]))
    case "unary":
      return !booleanValue(evaluateLoopTemplate(expression.value, state, description), description)
    case "binary": {
      const left = evaluateLoopTemplate(expression.left, state, description)
      if (expression.operator === "and" && !booleanValue(left, description)) return false
      if (expression.operator === "or" && booleanValue(left, description)) return true
      const right = evaluateLoopTemplate(expression.right, state, description)
      switch (expression.operator) {
        case "eq": return canonicalJson(left) === canonicalJson(right)
        case "neq": return canonicalJson(left) !== canonicalJson(right)
        case "gt": return numberValue(left, description) > numberValue(right, description)
        case "gte": return numberValue(left, description) >= numberValue(right, description)
        case "lt": return numberValue(left, description) < numberValue(right, description)
        case "lte": return numberValue(left, description) <= numberValue(right, description)
        case "and": return booleanValue(left, description) && booleanValue(right, description)
        case "or": return booleanValue(left, description) || booleanValue(right, description)
        case "add": return numberValue(left, description) + numberValue(right, description)
        case "concat": return stringValue(left, description) + stringValue(right, description)
      }
    }
  }
}

const fromStoredExit = (nodeId: string, exit: StoredNodeExit): JsonValue => {
  switch (exit.kind) {
    case "success":
      return exit.value
    case "failure":
      throw new DurableActionFailure(nodeId, exit.error)
    case "defect":
      throw new DurableActionDefect(nodeId, exit.defect)
    case "skipped":
      throw new DurableActionDefect(nodeId, { _tag: "SkippedValueDefect" })
    case "cancelled":
      throw new DurableExecutionCancelled(exit.reason)
  }
}

interface RunContext {
  readonly executionId: string
  readonly input: JsonValue
  readonly deadline: number
  readonly leaseMs: number
  readonly wakeupSweepMs: number
  readonly traceContext: Readonly<Record<string, string>>
  readonly afterTimerScheduled?: ((nodeId: string, wakeAt: number) => void | Promise<void>) | undefined
  readonly afterSignalWaiting?: ((nodeId: string, signalId: string) => void | Promise<void>) | undefined
  readonly afterQueueWaiting?: ((nodeId: string, queueId: string) => void | Promise<void>) | undefined
  readonly afterFanOutMaterialized?: (
    (nodeId: string, childNodeIds: readonly string[]) => void | Promise<void>
  ) | undefined
  readonly afterFanOutStepMaterialized?: (
    (nodeId: string, childNodeId: string) => void | Promise<void>
  ) | undefined
  readonly afterLoopRoundMaterialized?: (
    (nodeId: string, childNodeId: string, round: number) => void | Promise<void>
  ) | undefined
  readonly afterChildFlowLinked?: (
    (nodeId: string, childExecutionId: string) => void | Promise<void>
  ) | undefined
  readonly afterNodeAdopted?: ((nodeId: string) => void | Promise<void>) | undefined
  readonly resolutions: Map<string, Promise<JsonValue>>
}

export class DurableExecutor<Input = unknown, Success = unknown> {
  readonly owner = randomUUID()
  /**
   * The exact Plan this coordinator is authorized to advance. Every mutating
   * store call carries it — including the two that write durable state without
   * holding a per-attempt fence of their own, the branch skip (terminal) and
   * the timer schedule (an absolute wake deadline) — so a coordinator holding a
   * superseded deployment cannot claim, materialize, link, skip, schedule,
   * complete, or fail a migrated execution. The only deliberate exceptions are
   * `cancelExecution`, where operator intent outranks the pinned Plan, and the
   * cross-execution producer calls (`enqueue`, `deliverSignal`,
   * `deliverBroadcast`), which carry the consumer's contract expectation
   * instead because they are not scoped to this coordinator's Plan.
   */
  private get planDigest(): string {
    return this.deployment.flow.plan.digest
  }
  private readonly nodes = new Map<string, PlanNode>()
  private readonly routes: Map<string, BuiltDeployment<Input, Success>["manifest"]["routes"][number]>
  private readonly workers = new Map<string, DurableWorker>()
  private readonly executorOptions: DurableExecutorOptions
  /** Lazily constructed executors for embedded child Flow deployments, by child Plan digest. */
  private readonly childExecutors = new Map<string, DurableExecutor<unknown, unknown>>()
  private readonly activeAttempts = new Map<string, {
    readonly executionId: string
    readonly controller: AbortController
  }>()

  constructor(
    readonly deployment: BuiltDeployment<Input, Success>,
    readonly store: DurableStore,
    options: DurableExecutorOptions = {}
  ) {
    this.executorOptions = options
    this.routes = new Map(deployment.manifest.routes.map((route) => [route.actionId, route]))
    const collect = (fragment: PlanFragment): void => {
      for (const node of fragment.nodes) {
        if (this.nodes.has(node.id)) throw new Error(`Plan contains duplicate node id ${node.id}`)
        this.nodes.set(node.id, node)
        if (node.kind === "branch") {
          collect(node.whenTrue)
          collect(node.whenFalse)
        }
      }
    }
    collect(deployment.flow.plan)
    const workerFactory = options.workerFactory ?? ((pool, manifest, providers) =>
      new LocalWorker(pool, manifest, providers))
    for (const pool of deployment.pools.values()) {
      const worker = workerFactory(pool, deployment.manifest, deployment.providers)
      if (worker === null || typeof worker !== "object" || typeof worker.invoke !== "function") {
        throw new TypeError(`Worker factory returned an invalid transport for pool ${pool.id}`)
      }
      this.workers.set(pool.id, worker)
    }
  }

  async execute(inputValue: Input, options: ExecuteOptions): Promise<Success> {
    if (typeof options.executionId !== "string" || options.executionId.trim() === "") {
      throw new TypeError("Durable execution id must be non-empty")
    }
    const flowSchemas = this.deployment.flow.plan.flowSchemas
    const checkedFlowSuccess = (
      value: unknown,
      label: string,
      defectName: "FlowSuccessCodecDefect" | "PersistedFlowCodecDefect"
    ): JsonValue => {
      if (flowSchemas === undefined) return value as JsonValue
      try {
        return validateDurableValue(flowSchemas.success, value, label)
      } catch (error) {
        throw new DurableActionDefect("$execution", {
          name: defectName,
          message: error instanceof Error ? error.message : `${label} failed its durable codec`
        })
      }
    }
    const checkedStoredFailure = (value: JsonValue, label: string): JsonValue => {
      try {
        if (value === null || typeof value !== "object" || Array.isArray(value) ||
          canonicalJson(Object.keys(value).sort()) !== canonicalJson(["category", "error"]) ||
          (value.category !== "failure" && value.category !== "defect")) {
          throw new TypeError(`${label} has an invalid terminal failure envelope`)
        }
        if (value.category === "failure" && flowSchemas?.error !== undefined) {
          validateDurableValue(flowSchemas.error, value.error, `${label} typed error`)
        }
        return value
      } catch (error) {
        throw new DurableActionDefect("$execution", {
          name: "PersistedFlowCodecDefect",
          message: error instanceof Error ? error.message : `${label} failed its durable codec`
        })
      }
    }
    let input: JsonValue
    try {
      input = flowSchemas === undefined
        ? assertJson(inputValue, "Flow input")
        : validateDurableValue(flowSchemas.input, inputValue, "Flow input")
    } catch (error) {
      throw new DurableActionDefect("$execution", {
        name: "FlowInputCodecDefect",
        message: error instanceof Error ? error.message : "Flow input failed its durable codec"
      })
    }
    const requestedDeadline = options.deadline ?? Date.now() + 60_000
    if (!Number.isSafeInteger(requestedDeadline) || requestedDeadline < 0) {
      throw new TypeError("Durable execution deadline must be a non-negative integer timestamp")
    }
    const requestedLeaseMs = options.leaseMs ?? 2_000
    if (
      !Number.isSafeInteger(requestedLeaseMs) || requestedLeaseMs <= 0 ||
      !Number.isSafeInteger(Date.now() + requestedLeaseMs)
    ) {
      throw new TypeError("Durable execution leaseMs must be a positive safe integer")
    }
    const requestedWakeupSweepMs = options.wakeupSweepMs ?? DEFAULT_WAKEUP_SWEEP_MS
    if (
      !Number.isSafeInteger(requestedWakeupSweepMs) || requestedWakeupSweepMs <= 0 ||
      !Number.isSafeInteger(Date.now() + requestedWakeupSweepMs)
    ) {
      throw new TypeError("Durable execution wakeupSweepMs must be a positive safe integer")
    }
    const normalizedTraceContext = traceContext(options.traceContext)
    const stored = this.store.initializeExecution(
      options.executionId,
      this.deployment.flow.plan,
      this.deployment.manifest,
      input,
      requestedDeadline
    )
    if (stored.status === "completed") {
      return checkedFlowSuccess(
        stored.output,
        "stored Flow success",
        "PersistedFlowCodecDefect"
      ) as Success
    }
    if (stored.status === "failed") {
      throw new DurableExecutionAlreadyFailed(checkedStoredFailure(stored.error!, "stored Flow failure"))
    }
    if (stored.status === "cancelled") throw new DurableExecutionCancelled(cancellationReason(stored.error!))
    const context: RunContext = {
      executionId: options.executionId,
      input,
      // A restart cannot silently reset the execution's retry deadline.
      deadline: stored.deadline,
      leaseMs: requestedLeaseMs,
      wakeupSweepMs: requestedWakeupSweepMs,
      traceContext: normalizedTraceContext,
      afterTimerScheduled: options.afterTimerScheduled,
      afterSignalWaiting: options.afterSignalWaiting,
      afterQueueWaiting: options.afterQueueWaiting,
      afterFanOutMaterialized: options.afterFanOutMaterialized,
      afterFanOutStepMaterialized: options.afterFanOutStepMaterialized,
      afterLoopRoundMaterialized: options.afterLoopRoundMaterialized,
      afterChildFlowLinked: options.afterChildFlowLinked,
      afterNodeAdopted: options.afterNodeAdopted,
      resolutions: new Map()
    }
    try {
      if (Date.now() >= context.deadline) {
        throw new DurableActionDefect("$execution", {
          name: "DeadlineExceeded",
          message: "Persisted execution deadline exceeded before execution or resume"
        })
      }
      // Every root declaration runs, even when its value is not the Flow output.
      await Promise.all(this.deployment.flow.plan.nodes.map((node) => this.resolveNode(node.id, context)))
      let output = await this.evaluate(this.deployment.flow.plan.output, context)
      output = checkedFlowSuccess(output, "Flow success", "FlowSuccessCodecDefect")
      if (Date.now() >= context.deadline) {
        throw new DurableActionDefect("$execution", {
          name: "DeadlineExceeded",
          message: "Persisted execution deadline exceeded before terminal commit"
        })
      }
      const finished = this.store.completeExecution(options.executionId, output, this.planDigest)
      if (finished.execution.status === "completed") {
        return checkedFlowSuccess(
          finished.execution.output,
          "committed Flow success",
          "PersistedFlowCodecDefect"
        ) as Success
      }
      if (finished.execution.status === "cancelled") {
        throw new DurableExecutionCancelled(cancellationReason(finished.execution.error!))
      }
      throw new DurableExecutionAlreadyFailed(checkedStoredFailure(
        finished.execution.error!,
        "concurrent Flow failure"
      ))
    } catch (error) {
      if (error instanceof CoordinatorCrash) throw error // process death leaves the execution resumable
      // A coordinator that no longer matches the pinned Plan must abandon the
      // execution exactly like a dead process: it is emphatically NOT entitled
      // to record a terminal outcome for work it can no longer interpret.
      if (error instanceof ExecutionMigratedError) throw error
      let terminalError = error
      if (error instanceof DurableActionFailure && flowSchemas?.error !== undefined) {
        try {
          validateDurableValue(flowSchemas.error, error.failure, "Flow typed failure")
        } catch (codecError) {
          terminalError = new DurableActionDefect(error.nodeId, {
            name: "FlowFailureCodecDefect",
            message: codecError instanceof Error
              ? codecError.message
              : "Flow failure failed its durable codec"
          })
        }
      }
      let finished
      if (terminalError instanceof DurableActionFailure) {
        finished = this.store.failExecution(
          options.executionId,
          "failure",
          terminalError.failure,
          this.planDigest
        )
      } else if (terminalError instanceof DurableActionDefect) {
        finished = this.store.failExecution(
          options.executionId,
          "defect",
          terminalError.defect,
          this.planDigest
        )
      } else {
        finished = this.store.failExecution(options.executionId, "defect", {
          name: terminalError instanceof Error ? terminalError.name : "CoordinatorDefect",
          message: terminalError instanceof Error ? terminalError.message : String(terminalError)
        }, this.planDigest)
      }
      if (!finished.changed) {
        if (finished.execution.status === "completed") {
          return checkedFlowSuccess(
            finished.execution.output,
            "concurrent Flow success",
            "PersistedFlowCodecDefect"
          ) as Success
        }
        if (finished.execution.status === "cancelled") {
          throw new DurableExecutionCancelled(cancellationReason(finished.execution.error!))
        }
        throw new DurableExecutionAlreadyFailed(checkedStoredFailure(
          finished.execution.error!,
          "concurrent Flow failure"
        ))
      }
      throw terminalError
    }
  }

  cancel(executionId: string, reason: JsonValue = { name: "Cancelled", message: "Cancelled by caller" }): void {
    // Cancellation is recorded durably (parent and attached children in one
    // fenced transaction) before live attempts observe the abort.
    this.store.cancelExecution(executionId, assertJson(reason, "cancellation reason"))
    this.abortExecutionTree(executionId)
  }

  private abortExecutionTree(executionId: string): void {
    for (const attempt of this.activeAttempts.values()) {
      if (attempt.executionId === executionId) attempt.controller.abort()
    }
    for (const link of this.store.listChildExecutions(executionId)) {
      // An executor this process never constructed has no live attempts here;
      // the durable cancellation above already fenced its persisted state.
      this.childExecutors.get(link.planDigest)?.abortExecutionTree(link.childExecutionId)
    }
  }

  /**
   * Provisional external delivery entry point for the signal POC. Delivery is
   * fail-closed on sender authorization: the default requires a sender token
   * minted for exactly (executionId, signalId); the tokenless direct path
   * survives only behind an explicit `unsafeLocalDelivery: true` for
   * in-process tests/legacy callers. Wire spelling remains non-normative.
   */
  deliverSignal(
    request: SignalDeliveryRequest,
    authorization: SignalDeliveryAuthorization = {}
  ): SignalDeliveryResult {
    const normalized = assertJson(request, "durable signal delivery request")
    if (
      normalized === null || Array.isArray(normalized) || typeof normalized !== "object" ||
      canonicalJson(Object.keys(normalized).sort()) !== canonicalJson([
        "executionId", "idempotencyKey", "nodeId", "payload", "signalId"
      ]) || typeof normalized.nodeId !== "string" || typeof normalized.signalId !== "string"
    ) throw new TypeError("Durable signal delivery request must have exact fields")
    const safeRequest = normalized as unknown as SignalDeliveryRequest
    const node = this.nodes.get(safeRequest.nodeId)
    // `delivery === undefined` is the single-delivery form. A broadcast node is
    // reached only through `deliverBroadcast`; addressing one here would write
    // an inbox row `pollBroadcastSignal` never reads. The store refuses it too —
    // this check exists so the coordinator refuses it earlier, with a message
    // that names the actual mistake.
    if (node?.kind !== "signal" || node.signalId !== safeRequest.signalId || node.delivery !== undefined) {
      throw new TypeError(
        `Delivery does not address a signal in this deployment Plan; a broadcast signal is reached with deliverBroadcast`
      )
    }
    const expectation: SignalContractExpectation = {
      planDigest: this.deployment.flow.plan.digest,
      signalId: node.signalId,
      signalContractDigest: node.signalContractDigest
    }
    return this.store.deliverSignal(safeRequest, expectation, authorization)
  }

  /**
   * Provisional explicit grant API: mints local-trust delivery evidence for
   * one (executionId, signalId) pair after checking the signal exists in this
   * deployment Plan and that execution pinned its contract. The token is
   * unforgeable without the store secret but is honestly scoped local-trust
   * evidence, not remote-network authentication.
   */
  grantSignal(executionId: string, signalId: string): SignalDeliveryGrant {
    if (typeof signalId !== "string" || signalId.trim() === "") {
      throw new TypeError("Durable signal id must be non-empty")
    }
    const planNode = [...this.nodes.values()].find(
      (candidate): candidate is Extract<PlanNode, { readonly kind: "signal" }> =>
        candidate.kind === "signal" && candidate.signalId === signalId && candidate.delivery === undefined
    )
    if (planNode === undefined) {
      // A broadcast node in this Plan is deliberately not a match: this grant
      // mints unicast sender evidence, and `grantBroadcast` is its counterpart.
      throw new TypeError(
        `Grant does not address a signal in this deployment Plan; a broadcast signal is granted with grantBroadcast`
      )
    }
    const minted = this.store.mintSignalToken(executionId, signalId)
    if (minted.nodeId !== planNode.id) {
      throw new ContentIntegrityError(
        `signal ${executionId}/${signalId} persisted contract disagrees with the coordinator Plan node`
      )
    }
    return Object.freeze({
      executionId,
      nodeId: minted.nodeId,
      signalId,
      senderToken: minted.senderToken
    })
  }

  /** Finds the exact queue consumer contract this deployment Plan declares. */
  private queuePlanNode(queueId: string): QueueNode {
    if (typeof queueId !== "string" || queueId.trim() === "") {
      throw new TypeError("Durable queue id must be non-empty")
    }
    const found = [...this.nodes.values()].filter(
      (candidate): candidate is QueueNode => candidate.kind === "queue" && candidate.queueId === queueId
    )
    if (found.length === 0) {
      throw new TypeError(`Enqueue does not address a queue in this deployment Plan`)
    }
    // Several consumer nodes may share one queue; the Plan validator already
    // required them to agree on one exact item contract.
    return found[0]!
  }

  /** Finds the exact broadcast signal contract this deployment Plan declares. */
  private broadcastPlanNode(signalId: string): SignalNode {
    if (typeof signalId !== "string" || signalId.trim() === "") {
      throw new TypeError("Durable signal id must be non-empty")
    }
    const found = [...this.nodes.values()].find(
      (candidate): candidate is SignalNode =>
        candidate.kind === "signal" && candidate.signalId === signalId && candidate.delivery === "broadcast"
    )
    if (found === undefined) {
      throw new TypeError(`Delivery does not address a broadcast signal in this deployment Plan`)
    }
    return found
  }

  /**
   * Provisional producer entry point for a durable queue. Like signal delivery
   * it is fail-closed by default and requires a token minted by `grantQueue`;
   * the tokenless path survives only behind explicit `unsafeLocalDelivery`.
   */
  enqueue(
    request: QueueEnqueueRequest,
    authorization: { readonly producerToken?: string; readonly unsafeLocalDelivery?: true } = {}
  ): QueueEnqueueResult {
    const normalized = assertJson(request, "durable queue enqueue request")
    if (
      normalized === null || Array.isArray(normalized) || typeof normalized !== "object" ||
      canonicalJson(Object.keys(normalized).sort()) !== canonicalJson([
        "idempotencyKey", "item", "queueId"
      ]) || typeof normalized.queueId !== "string"
    ) throw new TypeError("Durable queue enqueue request must have exact fields")
    const node = this.queuePlanNode(normalized.queueId)
    const expectation: QueueContractExpectation = {
      queueId: node.queueId,
      queueContractDigest: node.queueContractDigest
    }
    return this.store.enqueue(normalized as unknown as QueueEnqueueRequest, expectation, authorization)
  }

  /** Mints local-trust producer evidence for one queue this Plan consumes. */
  grantQueue(queueId: string): { readonly queueId: string; readonly producerToken: string } {
    const node = this.queuePlanNode(queueId)
    const minted = this.store.mintQueueToken(node.queueId)
    return Object.freeze({ queueId: node.queueId, producerToken: minted.producerToken })
  }

  /**
   * Provisional broadcast entry point. One delivery satisfies every execution
   * already subscribed to this signal identity; each adopts it exactly once.
   */
  deliverBroadcast(
    request: BroadcastDeliveryRequest,
    authorization: SignalDeliveryAuthorization = {}
  ): BroadcastDeliveryResult {
    const normalized = assertJson(request, "durable broadcast delivery request")
    if (
      normalized === null || Array.isArray(normalized) || typeof normalized !== "object" ||
      canonicalJson(Object.keys(normalized).sort()) !== canonicalJson([
        "idempotencyKey", "payload", "signalId"
      ]) || typeof normalized.signalId !== "string"
    ) throw new TypeError("Durable broadcast delivery request must have exact fields")
    const node = this.broadcastPlanNode(normalized.signalId)
    const expectation: BroadcastContractExpectation = {
      signalId: node.signalId,
      signalContractDigest: node.signalContractDigest
    }
    return this.store.deliverBroadcast(
      normalized as unknown as BroadcastDeliveryRequest,
      expectation,
      authorization
    )
  }

  /**
   * Delivers a signal to a node inside an ATTACHED child Plan, addressed by the
   * chain of `childFlow` node ids leading to it.
   *
   * Authority derives entirely from the parent: the caller must already hold a
   * handle to `parentExecutionId`, and the store verifies every hop of the
   * durable parent -> child linkage before any token exists. No transferable
   * capability is produced — the minted evidence is consumed inside this call
   * and never returned — so this widens a parent grant's reach to exactly the
   * executions that parent itself created, and to nothing else.
   */
  private deliverAttachedChildSignal(
    parentExecutionId: string,
    childNodePath: readonly string[],
    signalId: string,
    options: DurableSignalOptions
  ): SignalDeliveryResult {
    if (!Array.isArray(childNodePath) || childNodePath.length === 0) {
      throw new TypeError("Durable child signal path must name at least one attached childFlow node")
    }
    // Resolve the leaf child deployment through the embedded, digest-pinned
    // child Plans, so the signal contract still comes from compiled evidence.
    let leaf: DurableExecutor<unknown, unknown> = this as DurableExecutor<unknown, unknown>
    for (const nodeId of childNodePath) {
      const childFlowNode = leaf.nodes.get(nodeId)
      if (childFlowNode?.kind !== "childFlow") {
        throw new TypeError(`Child signal path node ${nodeId} is not a childFlow node of this Plan`)
      }
      const next = leaf.childExecutor(childFlowNode.planDigest)
      if (next === undefined) {
        throw new TypeError(`Child Plan ${childFlowNode.planDigest} is not embedded in this deployment`)
      }
      leaf = next
    }
    const planNode = [...leaf.nodes.values()].find(
      (candidate): candidate is SignalNode =>
        candidate.kind === "signal" && candidate.signalId === signalId && candidate.delivery === undefined
    )
    if (planNode === undefined) {
      // Same discrimination as `deliverSignal`/`grantSignal`: an attached child's
      // broadcast node is not addressable through the unicast inbox either.
      throw new TypeError(
        `Delivery does not address a signal in the attached child Plan; a broadcast signal is reached with deliverBroadcast`
      )
    }
    // The durable linkage chain — not any new authority — is what permits this.
    const minted = this.store.mintAttachedSignalToken(parentExecutionId, childNodePath, signalId)
    if (minted.nodeId !== planNode.id) {
      throw new ContentIntegrityError(
        `attached child signal ${minted.executionId}/${signalId} disagrees with the embedded child Plan node`
      )
    }
    return this.store.deliverSignal({
      executionId: minted.executionId,
      nodeId: planNode.id,
      signalId,
      idempotencyKey: options.idempotencyKey,
      payload: options.payload
    }, {
      planDigest: leaf.deployment.flow.plan.digest,
      signalId: planNode.signalId,
      signalContractDigest: planNode.signalContractDigest
    }, { senderToken: minted.senderToken })
  }

  /** Mints local-trust sender evidence for one broadcast identity in this Plan. */
  grantBroadcast(signalId: string): { readonly signalId: string; readonly senderToken: string } {
    const node = this.broadcastPlanNode(signalId)
    const minted = this.store.mintBroadcastToken(node.signalId)
    return Object.freeze({ signalId: node.signalId, senderToken: minted.senderToken })
  }

  /**
   * Applies an EXPLICIT, opt-in migration of one in-flight execution from the
   * supplied previous deployment onto THIS executor's deployment. Nothing about
   * the compatibility judgment is trusted from here: the store re-derives it
   * inside the applying transaction from both artifacts and the execution's own
   * durable rows. Applying it twice is idempotent.
   */
  migrate(
    executionId: string,
    from: {
      readonly flow: { readonly plan: PlanTemplate }
      readonly manifest: DeploymentManifest
    }
  ): { readonly applied: boolean; readonly fencedNodeIds: readonly string[]; readonly generation: number } {
    const migration: MigrationPlan = planExecutionMigration(
      { plan: from?.flow?.plan, manifest: from?.manifest },
      { plan: this.deployment.flow.plan, manifest: this.deployment.manifest }
    )
    return this.store.migrateExecution(executionId, migration)
  }

  /**
   * Provisional start-without-await spelling: begins (or resumes) the durable
   * execution and immediately returns a typed handle scoped to exactly that
   * execution id. `execute` remains the start-and-await convenience.
   */
  start(inputValue: Input, options: ExecuteOptions): DurableExecutionHandle<Success> {
    if (typeof options?.executionId !== "string" || options.executionId.trim() === "") {
      throw new TypeError("Durable execution id must be non-empty")
    }
    return this.createHandle(options.executionId, this.execute(inputValue, options))
  }

  /**
   * Provisional re-attachment spelling: re-obtains a handle for an existing
   * durable execution from the execution id and store alone — the pinned,
   * digest-verified input is read back from the store, so a restarted process
   * needs no original in-memory state. A terminal execution exposes its
   * committed outcome without re-running; a running one resumes replay.
   */
  resume(
    executionId: string,
    options: Omit<ExecuteOptions, "executionId"> = {}
  ): DurableExecutionHandle<Success> {
    if (typeof executionId !== "string" || executionId.trim() === "") {
      throw new TypeError("Durable execution id must be non-empty")
    }
    this.store.getExecution(executionId) // fail closed on unknown executions
    const input = this.store.getExecutionInput(executionId)
    return this.createHandle(executionId, this.execute(input as Input, { ...options, executionId }))
  }

  private createHandle(executionId: string, run: Promise<Success>): DurableExecutionHandle<Success> {
    // A handle owner may never await result(); park the rejection so an
    // unobserved terminal failure is not an unhandled rejection. result()
    // still surfaces the original typed error from the same promise.
    run.catch(() => {})
    return Object.freeze({
      executionId,
      status: (): ExecutionStatus => this.store.getExecution(executionId).status,
      result: (): Promise<Success> => run,
      cancel: (reason?: JsonValue): void => {
        if (reason === undefined) this.cancel(executionId)
        else this.cancel(executionId, reason)
      },
      signal: (signalId: string, options: DurableSignalOptions): SignalDeliveryResult => {
        if (
          options === null || typeof options !== "object" || Array.isArray(options) ||
          Reflect.ownKeys(options).length !== 2 ||
          !Object.hasOwn(options, "idempotencyKey") || !Object.hasOwn(options, "payload")
        ) {
          throw new TypeError("Durable handle signal options must have exactly idempotencyKey and payload")
        }
        const grant = this.grantSignal(executionId, signalId)
        return this.deliverSignal({
          executionId,
          nodeId: grant.nodeId,
          signalId,
          idempotencyKey: options.idempotencyKey,
          payload: options.payload
        }, { senderToken: grant.senderToken })
      },
      signalChild: (
        childNodePath: readonly string[],
        signalId: string,
        options: DurableSignalOptions
      ): SignalDeliveryResult => {
        if (
          options === null || typeof options !== "object" || Array.isArray(options) ||
          Reflect.ownKeys(options).length !== 2 ||
          !Object.hasOwn(options, "idempotencyKey") || !Object.hasOwn(options, "payload")
        ) {
          throw new TypeError("Durable handle signal options must have exactly idempotencyKey and payload")
        }
        return this.deliverAttachedChildSignal(executionId, childNodePath, signalId, options)
      }
    })
  }

  inspect(executionId: string): {
    readonly plan: PlanTemplate
    readonly manifest: DeploymentManifest
    readonly journal: ReturnType<DurableStore["journal"]>
  } {
    return {
      plan: this.deployment.flow.plan,
      manifest: this.deployment.manifest,
      journal: this.store.journal(executionId)
    }
  }

  private resolveNode(nodeId: string, context: RunContext): Promise<JsonValue> {
    const active = context.resolutions.get(nodeId)
    if (active !== undefined) return active
    const resolution = this.resolveNodeUnshared(nodeId, context)
    context.resolutions.set(nodeId, resolution)
    return resolution
  }

  private async resolveNodeUnshared(nodeId: string, context: RunContext): Promise<JsonValue> {
    const node = this.nodes.get(nodeId)
    if (node === undefined) throw new Error(`Plan references unknown node ${nodeId}`)
    const recorded = this.store.getNode(context.executionId, nodeId).exit
    // Signal and queue nodes always route through their own poll transaction,
    // even when terminal, so the store re-verifies that the committed value
    // still agrees with its delivery/consumption evidence.
    if (recorded !== undefined && node.kind !== "signal" && node.kind !== "queue") {
      return node.kind === "action"
        ? this.fromActionStoredExit(node, recorded)
        : fromStoredExit(nodeId, recorded)
    }

    await Promise.all(node.controlDependencies.map((dependency) => this.resolveNode(dependency, context)))

    switch (node.kind) {
      case "action":
        return this.resolveAction(node, context)
      case "parallel": {
        const claim = await this.acquire(node.id, context)
        if (claim.kind === "terminal") return fromStoredExit(node.id, claim.exit)
        const values = await Promise.all(node.outputs.map((output) => this.evaluate(output, context)))
        return this.commitControlNode(node.id, claim.fencingToken, values, context)
      }
      case "timer":
        return this.resolveTimer(node, context)
      case "signal":
        return this.resolveSignal(node, context)
      case "queue":
        return this.resolveQueue(node, context)
      case "fanout":
        return this.resolveFanOut(node, context)
      case "loop":
        return this.resolveLoop(node, context)
      case "childFlow":
        return this.resolveChildFlow(node, context)
      case "branch": {
        const condition = booleanValue(await this.evaluate(node.condition, context), node.id)
        const claim = await this.acquire(node.id, context)
        if (claim.kind === "terminal") return fromStoredExit(node.id, claim.exit)
        const chosen = condition ? node.whenTrue : node.whenFalse
        const skipped = condition ? node.whenFalse : node.whenTrue
        // The skip is a terminal write, so it is fenced and pinned exactly like
        // the branch's own success commit: a migration landing inside this
        // `acquire` boundary must not be able to skip a node the new Plan needs.
        const owned = this.store.skipNodes(
          context.executionId,
          fragmentNodeIds(skipped),
          node.id,
          this.owner,
          claim.fencingToken,
          this.planDigest
        )
        if (!owned) return this.reresolveLostAttempt(node.id, context)
        await Promise.all(chosen.nodes.map((child) => this.resolveNode(child.id, context)))
        const value = await this.evaluate(chosen.output, context)
        return this.commitControlNode(node.id, claim.fencingToken, value, context)
      }
    }
  }

  private fanOutChildAction(
    node: FanOutNode,
    step: FanOutStep,
    stepIndex: number,
    childId: string,
    input: JsonValue
  ): ActionNode {
    return {
      kind: "action",
      id: childId,
      actionId: step.actionId,
      actionVersion: step.actionVersion,
      actionContractDigest: step.actionContractDigest,
      input: { kind: "literal", value: input },
      dependencies: [],
      controlDependencies: [],
      debug: {
        label: stepIndex === 0 && !("steps" in node)
          ? `fanOut:${step.actionId}`
          : `fanOut:${step.actionId}#${stepIndex}`,
        ...(node.debug?.callSite === undefined ? {} : { callSite: node.debug.callSite })
      }
    }
  }

  private async resolveFanOut(node: FanOutNode, context: RunContext): Promise<JsonValue> {
    const steps = fanOutSteps(node)
    const stepped = "steps" in node
    const value = await this.evaluate(node.items, context)
    if (!Array.isArray(value)) {
      throw new DurableActionDefect(node.id, {
        _tag: "FanOutItemsDefect",
        expected: "array",
        value
      })
    }
    if (value.length > MAX_FAN_OUT_ITEMS) {
      throw new DurableActionDefect(node.id, {
        _tag: "FanOutLimitDefect",
        limit: MAX_FAN_OUT_ITEMS,
        observed: value.length
      })
    }

    const seenKeys = new Set<string>()
    const children = value.map((item, index) => {
      const key = fanOutKeyValue(pathValue(item, node.keyPath, `${node.id} key ${index}`), node.id)
      const canonicalKey = canonicalJson(key)
      if (seenKeys.has(canonicalKey)) {
        throw new DurableActionDefect(node.id, {
          _tag: "FanOutDuplicateKeyDefect",
          key
        })
      }
      seenKeys.add(canonicalKey)
      const candidateInput = instantiateFanOutTemplate(steps[0]!.input, item, [], `${node.id} item ${canonicalKey}`)
      const childId = stepped
        ? `fan-${digest({ fanOutNodeId: node.id, key, step: 0 })}`
        : `fan-${digest({ fanOutNodeId: node.id, key })}`
      const candidateAction = this.fanOutChildAction(node, steps[0]!, 0, childId, candidateInput)
      // Validate every instantiated input before materializing or dispatching
      // any child. A hostile artifact therefore cannot create partial external
      // work by placing one malformed item after otherwise valid items.
      const input = this.validateActionInput(candidateAction, candidateInput)
      const action: ActionNode = {
        ...candidateAction,
        input: { kind: "literal", value: input }
      }
      return { key, item, input, action }
    })

    let newlyMaterialized = false
    try {
      newlyMaterialized = this.store.materializeFanOut(
        context.executionId,
        node.id,
        children.map(({ key, input, action }) => ({
          key,
          childNodeId: action.id,
          inputDigest: digest(input),
          ...(stepped ? { step: 0 as const } : {})
        })),
        this.planDigest
      ).newlyMaterialized
    } catch (error) {
      if (error instanceof CoordinatorCrash) throw error // process death leaves the fan-out resumable
      if (error instanceof DurableActionDefect) throw error
      throw new DurableActionDefect(node.id, {
        name: error instanceof Error ? error.name : "FanOutMaterializationDefect",
        message: error instanceof Error ? error.message : String(error)
      })
    }
    if (newlyMaterialized) {
      await context.afterFanOutMaterialized?.(node.id, children.map(({ action }) => action.id))
    }

    const results = await Promise.all(children.map(async ({ key, item, action }) => {
      const stepResults: JsonValue[] = []
      let current = await this.resolveDynamicAction(action, context)
      stepResults.push(current)
      for (let stepIndex = 1; stepIndex < steps.length; stepIndex++) {
        const step = steps[stepIndex]!
        const canonicalKey = canonicalJson(key)
        // Later step inputs are reconstructed from the item and the durable
        // results of earlier steps only, so replay is deterministic; the
        // persisted digest check below rejects any drift before dispatch.
        const candidateInput = instantiateFanOutTemplate(
          step.input,
          item,
          stepResults,
          `${node.id} item ${canonicalKey} step ${stepIndex}`
        )
        const childId = `fan-${digest({ fanOutNodeId: node.id, key, step: stepIndex })}`
        const candidateAction = this.fanOutChildAction(node, step, stepIndex, childId, candidateInput)
        const input = this.validateActionInput(candidateAction, candidateInput)
        const stepAction: ActionNode = {
          ...candidateAction,
          input: { kind: "literal", value: input }
        }
        let newlyMaterializedStep = false
        try {
          newlyMaterializedStep = this.store.materializeFanOutStep(context.executionId, node.id, {
            key,
            step: stepIndex,
            childNodeId: childId,
            inputDigest: digest(input)
          }, this.planDigest).newlyMaterialized
        } catch (error) {
          if (error instanceof CoordinatorCrash) throw error // process death leaves the step resumable
          if (error instanceof DurableActionDefect) throw error
          throw new DurableActionDefect(node.id, {
            name: error instanceof Error ? error.name : "FanOutStepMaterializationDefect",
            message: error instanceof Error ? error.message : String(error)
          })
        }
        if (newlyMaterializedStep) {
          await context.afterFanOutStepMaterialized?.(node.id, childId)
        }
        current = await this.resolveDynamicAction(stepAction, context)
        stepResults.push(current)
      }
      return current
    }))
    const claim = await this.acquire(node.id, context)
    if (claim.kind === "terminal") return fromStoredExit(node.id, claim.exit)
    return this.commitControlNode(node.id, claim.fencingToken, results, context)
  }

  /**
   * A bounded `while`-style next-round handoff. The durable state chain is
   * rebuilt deterministically from committed round results; each new round's
   * identity and evidence commit atomically before its Action dispatches, and
   * budget exhaustion is a durable terminal defect rather than a hang.
   */
  private async resolveLoop(node: LoopNode, context: RunContext): Promise<JsonValue> {
    let state = await this.evaluate(node.initial, context)
    for (let round = 0; ; round++) {
      const shouldContinue = booleanValue(
        evaluateLoopTemplate(node.condition, state, `${node.id} condition round ${round}`),
        `${node.id} condition round ${round}`
      )
      if (!shouldContinue) {
        const claim = await this.acquire(node.id, context)
        if (claim.kind === "terminal") return fromStoredExit(node.id, claim.exit)
        return this.commitControlNode(node.id, claim.fencingToken, state, context)
      }
      if (round >= node.maxRounds) {
        const claim = await this.acquire(node.id, context)
        if (claim.kind === "terminal") return fromStoredExit(node.id, claim.exit)
        const defect = {
          name: "LoopRoundBudgetExhausted",
          message: `Durable loop ${node.id} exhausted its explicit round budget of ${node.maxRounds}`,
          maxRounds: node.maxRounds
        }
        const committed = this.store.commitFailure(
          context.executionId,
          node.id,
          this.owner,
          claim.fencingToken,
          { kind: "defect", defect }
        )
        if (!committed) {
          const winner = this.store.getNode(context.executionId, node.id).exit
          if (winner !== undefined) return fromStoredExit(node.id, winner)
          context.resolutions.delete(node.id)
          return this.resolveNode(node.id, context)
        }
        throw new DurableActionDefect(node.id, defect)
      }
      const description = `${node.id} round ${round}`
      const candidateInput = evaluateLoopTemplate(node.body, state, description)
      const childId = `loop-${digest({ loopNodeId: node.id, round })}`
      const candidateAction: ActionNode = {
        kind: "action",
        id: childId,
        actionId: node.actionId,
        actionVersion: node.actionVersion,
        actionContractDigest: node.actionContractDigest,
        input: { kind: "literal", value: candidateInput },
        dependencies: [],
        controlDependencies: [],
        debug: {
          label: `loop:${node.actionId}@${round}`,
          ...(node.debug?.callSite === undefined ? {} : { callSite: node.debug.callSite })
        }
      }
      const input = this.validateActionInput(candidateAction, candidateInput)
      const action: ActionNode = { ...candidateAction, input: { kind: "literal", value: input } }
      let newlyMaterialized = false
      try {
        newlyMaterialized = this.store.materializeLoopRound(context.executionId, node.id, {
          round,
          childNodeId: childId,
          inputDigest: digest(input),
          stateDigest: digest(state)
        }, this.planDigest).newlyMaterialized
      } catch (error) {
        if (error instanceof CoordinatorCrash) throw error // process death leaves the round resumable
        if (error instanceof DurableActionDefect) throw error
        throw new DurableActionDefect(node.id, {
          name: error instanceof Error ? error.name : "LoopRoundMaterializationDefect",
          message: error instanceof Error ? error.message : String(error)
        })
      }
      if (newlyMaterialized) {
        await context.afterLoopRoundMaterialized?.(node.id, childId, round)
      }
      state = await this.resolveDynamicAction(action, context)
    }
  }

  private childExecutor(planDigest: string): DurableExecutor<unknown, unknown> | undefined {
    const existing = this.childExecutors.get(planDigest)
    if (existing !== undefined) return existing
    const childDeployment = this.deployment.childDeployments.get(planDigest)
    if (childDeployment === undefined) return undefined
    const executor = new DurableExecutor(childDeployment, this.store, this.executorOptions)
    this.childExecutors.set(planDigest, executor)
    return executor
  }

  private async resolveChildFlow(node: ChildFlowNode, context: RunContext): Promise<JsonValue> {
    const executor = this.childExecutor(node.planDigest)
    if (executor === undefined) {
      throw new DurableActionDefect(node.id, {
        _tag: "DeploymentUnavailable",
        flowId: node.flowId,
        planDigest: node.planDigest
      })
    }
    const rawInput = await this.evaluate(node.input, context)
    // The child's own compiler-derived Flow input schema gates the boundary
    // before any linkage or child execution row exists.
    const childSchemas = executor.deployment.flow.plan.flowSchemas
    let childInput: JsonValue = rawInput
    if (childSchemas !== undefined) {
      try {
        childInput = validateDurableValue(childSchemas.input, rawInput, `${node.flowId} child Flow input`)
      } catch (error) {
        return this.commitChildFlowExit(node, context, {
          kind: "defect",
          defect: {
            name: "ChildFlowInputCodecDefect",
            message: error instanceof Error ? error.message : `${node.flowId} child Flow input failed its durable codec`
          }
        })
      }
    }
    // The child execution id is a pure function of the parent execution and
    // node identity, so a restart resumes the same attached child instead of
    // spawning a sibling.
    const childExecutionId = `${context.executionId}::child::${node.id}`
    let linked
    try {
      linked = this.store.registerChildExecution(
        context.executionId,
        node.id,
        childExecutionId,
        node.planDigest,
        this.planDigest
      )
    } catch (error) {
      if (error instanceof CoordinatorCrash) throw error // process death leaves the parent resumable
      const recorded = this.store.getNode(context.executionId, node.id).exit
      if (recorded !== undefined) return fromStoredExit(node.id, recorded)
      throw new DurableActionDefect(node.id, {
        name: error instanceof Error ? error.name : "ChildFlowLinkDefect",
        message: error instanceof Error ? error.message : String(error)
      })
    }
    if (linked.newlyLinked) {
      await context.afterChildFlowLinked?.(node.id, childExecutionId)
    }
    // The parent childFlow node holds no owner or worker lease while the child
    // runs; it is claimed only for the terminal adoption commit below.
    let exit: WorkerExit
    try {
      const output = await executor.execute(childInput, {
        executionId: childExecutionId,
        deadline: context.deadline,
        leaseMs: context.leaseMs,
        wakeupSweepMs: context.wakeupSweepMs,
        traceContext: context.traceContext
      })
      exit = { kind: "success", value: output as JsonValue }
    } catch (error) {
      if (error instanceof CoordinatorCrash) throw error
      if (error instanceof DurableActionFailure) {
        exit = { kind: "failure", error: error.failure }
      } else if (error instanceof DurableExecutionAlreadyFailed) {
        const stored = error.storedError
        if (
          stored !== null && typeof stored === "object" && !Array.isArray(stored) &&
          stored.category === "failure" && Object.hasOwn(stored, "error")
        ) {
          exit = { kind: "failure", error: stored.error as JsonValue }
        } else {
          const defect = {
            name: "ChildFlowDefect",
            message: `Child execution ${childExecutionId} failed with a defect`,
            childDefect: stored !== null && typeof stored === "object" && !Array.isArray(stored) && Object.hasOwn(stored, "error")
              ? (stored as { readonly error: JsonValue }).error
              : stored
          }
          exit = { kind: "defect", defect }
        }
      } else if (error instanceof DurableExecutionCancelled) {
        const defect = {
          name: "ChildFlowCancelled",
          message: `Child execution ${childExecutionId} was cancelled`,
          reason: error.reason
        }
        exit = { kind: "defect", defect }
      } else if (error instanceof DurableActionDefect) {
        const defect = {
          name: "ChildFlowDefect",
          message: `Child execution ${childExecutionId} node ${error.nodeId} terminated with a defect`,
          childDefect: error.defect
        }
        exit = { kind: "defect", defect }
      } else {
        exit = {
          kind: "defect",
          defect: {
            name: error instanceof Error ? error.name : "ChildFlowDefect",
            message: error instanceof Error ? error.message : String(error)
          }
        }
      }
    }
    return this.commitChildFlowExit(node, context, exit)
  }

  /** Adopts the child's terminal outcome run-locally before exposing it. */
  private async commitChildFlowExit(
    node: ChildFlowNode,
    context: RunContext,
    exit: WorkerExit
  ): Promise<JsonValue> {
    const claim = await this.acquire(node.id, context)
    if (claim.kind === "terminal") return fromStoredExit(node.id, claim.exit)
    if (exit.kind === "success") {
      return this.commitControlNode(node.id, claim.fencingToken, exit.value, context)
    }
    const committed = this.store.commitFailure(context.executionId, node.id, this.owner, claim.fencingToken, exit)
    if (!committed) {
      const winner = this.store.getNode(context.executionId, node.id).exit
      if (winner !== undefined) return fromStoredExit(node.id, winner)
      context.resolutions.delete(node.id)
      return this.resolveNode(node.id, context)
    }
    if (exit.kind === "failure") throw new DurableActionFailure(node.id, exit.error)
    throw new DurableActionDefect(node.id, exit.defect)
  }

  private resolveDynamicAction(node: ActionNode, context: RunContext): Promise<JsonValue> {
    const active = context.resolutions.get(node.id)
    if (active !== undefined) return active
    const resolution = (async (): Promise<JsonValue> => {
      const recorded = this.store.getNode(context.executionId, node.id).exit
      return recorded === undefined
        ? this.resolveAction(node, context)
        : this.fromActionStoredExit(node, recorded)
    })()
    context.resolutions.set(node.id, resolution)
    return resolution
  }

  private async resolveTimer(
    node: Extract<PlanNode, { readonly kind: "timer" }>,
    context: RunContext
  ): Promise<JsonValue> {
    const durationMs = timerDurationValue(await this.evaluate(node.durationMs, context), node.id)
    const scheduled = this.store.scheduleTimer(
      context.executionId,
      node.id,
      durationMs,
      Date.now(),
      this.planDigest
    )
    if (scheduled.kind === "terminal") return fromStoredExit(node.id, scheduled.exit)
    if (scheduled.newlyScheduled) {
      await context.afterTimerScheduled?.(node.id, scheduled.wakeAt)
    }

    while (true) {
      const recorded = this.store.getNode(context.executionId, node.id).exit
      if (recorded !== undefined) return fromStoredExit(node.id, recorded)
      const now = Date.now()
      if (now >= context.deadline) {
        return fromStoredExit(node.id, this.store.timeoutNode(
          context.executionId,
          node.id,
          `Persisted execution deadline exceeded while waiting for timer ${node.id}`,
          this.planDigest
        ))
      }
      if (now >= scheduled.wakeAt) {
        const claim = await this.acquire(node.id, context)
        if (claim.kind === "terminal") return fromStoredExit(node.id, claim.exit)
        return this.commitControlNode(node.id, claim.fencingToken, null, context)
      }
      // Event-driven suspension: sleep to the exact persisted wake time
      // (never a fixed poll), bounded by the execution deadline and the
      // fallback sweep. A same-process wakeup notification (cancellation,
      // execution failure) ends the sleep early; correctness never depends on
      // it — committed state is re-read at the sweep boundary at the latest,
      // and the store's wake_at gate still rejects any early completion.
      await this.store.wakeups.wait(
        context.executionId,
        Math.min(scheduled.wakeAt, context.deadline, now + context.wakeupSweepMs)
      )
    }
  }

  /**
   * Suspends on a durable queue without holding a worker lease. The store's
   * consume transaction is the only place an item changes hands, so this loop
   * is a pure wait: it never caches, reserves, or partially consumes anything.
   */
  private async resolveQueue(node: QueueNode, context: RunContext): Promise<JsonValue> {
    while (true) {
      const polled = this.store.pollQueue(context.executionId, node.id, {
        planDigest: this.planDigest,
        queueId: node.queueId,
        queueContractDigest: node.queueContractDigest
      })
      if (polled.kind === "terminal") {
        if (polled.newlyConsumed) await context.afterNodeAdopted?.(node.id)
        return fromStoredExit(node.id, polled.exit)
      }
      if (polled.newlyWaiting) {
        await context.afterQueueWaiting?.(node.id, node.queueId)
      }
      const now = Date.now()
      if (now >= context.deadline) {
        return fromStoredExit(node.id, this.store.timeoutNode(
          context.executionId,
          node.id,
          `Persisted execution deadline exceeded while waiting on queue ${node.queueId}`,
          this.planDigest
        ))
      }
      await this.store.wakeups.wait(
        context.executionId,
        Math.min(context.deadline, now + context.wakeupSweepMs)
      )
    }
  }

  private async resolveSignal(
    node: Extract<PlanNode, { readonly kind: "signal" }>,
    context: RunContext
  ): Promise<JsonValue> {
    while (true) {
      const polled = this.store.pollSignal(context.executionId, node.id, {
        planDigest: this.deployment.flow.plan.digest,
        signalId: node.signalId,
        signalContractDigest: node.signalContractDigest
      })
      if (polled.kind === "terminal") {
        if (polled.newlyConsumed) await context.afterNodeAdopted?.(node.id)
        return fromStoredExit(node.id, polled.exit)
      }
      if (polled.newlyWaiting) {
        await context.afterSignalWaiting?.(node.id, node.signalId)
      }
      const now = Date.now()
      if (now >= context.deadline) {
        return fromStoredExit(node.id, this.store.timeoutNode(
          context.executionId,
          node.id,
          `Persisted execution deadline exceeded while waiting for signal ${node.signalId}`,
          this.planDigest
        ))
      }
      // Event-driven suspension: the persisted inbox remains the only source
      // of truth. A same-process delivery/cancellation notification wakes the
      // wait immediately; a delivery committed through another connection or
      // process is observed at the fallback sweep boundary at the latest, so
      // correctness never depends on the notifier.
      await this.store.wakeups.wait(
        context.executionId,
        Math.min(context.deadline, now + context.wakeupSweepMs)
      )
    }
  }

  private async acquire(
    nodeId: string,
    context: RunContext
  ): Promise<
    | {
      readonly kind: "claimed"
      readonly attempt: number
      readonly fencingToken: number
      readonly leaseExpiresAt: number
      readonly stolen: boolean
    }
    | { readonly kind: "terminal"; readonly exit: StoredNodeExit }
  > {
    while (true) {
      if (Date.now() >= context.deadline) {
        return {
          kind: "terminal",
          exit: this.store.timeoutNode(
            context.executionId,
            nodeId,
            `Persisted execution deadline exceeded while waiting for ${nodeId}`,
            this.planDigest
          )
        }
      }
      const claim = this.store.claimNode(
        context.executionId,
        nodeId,
        this.owner,
        context.leaseMs,
        Date.now(),
        this.planDigest
      )
      if (claim.kind !== "busy") return claim
      await delay(Math.min(
        25,
        Math.max(1, claim.leaseExpiresAt - Date.now()),
        Math.max(1, context.deadline - Date.now())
      ))
    }
  }

  /**
   * An attempt that lost its fence wrote nothing. Adopt whatever the winner
   * committed, or start the node over from the durable state that now exists.
   */
  private reresolveLostAttempt(nodeId: string, context: RunContext): Promise<JsonValue> {
    const winner = this.store.getNode(context.executionId, nodeId).exit
    if (winner !== undefined) return Promise.resolve(fromStoredExit(nodeId, winner))
    context.resolutions.delete(nodeId)
    return this.resolveNode(nodeId, context)
  }

  private async commitControlNode(
    nodeId: string,
    fencingToken: number,
    value: JsonValue,
    context: RunContext
  ): Promise<JsonValue> {
    const committed = this.store.commitSuccess(
      context.executionId,
      nodeId,
      this.owner,
      fencingToken,
      value,
      null
    )
    if (!committed) return this.reresolveLostAttempt(nodeId, context)
    await context.afterNodeAdopted?.(nodeId)
    return value
  }

  private async resolveAction(node: Extract<PlanNode, { readonly kind: "action" }>, context: RunContext): Promise<JsonValue> {
    const route = this.routes.get(node.actionId)
    const provider = this.deployment.providers.get(node.actionId)
    if (
      route === undefined ||
      provider === undefined ||
      route.actionVersion !== node.actionVersion ||
      route.actionContractDigest !== node.actionContractDigest ||
      provider.actionContractDigest !== node.actionContractDigest
    ) {
      throw new DurableActionDefect(node.id, {
        _tag: "DeploymentUnavailable",
        actionId: node.actionId,
        actionVersion: node.actionVersion
      })
    }
    // Provider-owned memo key functions and worker implementations observe an
    // immutable snapshot. In particular, a key function cannot mutate payload
    // bytes after `inputDigest` has been computed.
    let input: JsonValue
    try {
      input = deepFreeze(validateDurableValue(
        route.schemas.input,
        await this.evaluate(node.input, context),
        `${node.actionId} coordinator input`
      ))
    } catch (error) {
      throw new DurableActionDefect(node.id, {
        name: "InvocationCodecDefect",
        message: error instanceof Error ? error.message : `${node.actionId} input failed its durable codec`
      })
    }
    const inputDigest = digest(input)
    const reuse = provider.reuse
    let reuseIdentity: { readonly kind: "memo" | "content"; readonly key: string; readonly inputDigest: string } | undefined

    if (reuse.kind === "memo") {
      const explicitKey = reuse.key(input)
      if (typeof explicitKey !== "string") {
        throw new DurableActionDefect(node.id, {
          name: "MemoKeyDefect",
          message: `${node.actionId} memo key must return a string`
        })
      }
      const memoKey = digest({
        actionId: node.actionId,
        actionVersion: node.actionVersion,
        actionContractDigest: node.actionContractDigest,
        implementationDigest: provider.implementationDigest,
        policyDigest: provider.policyDigest,
        target: route.policy.target,
        explicitKey
      })
      const hit = this.store.memoGet(reuse.scope, reuse.generation, memoKey)
      if (hit !== undefined) {
        const checked = this.validateActionSuccess(node, hit)
        return this.adoptCacheHit(node, checked, `memo:${reuse.scope}:${reuse.generation}:${memoKey}`, context)
      }
      reuseIdentity = { kind: "memo", key: memoKey, inputDigest }
    } else if (reuse.kind === "content") {
      const contentKey = digest({
        actionId: node.actionId,
        actionVersion: node.actionVersion,
        actionContractDigest: node.actionContractDigest,
        input,
        implementationDigest: provider.implementationDigest,
        policyDigest: provider.policyDigest,
        dependencyDigests: provider.dependencyDigests,
        target: route.policy.target,
        invalidationSalt: reuse.invalidationSalt ?? ""
      })
      let hit: JsonValue | undefined
      try {
        hit = this.store.contentGet(contentKey, inputDigest)
      } catch (error) {
        if (error instanceof ContentIntegrityError) {
          return this.commitIntegrityDefect(node, context, error)
        }
        throw error
      }
      if (hit !== undefined) {
        const checked = this.validateActionSuccess(node, hit)
        return this.adoptCacheHit(node, checked, `content:${contentKey}`, context)
      }
      reuseIdentity = { kind: "content", key: contentKey, inputDigest }
    }

    while (true) {
      const acquired = await this.acquire(node.id, context)
      if (acquired.kind === "terminal") return this.fromActionStoredExit(node, acquired.exit)
      const recovery = provider.recovery
      if (acquired.stolen && recovery.mode === "manual") {
        const defect = {
          name: "AmbiguousCompletion",
          message: `${node.actionId} lost its lease and is manual-recovery only`,
          attempt: acquired.attempt,
        }
        this.store.commitFailure(
          context.executionId,
          node.id,
          this.owner,
          acquired.fencingToken,
          { kind: "defect", defect },
        )
        throw new DurableActionDefect(node.id, defect)
      }
      if (acquired.attempt > recovery.maxAttempts) {
        const defect = {
          name: "AttemptsExhausted",
          message: `${node.actionId} exceeded maxAttempts=${recovery.maxAttempts}`,
          attempt: acquired.attempt,
        }
        this.store.commitFailure(
          context.executionId,
          node.id,
          this.owner,
          acquired.fencingToken,
          { kind: "defect", defect },
        )
        throw new DurableActionDefect(node.id, defect)
      }
      if (Date.now() >= context.deadline) {
        const deadlineExit: WorkerExit = {
          kind: "defect",
          defect: { name: "DeadlineExceeded", message: `Deadline exceeded before ${node.actionId} attempt` }
        }
        this.store.commitFailure(
          context.executionId,
          node.id,
          this.owner,
          acquired.fencingToken,
          deadlineExit
        )
        throw new DurableActionDefect(node.id, deadlineExit.defect)
      }
      const invocation: Invocation = {
        schemaVersion: 1,
        executionId: context.executionId,
        nodeId: node.id,
        attempt: acquired.attempt,
        actionId: node.actionId,
        actionVersion: node.actionVersion,
        actionContractDigest: node.actionContractDigest,
        implementationDigest: route.implementationDigest,
        input,
        deadline: context.deadline,
        downstreamIdempotencyKey: digest({ executionId: context.executionId, nodeId: node.id }),
        capabilityGrant: route.policy.capabilityGrant,
        lease: { owner: this.owner, expiresAt: acquired.leaseExpiresAt },
        fencingToken: acquired.fencingToken,
        traceContext: context.traceContext
      }
      const worker = this.workers.get(route.poolId)
      if (worker === undefined) {
        throw new DurableActionDefect(node.id, { _tag: "WorkerPoolUnavailable", poolId: route.poolId })
      }
      const abortController = new AbortController()
      const heartbeat = setInterval(() => {
        const alive = this.store.heartbeat(
          context.executionId,
          node.id,
          this.owner,
          acquired.fencingToken,
          Date.now() + context.leaseMs
        )
        if (!alive) abortController.abort()
      }, Math.max(1, Math.floor(context.leaseMs / 3)))
      heartbeat.unref?.()
      let exit: WorkerExit
      const attemptKey = canonicalJson([context.executionId, node.id, acquired.fencingToken])
      this.activeAttempts.set(attemptKey, { executionId: context.executionId, controller: abortController })
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined
      try {
        const deadlineExit = new Promise<WorkerExit>((resolve) => {
          const schedule = (): void => {
            const remaining = context.deadline - Date.now()
            if (remaining > 0) {
              deadlineTimer = setTimeout(schedule, Math.min(MAX_TIMER_DELAY_MS, remaining))
              return
            }
            resolve({
              kind: "defect",
              defect: { name: "DeadlineExceeded", message: `Persisted deadline exceeded during ${node.actionId}` }
            })
            abortController.abort()
          }
          schedule()
        })
        const cancelledExit = new Promise<WorkerExit>((resolve) => {
          abortController.signal.addEventListener("abort", () => resolve({
            kind: "defect",
            defect: { name: "InvocationCancelled", message: `Invocation ${node.actionId} was fenced or cancelled` }
          }), { once: true })
        })
        exit = this.validateWorkerExit(
          node,
          await Promise.race([worker.invoke(invocation, abortController.signal), deadlineExit, cancelledExit])
        )
      } finally {
        this.activeAttempts.delete(attemptKey)
        if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
        clearInterval(heartbeat)
      }

      if (exit.kind === "success") {
        let canonical = exit.value
        let committed = false
        if (reuseIdentity?.kind === "memo" && reuse.kind === "memo") {
          const result = this.store.commitMemoSuccess(
            context.executionId,
            node.id,
            this.owner,
            acquired.fencingToken,
            reuse.scope,
            reuse.generation,
            reuseIdentity.key,
            canonical
          )
          if (result.kind === "lost") {
            const winner = this.store.getNode(context.executionId, node.id).exit
            if (winner !== undefined) return this.fromActionStoredExit(node, winner)
            continue
          }
          canonical = result.value
          committed = true
        } else if (reuseIdentity?.kind === "content") {
          try {
            const result = this.store.commitContentSuccess(
              context.executionId,
              node.id,
              this.owner,
              acquired.fencingToken,
              reuseIdentity.key,
              reuseIdentity.inputDigest,
              canonical
            )
            if (result.kind === "lost") {
              const winner = this.store.getNode(context.executionId, node.id).exit
              if (winner !== undefined) return this.fromActionStoredExit(node, winner)
              continue
            }
            canonical = result.value
            committed = true
          } catch (error) {
            if (error instanceof ContentIntegrityError) {
              const defect = { name: error.name, message: error.message }
              const committed = this.store.commitFailure(
                context.executionId,
                node.id,
                this.owner,
                acquired.fencingToken,
                { kind: "defect", defect }
              )
              if (!committed) {
                const winner = this.store.getNode(context.executionId, node.id).exit
                if (winner !== undefined) return this.fromActionStoredExit(node, winner)
              }
              throw new DurableActionDefect(node.id, defect)
            }
            throw error
          }
        }
        canonical = this.validateActionSuccess(node, canonical)
        if (!committed) {
          committed = this.store.commitSuccess(
            context.executionId,
            node.id,
            this.owner,
            acquired.fencingToken,
            canonical,
            null
          )
        }
        if (!committed) {
          const winner = this.store.getNode(context.executionId, node.id).exit
          if (winner !== undefined) return this.fromActionStoredExit(node, winner)
          continue
        }
        // Nothing below can observe the value until both state and lifecycle event are durable.
        await context.afterNodeAdopted?.(node.id)
        return canonical
      }

      const retryable = recovery.mode !== "manual" &&
        (exit.kind === "defect" || recovery.retryTypedFailures === true) &&
        acquired.attempt < recovery.maxAttempts &&
        Date.now() < context.deadline
      if (retryable) {
        const retryAt = Math.min(context.deadline, Date.now() + (recovery.delayMs ?? 0))
        if (this.store.scheduleRetry(
          context.executionId,
          node.id,
          this.owner,
          acquired.fencingToken,
          exit,
          retryAt
        )) {
          await delayUntil(retryAt)
          continue
        }
        const winner = this.store.getNode(context.executionId, node.id).exit
        if (winner !== undefined) return this.fromActionStoredExit(node, winner)
        continue
      }
      const committed = this.store.commitFailure(
        context.executionId,
        node.id,
        this.owner,
        acquired.fencingToken,
        exit
      )
      if (!committed) {
        const winner = this.store.getNode(context.executionId, node.id).exit
        if (winner !== undefined) return this.fromActionStoredExit(node, winner)
        continue
      }
      if (exit.kind === "failure") throw new DurableActionFailure(node.id, exit.error)
      throw new DurableActionDefect(node.id, exit.defect)
    }
  }

  private actionRoute(node: ActionNode): DeploymentManifest["routes"][number] {
    const route = this.routes.get(node.actionId)
    if (
      route === undefined ||
      route.actionVersion !== node.actionVersion ||
      route.actionContractDigest !== node.actionContractDigest
    ) {
      throw new DurableActionDefect(node.id, {
        name: "DeploymentUnavailable",
        message: `No pinned durable contract route for ${node.actionId}`
      })
    }
    return route
  }

  private validateActionInput(node: ActionNode, value: unknown): JsonValue {
    const route = this.actionRoute(node)
    try {
      return deepFreeze(validateDurableValue(
        route.schemas.input,
        value,
        `${route.actionId} coordinator input`
      ))
    } catch (error) {
      throw new DurableActionDefect(node.id, {
        name: "InvocationCodecDefect",
        message: error instanceof Error ? error.message : `${route.actionId} input failed its durable codec`
      })
    }
  }

  private validateActionSuccess(node: ActionNode, value: unknown): JsonValue {
    const route = this.actionRoute(node)
    try {
      return validateDurableValue(route.schemas.success, value, `${route.actionId} coordinator success`)
    } catch (error) {
      throw new DurableActionDefect(node.id, {
        name: "SuccessCodecDefect",
        message: error instanceof Error ? error.message : `${route.actionId} success failed its durable codec`
      })
    }
  }

  private fromActionStoredExit(node: ActionNode, exit: StoredNodeExit): JsonValue {
    const route = this.actionRoute(node)
    try {
      if (exit.kind === "success") {
        return fromStoredExit(node.id, { ...exit, value: validateDurableValue(
          route.schemas.success,
          exit.value,
          `${route.actionId} stored success`
        ) })
      }
      if (exit.kind === "failure") {
        return fromStoredExit(node.id, { ...exit, error: validateDurableValue(
          route.schemas.error,
          exit.error,
          `${route.actionId} stored failure`
        ) })
      }
      return fromStoredExit(node.id, exit)
    } catch (error) {
      if (error instanceof DurableActionFailure || error instanceof DurableActionDefect || error instanceof DurableExecutionCancelled) {
        throw error
      }
      throw new DurableActionDefect(node.id, {
        name: "PersistedCodecDefect",
        message: error instanceof Error ? error.message : `${route.actionId} stored exit failed its durable codec`
      })
    }
  }

  private validateWorkerExit(node: ActionNode, exit: unknown): WorkerExit {
    return decodeWorkerExit(this.actionRoute(node), exit, WORKER_EXIT_SURFACE)
  }

  private async adoptCacheHit(
    node: ActionNode,
    value: JsonValue,
    adoptedFrom: string,
    context: RunContext
  ): Promise<JsonValue> {
    const adopted = this.store.adoptSuccess(context.executionId, node.id, value, adoptedFrom, this.planDigest)
    if (!adopted) {
      const winner = this.store.getNode(context.executionId, node.id).exit
      if (winner !== undefined) return this.fromActionStoredExit(node, winner)
      return this.resolveAction(node, context)
    }
    await context.afterNodeAdopted?.(node.id)
    return value
  }

  private async commitIntegrityDefect(
    node: ActionNode,
    context: RunContext,
    error: ContentIntegrityError
  ): Promise<JsonValue> {
    const acquired = await this.acquire(node.id, context)
    if (acquired.kind === "terminal") return this.fromActionStoredExit(node, acquired.exit)
    const defect = { name: error.name, message: error.message }
    const committed = this.store.commitFailure(
      context.executionId,
      node.id,
      this.owner,
      acquired.fencingToken,
      { kind: "defect", defect }
    )
    if (!committed) {
      const winner = this.store.getNode(context.executionId, node.id).exit
      if (winner !== undefined) return this.fromActionStoredExit(node, winner)
    }
    throw new DurableActionDefect(node.id, defect)
  }

  private async evaluate(expression: ValueExpr, context: RunContext): Promise<JsonValue> {
    switch (expression.kind) {
      case "literal":
        return expression.value
      case "input":
        return pathValue(context.input, expression.path, "Flow input")
      case "node":
        return pathValue(await this.resolveNode(expression.nodeId, context), expression.path, expression.nodeId)
      case "array":
        return Promise.all(expression.items.map((item) => this.evaluate(item, context)))
      case "object": {
        const entries = await Promise.all(
          Object.entries(expression.fields).map(async ([key, value]) => [key, await this.evaluate(value, context)] as const)
        )
        return Object.fromEntries(entries)
      }
      case "unary":
        return !booleanValue(await this.evaluate(expression.value, context), expression.operator)
      case "binary": {
        const left = await this.evaluate(expression.left, context)
        // These are language operators, not graph-level parallelism. Preserve
        // their short-circuit semantics so an unchosen projection/node is not
        // evaluated accidentally.
        if (expression.operator === "and" && !booleanValue(left, "and")) return false
        if (expression.operator === "or" && booleanValue(left, "or")) return true
        const right = await this.evaluate(expression.right, context)
        switch (expression.operator) {
          case "eq":
            return canonicalJson(left) === canonicalJson(right)
          case "neq":
            return canonicalJson(left) !== canonicalJson(right)
          case "gt":
            return numberValue(left, "gt") > numberValue(right, "gt")
          case "gte":
            return numberValue(left, "gte") >= numberValue(right, "gte")
          case "lt":
            return numberValue(left, "lt") < numberValue(right, "lt")
          case "lte":
            return numberValue(left, "lte") <= numberValue(right, "lte")
          case "and":
            return booleanValue(left, "and") && booleanValue(right, "and")
          case "or":
            return booleanValue(left, "or") || booleanValue(right, "or")
          case "add":
            return numberValue(left, "add") + numberValue(right, "add")
          case "concat":
            return stringValue(left, "concat") + stringValue(right, "concat")
        }
      }
    }
  }
}
