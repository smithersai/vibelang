import type {
  AgentFunction,
  AgentFunctionContext,
  AgentFunctionTable,
  Awaitable,
  ComponentIdentity,
  FlowContract,
  JsonValue,
} from "./types.ts"
import type {
  ActionDescriptor,
  DurableSchema,
  DurableTypeDescriptor,
  StructuralDurableSchema,
} from "../durable/ir.ts"
import { validateActionContractDescriptor, validateDurableSchema } from "../durable/schema.ts"
import {
  defineComponentIdentity,
  functionArtifactDigest,
  sha256Json,
  snapshotComponentIdentity,
} from "./identity.ts"

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const SHA256 = /^[a-f0-9]{64}$/

export interface DefineFunctionOptions {
  /** Stable binding name; defaults to the declared implementation id. */
  readonly name?: string
  /**
   * Declared identity of the host callback — *which* implementation this is.
   *
   * It is required (unless a fully explicit `identity` is supplied) for the
   * same reason `ActionProvider` requires it in `../durable/provider.ts`: a
   * JavaScript function object carries no resolvable identity. `toString()`
   * cannot see the state the callback captures, so two deployments over
   * different projects produce byte-identical source text. Deriving identity
   * from that text makes them one component, and a durable journal will answer
   * one deployment's call with the other's recorded result.
   */
  readonly implementationId?: string
  /** Declared version of that implementation; bump it when behavior changes. */
  readonly implementationVersion?: string
  /** Closure/configuration data that affects behavior but is absent from toString(). */
  readonly config?: JsonValue
  /** Fully explicit identity for build systems that already hash their artifact. */
  readonly identity?: ComponentIdentity
  /** Compiler-derived input/success wire schemas and their complete Action identity. */
  readonly actionContract?: ActionDescriptor
  /** Compiler-derived Flow wire schemas, Plan digest, and Flow identity. */
  readonly flowContract?: FlowContract
}

export type DefineActionFunctionOptions = Omit<DefineFunctionOptions, "actionContract" | "flowContract">

export type DefineFlowFunctionOptions = DefineActionFunctionOptions

