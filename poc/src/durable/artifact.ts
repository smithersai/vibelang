import type { CompiledFlow } from "./authoring.ts"
import {
  assertJson,
  canonicalJson,
  decodeCanonicalJson,
  deepFreeze,
  digest,
  encodeCanonicalJson,
  expressionDependencies,
  fanOutSteps,
  PLAN_PROVENANCE_PROXY_RECORDED,
  queueContractIdentity,
  signalContractIdentity,
  type ActionDescriptor,
  type ActionImplementationContract,
  type DeploymentManifest,
  type DurableSchema,
  type FanOutTemplateExpr,
  type JsonValue,
  type PlanFragment,
  type PlanNode,
  type PlanTemplate,
  type StructuralDurableSchema,
  type ValueExpr
} from "./ir.ts"
import {
  assertActionImplementationContractMatchesAction,
  validateActionImplementationContract
} from "./implementation-contract.ts"
import { DurableCodecError, validateDurableTypeDescriptor } from "./schema.ts"

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
const MAX_PLAN_NODES = 100_000
const MAX_EXPRESSION_DEPTH = 256
/** Bounded per-item step sequence inside one multi-step fan-out template. */
export const MAX_FAN_OUT_STEPS = 16
/** Bounded child-Flow embedding depth; the POC's round budget for the child boundary. */
export const MAX_CHILD_FLOW_DEPTH = 8
/** Hard ceiling on any durable loop's explicit round budget. */
export const MAX_LOOP_ROUNDS = 1000
const HEX_DIGEST = /^[0-9a-f]{64}$/

export class DurableArtifactError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DurableArtifactError"
  }
}

const fail = (path: string, message: string): never => {
  throw new DurableArtifactError(`${path}: ${message}`)
}

const object = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "expected object")
  return value as Record<string, unknown>
}

const array = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) fail(path, "expected array")
  return value as readonly unknown[]
}

const string = (value: unknown, path: string): string => {
  if (typeof value !== "string") fail(path, "expected string")
  return value as string
}

const nonEmpty = (value: unknown, path: string): string => {
  const out = string(value, path)
  if (out.trim() === "") fail(path, "must be non-empty")
  return out
}

/** Narrows a validated schema to the exact compiler-derived structural form. */
const structuralOnly = (
  value: DurableSchema,
  path: string,
  what: string
): StructuralDurableSchema => {
  if (value.shape !== "structural" || value.source !== "compiler-derived") {
    fail(path, `${what} requires an exact compiler-derived structural schema`)
  }
  return value as StructuralDurableSchema
}

const signalIdentity = (value: unknown, path: string): string => {
  const out = nonEmpty(value, path)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(out)) {
    fail(path, "must be a bounded portable signal identity")
  }
  return out
}

const integer = (value: unknown, path: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(path, `expected integer >= ${minimum}`)
  return value as number
}

const digestString = (value: unknown, path: string): string => {
  const out = string(value, path)
  if (!HEX_DIGEST.test(out)) fail(path, "expected lowercase SHA-256 digest")
  return out
}

const exactKeys = (value: Record<string, unknown>, path: string, required: readonly string[], optional: readonly string[] = []): void => {
  const allowed = new Set([...required, ...optional])
  for (const key of required) if (!Object.hasOwn(value, key)) fail(path, `missing field ${key}`)
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(path, `unknown field ${key}`)
}

const stringArray = (value: unknown, path: string): readonly string[] =>
  array(value, path).map((item, index) => string(item, `${path}[${index}]`))

const assertSortedUnique = (values: readonly string[], path: string): void => {
  const expected = [...new Set(values)].sort()
  if (expected.length !== values.length || expected.some((value, index) => value !== values[index])) {
    fail(path, "must be sorted and unique")
  }
}

const schema = (value: unknown, role: DurableSchema["role"], path: string): DurableSchema => {
  const record = object(value, path)
  if (record.format !== "canonical-json" || record.schemaVersion !== 1 || record.role !== role) {
    fail(path, "unsupported durable schema/version")
  }
  const claimed = digestString(record.digest, `${path}.digest`)
  if (record.shape === "json-value" && record.source === "compiler-derived-poc-stub") {
    exactKeys(record, path, ["format", "schemaVersion", "role", "shape", "source", "digest"])
    const semantic = {
      format: "canonical-json",
      schemaVersion: 1,
      role,
      shape: "json-value",
      source: "compiler-derived-poc-stub"
    }
    if (digest(semantic) !== claimed) fail(path, "schema digest mismatch")
    return record as unknown as DurableSchema
  }
  if (record.shape !== "structural" || record.source !== "compiler-derived") {
    fail(path, "unsupported durable schema/version")
  }
  exactKeys(record, path, ["format", "schemaVersion", "role", "shape", "source", "descriptor", "digest"])
  let descriptor
  try {
    descriptor = validateDurableTypeDescriptor(record.descriptor)
  } catch (error) {
    if (error instanceof DurableCodecError) fail(`${path}.descriptor`, error.message)
    throw error
  }
  const semantic = {
    format: "canonical-json",
    schemaVersion: 1,
    role,
    shape: "structural",
    source: "compiler-derived",
    descriptor
  }
  if (digest(semantic) !== claimed) fail(path, "schema digest mismatch")
  return record as unknown as DurableSchema
}

