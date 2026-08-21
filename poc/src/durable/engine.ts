import { randomUUID } from "node:crypto"
import {
  assertJson,
  canonicalJson,
  digest,
  type DeploymentManifest,
  fragmentNodeIds,
  type Invocation,
  type JsonValue,
  type PlanFragment,
  type PlanNode,
  type PlanTemplate,
  type ValueExpr,
  type WorkerExit
} from "./ir.ts"
import type { BuiltDeployment } from "./provider.ts"
import { LocalWorker } from "./provider.ts"
import { ContentIntegrityError, DurableStore, type StoredNodeExit } from "./store.ts"

export class DurableActionFailure extends Error {
  constructor(
    readonly nodeId: string,
    readonly failure: JsonValue
  ) {
    super(`Durable Action ${nodeId} failed with a typed failure`)
    this.name = "DurableActionFailure"
  }
}

export class DurableActionDefect extends Error {
  constructor(
    readonly nodeId: string,
    readonly defect: JsonValue
  ) {
    super(`Durable Action ${nodeId} terminated with a defect`)
    this.name = "DurableActionDefect"
  }
}

export class DurableExecutionAlreadyFailed extends Error {
  constructor(readonly storedError: JsonValue) {
    super("Durable execution already has a terminal failure")
    this.name = "DurableExecutionAlreadyFailed"
  }
}

/** Used by the demo to model a coordinator dying after commit but before exposure. */
export class CoordinatorCrash extends Error {
  constructor(readonly nodeId: string) {
    super(`Simulated coordinator crash after adopting ${nodeId}`)
    this.name = "CoordinatorCrash"
  }
}

export interface ExecuteOptions {
  readonly executionId: string
  readonly deadline?: number
  readonly capabilityGrant?: readonly string[]
  readonly leaseMs?: number
  readonly traceContext?: Readonly<Record<string, string>>
  /** Runs after the durable terminal commit and before the result is exposed. */
  readonly afterNodeAdopted?: (nodeId: string) => void | Promise<void>
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)))