function snapshotActionContract(value: unknown, path: string): ActionDescriptor {
  let contract: ActionDescriptor
  try {
    contract = validateActionContractDescriptor(value)
  } catch (error) {
    throw new TypeError(
      `${path} is not a valid compiler-derived Action contract: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  for (const [role, schema] of [
    ["input", contract.inputSchema],
    ["success", contract.successSchema],
    ["error", contract.errorSchema],
  ] as const) {
    if (schema.shape !== "structural" || schema.source !== "compiler-derived") {
      throw new TypeError(`${path} ${role} schema must be compiler-derived and structural`)
    }
  }
  return contract
}

function structuralSchemaOf(
  value: unknown,
  role: "input" | "success",
  path: string,
): StructuralDurableSchema {
  let schema: DurableSchema
  try {
    schema = validateDurableSchema(value, role, `${path} ${role} schema`)
  } catch (error) {
    throw new TypeError(
      `${path} ${role} schema is not a valid durable schema: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  if (schema.shape !== "structural" || schema.source !== "compiler-derived") {
    throw new TypeError(`${path} ${role} schema must be compiler-derived and structural`)
  }
  return schema
}

/**
 * Canonical Flow contract digest. It covers the Flow identity, the exact
 * deployed Plan, and the complete Flow schemas, so a redeployed Plan or a
 * drifted schema is a different contract rather than a silent substitution.
 */
export function flowContractDigest(contract: Omit<FlowContract, "contractDigest">): string {
  return sha256Json({
    schema: "smithers.agent.flow-contract/v1",
    flowId: contract.flowId,
    flowVersion: contract.flowVersion,
    planDigest: contract.planDigest,
    inputSchema: contract.inputSchema as unknown as JsonValue,
    successSchema: contract.successSchema as unknown as JsonValue,
    errorSchema: (contract.errorSchema ?? null) as unknown as JsonValue,
  })
}

function snapshotFlowContract(value: unknown, path: string): FlowContract {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object`)
  }
  const record = value as Record<string, unknown>
  const keys = Reflect.ownKeys(record)
  if (keys.some((key) => typeof key !== "string") || !keys.every((key) =>
    typeof key === "string" && [
      "flowId", "flowVersion", "planDigest", "contractDigest", "inputSchema", "successSchema", "errorSchema",
    ].includes(key))) {
    throw new TypeError(`${path} has unsupported fields`)
  }
  for (const required of ["flowId", "flowVersion", "planDigest", "contractDigest", "inputSchema", "successSchema"]) {
    if (!keys.includes(required)) throw new TypeError(`${path} is missing ${required}`)
  }
  const { flowId, flowVersion, planDigest, contractDigest } = record
  if (typeof flowId !== "string" || flowId.trim() === "" || flowId.length > 256) {
    throw new TypeError(`${path} flowId must be a bounded non-empty string`)
  }
  if (!Number.isSafeInteger(flowVersion) || (flowVersion as number) < 0) {
    throw new TypeError(`${path} flowVersion must be a non-negative safe integer`)
  }
  if (typeof planDigest !== "string" || !SHA256.test(planDigest)) {
    throw new TypeError(`${path} planDigest must be a lowercase SHA-256 digest`)
  }
  const errorSchema = record.errorSchema === undefined || record.errorSchema === null
    ? undefined
    : validateDurableSchema(record.errorSchema, "error", `${path} error schema`)
  const contract: Omit<FlowContract, "contractDigest"> = {
    flowId,
    flowVersion: flowVersion as number,
    planDigest,
    inputSchema: structuralSchemaOf(record.inputSchema, "input", path),
    successSchema: structuralSchemaOf(record.successSchema, "success", path),
    ...(errorSchema === undefined ? {} : { errorSchema }),
  }
  const expected = flowContractDigest(contract)
  if (contractDigest !== expected) {
    throw new TypeError(`${path} contractDigest does not match its Flow identity and schemas`)
  }
  return Object.freeze({ ...contract, contractDigest: expected })
}

function descriptorTypeScript(descriptor: DurableTypeDescriptor): string {
  switch (descriptor.kind) {
    case "null": return "null"
    case "boolean": return "boolean"
    case "number": return "number"
    case "string": return "string"
    case "literal": return JSON.stringify(descriptor.value)
    case "array": return `readonly (${descriptorTypeScript(descriptor.element)})[]`
    case "tuple": return `readonly [${descriptor.items.map(descriptorTypeScript).join(", ")}]`
    case "object": return `{ ${descriptor.fields.map((field) =>
      `readonly ${JSON.stringify(field.name)}${field.optional ? "?" : ""}: ${descriptorTypeScript(field.value)}`
    ).join("; ")} }`
    case "union": return descriptor.variants
      .map((variant) => `(${descriptorTypeScript(variant)})`)
      .join(" | ")
    case "error": return `{ readonly version: 1; readonly identity: ${JSON.stringify(descriptor.identity)}; readonly payload: ${descriptorTypeScript(descriptor.payload)} }`
  }
}

function actionFunctionSignature(contract: ActionDescriptor): string {
  const input = contract.inputSchema
  const output = contract.successSchema
  if (input.shape !== "structural" || output.shape !== "structural") {
    throw new TypeError("Agent function Action contract must contain structural input and success schemas")
  }
  return `(input: ${descriptorTypeScript(input.descriptor)}) => Promise<${descriptorTypeScript(output.descriptor)}>`
}

/**
 * The generated-code-facing signature of a Flow binding, derived from the same
 * compiler-derived Plan schemas the durable executor validates against. It is
 * asynchronous for the same reason an Action binding is: the call crosses the
 * sandbox RPC boundary, and here it additionally awaits a durable execution.
 */
function flowFunctionSignature(contract: FlowContract): string {
  return `(input: ${descriptorTypeScript(contract.inputSchema.descriptor)}) => ` +
    `Promise<${descriptorTypeScript(contract.successSchema.descriptor)}>`
}

/** The signature a binding's compiler-derived contract requires, if it has one. */
function contractSignature(
  actionContract: ActionDescriptor | undefined,
  flowContract: FlowContract | undefined,
): string | undefined {
  if (actionContract !== undefined) return actionFunctionSignature(actionContract)
  if (flowContract !== undefined) return flowFunctionSignature(flowContract)
  return undefined
}

export function agentFunctionContractIdentity(fn: AgentFunction<any, any>): JsonValue {
  const contract = fn.actionContract
  if (contract !== undefined) {
    return {
      mode: "compiler-derived",
      actionId: contract.id,
      actionVersion: contract.version,
      contractDigest: contract.contractDigest,
      inputSchemaDigest: contract.inputSchema.digest,
      outputSchemaDigest: contract.successSchema.digest,
      errorSchemaDigest: contract.errorSchema.digest,
    }
  }
  const flow = fn.flowContract
  if (flow !== undefined) {
    return {
      mode: "compiler-derived-flow",
      flowId: flow.flowId,
      flowVersion: flow.flowVersion,
      planDigest: flow.planDigest,
      contractDigest: flow.contractDigest,
      inputSchemaDigest: flow.inputSchema.digest,
      outputSchemaDigest: flow.successSchema.digest,
      errorSchemaDigest: flow.errorSchema?.digest ?? null,
    }
  }
  return { mode: "legacy-json-only" }
}

/**
 * The deployment's declaration of *which* implementation a host callback is.
 *
 * This is deliberately the same rule `makeProvider` applies in
 * `../durable/provider.ts` — "needs explicit implementation identity and
 * version" — and for the same reason. A durable journal answers a replayed
 * call from a recording keyed by component identity, so identity must be a
 * *claim the deployment makes*, never something the library sniffs off the
 * function object. `Function.prototype.toString()` sees only source text: it
 * is blind to captured closure state, and it is the constant
 * `"function x() { [native code] }"` for every bound function. Both make two
 * behaviourally different deployments indistinguishable.
 *
 * The declaration is folded into the binding's `configDigest`; the source-text
 * digest remains in `artifactDigest` as a strictly additional discriminator
 * (it can split an identity that should have been split, but it can no longer
 * be the only thing keeping two deployments apart).
 */
function declaredImplementation(options: DefineFunctionOptions): {
  readonly implementationId: string
  readonly implementationVersion: string
} {
  const { implementationId, implementationVersion } = options
  if (
    typeof implementationId !== "string" || implementationId.trim() === "" ||
    typeof implementationVersion !== "string" || implementationVersion.trim() === ""
  ) {
    throw new TypeError(
      "Agent function needs explicit implementation identity and version " +
        "(implementationId + implementationVersion), or a fully explicit identity. " +
        "A host callback's identity cannot be derived from its source text: " +
        "toString() cannot see the state the callback captures, so two different " +
        "deployments would share a turn id and replay each other's recorded results.",
    )
  }
  return { implementationId: implementationId.trim(), implementationVersion: implementationVersion.trim() }
}

export function defineFunction<Input, Output>(
  signature: string,
  invoke: (input: Input, context: AgentFunctionContext) => Awaitable<Output>,
  description?: string,
  options: DefineFunctionOptions = {},
): AgentFunction<Input, Output> {
  if (typeof signature !== "string") throw new TypeError("Agent function signature must be a string")
  const stableSignature = signature.trim()
  if (!stableSignature.startsWith("(")) {
    throw new Error(`Agent function signature must be a function type, got: ${signature}`)
  }
  if (typeof invoke !== "function") throw new TypeError("Agent function invoke must be callable")
  if (description !== undefined && typeof description !== "string") {
    throw new TypeError("Agent function description must be a string")
  }
  if (
    options.identity && (
      options.name !== undefined || options.config !== undefined ||
      options.implementationId !== undefined || options.implementationVersion !== undefined
    )
  ) {
    throw new TypeError(
      "Explicit AgentFunction identity cannot be combined with name/config/implementation identity",
    )
  }
  if (options.actionContract !== undefined && options.flowContract !== undefined) {
    throw new TypeError("An agent function carries either an Action contract or a Flow contract, never both")
  }
  const actionContract = options.actionContract === undefined
    ? undefined
    : snapshotActionContract(options.actionContract, "Agent function Action contract")
  const flowContract = options.flowContract === undefined
    ? undefined
    : snapshotFlowContract(options.flowContract, "Agent function Flow contract")
  const required = contractSignature(actionContract, flowContract)
  if (required !== undefined && stableSignature !== required) {
    throw new TypeError("Agent function signature does not exactly match its compiler-derived contract")
  }
  const declared = options.identity ? undefined : declaredImplementation(options)
  const identity = options.identity
    ? snapshotComponentIdentity(options.identity, "AgentFunction identity")
    : defineComponentIdentity({
        name: options.name ?? declared!.implementationId,
        artifactDigest: functionArtifactDigest(invoke),
        configDigest: sha256Json({
          schema: "smithers.agent.binding-identity/v2",
          implementationId: declared!.implementationId,
          implementationVersion: declared!.implementationVersion,
          signature: stableSignature,
          description: description ?? null,
          config: options.config ?? null,
          contract: actionContract !== undefined
            ? {
                mode: "compiler-derived",
                contractDigest: actionContract.contractDigest,
                inputSchemaDigest: actionContract.inputSchema.digest,
                outputSchemaDigest: actionContract.successSchema.digest,
                errorSchemaDigest: actionContract.errorSchema.digest,
              }
            : flowContract !== undefined
              ? {
                  mode: "compiler-derived-flow",
                  planDigest: flowContract.planDigest,
                  contractDigest: flowContract.contractDigest,
                  inputSchemaDigest: flowContract.inputSchema.digest,
                  outputSchemaDigest: flowContract.successSchema.digest,
                  errorSchemaDigest: flowContract.errorSchema?.digest ?? null,
                }
              : { mode: "legacy-json-only" },
        }),
      })
  return Object.freeze({
    signature: stableSignature,
    invoke,
    description,
    identity,
    ...(actionContract === undefined ? {} : { actionContract }),
    ...(flowContract === undefined ? {} : { flowContract }),
  })
}

/**
 * Bind a compiler-produced Action descriptor directly to an agent RPC. The
 * generated surface is always asynchronous because sandbox calls cross a
 * process boundary even when the host callback completes synchronously.
 */
export function defineActionFunction<Input, Output>(
  actionContract: ActionDescriptor,
  invoke: (input: Input, context: AgentFunctionContext) => Awaitable<Output>,
  description?: string,
  options: DefineActionFunctionOptions = {},
): AgentFunction<Input, Output> {
  const contract = snapshotActionContract(actionContract, "Agent function Action contract")
  return defineFunction(
    actionFunctionSignature(contract),
    invoke,
    description,
    { ...options, actionContract: contract },
  )
}

/**
 * Bind a compiler-derived Flow contract directly to an agent RPC. The callback
 * is expected to start or join the durable execution and await its terminal
 * outcome; `flowTool` in `tools.ts` is the ready-made implementation.
 */
export function defineFlowFunction<Input, Output>(
  flowContract: FlowContract,
  invoke: (input: Input, context: AgentFunctionContext) => Awaitable<Output>,
  description?: string,
  options: DefineFlowFunctionOptions = {},
): AgentFunction<Input, Output> {
  const contract = snapshotFlowContract(flowContract, "Agent function Flow contract")
  return defineFunction(
    flowFunctionSignature(contract),
    invoke,
    description,
    { ...options, flowContract: contract },
  )
}

function plainObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must have Object.prototype or null prototype`)
  }
}