const descriptor = (value: unknown, path: string): ActionDescriptor => {
  const record = object(value, path)
  exactKeys(record, path, ["id", "version", "contractDigest", "inputSchema", "successSchema", "errorSchema"])
  nonEmpty(record.id, `${path}.id`)
  integer(record.version, `${path}.version`, 1)
  const contractDigest = digestString(record.contractDigest, `${path}.contractDigest`)
  schema(record.inputSchema, "input", `${path}.inputSchema`)
  schema(record.successSchema, "success", `${path}.successSchema`)
  schema(record.errorSchema, "error", `${path}.errorSchema`)
  const semantic = {
    id: record.id,
    version: record.version,
    inputSchema: record.inputSchema,
    successSchema: record.successSchema,
    errorSchema: record.errorSchema
  }
  if (digest(semantic) !== contractDigest) fail(path, "Action contract digest mismatch")
  return record as unknown as ActionDescriptor
}

const expression = (value: unknown, path: string, depth = 0): ValueExpr => {
  if (depth > MAX_EXPRESSION_DEPTH) fail(path, "expression nesting limit exceeded")
  const record = object(value, path)
  const kind = string(record.kind, `${path}.kind`)
  const nested = (next: unknown, suffix: string): ValueExpr => expression(next, `${path}.${suffix}`, depth + 1)
  switch (kind) {
    case "literal":
      exactKeys(record, path, ["kind", "value"])
      return record as unknown as ValueExpr
    case "input":
      exactKeys(record, path, ["kind", "path"])
      stringArray(record.path, `${path}.path`)
      return record as unknown as ValueExpr
    case "node":
      exactKeys(record, path, ["kind", "nodeId", "path"])
      nonEmpty(record.nodeId, `${path}.nodeId`)
      stringArray(record.path, `${path}.path`)
      return record as unknown as ValueExpr
    case "array":
      exactKeys(record, path, ["kind", "items"])
      array(record.items, `${path}.items`).forEach((item, index) => expression(item, `${path}.items[${index}]`, depth + 1))
      return record as unknown as ValueExpr
    case "object": {
      exactKeys(record, path, ["kind", "fields"])
      const fields = object(record.fields, `${path}.fields`)
      for (const [key, item] of Object.entries(fields)) expression(item, `${path}.fields.${key}`, depth + 1)
      return record as unknown as ValueExpr
    }
    case "unary":
      exactKeys(record, path, ["kind", "operator", "value"])
      if (record.operator !== "not") fail(`${path}.operator`, "unsupported unary operator")
      nested(record.value, "value")
      return record as unknown as ValueExpr
    case "binary":
      exactKeys(record, path, ["kind", "operator", "left", "right"])
      if (!["eq", "neq", "gt", "gte", "lt", "lte", "and", "or", "add", "concat"].includes(string(record.operator, `${path}.operator`))) {
        fail(`${path}.operator`, "unsupported binary operator")
      }
      nested(record.left, "left")
      nested(record.right, "right")
      return record as unknown as ValueExpr
    default:
      return fail(`${path}.kind`, `unsupported expression ${kind}`)
  }
}

const debugInfo = (value: unknown, path: string): void => {
  const record = object(value, path)
  exactKeys(record, path, [], ["label", "callSite"])
  if (record.label !== undefined) string(record.label, `${path}.label`)
  if (record.callSite !== undefined) string(record.callSite, `${path}.callSite`)
}

const fanOutTemplateExpression = (
  value: unknown,
  path: string,
  stepBudget: number,
  depth = 0
): FanOutTemplateExpr => {
  if (depth > MAX_EXPRESSION_DEPTH) fail(path, "fan-out template nesting limit exceeded")
  const record = object(value, path)
  const kind = string(record.kind, `${path}.kind`)
  if (kind === "item") {
    exactKeys(record, path, ["kind", "path"])
    stringArray(record.path, `${path}.path`)
  } else if (kind === "step") {
    exactKeys(record, path, ["kind", "step", "path"])
    const step = integer(record.step, `${path}.step`)
    if (step >= stepBudget) {
      fail(`${path}.step`, `step reference ${step} is not an earlier step of this fan-out template`)
    }
    stringArray(record.path, `${path}.path`)
  } else if (kind === "literal") {
    exactKeys(record, path, ["kind", "value"])
  } else if (kind === "array") {
    exactKeys(record, path, ["kind", "items"])
    array(record.items, `${path}.items`).forEach((item, index) =>
      fanOutTemplateExpression(item, `${path}.items[${index}]`, stepBudget, depth + 1))
  } else if (kind === "object") {
    exactKeys(record, path, ["kind", "fields"])
    for (const [name, item] of Object.entries(object(record.fields, `${path}.fields`))) {
      fanOutTemplateExpression(item, `${path}.fields.${name}`, stepBudget, depth + 1)
    }
  } else {
    fail(`${path}.kind`, `unsupported fan-out template expression ${kind}`)
  }
  return record as unknown as FanOutTemplateExpr
}

const nodeExpressions = (node: PlanNode): readonly ValueExpr[] =>
  node.kind === "action"
    ? [node.input]
    : node.kind === "parallel"
      ? node.outputs
      : node.kind === "timer"
        ? [node.durationMs]
        : node.kind === "signal" || node.kind === "queue"
          ? []
        : node.kind === "fanout"
          ? [node.items]
          : node.kind === "loop"
            ? [node.initial]
            : node.kind === "childFlow"
              ? [node.input]
              : [node.condition]

