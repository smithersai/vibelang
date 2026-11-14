/**
 * A trellis: a delegation plan a model wrote, checked against a fixed
 * envelope and run. A plan is nested `agent`, `sequence` and `parallel`
 * nodes.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"

/**
 * Why a plan or an envelope was refused.
 *
 * @category models
 * @since 0.0.13
 */
export type TrellisErrorCode =
  | "invalid_envelope"
  | "invalid_plan"
  | "depth_exceeded"
  | "fanout_exceeded"
  | "fuel_exhausted"

/**
 * A refused plan or envelope. `path` names the plan node an author has to
 * repair, such as `root.parallel[1].sequence[0]`.
 *
 * @category errors
 * @since 0.0.13
 */
export class TrellisError extends Data.TaggedError("TrellisError")<{
  readonly code: TrellisErrorCode
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * The bounds a plan is admitted under: `fuel` is the total leaf calls,
 * `depth` the nesting depth, and `fanout` the most members of one container.
 *
 * @category models
 * @since 0.0.13
 */
export interface Envelope {
  readonly fuel: number
  readonly depth: number
  readonly fanout: number
}

/**
 * A plan: one agent, an ordered sequence, or a parallel group. A container
 * holds at least one member.
 *
 * @category models
 * @since 0.0.13
 */
export type Plan =
  | { readonly agent: { readonly goal: string; readonly seat?: string | undefined } }
  | { readonly sequence: readonly [Plan, ...ReadonlyArray<Plan>] }
  | { readonly parallel: readonly [Plan, ...ReadonlyArray<Plan>] }

/**
 * The schema of one agent node's `agent` field.
 *
 * @category schemas
 * @since 0.0.13
 */
export const Agent = Schema.Struct({
  goal: Schema.NonEmptyString,
  seat: Schema.optional(Schema.String)
})

// Excess keys are kept so the one-key check can refuse them, instead of
// Struct decoding dropping them.
const PlanSchema: Schema.Codec<Plan> = Schema.suspend(
  (): Schema.Codec<Plan> =>
    Schema.Union([
      Schema.StructWithRest(
        Schema.Struct({
          agent: Agent,
          sequence: Schema.optionalKey(Schema.Never),
          parallel: Schema.optionalKey(Schema.Never)
        }),
        [Schema.Record(Schema.String, Schema.Unknown)]
      ),
      Schema.StructWithRest(
        Schema.Struct({
          sequence: Schema.NonEmptyArray(PlanSchema),
          agent: Schema.optionalKey(Schema.Never),
          parallel: Schema.optionalKey(Schema.Never)
        }),
        [Schema.Record(Schema.String, Schema.Unknown)]
      ),
      Schema.StructWithRest(
        Schema.Struct({
          parallel: Schema.NonEmptyArray(PlanSchema),
          agent: Schema.optionalKey(Schema.Never),
          sequence: Schema.optionalKey(Schema.Never)
        }),
        [Schema.Record(Schema.String, Schema.Unknown)]
      )
    ]).check(Schema.isMaxProperties(1))
)

/**
 * The schema of a plan: the closed grammar a model that writes plans answers
 * in. It accepts what {@link validate} accepts, apart from the envelope.
 *
 * @category schemas
 * @since 0.0.13
 */
export const Plan = PlanSchema

/**
 * One leaf of a plan: the goal, the seat the model asked for, and the plan
 * path the leaf came from.
 *
 * @category models
 * @since 0.0.13
 */
export interface Leaf {
  readonly goal: string
  readonly seat?: string | undefined
  readonly path: string
}

type AgentNode = { readonly agent: { readonly goal: string; readonly seat?: string | undefined } }

const container = (plan: Plan): ReadonlyArray<Plan> | undefined =>
  "sequence" in plan ? plan.sequence : "parallel" in plan ? plan.parallel : undefined

const childPath = (path: string, plan: Plan, index: number): string =>
  `${path}.${"sequence" in plan ? "sequence" : "parallel"}[${index}]`

const leafOf = (node: Plan, path: string): Leaf => {
  const agent = (node as AgentNode).agent
  return agent.seat === undefined ? { goal: agent.goal, path } : { goal: agent.goal, seat: agent.seat, path }
}

/**
 * Lists a plan's leaves in plan order. Their count is what the plan costs in
 * fuel, and their paths are stable keys for leaf outputs.
 *
 * @throws never
 * @category introspection
 * @since 0.0.13
 */
export const leaves = (plan: Plan): ReadonlyArray<Leaf> => {
  const collected: Array<Leaf> = []
  const visit = (node: Plan, path: string): void => {
    const members = container(node)
    if (members === undefined) {
      collected.push(leafOf(node, path))
      return
    }
    members.forEach((member, index) => visit(member, childPath(path, node, index)))
  }
  visit(plan, "root")
  return collected
}

const bounded = (value: number): boolean => Number.isSafeInteger(value) && value >= 1

// A structural copy, so an Effect that runs later visits the leaves the plan
// named at the call.
const copiedPlan = (plan: Plan): Plan => {
  const members = container(plan)
  if (members === undefined) {
    const agent = (plan as AgentNode).agent
    return { agent: agent.seat === undefined ? { goal: agent.goal } : { goal: agent.goal, seat: agent.seat } }
  }
  const copies: readonly [Plan, ...ReadonlyArray<Plan>] = [copiedPlan(members[0]!), ...members.slice(1).map(copiedPlan)]
  return "sequence" in plan ? { sequence: copies } : { parallel: copies }
}

const shape = (value: unknown): "agent" | "sequence" | "parallel" | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const keys = Object.keys(value)
  if (keys.length !== 1) return undefined
  const key = keys[0]
  return key === "agent" || key === "sequence" || key === "parallel" ? key : undefined
}