function dataValue(value: object, key: PropertyKey, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
    throw new TypeError(`${path}.${String(key)} must be an enumerable data property`)
  }
  return descriptor.value
}

/** Descriptor-safe snapshot used for both identity construction and execution. */
export function snapshotFunctionTable(functions: AgentFunctionTable): AgentFunctionTable {
  plainObject(functions, "Agent function table")
  const tableKeys = Reflect.ownKeys(functions)
  if (tableKeys.some((key) => typeof key !== "string")) {
    throw new TypeError("Agent function table cannot contain symbol properties")
  }
  const output = Object.create(null) as AgentFunctionTable
  for (const name of (tableKeys as string[]).sort()) {
    if (!IDENTIFIER.test(name)) {
      throw new Error(`Agent function name is not a TypeScript identifier: ${name}`)
    }
    const raw = dataValue(functions, name, "Agent function table")
    plainObject(raw, `Agent function '${name}'`)
    const keys = Reflect.ownKeys(raw)
    if (keys.some((key) => typeof key !== "string") || !keys.every((key) =>
      typeof key === "string" &&
      ["identity", "signature", "description", "actionContract", "flowContract", "invoke"].includes(key))) {
      throw new TypeError(`Agent function '${name}' has unsupported properties`)
    }
    for (const required of ["identity", "signature", "invoke"]) {
      if (!keys.includes(required)) throw new TypeError(`Agent function '${name}' is missing ${required}`)
    }
    const signature = dataValue(raw, "signature", `Agent function '${name}'`)
    const description = keys.includes("description")
      ? dataValue(raw, "description", `Agent function '${name}'`)
      : undefined
    const invoke = dataValue(raw, "invoke", `Agent function '${name}'`)
    const identity = dataValue(raw, "identity", `Agent function '${name}'`)
    const actionContract = keys.includes("actionContract")
      ? snapshotActionContract(
          dataValue(raw, "actionContract", `Agent function '${name}'`),
          `Agent function '${name}' Action contract`,
        )
      : undefined
    const flowContract = keys.includes("flowContract")
      ? snapshotFlowContract(
          dataValue(raw, "flowContract", `Agent function '${name}'`),
          `Agent function '${name}' Flow contract`,
        )
      : undefined
    if (actionContract !== undefined && flowContract !== undefined) {
      throw new TypeError(`Agent function '${name}' carries both an Action and a Flow contract`)
    }
    if (typeof signature !== "string" || !signature.trim().startsWith("(")) {
      throw new TypeError(`Agent function '${name}' has an invalid function-type signature`)
    }
    const requiredSignature = contractSignature(actionContract, flowContract)
    if (requiredSignature !== undefined && signature.trim() !== requiredSignature) {
      throw new TypeError(
        `Agent function '${name}' signature does not exactly match its compiler-derived contract`,
      )
    }
    if (description !== undefined && typeof description !== "string") {
      throw new TypeError(`Agent function '${name}' has an invalid description`)
    }
    if (typeof invoke !== "function") throw new TypeError(`Agent function '${name}' is not callable`)
    output[name] = Object.freeze({
      signature: signature.trim(),
      description,
      invoke: invoke as AgentFunction<any, any>["invoke"],
      identity: snapshotComponentIdentity(identity as ComponentIdentity, `Agent function '${name}' identity`),
      ...(actionContract === undefined ? {} : { actionContract }),
      ...(flowContract === undefined ? {} : { flowContract }),
    })
  }
  return Object.freeze(output)
}

