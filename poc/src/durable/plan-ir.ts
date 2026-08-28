/**
 * The Plan node graph: `ValueExpr`, the nine `PlanNode` kinds, the fan-out and
 * loop templates, and `PlanTemplate`.
 *
 * Split out of `ir.ts` unchanged. Everything here describes the static Plan;
 * the value-expression language it is built from lives in `value.ts` and does
 * not depend on this file. `ir.ts` re-exports both halves, so no import path
 * moved with the split.
 */
import {
  type ActionDescriptor,
  digest,
  type DurableSchema,
  type JsonValue,
  type StructuralDurableSchema,
  uniqueSorted
} from "./value.ts"

export type UnaryOperator = "not"
export type BinaryOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "and"
  | "or"
  | "add"
  | "concat"

/** Portable values are the only values allowed to cross plan/runtime phases. */
export type ValueExpr =
  | { readonly kind: "literal"; readonly value: JsonValue }
  | { readonly kind: "input"; readonly path: readonly string[] }
  | { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] }
  | { readonly kind: "array"; readonly items: readonly ValueExpr[] }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, ValueExpr>> }
  | { readonly kind: "unary"; readonly operator: UnaryOperator; readonly value: ValueExpr }
  | {
    readonly kind: "binary"
    readonly operator: BinaryOperator
    readonly left: ValueExpr
    readonly right: ValueExpr
  }

export interface NodeBase {
  readonly id: string
  readonly dependencies: readonly string[]
  readonly controlDependencies: readonly string[]
  readonly debug?: { readonly label?: string; readonly callSite?: string }
}

export interface ActionNode extends NodeBase {
  readonly kind: "action"
  readonly actionId: string
  readonly actionVersion: number
  readonly actionContractDigest: string
  readonly input: ValueExpr
}

export interface ParallelNode extends NodeBase {
  readonly kind: "parallel"
  readonly outputs: readonly ValueExpr[]
}

/**
 * A coordinator-owned durable suspension. The relative duration is part of
 * the immutable Plan; the store derives and persists one absolute wake time
 * the first time the node is reached.
 */
export interface TimerNode extends NodeBase {
  readonly kind: "timer"
  readonly durationMs: ValueExpr
}

/**
 * A compiler-owned suspension waiting for exactly one externally delivered
 * value. The authored identity and compiler-derived payload schema are part of
 * immutable Plan identity; an external sender cannot supply or widen them.
 *
 * `waitSignal<T>("name")` is a provisional source spelling for this POC. The
 * persisted node contract is the architectural seam, not that spelling.
 *
 * `delivery` is absent for the original unicast form — one delivery addressed
 * to exactly one (execution, node) inbox — so every pre-existing artifact keeps
 * its exact bytes and `signalContractDigest`. `delivery: "broadcast"`
 * (Plan format version 3) selects the fan-out form in which one delivery
 * addressed to the signal identity satisfies every execution subscribed to it,
 * and it participates in the contract digest, so a broadcast identity can never
 * be confused with a unicast identity of the same name.
 */
export interface SignalNode extends NodeBase {
  readonly kind: "signal"
  readonly signalId: string
  readonly payloadSchema: StructuralDurableSchema
  readonly signalContractDigest: string
  readonly delivery?: "broadcast"
}

/** Canonical signal contract identity; unicast keeps its original bytes. */
export const signalContractIdentity = (
  signalId: string,
  payloadSchema: StructuralDurableSchema,
  delivery?: "broadcast"
): string =>
  delivery === "broadcast"
    ? digest({ delivery, signalId, payloadSchema })
    : digest({ signalId, payloadSchema })

/**
 * A compiler-owned suspension that consumes exactly one item from a durable,
 * multi-producer queue (Plan format version 3). The queue identity and the
 * compiler-derived item schema are part of immutable Plan identity; a producer
 * supplies neither. Consumption commits the item's terminal state together with
 * the node's success, so two coordinators can never hand the same item to two
 * consumers, and a waiting node holds no worker lease.
 *
 * `dequeue<Item>("queue.id")` is a provisional source spelling; the persisted
 * node contract is the architectural seam.
 */
export interface QueueNode extends NodeBase {
  readonly kind: "queue"
  readonly queueId: string
  readonly itemSchema: StructuralDurableSchema
  readonly queueContractDigest: string
}

/** Canonical queue contract identity shared by consumers and the store. */
export const queueContractIdentity = (
  queueId: string,
  itemSchema: StructuralDurableSchema
): string => digest({ queueId, itemSchema })

