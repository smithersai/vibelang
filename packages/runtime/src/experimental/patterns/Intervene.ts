/**
 * An intervention: read a target, propose a change, apply it behind an
 * optional approval, and report what happened.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

/**
 * The stages of {@link run}. Every stage receives its `phase`. A dry run
 * reports the proposal and never applies it. `approval`, when present, runs
 * before `apply` and must answer the literal `"approved"`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, Context, Proposal, Applied, Report, E, R, E2, R2, E3, R3, E4, R4, E5, R5> {
  readonly read: (args: { readonly phase: "read"; readonly input: I }) => Effect.Effect<Context, E, R>
  readonly propose: (args: {
    readonly phase: "propose"
    readonly input: I
    readonly context: Context
  }) => Effect.Effect<Proposal, E2, R2>
  readonly apply: (args: {
    readonly phase: "apply"
    readonly input: I
    readonly proposal: Proposal
  }) => Effect.Effect<Applied, E3, R3>
  readonly report: (args: {
    readonly phase: "report"
    readonly input: I
    readonly proposal: Proposal
    readonly applied: Applied | undefined
    readonly dryRun: boolean
  }) => Effect.Effect<Report, E4, R4>
  readonly dryRun: boolean
  readonly approval?:
    | ((args: { readonly input: I; readonly proposal: Proposal }) => Effect.Effect<unknown, E5, R5>)
    | undefined
}

const decide = Schema.decodeUnknownEffect(Schema.Literal("approved"))

/**
 * Reads, proposes, and then either reports the proposal alone (a dry run) or
 * asks the approval, applies, and reports what was written.
 *
 * Fails with a `Schema.SchemaError` when the approval answers anything but
 * `"approved"`; `apply` then never runs.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, Context, Proposal, Applied, Report, E, R, E2, R2, E3, R3, E4, R4, E5 = never, R5 = never>(
  input: I,
  options: Options<I, Context, Proposal, Applied, Report, E, R, E2, R2, E3, R3, E4, R4, E5, R5>
): Effect.Effect<Report, E | E2 | E3 | E4 | E5 | Schema.SchemaError, R | R2 | R3 | R4 | R5> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const { apply, approval, dryRun, propose, read, report } = options
  return Effect.gen(function*() {
    const context = yield* read({ phase: "read", input })
    const proposal = yield* propose({ phase: "propose", input, context })
    if (dryRun) return yield* report({ phase: "report", input, proposal, applied: undefined, dryRun: true })
    if (approval !== undefined) yield* decide(yield* approval({ input, proposal }))
    const applied = yield* apply({ phase: "apply", input, proposal })
    return yield* report({ phase: "report", input, proposal, applied, dryRun: false })
  })
}