const loopTemplateExpression = (
  value: unknown,
  path: string,
  depth = 0
): void => {
  if (depth > MAX_EXPRESSION_DEPTH) fail(path, "loop template nesting limit exceeded")
  const record = object(value, path)
  const kind = string(record.kind, `${path}.kind`)
  if (kind === "state") {
    exactKeys(record, path, ["kind", "path"])
    stringArray(record.path, `${path}.path`)
  } else if (kind === "literal") {
    exactKeys(record, path, ["kind", "value"])
  } else if (kind === "array") {
    exactKeys(record, path, ["kind", "items"])
    array(record.items, `${path}.items`).forEach((item, index) =>
      loopTemplateExpression(item, `${path}.items[${index}]`, depth + 1))
  } else if (kind === "object") {
    exactKeys(record, path, ["kind", "fields"])
    for (const [name, item] of Object.entries(object(record.fields, `${path}.fields`))) {
      loopTemplateExpression(item, `${path}.fields.${name}`, depth + 1)
    }
  } else if (kind === "unary") {
    exactKeys(record, path, ["kind", "operator", "value"])
    if (record.operator !== "not") fail(`${path}.operator`, "unsupported unary operator")
    loopTemplateExpression(record.value, `${path}.value`, depth + 1)
  } else if (kind === "binary") {
    exactKeys(record, path, ["kind", "operator", "left", "right"])
    if (!["eq", "neq", "gt", "gte", "lt", "lte", "and", "or", "add", "concat"].includes(string(record.operator, `${path}.operator`))) {
      fail(`${path}.operator`, "unsupported binary operator")
    }
    loopTemplateExpression(record.left, `${path}.left`, depth + 1)
    loopTemplateExpression(record.right, `${path}.right`, depth + 1)
  } else {
    fail(`${path}.kind`, `unsupported loop template expression ${kind}`)
  }
}