const pathValue = (value: JsonValue, path: readonly string[], description: string): JsonValue => {
  let current: JsonValue = value
  for (const part of path) {
    if (Array.isArray(current)) {
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

const stringValue = (value: JsonValue, description: string): string => {
  if (typeof value !== "string") {
    throw new DurableActionDefect(description, { _tag: "ExpressionTypeDefect", expected: "string", value })
  }
  return value
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
  }
}

interface RunContext {
  readonly executionId: string
  readonly input: JsonValue
  readonly deadline: number
  readonly capabilityGrant: readonly string[]
  readonly leaseMs: number
  readonly traceContext: Readonly<Record<string, string>>
  readonly afterNodeAdopted?: ((nodeId: string) => void | Promise<void>) | undefined
  readonly resolutions: Map<string, Promise<JsonValue>>
}

export class DurableExecutor<Input = unknown, Success = unknown> {
  readonly owner = randomUUID()
  private readonly nodes = new Map<string, PlanNode>()
  private readonly routes: Map<string, BuiltDeployment<Input, Success>["manifest"]["routes"][number]>
  private readonly workers = new Map<string, LocalWorker>()

  constructor(
    readonly deployment: BuiltDeployment<Input, Success>,
    readonly store: DurableStore
  ) {
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
    for (const pool of deployment.pools.values()) {
      this.workers.set(pool.id, new LocalWorker(pool, deployment.manifest, deployment.providers))
    }
  }

  async execute(inputValue: Input, options: ExecuteOptions): Promise<Success> {
    const input = assertJson(inputValue, "Flow input")
    const requestedDeadline = options.deadline ?? Date.now() + 60_000
    if (!Number.isSafeInteger(requestedDeadline) || requestedDeadline < 0) {
      throw new TypeError("Durable execution deadline must be a non-negative integer timestamp")
    }
    if (options.leaseMs !== undefined && (!Number.isFinite(options.leaseMs) || options.leaseMs <= 0)) {
      throw new TypeError("Durable execution leaseMs must be positive")
    }
    const stored = this.store.initializeExecution(
      options.executionId,
      this.deployment.flow.plan,
      this.deployment.manifest,
      input,
      requestedDeadline
    )
    if (stored.status === "completed") return stored.output as Success
    if (stored.status === "failed") throw new DurableExecutionAlreadyFailed(stored.error!)
    const context: RunContext = {
      executionId: options.executionId,
      input,
      // A restart cannot silently reset the execution's retry deadline.
      deadline: stored.deadline,
      capabilityGrant: Object.freeze([...(options.capabilityGrant ?? [])]),
      leaseMs: options.leaseMs ?? 2_000,
      traceContext: Object.freeze({ ...(options.traceContext ?? {}) }),
      afterNodeAdopted: options.afterNodeAdopted,
      resolutions: new Map()
    }
    try {
      // Every root declaration runs, even when its value is not the Flow output.
      await Promise.all(this.deployment.flow.plan.nodes.map((node) => this.resolveNode(node.id, context)))
      const output = await this.evaluate(this.deployment.flow.plan.output, context)
      const finished = this.store.completeExecution(options.executionId, output)
      if (finished.execution.status === "completed") return finished.execution.output as Success
      throw new DurableExecutionAlreadyFailed(finished.execution.error!)
    } catch (error) {
      if (error instanceof CoordinatorCrash) throw error // process death leaves the execution resumable
      let finished
      if (error instanceof DurableActionFailure) {
        finished = this.store.failExecution(options.executionId, "failure", error.failure)
      } else if (error instanceof DurableActionDefect) {
        finished = this.store.failExecution(options.executionId, "defect", error.defect)
      } else {
        finished = this.store.failExecution(options.executionId, "defect", {
          name: error instanceof Error ? error.name : "CoordinatorDefect",
          message: error instanceof Error ? error.message : String(error)
        })
      }
      if (!finished.changed) {
        if (finished.execution.status === "completed") return finished.execution.output as Success
        throw new DurableExecutionAlreadyFailed(finished.execution.error!)
      }
      throw error
    }
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
    if (recorded !== undefined) return fromStoredExit(nodeId, recorded)

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
      case "branch": {
        const condition = booleanValue(await this.evaluate(node.condition, context), node.id)
        const claim = await this.acquire(node.id, context)
        if (claim.kind === "terminal") return fromStoredExit(node.id, claim.exit)
        const chosen = condition ? node.whenTrue : node.whenFalse
        const skipped = condition ? node.whenFalse : node.whenTrue
        this.store.skipNodes(context.executionId, fragmentNodeIds(skipped), node.id)
        await Promise.all(chosen.nodes.map((child) => this.resolveNode(child.id, context)))
        const value = await this.evaluate(chosen.output, context)
        return this.commitControlNode(node.id, claim.fencingToken, value, context)
      }
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
            `Persisted execution deadline exceeded while waiting for ${nodeId}`
          )
        }
      }
      const claim = this.store.claimNode(context.executionId, nodeId, this.owner, context.leaseMs)
      if (claim.kind !== "busy") return claim
      await delay(Math.min(
        25,
        Math.max(1, claim.leaseExpiresAt - Date.now()),
        Math.max(1, context.deadline - Date.now())
      ))
    }
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
    if (!committed) {
      const winner = this.store.getNode(context.executionId, nodeId).exit
      if (winner !== undefined) return fromStoredExit(nodeId, winner)
      context.resolutions.delete(nodeId)
      return this.resolveNode(nodeId, context)
    }
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
    const input = await this.evaluate(node.input, context)
    const inputDigest = digest(input)
    const reuse = provider.reuse
    let reuseIdentity: { readonly kind: "memo" | "content"; readonly key: string; readonly inputDigest: string } | undefined

    if (reuse.kind === "memo") {
      const explicitKey = reuse.key(input)
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
      if (hit !== undefined) return this.adoptCacheHit(node.id, hit, `memo:${reuse.scope}:${reuse.generation}:${memoKey}`, context)
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
          return this.commitIntegrityDefect(node.id, context, error)
        }
        throw error
      }
      if (hit !== undefined) return this.adoptCacheHit(node.id, hit, `content:${contentKey}`, context)
      reuseIdentity = { kind: "content", key: contentKey, inputDigest }
    }

    while (true) {
      const acquired = await this.acquire(node.id, context)
      if (acquired.kind === "terminal") return fromStoredExit(node.id, acquired.exit)
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
        capabilityGrant: context.capabilityGrant,
        lease: { owner: this.owner, expiresAt: acquired.leaseExpiresAt },
        fencingToken: acquired.fencingToken,
        traceContext: context.traceContext
      }
      const worker = this.workers.get(route.poolId)
      if (worker === undefined) {
        throw new DurableActionDefect(node.id, { _tag: "WorkerPoolUnavailable", poolId: route.poolId })
      }
      const heartbeat = setInterval(() => {
        this.store.heartbeat(
          context.executionId,
          node.id,
          this.owner,
          acquired.fencingToken,
          Date.now() + context.leaseMs
        )
      }, Math.max(10, Math.floor(context.leaseMs / 3)))
      heartbeat.unref?.()
      let exit: WorkerExit
      const abortController = new AbortController()
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined
      try {
        const deadlineExit = new Promise<WorkerExit>((resolve) => {
          deadlineTimer = setTimeout(() => {
            abortController.abort()
            resolve({
              kind: "defect",
              defect: { name: "DeadlineExceeded", message: `Persisted deadline exceeded during ${node.actionId}` }
            })
          }, Math.max(0, context.deadline - Date.now()))
        })
        exit = await Promise.race([worker.invoke(invocation, abortController.signal), deadlineExit])
      } finally {
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
            if (winner !== undefined) return fromStoredExit(node.id, winner)
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
              if (winner !== undefined) return fromStoredExit(node.id, winner)
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
                if (winner !== undefined) return fromStoredExit(node.id, winner)
              }
              throw new DurableActionDefect(node.id, defect)
            }
            throw error
          }
        }
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
          if (winner !== undefined) return fromStoredExit(node.id, winner)
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
          await delay(retryAt - Date.now())
          continue
        }
        const winner = this.store.getNode(context.executionId, node.id).exit
        if (winner !== undefined) return fromStoredExit(node.id, winner)
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
        if (winner !== undefined) return fromStoredExit(node.id, winner)
        continue
      }
      if (exit.kind === "failure") throw new DurableActionFailure(node.id, exit.error)
      throw new DurableActionDefect(node.id, exit.defect)
    }
  }

  private async adoptCacheHit(
    nodeId: string,
    value: JsonValue,
    adoptedFrom: string,
    context: RunContext
  ): Promise<JsonValue> {
    const adopted = this.store.adoptSuccess(context.executionId, nodeId, value, adoptedFrom)
    if (!adopted) {
      const winner = this.store.getNode(context.executionId, nodeId).exit
      if (winner !== undefined) return fromStoredExit(nodeId, winner)
      context.resolutions.delete(nodeId)
      return this.resolveNode(nodeId, context)
    }
    await context.afterNodeAdopted?.(nodeId)
    return value
  }

  private async commitIntegrityDefect(
    nodeId: string,
    context: RunContext,
    error: ContentIntegrityError
  ): Promise<JsonValue> {
    const acquired = await this.acquire(nodeId, context)
    if (acquired.kind === "terminal") return fromStoredExit(nodeId, acquired.exit)
    const defect = { name: error.name, message: error.message }
    const committed = this.store.commitFailure(
      context.executionId,
      nodeId,
      this.owner,
      acquired.fencingToken,
      { kind: "defect", defect }
    )
    if (!committed) {
      const winner = this.store.getNode(context.executionId, nodeId).exit
      if (winner !== undefined) return fromStoredExit(nodeId, winner)
    }
    throw new DurableActionDefect(nodeId, defect)
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
        const [left, right] = await Promise.all([
          this.evaluate(expression.left, context),
          this.evaluate(expression.right, context)
        ])
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
