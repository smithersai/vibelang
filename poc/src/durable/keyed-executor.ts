/**
 * Authenticated provider execution at the scheduler's NodeExecutor seam.
 * This module owns node meaning, not approval, readiness, caching or commits.
 * A host must perform admission before calling this low-level worker API.
 * No Effect/runtime package or alternate source compiler is embedded here.
 */
import { types } from "node:util"
import { requireAuthenticatedKeyedInvocation, requireAuthenticatedKeyedSourceDeployment,
  requireKeyedWorkerRuntime, type AuthenticatedKeyedInvocation } from "./keyed-deployment.ts"
import { KeyedSourceEvaluationError, type KeyedSourceInterpreter, type KeyedResolvedInput, type PreparedKeyedNode } from "./keyed-interpreter.ts"
import { decodeKeyedValue, encodeKeyedValue, snapshotKeyedJSON, type KeyedValue } from "./keyed-value.ts"
import { keyedBundleInvocationDriver } from "./pool-bundle.ts"
import { canonicalJson, deepFreeze, type JsonValue } from "./value.ts"
import {requireKeyedControlReservation,type KeyedControl,type KeyedControlTicket} from "./keyed-control.ts"

type Row = Record<string, unknown>

/** Ref-only inputs, exactly as supplied by the reference NodeExecutor seam.
 * `node` must match the COMPLETE authenticated Plan node, not just its id/key.
 * A boundary is measured by the scheduler; this worker accepts no filesystem
 * authority until the corresponding provider adapter exists. */
export interface KeyedNodeWork {
  readonly node: unknown
  readonly attempt: number
  readonly boundary: {
    readonly boundaryMode: string
    readonly readSet: readonly unknown[]
    readonly writeSet: readonly unknown[]
    readonly removes?: readonly unknown[]
  }
  readonly inputs: readonly KeyedResolvedInput[]
}

export type KeyedNodeExit =
  | {readonly kind: "success"; readonly value: KeyedValue}
  | {readonly kind: "failure"; readonly error: KeyedValue}
  | {readonly kind: "defect"; readonly defect: {readonly name: string; readonly message: string; readonly stack?: string}}
  | {readonly kind: "interrupted"}