const planNode = (value: unknown, path: string, formatVersion: 1 | 2 | 3, nesting = 0): PlanNode => {
  if (nesting > MAX_EXPRESSION_DEPTH) fail(path, "Plan fragment nesting limit exceeded")
  const record = object(value, path)
  const kind = string(record.kind, `${path}.kind`)
  const base = ["kind", "id", "dependencies", "controlDependencies"]
  const optional = ["debug"]
  nonEmpty(record.id, `${path}.id`)
  const dependencies = stringArray(record.dependencies, `${path}.dependencies`)
  const control = stringArray(record.controlDependencies, `${path}.controlDependencies`)
  assertSortedUnique(dependencies, `${path}.dependencies`)
  assertSortedUnique(control, `${path}.controlDependencies`)
  if (record.debug !== undefined) debugInfo(record.debug, `${path}.debug`)
  if (kind === "action") {
    exactKeys(record, path, [...base, "actionId", "actionVersion", "actionContractDigest", "input"], optional)
    nonEmpty(record.actionId, `${path}.actionId`)
    integer(record.actionVersion, `${path}.actionVersion`, 1)
    digestString(record.actionContractDigest, `${path}.actionContractDigest`)
    expression(record.input, `${path}.input`)
  } else if (kind === "parallel") {
    exactKeys(record, path, [...base, "outputs"], optional)
    array(record.outputs, `${path}.outputs`).forEach((item, index) => expression(item, `${path}.outputs[${index}]`))
  } else if (kind === "timer") {
    exactKeys(record, path, [...base, "durationMs"], optional)
    expression(record.durationMs, `${path}.durationMs`)
    const duration = record.durationMs as ValueExpr
    if (
      duration.kind === "literal" &&
      (typeof duration.value !== "number" || !Number.isSafeInteger(duration.value) || duration.value < 0)
    ) {
      fail(`${path}.durationMs`, "literal timer duration must be a non-negative safe integer")
    }
  } else if (kind === "signal") {
    exactKeys(record, path, [
      ...base, "signalId", "payloadSchema", "signalContractDigest"
    ], [...optional, "delivery"])
    const signalId = signalIdentity(record.signalId, `${path}.signalId`)
    const payloadSchema = structuralOnly(
      schema(record.payloadSchema, "input", `${path}.payloadSchema`),
      `${path}.payloadSchema`,
      "signal payload"
    )
    // The unicast form must never carry the field at all: an explicit
    // `delivery: "unicast"` spelling would be a second encoding of one meaning
    // and would silently change the pinned contract digest of an old Plan.
    let delivery: "broadcast" | undefined
    if (record.delivery !== undefined) {
      if (formatVersion < 3) fail(path, "broadcast signals require Plan format version 3")
      if (record.delivery !== "broadcast") fail(`${path}.delivery`, "unsupported signal delivery mode")
      delivery = "broadcast"
    }
    const contractDigest = digestString(record.signalContractDigest, `${path}.signalContractDigest`)
    if (signalContractIdentity(signalId, payloadSchema, delivery) !== contractDigest) {
      fail(path, "signal contract digest mismatch")
    }
  } else if (kind === "queue") {
    if (formatVersion < 3) fail(path, "durable queue nodes require Plan format version 3")
    exactKeys(record, path, [
      ...base, "queueId", "itemSchema", "queueContractDigest"
    ], optional)
    const queueId = signalIdentity(record.queueId, `${path}.queueId`)
    const itemSchema = structuralOnly(
      schema(record.itemSchema, "input", `${path}.itemSchema`),
      `${path}.itemSchema`,
      "queue items"
    )
    const contractDigest = digestString(record.queueContractDigest, `${path}.queueContractDigest`)
    if (queueContractIdentity(queueId, itemSchema) !== contractDigest) {
      fail(path, "queue contract digest mismatch")
    }
  } else if (kind === "fanout") {
    if (Object.hasOwn(record, "steps")) {
      if (formatVersion < 2) {
        fail(path, "multi-step fan-out requires Plan format version 2")
      }
      exactKeys(record, path, [...base, "items", "keyPath", "steps"], optional)
      expression(record.items, `${path}.items`)
      stringArray(record.keyPath, `${path}.keyPath`)
      const steps = array(record.steps, `${path}.steps`)
      if (steps.length < 1 || steps.length > MAX_FAN_OUT_STEPS) {
        fail(`${path}.steps`, `fan-out templates require 1..${MAX_FAN_OUT_STEPS} steps`)
      }
      steps.forEach((item, index) => {
        const step = object(item, `${path}.steps[${index}]`)
        exactKeys(step, `${path}.steps[${index}]`, ["actionId", "actionVersion", "actionContractDigest", "input"])
        nonEmpty(step.actionId, `${path}.steps[${index}].actionId`)
        integer(step.actionVersion, `${path}.steps[${index}].actionVersion`, 1)
        digestString(step.actionContractDigest, `${path}.steps[${index}].actionContractDigest`)
        // A step may project only the current item and strictly earlier steps.
        fanOutTemplateExpression(step.input, `${path}.steps[${index}].input`, index)
      })
    } else {
      exactKeys(record, path, [
        ...base, "items", "keyPath", "actionId", "actionVersion", "actionContractDigest", "input"
      ], optional)
      expression(record.items, `${path}.items`)
      stringArray(record.keyPath, `${path}.keyPath`)
      nonEmpty(record.actionId, `${path}.actionId`)
      integer(record.actionVersion, `${path}.actionVersion`, 1)
      digestString(record.actionContractDigest, `${path}.actionContractDigest`)
      fanOutTemplateExpression(record.input, `${path}.input`, 0)
    }
  } else if (kind === "loop") {
    if (formatVersion < 2) {
      fail(path, "durable loop nodes require Plan format version 2")
    }
    exactKeys(record, path, [
      ...base, "initial", "condition", "actionId", "actionVersion", "actionContractDigest", "body", "maxRounds"
    ], optional)
    expression(record.initial, `${path}.initial`)
    loopTemplateExpression(record.condition, `${path}.condition`)
    nonEmpty(record.actionId, `${path}.actionId`)
    integer(record.actionVersion, `${path}.actionVersion`, 1)
    digestString(record.actionContractDigest, `${path}.actionContractDigest`)
    loopTemplateExpression(record.body, `${path}.body`)
    const maxRounds = integer(record.maxRounds, `${path}.maxRounds`, 1)
    if (maxRounds > MAX_LOOP_ROUNDS) {
      fail(`${path}.maxRounds`, `loop round budget exceeds the ${MAX_LOOP_ROUNDS} round ceiling`)
    }
  } else if (kind === "childFlow") {
    if (formatVersion < 2) {
      fail(path, "child Flow nodes require Plan format version 2")
    }
    exactKeys(record, path, [...base, "flowId", "flowVersion", "planDigest", "input"], optional)
    nonEmpty(record.flowId, `${path}.flowId`)
    integer(record.flowVersion, `${path}.flowVersion`, 1)
    digestString(record.planDigest, `${path}.planDigest`)
    expression(record.input, `${path}.input`)
  } else if (kind === "branch") {
    exactKeys(record, path, [...base, "condition", "whenTrue", "whenFalse"], optional)
    expression(record.condition, `${path}.condition`)
    fragment(record.whenTrue, `${path}.whenTrue`, formatVersion, nesting + 1)
    fragment(record.whenFalse, `${path}.whenFalse`, formatVersion, nesting + 1)
  } else {
    fail(`${path}.kind`, `unsupported Plan node ${kind}`)
  }
  const node = record as unknown as PlanNode
  const expected = [...new Set(nodeExpressions(node).flatMap(expressionDependencies))].sort()
  if (canonicalJson(expected) !== canonicalJson(node.dependencies)) fail(path, "dependency list does not match expressions")
  return node
}

const fragment = (value: unknown, path: string, formatVersion: 1 | 2 | 3, nesting = 0): PlanFragment => {
  if (nesting > MAX_EXPRESSION_DEPTH) fail(path, "Plan fragment nesting limit exceeded")
  const record = object(value, path)
  exactKeys(record, path, ["nodes", "output"])
  array(record.nodes, `${path}.nodes`).forEach((item, index) => planNode(item, `${path}.nodes[${index}]`, formatVersion, nesting))
  expression(record.output, `${path}.output`)
  return record as unknown as PlanFragment
}

