/**
 * The fixed delegation chain: refine, plan, derisk, execute, review, settle.
 * It is assembled from the other patterns: `ReviewLoop` runs the derisk
 * rounds, `Trellis` admits and executes the derisked plan, and each leaf
 * climbs a ladder of tiers, weakest first.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { accepted as isAccepted } from "./internal.js"
import { PatternError } from "./PatternError.js"
import * as ReviewLoop from "./ReviewLoop.js"
import * as Trellis from "./Trellis.js"

/**
 * Why a chain failed.
 *
 * @category models
 * @since 0.0.13
 */
export type DelegationErrorCode = "invalid_bounds" | "missing_tier" | "derisk_failed" | "leaf_failed"

/**
 * A refused chain or a leaf no tier could settle. `path` names the plan path
 * the failure belongs to, or `root` for the chain itself. `cause` carries the
 * reported error or each tier's outcome.
 *
 * @category errors
 * @since 0.0.13
 */
export class DelegationError extends Data.TaggedError("DelegationError")<{
  readonly code: DelegationErrorCode
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * The run budget handed to every tier call. The chain only carries it.
 *
 * @category models
 * @since 0.0.13
 */
export interface Budget {
  readonly maxMinutes?: number | undefined
}

/**
 * The bounds of a chain. `tierOrder` is the tier ladder, weakest first.
 * `maxDepth` is the whole plan envelope: at most `maxDepth` leaves, `maxDepth`
 * levels of nesting, and `maxDepth` members in one container.
 *
 * @category models
 * @since 0.0.13
 */
export interface Bounds {
  readonly tierOrder: ReadonlyArray<string>
  readonly maxDepth: number
  readonly maxDeriskRounds: number
}

/**
 * One unit of work handed to a tier.
 *
 * @category models
 * @since 0.0.13
 */
export interface Work {
  readonly leaf: Trellis.Leaf
  readonly tier: string
  readonly goal: unknown
  readonly budget?: Budget | undefined
}

/**
 * What the review is asked about: one tier's output for a leaf, or the whole
 * chain.
 *
 * @category models
 * @since 0.0.13
 */
export type ReviewRequest =
  | {
    readonly stage: "leaf"
    readonly leaf: Trellis.Leaf
    readonly tier: string
    readonly output: unknown
  }
  | {
    readonly stage: "chain"
    readonly goal: unknown
    readonly plan: Trellis.Plan
    readonly leaves: ReadonlyArray<unknown>
  }

/**
 * What the derisk review is asked about each round.
 *
 * @category models
 * @since 0.0.13
 */
export interface DeriskRequest {
  readonly goal: unknown
  readonly plan: unknown
  readonly round: number
}

/**
 * What the planner is asked for each derisk round. From round 2 on it
 * receives the `previous` plan and the `derisk` review of it.
 *
 * @category models
 * @since 0.0.13
 */
export interface PlanRequest {
  readonly goal: unknown
  readonly round: number
  readonly previous?: unknown
  readonly derisk?: unknown
}

/**
 * What `settle` receives once every leaf has an output.
 *
 * @category models
 * @since 0.0.13
 */
export interface Settlement {
  readonly prompt: string
  readonly goal: unknown
  readonly plan: Trellis.Plan
  readonly leaves: ReadonlyArray<unknown>
  readonly review: unknown
  readonly deriskExhausted: boolean
}

/**
 * The stages of {@link run}. `execute` holds one stage for each tier
 * `tierOrder` names. `concurrency` bounds the leaves in flight and defaults
 * to `maxDepth`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<Settled, E1, R1, E2, R2, E3, R3, E4, R4, E5, R5, E6, R6> extends Bounds {
  readonly refine: (input: { readonly prompt: string }) => Effect.Effect<unknown, E1, R1>
  readonly plan: (request: PlanRequest) => Effect.Effect<unknown, E2, R2>
  readonly derisk: (request: DeriskRequest) => Effect.Effect<unknown, E3, R3>
  readonly execute: Readonly<Record<string, (work: Work) => Effect.Effect<unknown, E4, R4>>>
  readonly review: (request: ReviewRequest) => Effect.Effect<unknown, E5, R5>
  readonly settle: (settlement: Settlement) => Effect.Effect<Settled, E6, R6>
  readonly budget?: Budget | undefined
  readonly concurrency?: number | undefined
}

/**
 * Whether a review approves: `true`, `"approved"`, or an object whose own
 * `approved` or `accepted` property is `true`.
 *
 * @throws never
 * @category predicates
 * @since 0.0.13
 */
export const accepted = (review: unknown): boolean => isAccepted(review)

const isPatternError = (error: unknown): error is PatternError => error instanceof PatternError

const positive = (value: number): boolean => Number.isSafeInteger(value) && value >= 1

const refuse = (code: DelegationErrorCode, message: string): DelegationError =>
  new DelegationError({ code, path: "root", message })

const checkBounds = (
  bounds: Bounds & { readonly concurrency?: number | undefined },
  tiers: ReadonlyArray<string>
): DelegationError | undefined => {
  if (!positive(bounds.maxDepth) || !positive(bounds.maxDeriskRounds)) {
    return refuse("invalid_bounds", "maxDepth and maxDeriskRounds must be positive safe integers")
  }
  if (bounds.concurrency !== undefined && !positive(bounds.concurrency)) {
    return refuse("invalid_bounds", `Delegation concurrency must be a positive safe integer, received ${bounds.concurrency}`)
  }
  if (bounds.tierOrder.length === 0) return refuse("invalid_bounds", "tierOrder must name at least one tier, weakest first")
  const missing = bounds.tierOrder.filter((tier) => !tiers.includes(tier))
  if (missing.length > 0) return refuse("missing_tier", `execute has no flow for tier ${missing.join(", ")}`)
  return undefined
}

type Attempt =
  | { readonly tier: string; readonly failed: true; readonly error: unknown }
  | { readonly tier: string; readonly failed: false; readonly output: unknown; readonly rejected: boolean }

const attemptCause = (attempts: ReadonlyArray<Attempt>): ReadonlyArray<Readonly<Record<string, unknown>>> =>
  attempts.map((attempt) =>
    attempt.failed ? { tier: attempt.tier, error: attempt.error } : { tier: attempt.tier, rejected: attempt.rejected }
  )

/**
 * Refines the prompt into a goal, plans and derisks it, runs every leaf
 * through the tier ladder, reviews the assembled outputs, and settles.
 *
 * The derisk loop stops at the first approved round. Each leaf calls each
 * tier once, weakest first: a tier that fails, or whose output the review
 * rejects, hands the leaf to the next. The chain never retries a tier.
 * `settle` receives the leaf outputs in plan order.
 *
 * Fails with `DelegationError`: `invalid_bounds` or `missing_tier` before any
 * stage runs, `derisk_failed` when the planner or the derisk review fails
 * with a `PatternError`, and `leaf_failed` naming the leaf's path when no
 * tier settled it. Fails with `TrellisError` when the derisked plan is outside
 * the envelope; no leaf runs then.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <Settled, E1, R1, E2, R2, E3, R3, E4, R4, E5, R5, E6, R6>(
  prompt: string,
  caller: Options<Settled, E1, R1, E2, R2, E3, R3, E4, R4, E5, R5, E6, R6>
): Effect.Effect<
  Settled,
  E1 | E2 | E3 | E5 | E6 | DelegationError | Trellis.TrellisError,
  R1 | R2 | R3 | R4 | R5 | R6
> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const options: typeof caller = {
    tierOrder: [...caller.tierOrder],
    maxDepth: caller.maxDepth,
    maxDeriskRounds: caller.maxDeriskRounds,
    refine: caller.refine,
    plan: caller.plan,
    derisk: caller.derisk,
    execute: { ...caller.execute },
    review: caller.review,
    settle: caller.settle,
    budget: caller.budget === undefined ? undefined : { ...caller.budget },
    concurrency: caller.concurrency
  }
  return Effect.gen(function*() {
    const refusal = checkBounds(options, Object.keys(options.execute))
    if (refusal !== undefined) return yield* Effect.fail(refusal)
    const envelope: Trellis.Envelope = { fuel: options.maxDepth, depth: options.maxDepth, fanout: options.maxDepth }
    const goal = yield* options.refine({ prompt })
    const derisked = yield* ReviewLoop.run(goal, {
      maxRounds: options.maxDeriskRounds,
      produce: () => options.plan({ goal, round: 1 }),
      review: (plan, round) => options.derisk({ goal, plan, round }),
      revise: ({ output, review, round }) => options.plan({ goal, round: round + 1, previous: output, derisk: review })
    }).pipe(
      Effect.catchIf(
        isPatternError,
        (error) => Effect.fail(refuse("derisk_failed", error.message))
      )
    )
    const authored = derisked.output
    const refusals = Trellis.validate(authored, envelope)
    if (refusals.length > 0) {
      const first = refusals[0]!
      return yield* Effect.fail(
        new Trellis.TrellisError({
          code: first.code,
          path: first.path,
          message: first.message,
          cause: { rounds: [], remaining: envelope.fuel, refusals }
        })
      )
    }
    const plan = authored as Trellis.Plan
    const outputs = new Map<string, unknown>()
    const climb = (leaf: Trellis.Leaf): Effect.Effect<void, E5 | DelegationError, R4 | R5> =>
      Effect.gen(function*() {
        const attempts: Array<Attempt> = []
        for (const tier of options.tierOrder) {
          const work: Work = { leaf, tier, goal, ...(options.budget === undefined ? {} : { budget: options.budget }) }
          const attempt = yield* Effect.matchEffect(options.execute[tier]!(work), {
            onFailure: (error) => Effect.succeed<Attempt>({ tier, failed: true, error }),
            onSuccess: (output) =>
              Effect.map(
                options.review({ stage: "leaf", leaf, tier, output }),
                (decision): Attempt => ({ tier, failed: false, output, rejected: !accepted(decision) })
              )
          })
          attempts.push(attempt)
          if (!attempt.failed && !attempt.rejected) {
            outputs.set(leaf.path, attempt.output)
            return
          }
        }
        return yield* Effect.fail(
          new DelegationError({
            code: "leaf_failed",
            path: leaf.path,
            message: `No tier settled the leaf at ${leaf.path}`,
            cause: attemptCause(attempts)
          })
        )
      }).pipe(
        // A review that fails with a `PatternError` settles no tier.
        Effect.catchIf(
          isPatternError,
          (error) =>
            Effect.fail(
              new DelegationError({
                code: "leaf_failed",
                path: leaf.path,
                message: `No tier settled the leaf at ${leaf.path}`,
                cause: error
              })
            )
        )
      )
    yield* Trellis.execute(plan, { concurrency: options.concurrency ?? options.maxDepth, leaf: climb })
    const leaves = Trellis.leaves(plan).map((leaf) => outputs.get(leaf.path))
    const review = yield* options.review({ stage: "chain", goal, plan, leaves })
    return yield* options.settle({ prompt, goal, plan, leaves, review, deriskExhausted: derisked._tag === "Exhausted" })
  })
}
