/**
 * A merge queue: land a set of members in one prioritized order, at a
 * concurrency the queue owns rather than the members.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { safeIntegerPriorityRefusal } from "./internal.js"
import { PatternError } from "./PatternError.js"

/**
 * The priority a member gets when it names none and the queue sets no
 * `priority`.
 *
 * @category constants
 * @since 0.0.13
 */
export const DefaultPriority = 1000

/**
 * What a failing member does to the members behind it. `halt` fails the
 * queue and lands nothing behind it; `quarantine` records the failure and
 * lands the rest.
 *
 * @category models
 * @since 0.0.13
 */
export type FailurePolicy = "halt" | "quarantine"

/**
 * One member of the queue. `run` receives the member's id, its position in
 * the queue counted from 0, and the queue's input.
 *
 * @category models
 * @since 0.0.13
 */
export interface RuntimeMember<I, Out, E, R> {
  readonly id: string
  readonly priority?: number | undefined
  readonly run: (args: { readonly id: string; readonly position: number; readonly input: I }) => Effect.Effect<Out, E, R>
}

/**
 * The options of {@link run}. `concurrency` defaults to 1, and `halt`
 * requires 1: a wider batch starts a member before the one ahead of it has
 * failed. `priority` is the default for a member that names none.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, Out, E, R> {
  readonly members: ReadonlyArray<RuntimeMember<I, Out, E, R>>
  readonly concurrency?: number | undefined
  readonly priority?: number | undefined
  readonly failurePolicy: FailurePolicy
}

/**
 * A member that landed.
 *
 * @category models
 * @since 0.0.13
 */
export interface Landed<Out> {
  readonly id: string
  readonly output: Out
}

/**
 * A member the queue held back because it failed.
 *
 * @category models
 * @since 0.0.13
 */
export interface Quarantined<E> {
  readonly id: string
  readonly error: E
}

/**
 * What a queue pass landed and held back, in queue order. `order` is the
 * order the queue used, so the decision shows even when every member landed.
 *
 * @category models
 * @since 0.0.13
 */
export interface Result<Out, E> {
  readonly landed: ReadonlyArray<Landed<Out>>
  readonly quarantined: ReadonlyArray<Quarantined<E>>
  readonly order: ReadonlyArray<string>
}

/**
 * A member with its effective priority and its queue position resolved.
 *
 * @category models
 * @since 0.0.13
 */
export interface Position<M> {
  readonly id: string
  readonly priority: number
  readonly position: number
  readonly member: M
}

const priorityRefusal = (
  members: ReadonlyArray<{ readonly id: string; readonly priority?: number | undefined }>,
  priority: number
): PatternError | undefined => {
  for (const member of members) {
    const refusal = safeIntegerPriorityRefusal("MergeQueue", member.id, member.priority ?? priority)
    if (refusal !== undefined) return refusal
  }
  return undefined
}

/**
 * Resolves each member's effective priority and sorts the queue: descending
 * priority, and declaration order among equal priorities, so the order
 * depends on the declaration alone.
 *
 * @throws {PatternError} `invalid_decorator` when an effective priority is
 * not a safe integer.
 * @category introspection
 * @since 0.0.13
 */
export const ordered = <M extends { readonly id: string; readonly priority?: number | undefined }>(
  members: ReadonlyArray<M>,
  priority: number
): ReadonlyArray<Position<M>> => {
  const refusal = priorityRefusal(members, priority)
  if (refusal !== undefined) throw refusal
  return members
    .map((member, index) => ({ id: member.id, priority: member.priority ?? priority, position: index, member }))
    .sort((left, right) =>
      left.priority === right.priority ? left.position - right.position : right.priority - left.priority
    )
    .map((entry, index) => ({ ...entry, position: index }))
}

const refusal = (
  members: ReadonlyArray<{ readonly id: string; readonly priority?: number | undefined }>,
  concurrency: number,
  priority: number,
  failurePolicy: FailurePolicy
): PatternError | undefined => {
  if (members.length === 0) {
    return new PatternError({ code: "invalid_decorator", message: "MergeQueue requires at least one member" })
  }
  const ids = members.map((member) => member.id)
  if (new Set(ids).size !== ids.length) {
    return new PatternError({ code: "invalid_decorator", message: "MergeQueue member ids must be unique" })
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    return new PatternError({ code: "invalid_decorator", message: "MergeQueue concurrency must be a positive safe integer" })
  }
  if (failurePolicy === "halt" && concurrency > 1) {
    return new PatternError({ code: "invalid_decorator", message: "MergeQueue halt requires concurrency 1" })
  }
  return priorityRefusal(members, priority)
}

/**
 * Lands the members in queue order at the queue's concurrency. At the
 * default concurrency of 1 they land strictly one at a time.
 *
 * Under `halt` a failing member fails the queue and no member behind it
 * starts. Under `quarantine` the failure is recorded as `{ id, error }`, the
 * member does not land, and the members behind it still do. A defect fails
 * the queue under either policy.
 *
 * Fails with `PatternError` (`invalid_decorator`) before any member starts
 * when there is no member, two members share an id, `concurrency` is not a
 * positive safe integer, `halt` is asked for above concurrency 1, or a
 * priority is not a safe integer.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, Out, E = never, R = never>(
  input: I,
  options: Options<I, Out, E, R>
): Effect.Effect<Result<Out, E>, E | PatternError, R> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the array, a member, or the options in between must not reach it.
  const members = options.members.map((member) => ({ id: member.id, priority: member.priority, run: member.run }))
  const concurrency = options.concurrency ?? 1
  const priority = options.priority ?? DefaultPriority
  const failurePolicy = options.failurePolicy
  const invalid = refusal(members, concurrency, priority, failurePolicy)
  if (invalid !== undefined) return Effect.fail(invalid)
  const queue = ordered(members, priority)
  return Effect.map(
    Effect.forEach(
      queue,
      (entry) => {
        const landed = Effect.map(
          entry.member.run({ id: entry.id, position: entry.position, input }),
          (output) => ({ landed: true, id: entry.id, output }) as const
        )
        return failurePolicy === "quarantine"
          ? Effect.catch(landed, (error: E) => Effect.succeed({ landed: false, id: entry.id, error } as const))
          : landed
      },
      { concurrency }
    ),
    (outcomes): Result<Out, E> => ({
      landed: outcomes.flatMap((outcome) => outcome.landed ? [{ id: outcome.id, output: outcome.output }] : []),
      quarantined: outcomes.flatMap((outcome) => outcome.landed ? [] : [{ id: outcome.id, error: outcome.error }]),
      order: queue.map((entry) => entry.id)
    })
  )
}