const validateScope = (
  planFragment: PlanFragment,
  inherited: ReadonlySet<string>,
  allIds: Set<string>,
  counter: { value: number },
  path: string,
  nesting = 0
): void => {
  if (nesting > MAX_EXPRESSION_DEPTH) fail(path, "Plan fragment nesting limit exceeded")
  const available = new Set(inherited)
  for (const [index, node] of planFragment.nodes.entries()) {
    counter.value += 1
    if (counter.value > MAX_PLAN_NODES) fail(path, "Plan node limit exceeded")
    if (allIds.has(node.id)) fail(`${path}.nodes[${index}].id`, `duplicate node id ${node.id}`)
    allIds.add(node.id)
    const references = new Set([...node.dependencies, ...node.controlDependencies])
    for (const reference of references) {
      if (!available.has(reference)) fail(`${path}.nodes[${index}]`, `reference to unavailable node ${reference}`)
    }
    if (node.kind === "branch") {
      validateScope(node.whenTrue, available, allIds, counter, `${path}.nodes[${index}].whenTrue`, nesting + 1)
      validateScope(node.whenFalse, available, allIds, counter, `${path}.nodes[${index}].whenFalse`, nesting + 1)
    }
    available.add(node.id)
  }
  for (const reference of expressionDependencies(planFragment.output)) {
    if (!available.has(reference)) fail(`${path}.output`, `reference to unavailable node ${reference}`)
  }
}