export class KeyedNodeExecutionError extends TypeError {
  constructor(message: string) { super(message); this.name = "KeyedNodeExecutionError" }
}
function fail(message: string): never { throw new KeyedNodeExecutionError(message) }
function object(value: unknown, label: string): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`)
  return value as Row
}
function exact(value: Row, names: readonly string[], label: string): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...names].sort())) fail(`${label} has missing or unknown fields`)
}
const defect = (name: string, message: string): KeyedNodeExit => deepFreeze({kind: "defect", defect: {name, message}})
const interrupted: KeyedNodeExit = Object.freeze({kind: "interrupted"})

/** @internal Pure worker-protocol decoding. Never canonicalize raw author
 * objects before encoding them: their insertion order is observable data. */
export function decodeKeyedNodeExit(interpreter: KeyedSourceInterpreter, id: string, raw: unknown): KeyedNodeExit {
  try {
    const exit = object(snapshotKeyedJSON(raw), "keyed worker exit")
    if (exit.kind === "success") {
      exact(exit, ["kind", "value"], "keyed worker success")
      return deepFreeze({kind: "success", value: interpreter.encodeSuccess(id, decodeKeyedValue(exit.value))})
    }
    if (exit.kind === "failure") {
      exact(exit, ["kind", "error"], "keyed worker failure")
      return deepFreeze({kind: "failure", error: interpreter.encodeFailure(id, decodeKeyedValue(exit.error))})
    }
    if (exit.kind === "defect") {
      exact(exit, ["kind", "defect"], "keyed worker defect")
      const value = object(exit.defect, "keyed worker defect payload")
      exact(value, ["name", "message", ...(Object.hasOwn(value, "stack") ? ["stack"] : [])], "keyed worker defect payload")
      if (typeof value.name !== "string" || typeof value.message !== "string" ||
        Object.hasOwn(value, "stack") && typeof value.stack !== "string") fail("keyed worker defect requires string fields")
      return deepFreeze({kind: "defect", defect: {name: value.name, message: value.message,
        ...(typeof value.stack === "string" ? {stack: value.stack} : {})}})
    }
    fail("unknown keyed worker exit kind")
  } catch {
    return defect("KeyedWorkerProtocolDefect", "worker exit does not satisfy its keyed protocol or declared contract")
  }
}

export interface AuthenticatedKeyedNodeWorker {
  /** Invocation identity for inspection, not an approval or durable receipt. */
  readonly planId: string
  readonly planDigest: string
  readonly executionDigest: string
  /** Fresh, local dependency-demand state. Its tickets are not durable receipts
   * or authority to bypass host approval, attempts, fencing or cancellation. */
  readonly createControl: () => KeyedControl
  readonly execute: (work: KeyedNodeWork, options?: {readonly signal?: AbortSignal}) => Promise<KeyedNodeExit>
  /** Required for a graph with branches. Only a live reservation from this
   * worker's control instance can choose the runtime dependency subset. */
  readonly executeControlled: (control:KeyedControl,ticket:KeyedControlTicket,work:KeyedNodeWork,
    options?:{readonly signal?:AbortSignal}) => Promise<KeyedNodeExit>
}

/** Build the provider side of the execution seam from local authentication
 * proofs. Persisted copies and caller-selected code/runtimes cannot substitute.
 * The hosting scheduler maps success/failure/defect/interruption to its own
 * effect channels and retains all ownership, attempt and journal authority. */
export function createAuthenticatedKeyedNodeWorker(invocation: AuthenticatedKeyedInvocation): AuthenticatedKeyedNodeWorker {
  const issued = requireAuthenticatedKeyedInvocation(invocation)
  const {deployment, runtime} = requireAuthenticatedKeyedSourceDeployment(issued.source)
  const local = requireKeyedWorkerRuntime(runtime), interpreter = issued.interpreter
  const plan = JSON.parse(interpreter.planJson) as {nodes: Row[]}
  const nodes = new Map(plan.nodes.map(node => [node.id as string, canonicalJson(node as JsonValue)]))
  const providers = new Map(deployment.providers.map(provider => [provider.actionId, provider]))
  const bundles = new Map(deployment.bundles.map(bundle => [bundle.digest, bundle]))
  const controls=new WeakSet<KeyedControl>(),running=new WeakSet<KeyedControlTicket>()
  const branching=interpreter.nodes.some(node=>node.operation==="branch")
  const execute=async (work:KeyedNodeWork,options:{readonly signal?:AbortSignal}={},selection?:KeyedControlTicket):Promise<KeyedNodeExit>=>{
      // Snapshot BEFORE any await or property access: caller mutation, getters
      // or proxies must not change the material after it has been compared.
      const request = object(snapshotKeyedJSON(work), "keyed node work")
      exact(request, ["node", "attempt", "boundary", "inputs"], "keyed node work")
      const node = object(request.node, "keyed node")
      if (typeof node.id !== "string" || nodes.get(node.id) !== canonicalJson(node as JsonValue)) fail("node differs from the authenticated invocation")
      if(selection&&selection.nodeId!==node.id)fail("work does not match its live demand reservation")
      if (!Number.isSafeInteger(request.attempt) || (request.attempt as number) < 1) fail("node attempt must be a positive safe integer")
      const boundary = object(request.boundary, "keyed node boundary")
      exact(boundary, ["boundaryMode", "readSet", "writeSet", ...(Object.hasOwn(boundary, "removes") ? ["removes"] : [])], "keyed node boundary")
      if (boundary.boundaryMode !== "hard" || [boundary.readSet, boundary.writeSet, Object.hasOwn(boundary,"removes") ? boundary.removes : []]
        .some(value => !Array.isArray(value) || value.length !== 0)) fail("keyed worker requires an empty hard filesystem boundary")
      if (options === null || typeof options !== "object" || types.isProxy(options)) fail("keyed worker requires inert execution options")
      const descriptors = Object.getOwnPropertyDescriptors(options)
      if (Reflect.ownKeys(options).some(key => key !== "signal") || descriptors.signal && !("value" in descriptors.signal)) fail("keyed worker has unknown or accessor execution options")
      const signal = descriptors.signal?.value as AbortSignal | undefined
      if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("keyed worker cancellation requires a local AbortSignal")
      let prepared: PreparedKeyedNode
      try {prepared = selection ? interpreter.prepareSelected(node.id,request.inputs as unknown as readonly KeyedResolvedInput[],selection.dependencies)
        : interpreter.prepare(node.id, request.inputs as unknown as readonly KeyedResolvedInput[])} catch(error) {
        // Authored pure computation defects are node outcomes. Malformed Ref
        // evidence or worker authority remains a rejected protocol request.
        if(error instanceof KeyedSourceEvaluationError)return signal?.aborted ? interrupted : defect(error.name,error.message)
        throw error
      }
      if (signal?.aborted) return interrupted
      if (prepared.operation === "result") return deepFreeze({kind: "success", value: prepared.value})
      const provider = providers.get(prepared.contract.id), bundle = provider && bundles.get(provider.bundleDigest)
      if (!provider || !bundle || provider.implementation.implementationId !== prepared.implementationId ||
        bundle.digest !== prepared.implementationDigest || canonicalJson(provider.action) !== canonicalJson(prepared.contract)) fail("node has no matching authenticated provider")
      const payload = {actionId: prepared.contract.id, actionVersion: prepared.contract.version,
        actionContractDigest: prepared.contract.contractDigest, input: encodeKeyedValue(prepared.input)}
      let execution: Awaited<ReturnType<typeof local.execute>>
      try {
        execution = await local.execute(bundle.javascript + keyedBundleInvocationDriver(canonicalJson(payload)), {},
          {sourceDigest: bundle.digest, turnId: canonicalJson([invocation.planId, node.id, request.attempt as number]), ...(signal ? {signal} : {})})
      } catch {
        return signal?.aborted ? interrupted : defect("KeyedWorkerRuntimeDefect", "the authenticated runtime failed before producing a worker exit")
      }
      if (signal?.aborted) return interrupted
      if (!execution.ok) {
        // The sandbox serializes host/runtime errors independently of provider
        // failure data. Reuse exact defect decoding; unknown fields are omitted.
        const error = execution.error
        return decodeKeyedNodeExit(interpreter, node.id, {kind: "defect", defect: {
          name: error?.name ?? "KeyedWorkerRuntimeDefect", message: error?.message ?? "keyed worker execution failed",
          ...(error?.stack === undefined ? {} : {stack: error.stack}),
        }})
      }
      return decodeKeyedNodeExit(interpreter, node.id, execution.result)
  }
  return Object.freeze({planId:invocation.planId,planDigest:invocation.planDigest,executionDigest:invocation.executionDigest,
    createControl:()=>{const control=interpreter.createControl();controls.add(control);return control},
    execute:async(work:KeyedNodeWork,options?:{readonly signal?:AbortSignal})=>{
      if(branching)fail("a branch graph requires controlled execution; an eager node sweep is unsafe")
      return execute(work,options)
    },
    executeControlled:async(control:KeyedControl,ticket:KeyedControlTicket,work:KeyedNodeWork,options?:{readonly signal?:AbortSignal})=>{
      if(!controls.has(control))fail("demand control was not issued by this authenticated worker")
      const selected=requireKeyedControlReservation(control,ticket)
      if(running.has(selected))fail("demand reservation already has an executing attempt")
      running.add(selected)
      try {
        const exit=await execute(work,options,selected)
        try {requireKeyedControlReservation(control,ticket)} catch {return interrupted}
        return exit
      } finally {running.delete(selected)}
    },
  })
}
