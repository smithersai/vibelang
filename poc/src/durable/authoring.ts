import {
  type ActionDescriptor,
  type ActionNode,
  type BinaryOperator,
  type BranchNode,
  assertJson,
  deepFreeze,
  derivedSchema,
  digest,
  expressionDependencies,
  type JsonValue,
  type ParallelNode,
  type PlanFragment,
  type PlanNode,
  type PlanTemplate,
  uniqueSorted,
  type ValueExpr
} from "./ir.ts"
import { validateActionContractDescriptor } from "./schema.ts"

export const DurableExpression: unique symbol = Symbol.for("vibelang.poc.durable-expression") as never

const plannedExpressions = new WeakMap<object, ValueExpr>()

interface ExpressionCarrier {
  readonly [DurableExpression]: ValueExpr
}

/**
 * A value that exists at execution time but not while the Flow callback runs.
 * Object fields remain projectable, while computation requires Expr helpers.
 */
export type Planned<T> =
  & ExpressionCarrier
  & ([T] extends [object] ? { readonly [Key in keyof T]: Planned<T[Key]> } : unknown)

export type PlannedInput<T> =
  | Planned<T>
  | ([T] extends [readonly (infer Item)[]] ? readonly PlannedInput<Item>[]
    : [T] extends [object] ? { readonly [Key in keyof T]: PlannedInput<T[Key]> }
    : T)

export interface DurableAction<Input, Success, Failure = never> {
  readonly descriptor: ActionDescriptor
  /** Emits a node. It deliberately has no eager implementation path. */
  readonly run: (input: PlannedInput<Input>) => Planned<Success>
  /** Phantom signature channels retained for provider type checking. */
  readonly __types?: (input: Input) => Success | Failure
}

export interface CompiledFlow<Input, Success> {
  readonly id: string
  readonly version: number
  readonly plan: PlanTemplate
  readonly artifactSource?: "static-plan-artifact"
  readonly __types?: (input: Input) => Success
}

interface SharedPlanningState {
  readonly actions: Map<string, ActionDescriptor>
}

class Planner {
  readonly nodes: PlanNode[] = []
  private ordinal = 0
  controlDependencies: readonly string[] = []

  constructor(
    readonly prefix: string,
    readonly shared: SharedPlanningState
  ) {}

  allocate(label: string): string {
    this.ordinal += 1
    const safe = label.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(-32) || "node"
    return `${this.prefix}n${String(this.ordinal).padStart(4, "0")}-${safe}`
  }

  registerAction(descriptor: ActionDescriptor): void {
    const current = this.shared.actions.get(descriptor.id)
    if (current !== undefined && current !== descriptor) {
      throw new Error(
        `Flow contains distinct nominal definitions for Action ${descriptor.id}; ` +
          `reuse one descriptor (compiler contract digests replace object identity in production)`
      )
    }
    this.shared.actions.set(descriptor.id, descriptor)
  }
}

const planners: Planner[] = []

const currentPlanner = (): Planner => {
  const planner = planners.at(-1)
  if (planner === undefined) {
    throw new Error("Action.run and durable control helpers are valid only while compiling a Flow")
  }
  return planner
}

const underPlanner = <T>(planner: Planner, body: () => T): T => {
  planners.push(planner)
  try {
    const result = body()
    if (result instanceof Promise) {
      throw new TypeError("A Flow callback is comptime and must be synchronous; Actions emit nodes without awaiting")
    }
    return result
  } finally {
    planners.pop()
  }
}

const projection = (expression: ValueExpr, key: string): ValueExpr => {
  if (expression.kind === "input") return { ...expression, path: [...expression.path, key] }
  if (expression.kind === "node") return { ...expression, path: [...expression.path, key] }
  if (expression.kind === "object") {
    const value = expression.fields[key]
    if (value !== undefined) return value
  }
  if (expression.kind === "array") {
    const index = Number(key)
    if (Number.isSafeInteger(index) && index >= 0 && index < expression.items.length) return expression.items[index]
  }
  if (expression.kind === "literal" && expression.value !== null && typeof expression.value === "object") {
    if (Array.isArray(expression.value)) {
      const index = Number(key)
      if (Number.isSafeInteger(index) && index >= 0 && index < expression.value.length) {
        return { kind: "literal", value: expression.value[index] }
      }
    } else if (Object.hasOwn(expression.value, key)) {
      return { kind: "literal", value: expression.value[key] }
    }
  }
  throw new TypeError("Only Flow input and node results may be projected in this POC")
}

const plannedDescription = (expression: ValueExpr): string => {
  if (expression.kind === "input") return `input${expression.path.map((part) => `.${part}`).join("")}`
  if (expression.kind === "node") return `${expression.nodeId}${expression.path.map((part) => `.${part}`).join("")}`
  return expression.kind
}