const validatePlanTemplateInner = (value: unknown, label: string, embedDepth: number): PlanTemplate => {
  if (embedDepth > MAX_CHILD_FLOW_DEPTH) {
    fail(label, `child Flow embedding exceeds the depth budget of ${MAX_CHILD_FLOW_DEPTH}`)
  }
  // Validate the host object before reading fields. Artifact decoding already
  // gives us this guarantee, but Deployment.build also accepts compiler/test
  // objects directly and must not invoke accessors or ignore hidden semantics.
  // Continue from the normalized snapshot rather than the caller's object. In
  // addition to rejecting accessors/hidden fields, this closes a validation/use
  // gap for mutable objects and hostile Proxy `get` behavior.
  const record = object(assertJson(value, "Plan template"), label)
  exactKeys(record, label, [
    "formatVersion", "flowId", "flowVersion", "nodes", "output", "requirements", "actions", "digest"
  ], ["flowSchemas", "provenance", "childFlows"])
  // An unverified-construction marker is fail-closed: an unknown spelling is a
  // Plan this build cannot reason about, not a Plan to trust by default.
  if (record.provenance !== undefined && record.provenance !== PLAN_PROVENANCE_PROXY_RECORDED) {
    fail(`${label}.provenance`, "unsupported Plan provenance marker")
  }
  if (record.formatVersion !== 1 && record.formatVersion !== 2 && record.formatVersion !== 3) {
    fail(`${label}.formatVersion`, "unsupported Plan format")
  }
  const formatVersion = record.formatVersion as 1 | 2 | 3
  nonEmpty(record.flowId, `${label}.flowId`)
  integer(record.flowVersion, `${label}.flowVersion`, 1)
  const requirements = stringArray(record.requirements, `${label}.requirements`)
  assertSortedUnique(requirements, `${label}.requirements`)
  const actions = array(record.actions, `${label}.actions`).map((item, index) => descriptor(item, `${label}.actions[${index}]`))
  const actionIds = actions.map((action) => action.id)
  assertSortedUnique(actionIds, `${label}.actions`)
  array(record.nodes, `${label}.nodes`).forEach((item, index) => planNode(item, `${label}.nodes[${index}]`, formatVersion))
  expression(record.output, `${label}.output`)
  if (record.flowSchemas !== undefined) {
    const flowSchemas = object(record.flowSchemas, `${label}.flowSchemas`)
    exactKeys(flowSchemas, `${label}.flowSchemas`, ["input", "success"], ["error"])
    schema(flowSchemas.input, "input", `${label}.flowSchemas.input`)
    schema(flowSchemas.success, "success", `${label}.flowSchemas.success`)
    if (flowSchemas.error !== undefined) schema(flowSchemas.error, "error", `${label}.flowSchemas.error`)
  }
  const childPlans = new Map<string, PlanTemplate>()
  if (record.childFlows !== undefined) {
    if (formatVersion < 2) fail(`${label}.childFlows`, "child Flows require Plan format version 2")
    const embedded = array(record.childFlows, `${label}.childFlows`)
    if (embedded.length === 0) fail(`${label}.childFlows`, "childFlows must be absent or non-empty")
    const orderedDigests: string[] = []
    embedded.forEach((item, index) => {
      const child = validatePlanTemplateInner(item, `${label}.childFlows[${index}]`, embedDepth + 1)
      if (childPlans.has(child.digest)) {
        fail(`${label}.childFlows[${index}]`, `duplicate embedded child Plan ${child.digest}`)
      }
      childPlans.set(child.digest, child)
      orderedDigests.push(child.digest)
    })
    assertSortedUnique(orderedDigests, `${label}.childFlows`)
  }
  const claimed = digestString(record.digest, `${label}.digest`)
  const { digest: _claimed, ...semantic } = record
  if (digest(semantic) !== claimed) fail(`${label}.digest`, "Plan semantic digest mismatch")
  const plan = record as unknown as PlanTemplate
  const allIds = new Set<string>()
  validateScope(plan, new Set(), allIds, { value: 0 }, label)
  const descriptors = new Map(actions.map((action) => [action.id, action]))
  const used = new Set<string>()
  const signalIds = new Set<string>()
  const queueContracts = new Map<string, string>()
  const referencedChildren = new Set<string>()
  const visit = (part: PlanFragment): void => {
    for (const node of part.nodes) {
      if (node.kind === "action") {
        used.add(node.actionId)
        const action = descriptors.get(node.actionId)
        if (action === undefined || action.version !== node.actionVersion || action.contractDigest !== node.actionContractDigest) {
          fail(`${label} node ${node.id}`, "Action version/schema contract mismatch")
        }
      } else if (node.kind === "fanout") {
        for (const step of fanOutSteps(node)) {
          used.add(step.actionId)
          const action = descriptors.get(step.actionId)
          if (action === undefined || action.version !== step.actionVersion || action.contractDigest !== step.actionContractDigest) {
            fail(`${label} node ${node.id}`, "Action version/schema contract mismatch")
          }
        }
      } else if (node.kind === "loop") {
        used.add(node.actionId)
        const action = descriptors.get(node.actionId)
        if (action === undefined || action.version !== node.actionVersion || action.contractDigest !== node.actionContractDigest) {
          fail(`${label} node ${node.id}`, "Action version/schema contract mismatch")
        }
      } else if (node.kind === "childFlow") {
        const child = childPlans.get(node.planDigest) ??
          fail(`${label} node ${node.id}`, `child Flow references a Plan digest absent from childFlows`)
        if (child.flowId !== node.flowId || child.flowVersion !== node.flowVersion) {
          fail(`${label} node ${node.id}`, "child Flow identity does not match its embedded Plan")
        }
        referencedChildren.add(node.planDigest)
      } else if (node.kind === "signal") {
        if (signalIds.has(node.signalId)) {
          fail(`${label} node ${node.id}`, `duplicate signal identity ${node.signalId}`)
        }
        signalIds.add(node.signalId)
      } else if (node.kind === "queue") {
        // Unlike a signal inbox, a queue is shared durable state: several nodes
        // in one Flow may legitimately consume from it. They must nonetheless
        // agree on one exact item contract, or the Plan itself is ambiguous
        // about the queue's persisted schema.
        const pinned = queueContracts.get(node.queueId)
        if (pinned !== undefined && pinned !== node.queueContractDigest) {
          fail(`${label} node ${node.id}`, `conflicting queue contract for ${node.queueId}`)
        }
        queueContracts.set(node.queueId, node.queueContractDigest)
      } else if (node.kind === "branch") {
        visit(node.whenTrue)
        visit(node.whenFalse)
      }
    }
  }
  visit(plan)
  for (const digestKey of childPlans.keys()) {
    if (!referencedChildren.has(digestKey)) {
      fail(`${label}.childFlows`, `embedded child Plan ${digestKey} is not referenced by any childFlow node`)
    }
  }
  // A child execution runs against its own manifest, but the parent deployment
  // must be able to route every transitively required Action, and one Action id
  // must resolve to one exact contract across the whole embedded tree.
  for (const child of childPlans.values()) {
    for (const childAction of child.actions) {
      used.add(childAction.id)
      const parentAction = descriptors.get(childAction.id)
      if (parentAction === undefined || parentAction.contractDigest !== childAction.contractDigest) {
        fail(`${label}.actions`, `child Flow Action ${childAction.id} is missing or has a conflicting contract in the parent Plan`)
      }
    }
  }
  const expectedRequirements = [...used].sort()
  if (canonicalJson(expectedRequirements) !== canonicalJson(requirements) ||
    canonicalJson(expectedRequirements) !== canonicalJson(actionIds)) {
    fail(`${label}.requirements`, "requirements, Action descriptors, and Action nodes must agree exactly")
  }
  return deepFreeze(plan)
}

export const validatePlanTemplate = (value: unknown): PlanTemplate =>
  validatePlanTemplateInner(value, "plan", 0)

const recoveryPolicy = (value: unknown, path: string): void => {
  const record = object(value, path)
  exactKeys(record, path, ["mode", "maxAttempts"], ["retryTypedFailures", "delayMs"])
  if (!["repeatable", "downstream-deduplicated", "manual"].includes(string(record.mode, `${path}.mode`))) {
    fail(`${path}.mode`, "unsupported recovery mode")
  }
  integer(record.maxAttempts, `${path}.maxAttempts`, 1)
  if (record.retryTypedFailures !== undefined && typeof record.retryTypedFailures !== "boolean") fail(`${path}.retryTypedFailures`, "expected boolean")
  if (record.delayMs !== undefined) integer(record.delayMs, `${path}.delayMs`)
}

const reusePolicy = (value: unknown, path: string): void => {
  const record = object(value, path)
  const kind = string(record.kind, `${path}.kind`)
  if (kind === "execution") exactKeys(record, path, ["kind"])
  else if (kind === "memo") {
    exactKeys(record, path, ["kind", "scope", "generation", "keyVersion"])
    nonEmpty(record.scope, `${path}.scope`); nonEmpty(record.generation, `${path}.generation`); nonEmpty(record.keyVersion, `${path}.keyVersion`)
  } else if (kind === "content") {
    exactKeys(record, path, ["kind"], ["invalidationSalt"])
    if (record.invalidationSalt !== undefined) string(record.invalidationSalt, `${path}.invalidationSalt`)
  } else fail(`${path}.kind`, "unsupported reuse policy")
}

