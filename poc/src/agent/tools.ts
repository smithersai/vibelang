import { validatePlanTemplate } from "../durable/artifact.ts"
import type { PlanTemplate } from "../durable/plan-ir.ts"
import type { ActionDescriptor } from "../durable/value.ts"
import { compileActionContract } from "../durable/schema.ts"
import {
  agentFunctionContractIdentity,
  defineActionFunction,
  flowContractDigest,
  snapshotFunctionTable,
} from "./bindings.ts"
import { sha256Json } from "./identity.ts"
import type {
  AgentFunction,
  AgentFunctionContext,
  AgentFunctionTable,
  Awaitable,
  ComponentIdentity,
  FlowCallIdentity,
  FlowContract,
  JsonValue,
} from "./types.ts"

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const IDENTITY_UNSAFE = /[^A-Za-z0-9$._/@:+-]/g

/**
 * The `tool or MCP operation -> typed Action -> generated-code function` step
 * of AGENT_LIBRARY.md. A tool is a host callback plus the compiler-issued
 * Action contract that describes its wire types; exposing it produces an
 * ordinary sandbox function whose RPC is schema-checked and whose calls are
 * recorded and replayed through the turn journal.
 */
export interface ActionTool<Input = JsonValue, Output = JsonValue> {
  /** Name the generated TypeScript sees on the `Functions` argument. */
  readonly exposedAs: string
  /** Exact, untampered descriptor from the durable contract compiler. */
  readonly action: ActionDescriptor
  readonly call: (input: Input, context: AgentFunctionContext) => Awaitable<Output>
  readonly description?: string
  /** Binding identity name; defaults to `action/<id>@<version>`. */
  readonly name?: string
  /**
   * Declared identity of the host callback. Required unless `identity` is
   * given: the Action contract says *what* the tool is, this says *which
   * implementation of it* this deployment bound. See `DefineFunctionOptions`.
   */
  readonly implementationId?: string
  readonly implementationVersion?: string
  readonly config?: JsonValue
  readonly identity?: ComponentIdentity
}

export interface CallableSurfaceEntry {
  readonly exposedAs: string
  /** Which compiler-derived boundary backs this member, if any. */
  readonly kind: "action" | "flow" | "legacy"
  readonly actionId: string | null
  readonly actionVersion: number | null
  readonly flowId: string | null
  readonly flowVersion: number | null
  /** The exact deployed Plan a Flow member starts or joins. */
  readonly planDigest: string | null
  readonly contractDigest: string | null
  /** Action- and Flow-backed members replay; legacy JSON-only closures never do. */
  readonly durable: boolean
}

export interface CallableSurfaceManifest {
  readonly digest: string
  readonly entries: readonly CallableSurfaceEntry[]
}

export class ActionToolContractError extends Error {
  readonly diagnostics: readonly unknown[]

  constructor(message: string, diagnostics: readonly unknown[]) {
    super(message)
    this.name = "ActionToolContractError"
    this.diagnostics = Object.freeze([...diagnostics])
  }
}

/** A Plan cannot be exposed as an agent function under its current contract. */
export class FlowToolContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FlowToolContractError"
  }
}

/**
 * The durable execution this call site is attached to is still resumable: the
 * coordinator died, the transport dropped, or the turn was torn down before a
 * terminal commit. It is deliberately *not* a Flow outcome, so the turn journal
 * never records it as a replayable result and a restarted turn re-attaches to
 * the same execution id instead of starting a second execution.
 */
export class DurableFlowInterrupted extends Error {
  readonly executionId: string

  constructor(executionId: string, cause: unknown) {
    super(
      `Durable execution ${executionId} was interrupted before a terminal outcome: ` +
        (cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)),
      { cause },
    )
    this.name = "DurableFlowInterrupted"
    this.executionId = executionId
  }
}

/**
 * Naming. This is many-to-one twice over, and it is CORRECT that way; what
 * makes it correct is not the function, so the argument lives here.
 *
 * Both losses are real. `IDENTITY_UNSAFE` folds every character outside
 * `[A-Za-z0-9$._/@:+-]` onto `-`, and `-` is itself in that set, so ids
 * `tool#read`, `tool-read` and `tool read` all mint `action/tool-read@1` — and
 * `#` is not a hypothetical, it is the separator `source-compiler.ts` puts in
 * every derived Flow and Action id. `.slice(0, 128)` then cuts `@<version>` off
 * entirely once the id passes 120 characters, so two VERSIONS of one long-named
 * Action mint one name. Nothing here compares a minted name against the ones
 * already handed out.
 *
 * Why not an escape: what this returns is one FIELD of a three-field
 * `ComponentIdentity`, and the other two are not lossy. `configDigest` folds
 * the raw, un-normalized `action.id` and `action.version` (below), so two
 * name-colliding tools still differ in the identity, and `journal.ts` compares
 * the whole `function_identity_json` rather than the name. The model never sees
 * this string either: what reaches the prompt is `exposedAs`, which is required
 * to be a TypeScript identifier and is refused outright when it is claimed
 * twice (`Action tool ... is exposed twice`). So a collision here costs a
 * human reading a journal an ambiguous label, and costs nothing else.
 *
 * And the cost of "fixing" it is not zero: `ComponentIdentity.name` is
 * PERSISTED, in `function_identity_json`, and re-derived and compared on every
 * replay. Re-escaping it would make every journal written before the change
 * diverge from every journal written after — a replay failure on real recorded
 * work, to fix a label. The lossy spelling stays, and the reason it is safe is
 * written down instead.
 *
 * There is no refusal, and that is the one part of this that is a gap rather
 * than a decision. It is not added here because a duplicate name is not an
 * error — two builds of one Action legitimately share it — so the guard would
 * have to compare identities, which is what the journal already does.
 */
