import {
  DurableActionDefect,
  DurableActionFailure,
  DurableExecutionAlreadyFailed,
  DurableExecutionCancelled,
} from "../durable/engine.ts"
import type { PlanTemplate } from "../durable/ir.ts"
import { defineFlowFunction } from "./bindings.ts"
import {
  DurableFlowInterrupted,
  flowContractFromPlan,
  flowExecutionId,
  type DeployedFlowExecutor,
  type DurableFlowBinding,
  type FlowToolOptions,
  type FlowToolTarget,
} from "./tools.ts"
import type {
  AgentFunction,
  AgentFunctionContext,
  FlowAttachment,
  FlowCallIdentity,
  FlowContract,
  JsonValue,
} from "./types.ts"

const IDENTITY_UNSAFE = /[^A-Za-z0-9$._/@:+-]/g

function flowIdentityName(contract: FlowContract): string {
  const raw = `flow/${contract.flowId}@${contract.flowVersion}`.replace(IDENTITY_UNSAFE, "-")
  return raw.slice(0, 128)
}

function flowTargetOf(
  target: FlowToolTarget,
): { readonly plan: PlanTemplate; readonly execute: DurableFlowBinding["execute"] } {
  if (target === null || typeof target !== "object") {
    throw new TypeError("A Flow tool needs a compiled Plan and its executor wiring")
  }
  const candidate = target as Partial<DurableFlowBinding> & Partial<DeployedFlowExecutor>
  const plan = candidate.plan ?? candidate.deployment?.flow?.plan
  if (plan === undefined || typeof candidate.execute !== "function") {
    throw new TypeError("A Flow tool needs a compiled Plan and an execute(input, { executionId }) entry point")
  }
  return { plan, execute: candidate.execute.bind(target) }
}

/**
 * A terminal durable outcome the execution has already committed. Anything
 * else that escapes the executor left the execution resumable.
 */
function isTerminalFlowOutcome(error: unknown): boolean {
  return error instanceof DurableActionFailure ||
    error instanceof DurableActionDefect ||
    error instanceof DurableExecutionAlreadyFailed ||
    error instanceof DurableExecutionCancelled
}

/**
 * Expose a compiled durable Flow as an agent function.
 *
 * The generated-code signature comes from the Plan's compiler-derived Flow
 * schemas, so the sandbox validates the input against the same schema the
 * executor would — invalid input never reaches the durable store. A call then
 * starts or joins the execution named by `flowExecutionId` and awaits its
 * terminal outcome: the success value crosses back through the schema-checked
 * RPC path, and a typed Flow failure, defect, or cancellation crosses the
 * sandbox's structured error channel.
 */
export function flowTool<Input = JsonValue, Success = JsonValue>(
  target: FlowToolTarget,
  options: FlowToolOptions = {},
): AgentFunction<Input, Success> {
  if (options.identity !== undefined && (options.name !== undefined || options.config !== undefined)) {
    throw new TypeError("An explicit FlowTool identity cannot be combined with name/config")
  }
  const { plan, execute } = flowTargetOf(target)
  const contract = flowContractFromPlan(plan)

  const invoke = async (input: Input, context: AgentFunctionContext): Promise<Success> => {
    const identity: FlowCallIdentity = Object.freeze({
      turnId: context.turnId,
      sourceDigest: context.sourceDigest,
      functionName: context.functionName,
      ordinal: context.ordinal,
      flowId: contract.flowId,
      flowVersion: contract.flowVersion,
      planDigest: contract.planDigest,
      inputDigest: context.inputDigest,
      executionId: flowExecutionId({
        turnId: context.turnId,
        sourceDigest: context.sourceDigest,
        functionName: context.functionName,
        ordinal: context.ordinal,
        flowId: contract.flowId,
        flowVersion: contract.flowVersion,
        planDigest: contract.planDigest,
        inputDigest: context.inputDigest,
      }),
    })
    const journal = context.journal
    // Commit the attachment before any durable work starts. A replay of this
    // call site under a different input or a different deployed Plan fails
    // closed here instead of quietly starting a second execution.
    const attachment: FlowAttachment | undefined = journal?.attachFlowCall === undefined
      ? undefined
      : await journal.attachFlowCall(identity)
    await journal?.append({
      type: "flow.attached",
      turnId: identity.turnId,
      sourceDigest: identity.sourceDigest,
      functionName: identity.functionName,
      callId: context.callId,
      ordinal: identity.ordinal,
      details: {
        executionId: identity.executionId,
        flowId: identity.flowId,
        flowVersion: identity.flowVersion,
        planDigest: identity.planDigest,
        inputDigest: identity.inputDigest,
        contractDigest: contract.contractDigest,
        attachment: attachment?.attachment ?? "unjournaled",
      },
    })
    try {
      // The success value is revalidated against the Flow success schema by the
      // sandbox before it re-enters generated code, exactly like an Action's.
      return await execute(input, { executionId: identity.executionId }) as Success
    } catch (error) {
      if (isTerminalFlowOutcome(error)) throw error
      throw new DurableFlowInterrupted(identity.executionId, error)
    }
  }

  return defineFlowFunction<Input, Success>(
    contract,
    invoke,
    options.description,
    options.identity !== undefined
      ? { identity: options.identity }
      : {
        name: options.name ?? flowIdentityName(contract),
        config: {
          schema: "vibelang.agent.flow-tool/v1",
          flowId: contract.flowId,
          flowVersion: contract.flowVersion,
          planDigest: contract.planDigest,
          config: options.config ?? null,
        },
      },
  )
}