export const validateDeploymentManifest = (value: unknown, plan: PlanTemplate): DeploymentManifest => {
  const validatedPlan = validatePlanTemplate(plan)
  const record = object(assertJson(value, "deployment manifest"), "manifest")
  exactKeys(record, "manifest", ["formatVersion", "deploymentId", "planDigest", "coordinatorDigest", "pools", "routes", "digest"])
  if (record.formatVersion !== 1) fail("manifest.formatVersion", "unsupported manifest format")
  nonEmpty(record.deploymentId, "manifest.deploymentId")
  if (digestString(record.planDigest, "manifest.planDigest") !== validatedPlan.digest) fail("manifest.planDigest", "does not pin the supplied Plan")
  const poolRecords = array(record.pools, "manifest.pools").map((item, index) => {
    const pool = object(item, `manifest.pools[${index}]`)
    exactKeys(pool, `manifest.pools[${index}]`, ["id", "target", "sandbox", "placement", "artifactDigest", "actionIds"], ["bundleDigest"])
    nonEmpty(pool.id, `manifest.pools[${index}].id`); nonEmpty(pool.target, `manifest.pools[${index}].target`); nonEmpty(pool.sandbox, `manifest.pools[${index}].sandbox`)
    object(pool.placement, `manifest.pools[${index}].placement`)
    digestString(pool.artifactDigest, `manifest.pools[${index}].artifactDigest`)
    // The optional bundleDigest pins the exact bytes of this pool's emitted
    // tree-shaken worker bundle; the manifest digest and deployment signature
    // therefore cover the worker bundle content.
    if (pool.bundleDigest !== undefined) digestString(pool.bundleDigest, `manifest.pools[${index}].bundleDigest`)
    const ids = stringArray(pool.actionIds, `manifest.pools[${index}].actionIds`); assertSortedUnique(ids, `manifest.pools[${index}].actionIds`)
    return pool
  })
  const poolIds = poolRecords.map((pool) => pool.id as string)
  assertSortedUnique(poolIds, "manifest.pools")
  const poolById = new Map(poolRecords.map((pool) => [pool.id as string, pool]))
  const descriptorById = new Map(validatedPlan.actions.map((action) => [action.id, action]))
  const routeRecords = array(record.routes, "manifest.routes").map((item, index) => {
    const path = `manifest.routes[${index}]`
    const route = object(item, path)
    exactKeys(route, path, ["actionId", "actionVersion", "actionContractDigest", "poolId", "artifactDigest", "implementationDigest", "implementationContract", "policyDigest", "policy", "schemas"])
    const actionId = nonEmpty(route.actionId, `${path}.actionId`)
    const selectedPool = poolById.get(nonEmpty(route.poolId, `${path}.poolId`)) ??
      fail(`${path}.poolId`, "route references an unknown worker pool")
    integer(route.actionVersion, `${path}.actionVersion`, 1)
    digestString(route.actionContractDigest, `${path}.actionContractDigest`); digestString(route.artifactDigest, `${path}.artifactDigest`)
    digestString(route.implementationDigest, `${path}.implementationDigest`); digestString(route.policyDigest, `${path}.policyDigest`)
    const policy = object(route.policy, `${path}.policy`)
    exactKeys(policy, `${path}.policy`, ["recovery", "reuse", "dependencyDigests", "capabilityGrant", "target"])
    recoveryPolicy(policy.recovery, `${path}.policy.recovery`); reusePolicy(policy.reuse, `${path}.policy.reuse`)
    const dependencies = stringArray(policy.dependencyDigests, `${path}.policy.dependencyDigests`); assertSortedUnique(dependencies, `${path}.policy.dependencyDigests`)
    const capabilities = stringArray(policy.capabilityGrant, `${path}.policy.capabilityGrant`); assertSortedUnique(capabilities, `${path}.policy.capabilityGrant`)
    nonEmpty(policy.target, `${path}.policy.target`)
    if (digest({ recovery: policy.recovery, reuse: policy.reuse, capabilityGrant: policy.capabilityGrant }) !== route.policyDigest) fail(path, "policy digest mismatch")
    let implementationContract: ActionImplementationContract | undefined
    if (route.implementationContract === null) {
      if (capabilities.length > 0) fail(path, "legacy provider route cannot receive capability authority")
    } else {
      implementationContract = (() => {
        try {
          return validateActionImplementationContract(route.implementationContract)
        } catch (error) {
          return fail(`${path}.implementationContract`, error instanceof Error ? error.message : "invalid compiler contract")
        }
      })()
      if (
        canonicalJson(implementationContract.requirements) !== canonicalJson(capabilities) ||
        !dependencies.includes(implementationContract.digest)
      ) {
        fail(path, "capability grant does not exactly close the compiler-derived implementation requirements")
      }
    }
    const schemas = object(route.schemas, `${path}.schemas`); exactKeys(schemas, `${path}.schemas`, ["input", "success", "error"])
    schema(schemas.input, "input", `${path}.schemas.input`); schema(schemas.success, "success", `${path}.schemas.success`); schema(schemas.error, "error", `${path}.schemas.error`)
    const action = descriptorById.get(actionId) ?? fail(path, "route references an unknown Plan Action contract")
    if (action.version !== route.actionVersion || action.contractDigest !== route.actionContractDigest ||
      canonicalJson({ input: action.inputSchema, success: action.successSchema, error: action.errorSchema }) !== canonicalJson(schemas)) {
      fail(path, "route does not match Plan Action contract")
    }
    if (implementationContract !== undefined) {
      try {
        assertActionImplementationContractMatchesAction(implementationContract, action)
      } catch (error) {
        fail(path, error instanceof Error ? error.message : "implementation failure row does not match Action contract")
      }
    }
    if (route.artifactDigest !== selectedPool.artifactDigest || policy.target !== selectedPool.target) {
      fail(path, "route artifact/target does not match its worker pool")
    }
    return route
  })
  const routeIds = routeRecords.map((route) => route.actionId as string)
  if (new Set(routeIds).size !== routeIds.length || canonicalJson([...routeIds].sort()) !== canonicalJson(routeIds)) fail("manifest.routes", "routes must be sorted and unique")
  if (canonicalJson(routeIds) !== canonicalJson(validatedPlan.requirements)) fail("manifest.routes", "routes must cover Plan requirements exactly")
  for (const pool of poolRecords) {
    const routes = routeRecords.filter((route) => route.poolId === pool.id)
    if (canonicalJson(routes.map((route) => route.actionId)) !== canonicalJson(pool.actionIds)) fail(`pool ${pool.id}`, "Action table does not match routes")
    if (routes.some((route) => route.artifactDigest !== pool.artifactDigest ||
      object(route.policy, "route policy").target !== pool.target)) fail(`pool ${pool.id}`, "route artifact/target mismatch")
    const selected = routes.map((route) => ({
      actionId: route.actionId,
      implementationDigest: route.implementationDigest,
      policyDigest: route.policyDigest
    }))
    const expectedArtifactDigest = digest({
      poolId: pool.id,
      target: pool.target,
      sandbox: pool.sandbox,
      selected,
      ...(pool.bundleDigest === undefined ? {} : { bundleDigest: pool.bundleDigest })
    })
    if (expectedArtifactDigest !== pool.artifactDigest) fail(`pool ${pool.id}`, "artifact digest mismatch")
  }
  const coordinatorDigest = digest({
    planDigest: validatedPlan.digest,
    routes: routeRecords.map((route) => ({
      actionId: route.actionId,
      poolId: route.poolId,
      implementationDigest: route.implementationDigest,
      policyDigest: route.policyDigest
    }))
  })
  if (digestString(record.coordinatorDigest, "manifest.coordinatorDigest") !== coordinatorDigest) fail("manifest.coordinatorDigest", "coordinator digest mismatch")
  const claimed = digestString(record.digest, "manifest.digest")
  const { digest: _claimed, ...unsigned } = record
  if (digest(unsigned) !== claimed) fail("manifest.digest", "manifest semantic digest mismatch")
  return deepFreeze(record as unknown as DeploymentManifest)
}