const unsupportedComputation = (expression: ValueExpr, operation: string): never => {
  throw new TypeError(
    `Symbolic value ${plannedDescription(expression)} was inspected by ${operation} while compiling a Flow. ` +
      "Use Expr.* or Flow.branch so the operation is represented in portable Plan IR."
  )
}

const makePlanned = <T>(expression: ValueExpr): Planned<T> => {
  const target = (): never => unsupportedComputation(expression, "function application")
  const planned = new Proxy(target, {
    get(_target, key) {
      if (key === DurableExpression) return expression
      if (key === "then") return undefined
      if (key === Symbol.toPrimitive || key === "valueOf" || key === "toString" || key === "toJSON") {
        return () => unsupportedComputation(expression, String(key))
      }
      if (typeof key === "symbol") return unsupportedComputation(expression, `symbol property ${String(key)}`)
      return makePlanned(projection(expression, key))
    },
    apply: () => unsupportedComputation(expression, "function application"),
    construct: () => unsupportedComputation(expression, "construction"),
    has: () => unsupportedComputation(expression, "property existence"),
    ownKeys: () => unsupportedComputation(expression, "property enumeration"),
    getOwnPropertyDescriptor: () => unsupportedComputation(expression, "property descriptor inspection")
  }) as unknown as Planned<T>
  plannedExpressions.set(planned as unknown as object, expression)
  return planned
}

const expressionOf = (value: unknown): ValueExpr | undefined => {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return undefined
  const trusted = plannedExpressions.get(value as object)
  if (trusted !== undefined) return trusted
  const descriptor = Object.getOwnPropertyDescriptor(value, DurableExpression)
  if (descriptor === undefined) return undefined
  if (!("value" in descriptor)) {
    throw new TypeError("A durable expression carrier cannot expose its IR through an accessor")
  }
  return descriptor.value as ValueExpr | undefined
}

const MAX_CAPTURE_DEPTH = 256

