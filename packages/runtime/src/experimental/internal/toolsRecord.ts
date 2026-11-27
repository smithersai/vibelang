/**
 * Recorded tool calls (VIP-64 rule 11, VIP-63 rule 3, VIP-65 rule 10).
 *
 * Inside a workflow or one of its tasks, a tool call is its own recorded
 * step: an Effect `Activity` named after the call, whose result, or typed
 * failure, the engine journals. A resumed run reads the recorded result and
 * runs no handler. Outside a workflow the call is an ordinary live Effect.
 *
 * @internal
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Schema from "effect/Schema"
import * as Activity from "effect/workflow/Activity"
import * as WorkflowEngine from "effect/workflow/WorkflowEngine"
import * as record from "./record.js"

/**
 * Runs `execute` as the recorded step `<kind>/<digest>/<n>` when a workflow
 * instance is in context, and live otherwise. `request` names the call: the
 * same request reached again in the same attempt is the next occurrence.
 */
export const recorded = <A, E, R, S extends Schema.Top, F extends Schema.Top>(options: {
  readonly kind: string
  readonly request: unknown
  readonly success: S
  readonly error: F
  readonly execute: Effect.Effect<A, E, R>
}): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.serviceOption(WorkflowEngine.WorkflowInstance), (instance) => {
    if (Option.isNone(instance)) return options.execute
    return Effect.flatMap(record.stepName(options.kind, instance.value, options.request), (name) =>
      Activity.make({
        name,
        success: options.success,
        error: options.error,
        execute: options.execute as unknown as Effect.Effect<unknown, unknown, unknown>
      }) as unknown as Effect.Effect<A, E, R>)
  })
