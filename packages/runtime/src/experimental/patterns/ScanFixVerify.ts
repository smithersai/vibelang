/**
 * Scan for issues, fix each one, verify, and repeat until a scan comes back
 * clean or the retries are spent. Unlike a review loop, which revises one
 * output, each issue gets its own fix.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { ownTrue } from "./internal.js"
import { PatternError } from "./PatternError.js"

/**
 * How a scan-fix-verify loop ended. `resolved` is true when a scan returned
 * no issue; `remaining` is the last scan's issues otherwise. `verifications`
 * holds every round's verification in order.
 *
 * @category models
 * @since 0.0.13
 */
export interface Result<Issue, Verification> {
  readonly iterations: number
  readonly remaining: ReadonlyArray<Issue>
  readonly resolved: boolean
  readonly verifications: ReadonlyArray<Verification>
}

/**
 * The stages of {@link run}. `maxRetries` is how many scans may find issues;
 * `maxIssues` is how many of a scan's issues one round fixes, the rest waiting
 * for the next scan; `concurrency` is the size of each batch of fixes.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, Issue, Fix, Verification, E, R, E2, R2, E3, R3> {
  readonly scan: (input: { readonly input: I; readonly iteration: number }) => Effect.Effect<ReadonlyArray<Issue>, E, R>
  readonly fix: (input: { readonly issue: Issue; readonly index: number; readonly iteration: number }) => Effect.Effect<Fix, E2, R2>
  readonly verify: (input: {
    readonly input: I
    readonly issues: ReadonlyArray<Issue>
    readonly fixes: ReadonlyArray<Fix>
    readonly iteration: number
  }) => Effect.Effect<Verification, E3, R3>
  readonly maxRetries: number
  readonly maxIssues: number
  readonly concurrency: number
}

/**
 * Whether a verification reports nothing left to fix: `true`, or an object
 * whose own `resolved` property is `true`. The loop itself stops only on a
 * clean scan; a caller reads the recorded verifications with this.
 *
 * @throws never
 * @category predicates
 * @since 0.0.13
 */
export const resolved = (value: unknown): boolean => value === true || ownTrue(value, "resolved")

const positive = (value: number): boolean => Number.isSafeInteger(value) && value >= 1

/**
 * Each round scans; a clean scan ends the loop resolved. Otherwise it fixes
 * the first `maxIssues` issues in batches of `concurrency`, each batch
 * starting after the one before it has finished, then verifies the round's
 * fixes. After `maxRetries` rounds with issues the loop ends unresolved.
 *
 * Fails with `PatternError` (`invalid_decorator`) when a bound is not a
 * positive safe integer, and with a stage's own failure.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, Issue, Fix, Verification, E, R, E2, R2, E3, R3>(
  input: I,
  options: Options<I, Issue, Fix, Verification, E, R, E2, R2, E3, R3>
): Effect.Effect<Result<Issue, Verification>, E | E2 | E3 | PatternError, R | R2 | R3> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const { concurrency, fix, maxIssues, maxRetries, scan, verify } = options
  if (!positive(maxRetries) || !positive(maxIssues) || !positive(concurrency)) {
    return Effect.fail(
      new PatternError({
        code: "invalid_decorator",
        message: "ScanFixVerify maxRetries, maxIssues, and concurrency must be positive safe integers"
      })
    )
  }
  return Effect.gen(function*() {
    const verifications: Array<Verification> = []
    let iteration = 1
    while (true) {
      const issues = yield* scan({ input, iteration })
      if (issues.length === 0) {
        const clean: Result<Issue, Verification> = { iterations: iteration, remaining: [], resolved: true, verifications }
        return clean
      }
      const fixes: Array<Fix> = []
      const admitted = Math.min(issues.length, maxIssues)
      for (let offset = 0; offset < admitted; offset += concurrency) {
        const batch = issues.slice(offset, Math.min(offset + concurrency, admitted))
        const round = iteration
        fixes.push(
          ...yield* Effect.forEach(batch, (issue, index) => fix({ issue, index: offset + index, iteration: round }), {
            concurrency: "unbounded"
          })
        )
      }
      verifications.push(yield* verify({ input, issues, fixes, iteration }))
      if (iteration >= maxRetries) {
        const spent: Result<Issue, Verification> = { iterations: iteration, remaining: issues, resolved: false, verifications }
        return spent
      }
      iteration += 1
    }
  })
}