const toValueExprInner = (value: unknown, seen: Set<object>, depth: number): ValueExpr => {
  if (depth > MAX_CAPTURE_DEPTH) throw new TypeError("Flow captured value exceeds the durable nesting limit")
  const planned = expressionOf(value)
  if (planned !== undefined) return planned
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return { kind: "literal", value: assertJson(value, "Flow captured literal") }
  }
  if (typeof value !== "object") throw new TypeError(`Flow captured non-durable ${typeof value}`)
  if (seen.has(value)) throw new TypeError("Flow captured a cyclic value")
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
      const length = lengthDescriptor !== undefined && "value" in lengthDescriptor
        ? lengthDescriptor.value as number
        : -1
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue
        if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
          throw new TypeError(`Flow captured an array with unexpected property ${String(key)}`)
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!
        if (!("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(`Flow captured an array accessor or hidden property at index ${key}`)
        }
      }
      const items: ValueExpr[] = []
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(`Flow captured a sparse or hidden array index ${index}`)
        }
        items.push(toValueExprInner(descriptor.value, seen, depth + 1))
      }
      return { kind: "array", items }
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Flow captured non-durable ${prototype?.constructor?.name ?? "object"}`)
    }
    const descriptors = new Map<string, PropertyDescriptor>()
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError("Flow captured an object with a symbol property")
      assertJson(key, "Flow captured object key")
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`Flow captured an accessor or hidden property ${key}`)
      }
      descriptors.set(key, descriptor)
    }
    const fields = Object.create(null) as Record<string, ValueExpr>
    for (const key of [...descriptors.keys()].sort()) {
      fields[key] = toValueExprInner(descriptors.get(key)!.value, seen, depth + 1)
    }
    return { kind: "object", fields }
  } finally {
    seen.delete(value)
  }
}

export const toValueExpr = (value: unknown): ValueExpr =>
  toValueExprInner(value, new Set(), 0)

const binary = <Result>(operator: BinaryOperator, left: unknown, right: unknown): Planned<Result> =>
  makePlanned({ kind: "binary", operator, left: toValueExpr(left), right: toValueExpr(right) })

export const Expr = {
  eq: (left: unknown, right: unknown): Planned<boolean> => binary("eq", left, right),
  neq: (left: unknown, right: unknown): Planned<boolean> => binary("neq", left, right),
  gt: (left: unknown, right: unknown): Planned<boolean> => binary("gt", left, right),
  gte: (left: unknown, right: unknown): Planned<boolean> => binary("gte", left, right),
  lt: (left: unknown, right: unknown): Planned<boolean> => binary("lt", left, right),
  lte: (left: unknown, right: unknown): Planned<boolean> => binary("lte", left, right),
  and: (left: unknown, right: unknown): Planned<boolean> => binary("and", left, right),
  or: (left: unknown, right: unknown): Planned<boolean> => binary("or", left, right),
  add: (left: unknown, right: unknown): Planned<number> => binary("add", left, right),
  concat: (left: unknown, right: unknown): Planned<string> => binary("concat", left, right),
  not: (value: unknown): Planned<boolean> => makePlanned({ kind: "unary", operator: "not", value: toValueExpr(value) })
} as const

const actionFromDescriptor = <Input, Success, Failure = never>(
  rawDescriptor: ActionDescriptor
): DurableAction<Input, Success, Failure> => {
  const descriptor = validateActionContractDescriptor(rawDescriptor)
  const id = descriptor.id
  const version = descriptor.version
  return Object.freeze({
    descriptor,
    run(input: PlannedInput<Input>): Planned<Success> {
      const planner = currentPlanner()
      planner.registerAction(descriptor)
      const inputExpression = toValueExpr(input)
      const nodeId = planner.allocate(id)
      const node: ActionNode = {
        kind: "action",
        id: nodeId,
        actionId: id,
        actionVersion: version,
        actionContractDigest: descriptor.contractDigest,
        input: inputExpression,
        dependencies: expressionDependencies(inputExpression),
        controlDependencies: planner.controlDependencies,
        debug: { label: id }
      }
      planner.nodes.push(node)
      return makePlanned({ kind: "node", nodeId, path: [] })
    }
  })
}

const defineAction = <Input, Success, Failure = never>(options: {
  readonly id: string
  readonly version: number
}): DurableAction<Input, Success, Failure> => {
  const id = options.id
  const version = options.version
  if (typeof id !== "string" || id.trim() === "") throw new TypeError("Action id must be non-empty")
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError(`Action ${id} version must be a positive integer`)
  }
  const inputSchema = derivedSchema("input")
  const successSchema = derivedSchema("success")
  const errorSchema = derivedSchema("error")
  const contract = { id, version, inputSchema, successSchema, errorSchema }
  return actionFromDescriptor(deepFreeze({ ...contract, contractDigest: digest(contract) }))
}

const compileFragment = (planner: Planner, body: () => unknown): PlanFragment => {
  const value = underPlanner(planner, body)
  return { nodes: planner.nodes, output: toValueExpr(value) }
}

const nodeReferences = (node: PlanNode): readonly string[] => {
  const expressions = node.kind === "action"
    ? [node.input]
    : node.kind === "parallel"
      ? node.outputs
      : node.kind === "timer"
        ? [node.durationMs]
        : node.kind === "signal"
          ? []
        : node.kind === "fanout"
          ? [node.items]
          : node.kind === "loop"
            ? [node.initial]
            : node.kind === "childFlow"
              ? [node.input]
              : [node.condition]
  return uniqueSorted([
    ...node.dependencies,
    ...node.controlDependencies,
    ...expressions.flatMap(expressionDependencies)
  ])
}

/**
 * Branch bodies are lexical Plan fragments. A Planned value may refer to a
 * node in its own fragment or an enclosing fragment, but never a sibling arm,
 * a branch child that escaped into its parent, or another Flow compilation.
 */
const validateFragmentScope = (fragment: PlanFragment, inherited: ReadonlySet<string>): void => {
  const available = new Set(inherited)
  for (const node of fragment.nodes) {
    for (const reference of nodeReferences(node)) {
      if (!available.has(reference)) {
        throw new TypeError(
          `Plan node ${node.id} references unavailable node ${reference}; ` +
            "a Planned value escaped a branch arm or another lexical Flow fragment"
        )
      }
    }
    if (node.kind === "branch") {
      validateFragmentScope(node.whenTrue, available)
      validateFragmentScope(node.whenFalse, available)
    }
    available.add(node.id)
  }
  for (const reference of expressionDependencies(fragment.output)) {
    if (!available.has(reference)) {
      throw new TypeError(
        `Plan output references unavailable node ${reference}; ` +
          "a Planned value escaped a branch arm or another lexical Flow fragment"
      )
    }
  }
}

const branch = <Result>(
  condition: boolean | Planned<boolean>,
  whenTrue: () => PlannedInput<Result>,
  whenFalse: () => PlannedInput<Result>
): Planned<Result> => {
  const conditionExpression = toValueExpr(condition)
  if (conditionExpression.kind === "literal") {
    if (typeof conditionExpression.value !== "boolean") throw new TypeError("Flow.branch condition must be boolean")
    return makePlanned(toValueExpr(conditionExpression.value ? whenTrue() : whenFalse()))
  }
  const planner = currentPlanner()
  const id = planner.allocate("branch")
  const truePlanner = new Planner(`${id}.true.`, planner.shared)
  const falsePlanner = new Planner(`${id}.false.`, planner.shared)
  const whenTrueFragment = compileFragment(truePlanner, whenTrue)
  const whenFalseFragment = compileFragment(falsePlanner, whenFalse)
  const node: BranchNode = {
    kind: "branch",
    id,
    condition: conditionExpression,
    whenTrue: whenTrueFragment,
    whenFalse: whenFalseFragment,
    dependencies: expressionDependencies(conditionExpression),
    controlDependencies: planner.controlDependencies,
    debug: { label: "branch" }
  }
  planner.nodes.push(node)
  return makePlanned({ kind: "node", nodeId: id, path: [] })
}

type Step = () => unknown
type StepResult<Function> = Function extends () => infer Result ? Result : never
type Last<Values extends readonly unknown[]> = Values extends readonly [...unknown[], infer Value] ? Value : never

const parallel = <const Steps extends readonly Step[]>(
  ...steps: Steps
): Planned<{ readonly [Index in keyof Steps]: StepResult<Steps[Index]> }> => {
  if (steps.length === 0) throw new TypeError("Flow.parallel needs at least one arm")
  const planner = currentPlanner()
  const before = planner.nodes.length
  const results = steps.map((step) => step())
  const expressions = results.map(toValueExpr)
  const emitted = planner.nodes.slice(before).map((node) => node.id)
  const id = planner.allocate("parallel")
  const node: ParallelNode = {
    kind: "parallel",
    id,
    outputs: expressions,
    dependencies: uniqueSorted(expressions.flatMap(expressionDependencies)),
    controlDependencies: uniqueSorted([...planner.controlDependencies, ...emitted]),
    debug: { label: "parallel" }
  }
  planner.nodes.push(node)
  return makePlanned({ kind: "node", nodeId: id, path: [] })
}

const sequence = <const Steps extends readonly Step[]>(...steps: Steps): StepResult<Last<Steps>> => {
  if (steps.length === 0) throw new TypeError("Flow.sequence needs at least one step")
  const planner = currentPlanner()
  const saved = planner.controlDependencies
  let result: unknown
  try {
    for (const step of steps) {
      const before = planner.nodes.length
      result = step()
      const emitted = planner.nodes.slice(before).map((node) => node.id)
      const resultDependencies = expressionDependencies(toValueExpr(result))
      planner.controlDependencies = uniqueSorted([
        ...planner.controlDependencies,
        ...emitted,
        ...resultDependencies
      ])
    }
  } finally {
    planner.controlDependencies = saved
  }
  return result as StepResult<Last<Steps>>
}

const defineFlow = <Input, Success>(
  options: { readonly id: string; readonly version: number },
  callback: (input: Planned<Input>) => PlannedInput<Success>
): CompiledFlow<Input, Success> => {
  const id = options.id
  const version = options.version
  if (typeof id !== "string" || id.trim() === "") throw new TypeError("Flow id must be non-empty")
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError(`Flow ${id} version must be a positive integer`)
  }
  const shared: SharedPlanningState = { actions: new Map() }
  const planner = new Planner("", shared)
  const input = makePlanned<Input>({ kind: "input", path: [] })
  const output = underPlanner(planner, () => callback(input))
  const semantic = {
    formatVersion: 1 as const,
    flowId: id,
    flowVersion: version,
    nodes: planner.nodes,
    output: toValueExpr(output),
    requirements: [...shared.actions.keys()].sort(),
    actions: [...shared.actions.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  }
  validateFragmentScope(semantic, new Set())
  const plan: PlanTemplate = deepFreeze({ ...semantic, digest: digest(semantic) })
  return Object.freeze({ id, version, plan })
}

export const Action = { define: defineAction, fromDescriptor: actionFromDescriptor } as const

export const Flow = {
  define: defineFlow,
  branch,
  parallel,
  sequence
} as const

/** A typed domain failure; defects remain ordinary thrown values. */
export class ActionFailure<Failure extends JsonValue = JsonValue> extends Error {
  readonly _tag = "ActionFailure"
  constructor(readonly failure: Failure) {
    super("Durable Action reported a typed failure")
    this.name = "ActionFailure"
  }
}

export const fail = <Failure extends JsonValue>(failure: Failure): never => {
  throw new ActionFailure(failure)
}

export const literal = <Value extends JsonValue>(value: Value): Planned<Value> =>
  makePlanned({ kind: "literal", value: deepFreeze(assertJson(value, "durable literal")) as Value })