/**
 * A deliberately bounded parameterized expression. It can read only the
 * current fan-out item, the durable results of earlier steps in the same
 * per-item template, and canonical JSON literals; it cannot capture Flow
 * state, call code, or reference another Plan node. The `step` form exists
 * only in Plan format version 2 multi-step fan-out templates.
 */
export type FanOutTemplateExpr =
  | { readonly kind: "item"; readonly path: readonly string[] }
  | { readonly kind: "step"; readonly step: number; readonly path: readonly string[] }
  | { readonly kind: "literal"; readonly value: JsonValue }
  | { readonly kind: "array"; readonly items: readonly FanOutTemplateExpr[] }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, FanOutTemplateExpr>> }

/** One statically pinned Action call inside a per-item fan-out template. */
export interface FanOutStep {
  readonly actionId: string
  readonly actionVersion: number
  readonly actionContractDigest: string
  readonly input: FanOutTemplateExpr
}

/**
 * One runtime-sized collection mapped through exactly one statically selected
 * Action. Dynamic child identities are derived from this node id and each
 * canonical scalar key, never from the item's array index. This flat encoding
 * is the only fan-out encoding accepted in Plan format version 1.
 */
export interface SingleActionFanOutNode extends NodeBase {
  readonly kind: "fanout"
  readonly items: ValueExpr
  /** Direct projection from the current item; an empty path keys scalar items. */
  readonly keyPath: readonly string[]
  readonly actionId: string
  readonly actionVersion: number
  readonly actionContractDigest: string
  readonly input: FanOutTemplateExpr
}

/**
 * A runtime-sized collection mapped through a bounded per-item SEQUENCE of
 * statically pinned Action steps (Plan format version 2). Child identities are
 * derived from this node id, the canonical item key, and the step ordinal;
 * step inputs may project the current item and earlier steps' durable results.
 */
export interface MultiStepFanOutNode extends NodeBase {
  readonly kind: "fanout"
  readonly items: ValueExpr
  /** Direct projection from the current item; an empty path keys scalar items. */
  readonly keyPath: readonly string[]
  readonly steps: readonly FanOutStep[]
}

export type FanOutNode = SingleActionFanOutNode | MultiStepFanOutNode

/** Normalizes both fan-out encodings into the ordered step sequence. */
export const fanOutSteps = (node: FanOutNode): readonly FanOutStep[] =>
  "steps" in node
    ? node.steps
    : [{
      actionId: node.actionId,
      actionVersion: node.actionVersion,
      actionContractDigest: node.actionContractDigest,
      input: node.input
    }]

/**
 * A deliberately bounded parameterized expression over one durable loop
 * state value. Beyond projections and literals it admits the same canonical
 * pure operators as ValueExpr, so a `while`-style condition and a next-state
 * input can be represented without ever calling author code. Plan format
 * version 2 only.
 */
export type LoopTemplateExpr =
  | { readonly kind: "state"; readonly path: readonly string[] }
  | { readonly kind: "literal"; readonly value: JsonValue }
  | { readonly kind: "array"; readonly items: readonly LoopTemplateExpr[] }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, LoopTemplateExpr>> }
  | { readonly kind: "unary"; readonly operator: UnaryOperator; readonly value: LoopTemplateExpr }
  | {
    readonly kind: "binary"
    readonly operator: BinaryOperator
    readonly left: LoopTemplateExpr
    readonly right: LoopTemplateExpr
  }

/**
 * A runtime-round `while`-style durable loop as a next-round handoff
 * template (Plan format version 2). Each round instantiates exactly one
 * pinned Action from the current durable state; the Action's success becomes
 * the next round's state. Round children derive their identity from this
 * node id and the round ordinal. The explicit round budget makes exhaustion
 * a durable terminal defect rather than a hang.
 */
export interface LoopNode extends NodeBase {
  readonly kind: "loop"
  readonly initial: ValueExpr
  /** Boolean template over the current state; false completes the loop. */
  readonly condition: LoopTemplateExpr
  readonly actionId: string
  readonly actionVersion: number
  readonly actionContractDigest: string
  /** Action input template over the current state. */
  readonly body: LoopTemplateExpr
  readonly maxRounds: number
}

/**
 * A statically resolved invocation of another compiled durable Flow. The child
 * runs as its own pinned execution with its own journal; the node's value is
 * the child execution's terminal Flow success, adopted run-locally before
 * exposure. The `ChildFlow.run(input)` source spelling is provisional; the
 * persisted node contract is the architectural seam. Plan format version 2.
 */
