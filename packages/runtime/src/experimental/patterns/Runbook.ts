/**
 * A runbook: ordered steps where a step's risk decides whether an approval
 * gates it, and a denial either stops the runbook or skips the step.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { PatternError } from "./PatternError.js"

/**
 * How much authority a step needs. A `safe` step runs unasked. A `risky`
 * step needs an approval. A `critical` step needs one too, and its request
 * carries `elevated: true`.
 *
 * @category models
 * @since 0.0.13
 */
export type Risk = "safe" | "risky" | "critical"

/**
 * What a denial does: `fail` stops the runbook, `skip` drops the step and
 * goes on.
 *
 * @category models
 * @since 0.0.13
 */
export type OnDeny = "fail" | "skip"

/**
 * What a step and its approval see. `previous` is the output of the last
 * step that ran.
 *
 * @category models
 * @since 0.0.13
 */
export interface Request<I, Out> {
  readonly step: string
  readonly risk: Risk
  readonly elevated: boolean
  readonly input: I
  readonly previous: Out | undefined
}

/**
 * One step of the runbook.
 *
 * @category models
 * @since 0.0.13
 */
export interface RuntimeStep<I, Out, E, R> {
  readonly id: string
  readonly risk: Risk
  readonly run: (args: Request<I, Out>) => Effect.Effect<Out, E, R>
}

/**
 * The options of {@link run}. `approve` must answer the literal
 * `"approved"`; any other answer is a denial.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, Out, E, R, E2, R2> {
  readonly steps: ReadonlyArray<RuntimeStep<I, Out, E, R>>
  readonly approve: (request: Request<I, Out>) => Effect.Effect<unknown, E2, R2>
  readonly onDeny: OnDeny
}

/**
 * What a runbook did. `ran` and `skipped` are disjoint and together name
 * every step; `outputs` holds one entry for each step in `ran`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Result<Out> {
  readonly outputs: Record<string, Out>
  readonly ran: ReadonlyArray<string>
  readonly skipped: ReadonlyArray<string>
}

const decide = Schema.decodeUnknownEffect(Schema.Literal("approved"))

/**
 * Whether a step's risk requires an approval.
 *
 * @throws never
 * @category introspection
 * @since 0.0.13
 */
export const gated = (risk: Risk): boolean => risk !== "safe"

/**
 * Whether a step's risk marks its approval request elevated.
 *
 * @throws never
 * @category introspection
 * @since 0.0.13
 */
export const elevated = (risk: Risk): boolean => risk === "critical"

/**
 * Runs the steps in order. A safe step runs without asking; any other step
 * asks `approve` first, and the answer must decode as the literal
 * `"approved"`. Under `onDeny: "fail"` a denial fails the runbook with a
 * `Schema.SchemaError` and no later step runs. Under `onDeny: "skip"` the
 * denied step is listed in `skipped`, and the next step sees the last step
 * that ran as its `previous`.
 *
 * Fails with `PatternError` (`invalid_decorator`) before any step runs when
 * there is no step or two steps share an id.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, Out, E = never, R = never, E2 = never, R2 = never>(
  input: I,
  options: Options<I, Out, E, R, E2, R2>
): Effect.Effect<Result<Out>, E | E2 | PatternError | Schema.SchemaError, R | R2> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the array, a step, or the options in between must not reach it.
  const steps = options.steps.map((step) => ({ id: step.id, risk: step.risk, run: step.run }))
  const approve = options.approve
  const onDeny = options.onDeny
  if (steps.length === 0) {
    return Effect.fail(new PatternError({ code: "invalid_decorator", message: "Runbook requires at least one step" }))
  }
  if (new Set(steps.map((step) => step.id)).size !== steps.length) {
    return Effect.fail(new PatternError({ code: "invalid_decorator", message: "Runbook step ids must be unique" }))
  }
  return Effect.gen(function*() {
    const outputs = new Map<string, Out>()
    const ran: Array<string> = []
    const skipped: Array<string> = []
    let previous: Out | undefined = undefined
    for (const step of steps) {
      const request: Request<I, Out> = { step: step.id, risk: step.risk, elevated: elevated(step.risk), input, previous }
      if (gated(step.risk)) {
        const answer = decide(yield* approve(request))
        const decision = onDeny === "skip"
          ? yield* Effect.catch(answer, () => Effect.succeed("denied" as const))
          : yield* answer
        if (decision === "denied") {
          skipped.push(step.id)
          continue
        }
      }
      const output = yield* step.run(request)
      outputs.set(step.id, output)
      ran.push(step.id)
      previous = output
    }
    const result: Result<Out> = { outputs: Object.fromEntries(outputs), ran, skipped }
    return result
  })
}