export interface StaticPlanArtifact {
  readonly artifactVersion: 1
  readonly kind: "smithers.plan"
  readonly plan: PlanTemplate
  readonly digest: string
}

export const encodePlanArtifact = (planValue: PlanTemplate): Uint8Array => {
  const plan = validatePlanTemplate(planValue)
  const identity = { artifactVersion: 1 as const, kind: "smithers.plan" as const, plan }
  const bytes = encodeCanonicalJson({ ...identity, digest: digest(identity) })
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) fail("artifact", "size limit exceeded")
  return bytes
}

export const decodePlanArtifact = (bytes: Uint8Array | string): PlanTemplate => {
  if (typeof bytes !== "string" && bytes.byteLength > MAX_ARTIFACT_BYTES) fail("artifact", "size limit exceeded")
  if (typeof bytes === "string" && new TextEncoder().encode(bytes).byteLength > MAX_ARTIFACT_BYTES) fail("artifact", "size limit exceeded")
  const record = object(decodeCanonicalJson(bytes, "Plan artifact"), "artifact")
  exactKeys(record, "artifact", ["artifactVersion", "kind", "plan", "digest"])
  if (record.artifactVersion !== 1 || record.kind !== "smithers.plan") fail("artifact", "unsupported artifact kind/version")
  const claimed = digestString(record.digest, "artifact.digest")
  const identity = { artifactVersion: 1, kind: "smithers.plan", plan: record.plan }
  if (digest(identity) !== claimed) fail("artifact.digest", "artifact digest mismatch")
  return validatePlanTemplate(record.plan)
}

export const loadCompiledFlow = <Input, Success>(bytes: Uint8Array | string): CompiledFlow<Input, Success> => {
  const plan = decodePlanArtifact(bytes)
  return Object.freeze({ id: plan.flowId, version: plan.flowVersion, plan, artifactSource: "static-plan-artifact" as const })
}

export const PlanArtifact = Object.freeze({
  encode: encodePlanArtifact,
  decode: decodePlanArtifact,
  load: loadCompiledFlow,
  validate: validatePlanTemplate
})