function identityName(action: ActionDescriptor): string {
  const raw = `action/${action.id}@${action.version}`.replace(IDENTITY_UNSAFE, "-")
  return raw.slice(0, 128)
}

/**
 * Durable execution semantics attach to Action and Flow calls only. A binding
 * without a compiler-derived contract is an ordinary host closure: it is still
 * journaled as an observation, but it is never replayed from a recording.
 */
export function isDurableAgentFunction(fn: AgentFunction<any, any>): boolean {
  return fn.actionContract !== undefined || fn.flowContract !== undefined
}

/** Bind one compiler-issued Action descriptor as a durable sandbox function. */
export function actionTool<Input, Output>(
  action: ActionDescriptor,
  call: (input: Input, context: AgentFunctionContext) => Awaitable<Output>,
  options: Omit<ActionTool<Input, Output>, "exposedAs" | "action" | "call"> = {},
): AgentFunction<Input, Output> {
  if (
    options.identity !== undefined && (
      options.name !== undefined || options.config !== undefined ||
      options.implementationId !== undefined || options.implementationVersion !== undefined
    )
  ) {
    throw new TypeError(
      "An explicit ActionTool identity cannot be combined with name/config/implementation identity",
    )
  }
  return defineActionFunction<Input, Output>(
    action,
    call,
    options.description,
    options.identity !== undefined
      ? { identity: options.identity }
      : {
        name: options.name ?? identityName(action),
        ...(options.implementationId === undefined ? {} : { implementationId: options.implementationId }),
        ...(options.implementationVersion === undefined
          ? {}
          : { implementationVersion: options.implementationVersion }),
        config: {
          schema: "smithers.agent.action-tool/v1",
          actionId: action.id,
          actionVersion: action.version,
          config: options.config ?? null,
        },
      },
  )
}

/**
 * Compile a tool's Action contract from Smithers Action source and bind it in
 * one step. This is the whole tool adapter: nothing about the sandbox, the
 * journal, or the prompt is tool-protocol specific.
 */
export function compileActionTool<Input, Output>(
  options: {
    readonly source: string
    readonly exportName: string
    readonly id: string
    readonly version: number
    readonly fileName?: string
  } & Omit<ActionTool<Input, Output>, "exposedAs" | "action" | "call">,
  call: (input: Input, context: AgentFunctionContext) => Awaitable<Output>,
): AgentFunction<Input, Output> {
  const compiled = compileActionContract(options.source, {
    ...(options.fileName === undefined ? {} : { fileName: options.fileName }),
    exportName: options.exportName,
    id: options.id,
    version: options.version,
  })
  if (!compiled.ok) {
    throw new ActionToolContractError(
      `Action contract for ${options.id} did not compile: ${compiled.diagnostics
        .map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`)
        .join("; ")}`,
      compiled.diagnostics,
    )
  }
  const { source: _source, exportName: _exportName, id: _id, version: _version, fileName: _fileName, ...rest } = options
  return actionTool<Input, Output>(compiled.descriptor, call, rest)
}

/**
 * Project the agent-facing Flow contract out of a compiled Plan. The Plan is
 * revalidated here — the same validation the durable store performs before it
 * pins an execution to it — and its compiler-derived Flow schemas become the
 * generated-code signature and the sandbox RPC codec.
 */
export function flowContractFromPlan(plan: PlanTemplate): FlowContract {
  let validated: PlanTemplate
  try {
    validated = validatePlanTemplate(plan)
  } catch (error) {
    throw new FlowToolContractError(
      `Flow Plan is not a valid durable Plan artifact: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const schemas = validated.flowSchemas
  if (schemas === undefined) {
    throw new FlowToolContractError(
      `Flow ${validated.flowId} has no compiler-derived Flow schemas; a legacy Plan artifact cannot be exposed`,
    )
  }
  for (const [role, schema] of [["input", schemas.input], ["success", schemas.success]] as const) {
    if (schema.shape !== "structural" || schema.source !== "compiler-derived") {
      throw new FlowToolContractError(
        `Flow ${validated.flowId} ${role} schema must be compiler-derived and structural to cross the sandbox RPC`,
      )
    }
  }
  const contract = {
    flowId: validated.flowId,
    flowVersion: validated.flowVersion,
    planDigest: validated.digest,
    inputSchema: schemas.input as FlowContract["inputSchema"],
    successSchema: schemas.success as FlowContract["successSchema"],
    ...(schemas.error === undefined ? {} : { errorSchema: schemas.error }),
  }
  return Object.freeze({ ...contract, contractDigest: flowContractDigest(contract) })
}

