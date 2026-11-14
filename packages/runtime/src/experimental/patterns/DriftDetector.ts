/**
 * A drift detector: capture the world, compare it with a baseline, and alert
 * when it moved. It detects once; how often to look is the caller's choice.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { ownTrue } from "./internal.js"

/**
 * The stages of {@link run}. `baseline` is read at the call and handed, as
 * the same reference, to every stage. `alertIf` decides drift from the
 * comparison; without it {@link drifted} does.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, Baseline, Snapshot, Comparison, Alert, E, R, E2, R2, E3 = never, R3 = never> {
  readonly baseline: Baseline
  readonly capture: (input: { readonly input: I; readonly baseline: Baseline }) => Effect.Effect<Snapshot, E, R>
  readonly compare: (input: {
    readonly snapshot: Snapshot
    readonly baseline: Baseline
  }) => Effect.Effect<Comparison, E2, R2>
  readonly alertIf?: ((comparison: Comparison) => boolean) | undefined
  readonly alert?:
    | ((input: {
      readonly comparison: Comparison
      readonly snapshot: Snapshot
      readonly baseline: Baseline
    }) => Effect.Effect<Alert, E3, R3>)
    | undefined
}

/**
 * One detection. `alert` is present only when the alert ran.
 *
 * @category models
 * @since 0.0.13
 */
export interface Result<Snapshot, Comparison, Alert> {
  readonly snapshot: Snapshot
  readonly comparison: Comparison
  readonly drifted: boolean
  readonly alert?: Alert | undefined
}

/**
 * Whether a comparison reports drift: `true`, or an object whose own
 * `drifted` property is `true`.
 *
 * @throws never
 * @category predicates
 * @since 0.0.13
 */
export const drifted = (value: unknown): boolean => value === true || ownTrue(value, "drifted")

/**
 * Captures a snapshot, compares it with the baseline, and runs `alert` once
 * when the comparison reports drift. The alert's failure is the run's
 * failure.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, Baseline, Snapshot, Comparison, Alert, E, R, E2, R2, E3 = never, R3 = never>(
  input: I,
  options: Options<I, Baseline, Snapshot, Comparison, Alert, E, R, E2, R2, E3, R3>
): Effect.Effect<Result<Snapshot, Comparison, Alert>, E | E2 | E3, R | R2 | R3> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const { alert, alertIf, baseline, capture, compare } = options
  return Effect.gen(function*() {
    const snapshot = yield* capture({ input, baseline })
    const comparison = yield* compare({ snapshot, baseline })
    const moved = alertIf === undefined ? drifted(comparison) : alertIf(comparison)
    if (!moved || alert === undefined) {
      const reported: Result<Snapshot, Comparison, Alert> = { snapshot, comparison, drifted: moved }
      return reported
    }
    const raised = yield* alert({ comparison, snapshot, baseline })
    const reported: Result<Snapshot, Comparison, Alert> = { snapshot, comparison, drifted: moved, alert: raised }
    return reported
  })
}
