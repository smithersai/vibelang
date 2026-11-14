/**
 * A stall breaker: it ends a loop whose rounds keep producing the same thing.
 *
 * A loop reports one observation a round. When the same value of one signal
 * repeats `rounds` times in a row, the loop is stalled. Values are compared by
 * their canonical JSON text: object keys sorted, arrays in order.
 *
 * @experimental
 * @since 0.0.13
 */

/**
 * What a stalled loop does: `"stop"` and `"park"` settle it with a `Stalled`
 * result, and `"escalate"` fails it.
 *
 * @category models
 * @since 0.0.13
 */
export type On = "stop" | "park" | "escalate"

/**
 * The signal that repeated.
 *
 * @category models
 * @since 0.0.13
 */
export type Signal = "tree" | "checks" | "output"

/**
 * A validated stall breaker.
 *
 * @category models
 * @since 0.0.13
 */
export interface Policy {
  readonly rounds: number
  readonly on: On
}

/**
 * What a caller writes: `rounds` is at least 2, and `on` defaults to `"stop"`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options {
  readonly rounds: number
  readonly on?: On | undefined
}

/**
 * One round's readings. An absent signal is not compared.
 *
 * @category models
 * @since 0.0.13
 */
export interface Observation {
  readonly tree?: string | undefined
  readonly checks?: ReadonlyArray<string> | undefined
  readonly output?: unknown
}

interface Streak {
  readonly key: string
  readonly rounds: number
}

/**
 * How many rounds in a row each signal has repeated.
 *
 * @category models
 * @since 0.0.13
 */
export interface State {
  readonly tree: Streak | null
  readonly checks: Streak | null
  readonly output: Streak | null
}

/**
 * The state before the first round.
 *
 * @category constructors
 * @since 0.0.13
 */
export const initial: State = { tree: null, checks: null, output: null }

/**
 * The record of a stall: which signal repeated, for how many rounds, and what
 * the breaker was told to do.
 *
 * @category models
 * @since 0.0.13
 */
export interface Stalled {
  readonly _tag: "Stalled"
  readonly signal: Signal
  readonly rounds: number
  readonly on: On
}

/**
 * Validates stall options. `undefined` means the options are invalid:
 * `rounds` must be a safe integer of at least 2.
 *
 * @throws never
 * @category constructors
 * @since 0.0.13
 */
export const policy = (options: Options): Policy | undefined =>
  Number.isSafeInteger(options.rounds) && options.rounds >= 2
    ? { rounds: options.rounds, on: options.on ?? "stop" }
    : undefined

const plain = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || prototype === Object.prototype
}

// The canonical JSON text of a value, or undefined when it has none: a
// bigint, a function, a symbol, a non-finite number, a class instance or a
// cycle is not compared.
const canonical = (value: unknown, seen: ReadonlyArray<object>): string | undefined => {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : undefined
  if (typeof value !== "object" || seen.includes(value)) return undefined
  const inside = [...seen, value]
  if (Array.isArray(value)) {
    const items: Array<string> = []
    for (const item of value) {
      const text = canonical(item, inside)
      if (text === undefined) return undefined
      items.push(text)
    }
    return `[${items.join(",")}]`
  }
  if (!plain(value)) return undefined
  const fields: Array<string> = []
  for (const key of Object.keys(value).sort()) {
    const text = canonical((value as Readonly<Record<string, unknown>>)[key], inside)
    if (text === undefined) return undefined
    fields.push(`${JSON.stringify(key)}:${text}`)
  }
  return `{${fields.join(",")}}`
}

const keys = (observation: Observation): Record<Signal, string | undefined> => ({
  tree: observation.tree,
  // No failing check is not a repeated failure.
  checks: observation.checks === undefined || observation.checks.length === 0
    ? undefined
    : JSON.stringify([...new Set(observation.checks)].sort()),
  output: "output" in observation ? canonical(observation.output, []) : undefined
})

const signals: ReadonlyArray<Signal> = ["tree", "checks", "output"]

/**
 * Folds one round's observation into the state and reports a stall when a
 * signal has repeated `policy.rounds` times in a row.
 *
 * @throws never
 * @category combinators
 * @since 0.0.13
 */
export const observe = (
  policy: Policy,
  state: State,
  observation: Observation
): { readonly state: State; readonly stalled: Stalled | undefined } => {
  const current = keys(observation)
  const streak = (signal: Signal): Streak | null => {
    const key = current[signal]
    const prior = state[signal]
    return key === undefined ? null : { key, rounds: prior?.key === key ? prior.rounds + 1 : 1 }
  }
  const next: State = { tree: streak("tree"), checks: streak("checks"), output: streak("output") }
  for (const signal of signals) {
    const rounds = next[signal]?.rounds ?? 0
    if (rounds >= policy.rounds) return { state: next, stalled: { _tag: "Stalled", signal, rounds, on: policy.on } }
  }
  return { state: next, stalled: undefined }
}
