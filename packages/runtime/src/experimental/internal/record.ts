/**
 * Naming for model calls recorded as workflow steps: a digest of the request
 * and its occurrence in one workflow or task attempt. A call refused for
 * capacity parks the run and is asked again as the next occurrence.
 *
 * @internal
 */
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Activity from "effect/workflow/Activity"
import * as DurableClock from "effect/workflow/DurableClock"
import type { WorkflowInstance } from "effect/workflow/WorkflowEngine"
import * as canonical from "./canonical.js"
import { nextOccurrence } from "./durableSteps.js"
import { StepScope } from "./modelStepScope.js"
import * as quota from "./quota.js"

export { StepScope } from "./modelStepScope.js"

const jsonSafe = (_key: string, value: unknown): unknown =>
  value instanceof Uint8Array
    ? { bytes: Array.from(value) }
    : typeof value === "bigint"
    ? String(value)
    : value instanceof URL
    ? value.href
    : value

/** The stable journal name of one request within its task attempt and named race. */
export const stepName = (kind: string, instance: WorkflowInstance["Service"], request: unknown): Effect.Effect<string> =>
  Effect.gen(function*() {
    const scope = yield* StepScope
    const digest = yield* canonical.sha256(JSON.stringify(scope === "" ? request : [scope, request], jsonSafe) ?? "null")
    const occurrence = nextOccurrence(instance, `${kind}/${digest}`, `A recorded ${kind} call`)
    return `${kind}/${digest.slice(0, 16)}/${occurrence}`
  })

/**
 * A recorded call: `step(name)` runs as the step `<kind>/<digest>/<n>`. When
 * it fails with a capacity refusal, the decision is recorded as the step
 * `<name>/park`: no park, or the wake time when {@link quota.classify} calls
 * the refusal a window. A parked run waits out that deadline, sleeping
 * on Effect's `DurableClock` until then, and the request is asked again as
 * the next occurrence. A call parks at most {@link quota.maxParks} times,
 * and only while `parkable()` holds: a stream that has delivered a part
 * fails rather than asks again, so no prefix is delivered twice.
 */
export const parked = <A, E, R>(
  kind: string,
  instance: WorkflowInstance["Service"],
  request: unknown,
  step: (name: string) => Effect.Effect<A, E, R>,
  parkable: () => boolean = () => true
) =>
  Effect.gen(function*() {
    for (let parks = 0; ; parks++) {
      const name = yield* stepName(kind, instance, request)
      const result = yield* Effect.result(step(name))
      if (Result.isSuccess(result)) return result.success
      const error = result.failure
      if (parks >= quota.maxParks || !quota.isCapacity(error)) return yield* Effect.fail(error)
      // Whether to park reads the clock and the caller's state, so the
      // decision is recorded, a refusal to park included: a resumed run
      // follows it rather than deciding again.
      const park = yield* Activity.make({
        name: `${name}/park`,
        success: Schema.NullOr(quota.Park),
        execute: Effect.map(Clock.currentTimeMillis, (now) => parkable() ? quota.classify(error, now) : null)
      })
      if (park === null) return yield* Effect.fail(error)
      const wait = Math.max(0, park.wakeAt - (yield* Clock.currentTimeMillis))
      // A threshold of zero keeps every park a durable wait, which a process
      // that stops during it resumes into.
      yield* DurableClock.sleep({ name: `${name}/park`, duration: wait, inMemoryThreshold: 0 })
    }
  })