export function functionTableIdentity(functions: AgentFunctionTable): {
  readonly digest: string
  readonly identities: Readonly<Record<string, ComponentIdentity>>
} {
  const snapshot = snapshotFunctionTable(functions)
  const identities: Record<string, ComponentIdentity> = Object.create(null) as Record<string, ComponentIdentity>
  const description: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  for (const [name, fn] of Object.entries(snapshot)) {
    identities[name] = fn.identity
    description[name] = {
      signature: fn.signature,
      description: fn.description ?? null,
      identity: {
        name: fn.identity.name,
        artifactDigest: fn.identity.artifactDigest,
        configDigest: fn.identity.configDigest,
      },
      contract: agentFunctionContractIdentity(fn),
    }
  }
  return Object.freeze({
    digest: sha256Json(description),
    identities: Object.freeze(identities),
  })
}

export function declareCallableSurface(functions: AgentFunctionTable): string {
  const snapshot = snapshotFunctionTable(functions)
  const members = Object.entries(snapshot).flatMap(([name, fn]) => {
    const contract = fn.actionContract
    const flow = fn.flowContract
    const marker = contract !== undefined
      ? `compiler-derived contract=${contract.contractDigest} input=${contract.inputSchema.digest} output=${contract.successSchema.digest} error=${contract.errorSchema.digest}`
      : flow !== undefined
        ? `compiler-derived-flow plan=${flow.planDigest} contract=${flow.contractDigest} input=${flow.inputSchema.digest} output=${flow.successSchema.digest} error=${flow.errorSchema?.digest ?? "none"}`
        : "legacy-json-only"
    return [
      `  /** @smithersAgentContract ${marker} */`,
      `  readonly ${name}: ${fn.signature};`,
    ]
  })

  return [
    "interface Functions {",
    ...members,
    "}",
    "",
    "interface Console {",
    "  log(...values: unknown[]): void;",
    "  info(...values: unknown[]): void;",
    "  warn(...values: unknown[]): void;",
    "  error(...values: unknown[]): void;",
    "}",
    "declare const console: Console;",
    "",
  ].join("\n")
}
