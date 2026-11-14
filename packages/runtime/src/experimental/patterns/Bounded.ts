/**
 * Bounded fan-out: a fixed set of members run at most `concurrency` at a
 * time, highest priority first.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { concurrencyRefusal, nonEmptyMembersRefusal, safeIntegerPriorityRefusal } from "./internal.js"
import { PatternError } from "./PatternError.js"

/**
 * The options of {@link run}. `priorities` holds per-member priorities by
 * name; `priority` is the default for every member that names none, and
 * without either a member's priority is 0.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options {
  readonly concurrency: number
  readonly priority?: number | undefined
  readonly priorities?: Readonly<Record<string, number>> | undefined
}

/**
 * Runs a record of Effects at most `concurrency` at a time, starting the
 * highest priority member first; members of equal priority start in the
 * order they were written. The result holds every member's value under its
 * name.
 *
 * The first failure interrupts the members still in flight, as
 * `Effect.forEach` does. Use `Quarantine.run` when the others must finish.
 *
 * Fails with `PatternError` (`invalid_decorator`) before any member runs when
 * the record is empty, `concurrency` is not a positive safe integer, a
 * priority is not a safe integer, or `priorities` names a member the record
 * does not hold.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <A, E, R>(
  members: Readonly<Record<string, Effect.Effect<A, E, R>>>,
  options: Options
): Effect.Effect<Readonly<Record<string, A>>, E | PatternError, R> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the record or the options in between must not reach it. Own entries only,
  // so a prototype-shaped member name stays a data property.
  const declared = Object.entries(members)
  const concurrency = options.concurrency
  const priority = options.priority
  const priorities = options.priorities === undefined ? undefined : Object.fromEntries(Object.entries(options.priorities))
  return Effect.suspend((): Effect.Effect<Readonly<Record<string, A>>, E | PatternError, R> => {
    const names = declared.map(([name]) => name)
    const refusal = concurrencyRefusal("Bounded", concurrency) ?? nonEmptyMembersRefusal("Bounded", names)
    if (refusal !== undefined) return Effect.fail(refusal)
    const known = new Set(names)
    for (const name of Object.keys(priorities ?? {})) {
      if (!known.has(name)) {
        return Effect.fail(
          new PatternError({
            code: "invalid_decorator",
            message: `Bounded declares a priority for the unknown member "${name}"`
          })
        )
      }
    }
    const ranked: Array<{ readonly name: string; readonly member: Effect.Effect<A, E, R>; readonly rank: number; readonly index: number }> = []
    for (const [index, [name, member]] of declared.entries()) {
      const rank: unknown = priorities !== undefined && Object.hasOwn(priorities, name) ? priorities[name] : priority ?? 0
      const invalid = safeIntegerPriorityRefusal("Bounded", name, rank)
      if (invalid !== undefined) return Effect.fail(invalid)
      ranked.push({ name, member, rank: rank as number, index })
    }
    // Descending priority, declaration order among equals.
    ranked.sort((left, right) => right.rank - left.rank || left.index - right.index)
    return Effect.map(
      Effect.forEach(ranked, ({ name, member }) => Effect.map(member, (value) => [name, value] as const), {
        concurrency
      }),
      (pairs): Readonly<Record<string, A>> => Object.fromEntries(pairs)
    )
  })
}