/**
 * Deterministic durable execution id for one Flow call site.
 *
 * The id is derived, never chosen: turn identity, accepted-source digest, call
 * site (function name plus per-site ordinal), deployed Plan digest, and input
 * digest. Replaying the same turn therefore joins the prior execution, while a
 * changed input or Plan produces a distinct execution.
 */
export function flowExecutionId(identity: Omit<FlowCallIdentity, "executionId">): string {
  return `turnflow_${sha256Json({
    schema: "smithers.agent.flow-execution-id/v1",
    turnId: identity.turnId,
    sourceDigest: identity.sourceDigest,
    functionName: identity.functionName,
    ordinal: identity.ordinal,
    flowId: identity.flowId,
    flowVersion: identity.flowVersion,
    planDigest: identity.planDigest,
    inputDigest: identity.inputDigest,
  })}`
}

/** Compiled Plan plus wiring that starts or joins one durable execution. */
export interface DurableFlowBinding {
  readonly plan: PlanTemplate
  execute(input: unknown, options: { readonly executionId: string }): Awaitable<unknown>
}

export interface DeployedFlowExecutor {
  readonly deployment: { readonly flow: { readonly plan: PlanTemplate } }
  execute(input: unknown, options: { readonly executionId: string }): Awaitable<unknown>
}

export type FlowToolTarget = DurableFlowBinding | DeployedFlowExecutor

export interface FlowToolOptions {
  readonly description?: string
  /** Binding identity name; defaults to `flow/<id>@<version>`. */
  readonly name?: string
  /**
   * Declared identity of the wiring that starts or joins the Plan. Required
   * unless `identity` is given. See `DefineFunctionOptions`.
   */
  readonly implementationId?: string
  readonly implementationVersion?: string
  readonly config?: JsonValue
  readonly identity?: ComponentIdentity
}

/** Assemble a validated function table from a set of exposed tools. */
export function actionToolTable(tools: readonly ActionTool<any, any>[]): AgentFunctionTable {
  const table: Record<string, AgentFunction<any, any>> = Object.create(null) as Record<string, AgentFunction<any, any>>
  for (const tool of tools) {
    if (typeof tool.exposedAs !== "string" || !IDENTIFIER.test(tool.exposedAs)) {
      throw new Error(`Action tool name is not a TypeScript identifier: ${String(tool.exposedAs)}`)
    }
    if (Object.hasOwn(table, tool.exposedAs)) {
      throw new Error(`Action tool ${tool.exposedAs} is exposed twice`)
    }
    const { exposedAs: _exposedAs, action, call, ...rest } = tool
    table[tool.exposedAs] = actionTool(action, call, rest)
  }
  return snapshotFunctionTable(table)
}

/**
 * The callable surface's durable manifest: which members carry durable
 * semantics, under which Action or Flow identity, contract digest, and — for a
 * Flow — the exact deployed Plan digest. Journaled with the turn so a replay
 * can prove it ran against the same deployment.
 */
export function callableSurfaceManifest(functions: AgentFunctionTable): CallableSurfaceManifest {
  const snapshot = snapshotFunctionTable(functions)
  const entries = Object.entries(snapshot).map(([exposedAs, fn]) => {
    const action = fn.actionContract
    const flow = fn.flowContract
    return Object.freeze({
      exposedAs,
      kind: action !== undefined ? "action" as const : flow !== undefined ? "flow" as const : "legacy" as const,
      actionId: action?.id ?? null,
      actionVersion: action?.version ?? null,
      flowId: flow?.flowId ?? null,
      flowVersion: flow?.flowVersion ?? null,
      planDigest: flow?.planDigest ?? null,
      contractDigest: action?.contractDigest ?? flow?.contractDigest ?? null,
      durable: isDurableAgentFunction(fn),
    })
  })
  return Object.freeze({
    digest: sha256Json({
      schema: "smithers.agent.callable-manifest/v2",
      entries: entries.map((entry) => ({
        exposedAs: entry.exposedAs,
        kind: entry.kind,
        actionId: entry.actionId,
        actionVersion: entry.actionVersion,
        flowId: entry.flowId,
        flowVersion: entry.flowVersion,
        planDigest: entry.planDigest,
        contractDigest: entry.contractDigest,
        durable: entry.durable,
        contract: agentFunctionContractIdentity(snapshot[entry.exposedAs]),
      })),
    }),
    entries: Object.freeze(entries),
  })
}