export interface ChildFlowNode extends NodeBase {
  readonly kind: "childFlow"
  readonly flowId: string
  readonly flowVersion: number
  /** Exact digest of the embedded child Plan this node instantiates. */
  readonly planDigest: string
  readonly input: ValueExpr
}

export interface BranchNode extends NodeBase {
  readonly kind: "branch"
  readonly condition: ValueExpr
  readonly whenTrue: PlanFragment
  readonly whenFalse: PlanFragment
}

export type PlanNode =
  | ActionNode
  | ParallelNode
  | TimerNode
  | SignalNode
  | QueueNode
  | FanOutNode
  | LoopNode
  | ChildFlowNode
  | BranchNode

export interface PlanFragment {
  readonly nodes: readonly PlanNode[]
  readonly output: ValueExpr
}

export interface FlowSchemas {
  readonly input: DurableSchema
  readonly success: DurableSchema
  readonly error?: DurableSchema
}

/**
 * Format version 1 is the original bounded node set with the flat fan-out
 * encoding. Format version 2 additionally permits multi-step fan-out `steps`
 * encodings, round-budgeted loop nodes, and child-Flow nodes with embedded
 * child Plans. Format version 3 additionally permits durable `queue` consumer
 * nodes and the `delivery: "broadcast"` signal form. The compiler emits the
 * minimal version a Plan needs, so pre-existing artifacts remain byte- and
 * digest-stable; a lower-version artifact claiming a higher version's feature
 * is rejected with an explicit version diagnostic.
 */
/**
 * How a Plan's control flow was established.
 *
 * `"proxy-recorded"` means the Plan was recorded by *running* an authoring
 * callback with a Proxy standing in for each symbolic value. JavaScript offers
 * no trap for ToBoolean, `&&`/`||`/`??`, `typeof`, `===`, `Array.isArray`, or
 * `Object.is`, so such a callback's control flow cannot be verified at record
 * time. `authoring.ts` refuses every form it can account for, but a Plan
 * carrying this marker still has an *unverified construction* and must not be
 * mistaken for one the source compiler checked.
 *
 * Absence means the Plan came from a path without that limitation — the `.sm`
 * source compiler, which fails closed on the same programs with
 * SMITHERS4106/4107/4111 — or from an artifact predating this marker. Absence
 * is therefore not a positive claim of verification, only the lack of a
 * negative one; see `signed-deployment.ts` for the trust decision.
 */
export type PlanProvenance = "proxy-recorded"

export const PLAN_PROVENANCE_PROXY_RECORDED = "proxy-recorded" as const satisfies PlanProvenance

export interface PlanTemplate extends PlanFragment {
  readonly formatVersion: 1 | 2 | 3
  readonly flowId: string
  readonly flowVersion: number
  /** Compiler-derived persistence contract. Absent only on legacy POC artifacts. */
  readonly flowSchemas?: FlowSchemas
  /** Present only when the Plan's construction could not be statically verified. */
  readonly provenance?: PlanProvenance
  readonly requirements: readonly string[]
  readonly actions: readonly ActionDescriptor[]
  /** Embedded, digest-pinned Plans instantiated by childFlow nodes (format version 2). */
  readonly childFlows?: readonly PlanTemplate[]
  readonly digest: string
}

export const expressionDependencies = (expression: ValueExpr): readonly string[] => {
  const found = new Set<string>()
  const pending: ValueExpr[] = [expression]
  while (pending.length > 0) {
    const current = pending.pop()!
    switch (current.kind) {
      case "node":
        found.add(current.nodeId)
        break
      case "array":
        pending.push(...current.items)
        break
      case "object":
        pending.push(...Object.values(current.fields))
        break
      case "unary":
        pending.push(current.value)
        break
      case "binary":
        pending.push(current.left, current.right)
        break
      case "input":
      case "literal":
        break
    }
  }
  return uniqueSorted(found)
}

export const allPlanNodes = (fragment: PlanFragment): readonly PlanNode[] => {
  const out: PlanNode[] = []
  const visit = (value: PlanFragment): void => {
    for (const node of value.nodes) {
      out.push(node)
      if (node.kind === "branch") {
        visit(node.whenTrue)
        visit(node.whenFalse)
      }
    }
  }
  visit(fragment)
  return out
}

export const fragmentNodeIds = (fragment: PlanFragment): readonly string[] =>
  allPlanNodes(fragment).map((node) => node.id)