/**
 * Checks a value a model wrote against an envelope and returns every reason
 * it was refused, each naming its plan path. An admitted plan returns none.
 * Fuel is checked for the whole plan, so a plan is admitted or refused as a
 * unit.
 *
 * @throws never
 * @category validation
 * @since 0.0.13
 */
export const validate = (plan: unknown, envelope: Envelope): ReadonlyArray<TrellisError> => {
  if (!bounded(envelope.fuel) || !bounded(envelope.depth) || !bounded(envelope.fanout)) {
    return [
      new TrellisError({
        code: "invalid_envelope",
        path: "root",
        message: "Trellis envelope fuel, depth, and fanout must be positive safe integers"
      })
    ]
  }
  const found: Array<TrellisError> = []
  const refuse = (code: TrellisErrorCode, path: string, message: string): void => {
    found.push(new TrellisError({ code, path, message }))
  }
  let leafCount = 0
  const visit = (value: unknown, path: string, depth: number): void => {
    const kind = shape(value)
    if (kind === undefined) {
      return refuse("invalid_plan", path, "A plan node must be exactly one of agent, sequence, or parallel")
    }
    if (depth > envelope.depth) {
      return refuse("depth_exceeded", path, `Plan depth ${depth} exceeds the envelope depth ${envelope.depth}`)
    }
    if (kind === "agent") {
      const agent = (value as { readonly agent: unknown }).agent
      if (typeof agent !== "object" || agent === null) {
        return refuse("invalid_plan", `${path}.agent`, "agent must be an object")
      }
      const goal = (agent as { readonly goal?: unknown }).goal
      const seat = (agent as { readonly seat?: unknown }).seat
      if (typeof goal !== "string" || goal.length === 0) {
        refuse("invalid_plan", `${path}.agent.goal`, "agent.goal must be a non-empty string")
      }
      if (seat !== undefined && typeof seat !== "string") {
        refuse("invalid_plan", `${path}.agent.seat`, "agent.seat must be a string")
      }
      leafCount += 1
      return
    }
    const members = (value as { readonly [key: string]: unknown })[kind]
    if (!Array.isArray(members)) return refuse("invalid_plan", `${path}.${kind}`, `${kind} must be an array`)
    if (members.length === 0) return refuse("invalid_plan", path, `${kind} must hold at least one member`)
    if (members.length > envelope.fanout) {
      return refuse(
        "fanout_exceeded",
        path,
        `${kind} declares ${members.length} members, above the envelope fan-out ${envelope.fanout}`
      )
    }
    // A hole is a missing member `forEach` would skip, so walk every index.
    for (let index = 0; index < members.length; index++) {
      const memberPath = `${path}.${kind}[${index}]`
      if (index in members) visit(members[index], memberPath, depth + 1)
      else refuse("invalid_plan", memberPath, "A plan node must not be a missing member")
    }
  }
  visit(plan, "root", 1)
  if (found.length === 0 && leafCount > envelope.fuel) {
    refuse("fuel_exhausted", "root", `Plan needs ${leafCount} leaf calls but only ${envelope.fuel} fuel remains`)
  }
  return found
}

/**
 * Runs a validated plan with at most `concurrency` leaves in flight across the
 * whole plan. Sequence members run in plan order; parallel members start
 * together. A container's result is its members' results in plan order,
 * whatever order they finish in.
 *
 * Fails with `TrellisError` (`invalid_envelope`) when `concurrency` is not a
 * positive safe integer, and with a leaf's own failure.
 *
 * @category combinators
 * @since 0.0.13
 */
export const execute = <E, R>(
  plan: Plan,
  options: {
    readonly leaf: (input: Leaf) => Effect.Effect<unknown, E, R>
    readonly concurrency: number
  }
): Effect.Effect<unknown, E | TrellisError, R> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the plan or the options in between must not reach it.
  const admitted = copiedPlan(plan)
  const runLeaf = options.leaf
  const concurrency = options.concurrency
  if (!bounded(concurrency)) {
    return Effect.fail(
      new TrellisError({
        code: "invalid_envelope",
        path: "root",
        message: `Trellis concurrency must be a positive safe integer, received ${concurrency}`
      })
    )
  }
  return Effect.flatMap(Semaphore.make(concurrency), (semaphore) => {
    const visit = (node: Plan, path: string): Effect.Effect<unknown, E, R> => {
      const members = container(node)
      if (members === undefined) return semaphore.withPermits(1)(runLeaf(leafOf(node, path)))
      return Effect.forEach(
        members,
        (member, index) => visit(member, childPath(path, node, index)),
        { concurrency: "parallel" in node ? "unbounded" : 1 }
      )
    }
    return visit(admitted, "root")
  })
}
