/**
 * Evals: run a fixed set of cases against a target, grade every answer with
 * scorers, compare the scores with a committed baseline, and turn the
 * comparison into a CI exit code.
 *
 * ```text
 *  cases ──► target ──► output ──► scorers ──► scores in [0, 1] ──► compare with baseline ──► gate
 *                                                                     │ regressed?       │ 0  pass
 *                                                                     │ moved? missing?  │ 1  regressed
 *                                                                     │                  │ 5  could not decide
 * ```
 *
 * Five outcomes stay distinct: a target that failed, a scorer that could not
 * decide, a score that dropped on a different answer (a regression), a score
 * that moved on the same answer (nondeterminism), and a score present on only
 * one side of the comparison (missing). A failed target and an inconclusive
 * scorer never become a score of zero.
 *
 * A step key names the work a target did for a case: here, a hash of the
 * output's canonical JSON. A score that dropped at a changed step key is a
 * regression; a score that moved at the same step key is nondeterminism, the
 * same answer graded differently twice.
 *
 * `suite` runs nothing and never throws. `run` validates the suite first and
 * fails with `invalid_suite` naming the offending field. `gate` is a pure
 * function from a report to a verdict and an exit code.
 *
 * Ported from Smithers' `@smthrs/evals` (`Suite`, `Runner`, `Baseline`,
 * `Regression`, `Gate`, `Trials`); a baseline is the same versioned JSON.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as canonical from "./internal/canonical.js"
import * as text from "./internal/evalText.js"
import { sha256Hex } from "./internal/sha256.js"
import * as Scorer from "./Scorer.js"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/Eval"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/Eval"

/**
 * Why an eval call refused its input.
 *
 * @category models
 * @since 0.0.13
 */
export type EvalErrorCode =
  | "invalid_suite"
  | "invalid_run_options"
  | "invalid_baseline"
  | "invalid_tolerance"
  | "target"

/**
 * @category errors
 * @since 0.0.13
 */
export class EvalError extends Data.TaggedError("EvalError")<{
  readonly code: EvalErrorCode
  readonly message: string
  readonly path?: string | undefined
  readonly cause?: unknown
}> {}

/**
 * The most cases a suite holds and the most it runs at once.
 *
 * @category limits
 * @since 0.0.13
 */
export const limits = {
  cases: 10_000,
  concurrency: 1_024,
  trials: 1_000,
  fixtureLength: 8 * 1024 * 1024,
  baselineLength: 16 * 1024 * 1024
} as const

/**
 * One case: a name, the target's arguments, and the answer a scorer compares
 * with, if any.
 *
 * @category models
 * @since 0.0.13
 */
export interface Case<Args extends ReadonlyArray<unknown> = ReadonlyArray<unknown>, A = unknown> {
  readonly name: string
  readonly input: Args
  readonly expected?: A | undefined
}

/**
 * What a gate requires. `min` is the lowest passing score, `mean` the lowest
 * passing average, `perCase` the lowest passing score of named cases, and
 * `tolerance` how far a score may move from its baseline before it counts.
 *
 * @category models
 * @since 0.0.13
 */
export interface GateOptions {
  readonly mean?: number | undefined
  readonly min?: number | undefined
  readonly perCase?: Readonly<Record<string, number>> | undefined
  readonly tolerance?: number | undefined
}

/**
 * A declared suite. Running it needs the services `R` its target and
 * scorers need.
 *
 * @category models
 * @since 0.0.13
 */
export interface Suite<Args extends ReadonlyArray<unknown> = ReadonlyArray<any>, A = any, R = never> {
  readonly [TypeId]: TypeId
  readonly name: string
  readonly target: (...args: Args) => Effect.Effect<A, unknown, R>
  readonly cases: ReadonlyArray<Case<Args, A>>
  readonly scorers: ReadonlyArray<Scorer.Scorer<Scorer.Run<Args, A>, R>>
  readonly trials: number
  readonly concurrency: number
  readonly gate: GateOptions | undefined
  /**
   * What {@link run} logs as a warning before it runs: one line for each
   * scorer graded by a model, such as `Scorer.rubric` or `Scorer.decide`,
   * when the gate sets no `tolerance`. Model scores move, so with no
   * tolerance any lower score is a regression.
   */
  readonly warnings: ReadonlyArray<string>
}

type ServicesOf<S> = S extends Scorer.Scorer<any, infer R> ? R : never

/**
 * Options of {@link suite}.
 *
 * @category models
 * @since 0.0.13
 */
export interface SuiteOptions<
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
  S extends ReadonlyArray<Scorer.Scorer<Scorer.Run<Args, A>, any>>
> {
  readonly target: (...args: Args) => Effect.Effect<A, E, R>
  readonly cases: ReadonlyArray<Case<NoInfer<Args>, NoInfer<A>>>
  readonly scorers: S
  /** How many times each case runs. Default 1, at most 1,000. */
  readonly trials?: number | undefined
  /** How many cases run at once. Default 1, at most 1,024. */
  readonly concurrency?: number | undefined
  readonly gate?: GateOptions | undefined
}

/**
 * Declares a suite: a target, its cases and the scorers that grade every
 * answer. Runs nothing and never throws; {@link run} validates it.
 *
 * @category constructors
 * @since 0.0.13
 */
export const suite = <
  Args extends ReadonlyArray<unknown>,
  A,
  E = never,
  R = never,
  const S extends ReadonlyArray<Scorer.Scorer<Scorer.Run<NoInfer<Args>, NoInfer<A>>, any>> = readonly []
>(name: string, options: SuiteOptions<Args, A, E, R, S>): Suite<Args, A, R | ServicesOf<S[number]>> => {
  type Declared = Suite<Args, A, R | ServicesOf<S[number]>>
  // Read every field once and never throw: run refuses what is malformed.
  const read = <X>(pick: () => X): X | undefined => {
    try {
      return pick()
    } catch {
      return undefined
    }
  }
  const source = (typeof options === "object" && options !== null ? options : {}) as Partial<SuiteOptions<Args, A, E, R, S>>
  const list = (value: unknown) => Array.isArray(value) ? Object.freeze([...value]) : value === undefined ? Object.freeze([]) : value
  const scorers = read(() => list(source.scorers))
  const gate = read(() => source.gate)
  return Object.freeze({
    [TypeId]: TypeId,
    name,
    target: read(() => source.target) as Declared["target"],
    cases: read(() => list(source.cases)) as Declared["cases"],
    scorers: scorers as Declared["scorers"],
    trials: read(() => source.trials) ?? 1,
    concurrency: read(() => source.concurrency) ?? 1,
    gate,
    warnings: Object.freeze(read(() => toleranceWarnings(name, scorers, gate)) ?? [])
  })
}

const toleranceWarnings = (name: unknown, scorers: unknown, gate: unknown): ReadonlyArray<string> => {
  const tolerance = typeof gate === "object" && gate !== null ? (gate as GateOptions).tolerance : undefined
  if (tolerance !== undefined || !Array.isArray(scorers)) return []
  return scorers.flatMap((scorer) =>
    Scorer.isScorer(scorer) && typeof scorer.judge === "string"
      ? [`Suite ${JSON.stringify(name)}: scorer ${JSON.stringify(scorer.name)} is graded by the model ${scorer.judge}, and its gate sets no tolerance, so any lower score is a regression. Model scores move: set gate.tolerance.`]
      : []
  )
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const invalid = (message: string, path: string): EvalError => new EvalError({ code: "invalid_suite", message, path })

const validThreshold = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1

const gateProblem = (gate: GateOptions | undefined | null, path: string): EvalError | undefined => {
  if (gate === undefined || gate === null) return undefined
  if (typeof gate !== "object" || gate === null) return invalid("A gate must be a record", path)
  for (const key of ["mean", "min"] as const) {
    const value = gate[key]
    if (value !== undefined && !validThreshold(value)) {
      return invalid(`Gate '${key}' must be a finite number in [0, 1], got ${shown(value)}`, `${path}.${key}`)
    }
  }
  const perCase: unknown = gate.perCase
  if (perCase !== undefined && (typeof perCase !== "object" || perCase === null)) return invalid("Gate 'perCase' must be a record", `${path}.perCase`)
  for (const [name, value] of Object.entries(perCase ?? {})) {
    if (!validThreshold(value)) {
      return invalid(`Gate threshold for case '${text.flattenControlCharacters(name)}' must be in [0, 1]`, `${path}.perCase`)
    }
  }
  const tolerance = gate.tolerance
  if (tolerance !== undefined && !(typeof tolerance === "number" && Number.isFinite(tolerance) && tolerance >= 0)) {
    return invalid(`Gate 'tolerance' must be finite and non-negative, got ${shown(tolerance)}`, `${path}.tolerance`)
  }
  return undefined
}

const nameProblem = (value: unknown, what: string, path: string): EvalError | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) return invalid(`${what} must be a non-empty string`, path)
  const control = text.controlCharacter(value)
  return control === undefined ? undefined : invalid(`${what} must not contain the control character ${control}`, path)
}

const integerIn = (value: unknown, low: number, high: number): boolean =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= low && value <= high

const suiteProblem = (suite: Suite<ReadonlyArray<unknown>, unknown, unknown>): EvalError | undefined => {
  if (typeof suite !== "object" || suite === null || suite[TypeId] !== TypeId) {
    return invalid("Eval.run needs a suite from Eval.suite or Eval.fromJsonLines", "suite")
  }
  const named = nameProblem(suite.name, "A suite name", "name")
  if (named !== undefined) return named
  if (typeof suite.target !== "function") return invalid("A suite's target must be a function", "target")
  if (!integerIn(suite.trials, 1, limits.trials)) {
    return invalid(`Suite trials must be an integer from 1 to ${limits.trials}, got ${String(suite.trials)}`, "trials")
  }
  if (!integerIn(suite.concurrency, 1, limits.concurrency)) {
    return invalid(
      `Suite concurrency must be an integer from 1 to ${limits.concurrency}, got ${String(suite.concurrency)}`,
      "concurrency"
    )
  }
  if (!Array.isArray(suite.cases)) return invalid("A suite's cases must be an array", "cases")
  if (!Array.isArray(suite.scorers)) return invalid("A suite's scorers must be an array", "scorers")
  if (suite.cases.length === 0) return invalid("A suite must contain at least one case", "cases")
  if (suite.cases.length > limits.cases) {
    return invalid(`A suite must contain at most ${limits.cases} cases, got ${suite.cases.length}`, "cases")
  }
  const names = new Set<string>()
  for (const [index, item] of suite.cases.entries()) {
    if (typeof item !== "object" || item === null) return invalid("A case must be a record", `cases[${index}]`)
    const problem = nameProblem(item.name, "A case name", `cases[${index}].name`)
    if (problem !== undefined) return problem
    if (names.has(item.name)) return invalid(`Duplicate case: ${item.name}`, `cases[${index}].name`)
    names.add(item.name)
    if (!Array.isArray(item.input)) {
      return invalid("A case's input must be an array of the target's arguments", `cases[${index}].input`)
    }
  }
  const keys = new Map<string, number>()
  for (const [index, scorer] of suite.scorers.entries()) {
    if (!Scorer.isScorer(scorer)) return invalid("A suite's scorers must come from Experimental.Scorer", `scorers[${index}]`)
    if (scorer.problem !== undefined) {
      return invalid(`Scorer '${text.flattenControlCharacters(scorer.name)}' is invalid: ${scorer.problem}`, `scorers[${index}]`)
    }
    const previous = keys.get(scorer.scorerKey)
    if (previous !== undefined) {
      return invalid(
        `Scorers ${previous} and ${index} have the same identity; give one a different name, version or config`,
        `scorers[${index}]`
      )
    }
    keys.set(scorer.scorerKey, index)
  }
  return gateProblem(suite.gate, "gate")
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/**
 * One scorer's verdict on one answer. `scorer` is the scorer's `scorerKey`.
 * An inconclusive observation carries the scorer's failure code and reason.
 *
 * @category models
 * @since 0.0.13
 */
export type Observation =
  & {
    readonly case: string
    readonly scorer: string
    readonly scorerName?: string | undefined
    readonly stepKey: string
    readonly at: string
  }
  & (
    | { readonly kind: "score"; readonly score: number; readonly reason?: string | undefined; readonly meta?: unknown }
    | {
      readonly kind: "inconclusive"
      readonly code: Scorer.ScorerErrorCode
      readonly reason: string
      readonly meta?: unknown
    }
  )

/**
 * A scored observation.
 *
 * @category models
 * @since 0.0.13
 */
export type ScoreObservation = Extract<Observation, { readonly kind: "score" }>

/**
 * An inconclusive observation.
 *
 * @category models
 * @since 0.0.13
 */
export type InconclusiveObservation = Extract<Observation, { readonly kind: "inconclusive" }>

/**
 * What the target did for a case.
 *
 * @category models
 * @since 0.0.13
 */
export interface Execution {
  readonly output: unknown
  readonly stepKey: string
  readonly latencyMs: number
}

/**
 * Pass rates of a case over its trials. A trial passes when its target
 * succeeded and every scorer gave 1.
 *
 * @category models
 * @since 0.0.13
 */
export interface TrialSummary {
  readonly n: number
  readonly passes: number
  readonly rate: number
  readonly passAt1: number
  readonly passAtK: number
  readonly passHatK: number
  readonly stderr: number
}

/**
 * Pass rates averaged over cases.
 *
 * @category models
 * @since 0.0.13
 */
export interface TrialAggregate {
  readonly cases: number
  readonly passAt1: number
  readonly passAtK: number
  readonly passHatK: number
  readonly allPass: number
  readonly perCase: Readonly<Record<string, TrialSummary>>
}

/**
 * One case's result. `execution` is the first trial's; `error` the first
 * failed trial's; `observations` hold every trial's.
 *
 * @category models
 * @since 0.0.13
 */
export interface CaseResult {
  readonly case: string
  readonly execution?: Execution | undefined
  readonly error?: EvalError | undefined
  readonly observations: ReadonlyArray<Observation>
  readonly trials: TrialSummary
}

/**
 * A run of a suite.
 *
 * @category models
 * @since 0.0.13
 */
export interface RunResult {
  readonly runId: string
  readonly suite: string
  readonly at: string
  readonly cases: ReadonlyArray<CaseResult>
  readonly observations: ReadonlyArray<Observation>
  readonly trials: TrialAggregate
  readonly k: number
}

/**
 * Options of {@link run}.
 *
 * @category models
 * @since 0.0.13
 */
export interface RunOptions {
  /** Names the run. Default: the suite name and the start time. */
  readonly runId?: string | undefined
  /** Overrides the suite's `trials`. */
  readonly trials?: number | undefined
  /** The `k` of pass@k. Default 1, at most `trials`. */
  readonly k?: number | undefined
}

const casePath = (name: string): string => `cases['${name}']`

const describe = (cause: unknown): string => {
  try {
    if (cause instanceof Error) return cause.message
    if (typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string") {
      return cause.message
    }
    return String(cause)
  } catch {
    return "an unprintable failure"
  }
}

// The step key is the hash of the output's canonical JSON. Output that is not
// JSON keeps one step key per type, so every move of its score is noise.
const stepKeyOf = (output: unknown): string => {
  let written: string
  try {
    written = canonical.canonicalJson(canonical.sortCollections(output))
  } catch {
    written = `opaque:${typeof output}`
  }
  return sha256Hex(written).slice(0, 16)
}

interface Attempt {
  readonly execution?: Execution | undefined
  readonly error?: EvalError | undefined
  readonly observations: ReadonlyArray<Observation>
}

const runTarget = <Args extends ReadonlyArray<unknown>, A, R>(
  suite: Suite<Args, A, R>,
  item: Case<Args, A>
): Effect.Effect<Attempt, never, R> =>
  Effect.gen(function*() {
    const started = yield* Clock.currentTimeMillis
    const output = yield* Effect.suspend(() => suite.target(...item.input))
    const finished = yield* Clock.currentTimeMillis
    return { execution: { output, stepKey: stepKeyOf(output), latencyMs: Math.max(0, finished - started) }, observations: [] }
  }).pipe(
    // Any cause, an interruption the target raised itself included, fails
    // only this case. Interrupting the run still stops it: the fiber stays
    // interrupted and ends at its next step.
    Effect.catchCause((cause): Effect.Effect<Attempt> =>
      Effect.succeed({
          error: new EvalError({
            code: "target",
            message: text.flattenControlCharacters(`Target failed for case '${item.name}': ${describe(Cause.squash(cause))}`),
            path: casePath(item.name),
            cause: Cause.squash(cause)
          }),
          observations: []
        })
    ),
    Effect.withSpan("Eval.case", { attributes: { case: item.name } })
  )

const scoreOne = <Args extends ReadonlyArray<unknown>, A, R>(
  item: Case<Args, A>,
  execution: Execution,
  scorer: Scorer.Scorer<Scorer.Run<Args, A>, R>,
  at: string
): Effect.Effect<Observation, never, R> => {
  const base = { case: item.name, scorer: scorer.scorerKey, scorerName: scorer.name, stepKey: execution.stepKey, at }
  return Effect.suspend(() =>
    scorer.score({ input: item.input, output: execution.output as A, expected: item.expected as A })
  ).pipe(
    Effect.map((result): Observation => ({
      ...base,
      kind: "score",
      score: result.score,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(result.meta === undefined ? {} : { meta: result.meta })
    })),
    Effect.catchCause((cause): Effect.Effect<Observation> => {
      const reason = Cause.squash(cause)
      const failure = reason instanceof Scorer.ScorerError ? reason : undefined
      return Effect.succeed({
        ...base,
        kind: "inconclusive",
        code: failure?.code ?? "inconclusive",
        reason: text.flattenControlCharacters(
          `Scorer ${scorer.name} could not decide: ${failure?.message ?? describe(reason)}`
        ).slice(0, 2048)
      })
    })
  )
}

const mean = (values: ReadonlyArray<number>): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length

/**
 * The chance that at least one of `k` trials passes, estimated from `c`
 * passes in `n` trials (the unbiased pass@k estimator). `NaN` unless
 * `1 <= k <= n` and `0 <= c <= n` are integers.
 *
 * @category trials
 * @since 0.0.13
 */
export const passAtK = (n: number, c: number, k: number): number => {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(c) || !Number.isSafeInteger(k)) return Number.NaN
  if (n < 1 || c < 0 || c > n || k < 1 || k > n) return Number.NaN
  if (n - c < k) return 1
  let fail = 1
  for (let index = n - c + 1; index <= n; index++) fail *= 1 - k / index
  return 1 - fail
}

/**
 * The chance that all of `k` trials pass, estimated from `c` passes in `n`.
 * `NaN` on the inputs {@link passAtK} refuses.
 *
 * @category trials
 * @since 0.0.13
 */
export const passHatK = (n: number, c: number, k: number): number => {
  if (Number.isNaN(passAtK(n, c, k))) return Number.NaN
  let all = 1
  for (let index = 0; index < k; index++) all *= (c - index) / (n - index)
  return Math.max(0, all)
}

const summarize = (outcomes: ReadonlyArray<boolean>, k: number): TrialSummary => {
  const n = outcomes.length
  const passes = outcomes.filter(Boolean).length
  const rate = passes / n
  return {
    n,
    passes,
    rate,
    passAt1: rate,
    passAtK: passAtK(n, passes, k),
    passHatK: passHatK(n, passes, k),
    stderr: n <= 1 ? 0 : Math.sqrt(rate * (1 - rate) / n)
  }
}

const runOptionsProblem = (options: RunOptions, trials: number, k: number): EvalError | undefined => {
  if (options.runId !== undefined) {
    const problem = nameProblem(options.runId, "A run id", "options.runId")
    if (problem !== undefined) return new EvalError({ ...problem, code: "invalid_run_options" })
  }
  if (!integerIn(trials, 1, limits.trials) || !integerIn(k, 1, trials)) {
    return new EvalError({
      code: "invalid_run_options",
      message: `trials must be an integer from 1 to ${limits.trials} and k an integer from 1 to trials`,
      path: "options.trials"
    })
  }
  return undefined
}

/**
 * Runs every case of a suite `trials` times and grades every answer with
 * every scorer. Trials run one after another; within a trial, `concurrency`
 * cases at once. A target that fails is a failed case; a scorer that fails
 * is an inconclusive observation. Neither fails the run.
 *
 * @category running
 * @since 0.0.13
 */
export const run = <Args extends ReadonlyArray<unknown>, A, R>(
  suite: Suite<Args, A, R>,
  options: RunOptions = {}
): Effect.Effect<RunResult, EvalError, R> =>
  Effect.gen(function*() {
    const problem = suiteProblem(suite as unknown as Suite<ReadonlyArray<unknown>, unknown, unknown>)
    if (problem !== undefined) return yield* Effect.fail(problem)
    for (const warning of Array.isArray(suite.warnings) ? suite.warnings : []) yield* Effect.logWarning(warning)
    const n = options.trials ?? suite.trials
    const k = options.k ?? 1
    const optionsProblem = runOptionsProblem(options, n, k)
    if (optionsProblem !== undefined) return yield* Effect.fail(optionsProblem)
    const at = new Date(yield* Clock.currentTimeMillis).toISOString()
    const runId = options.runId ?? `${suite.name}@${at}`
    const trials = yield* Effect.forEach(
      Array.from({ length: n }, (_, index) => index),
      () =>
        Effect.forEach(suite.cases, (item) =>
          runTarget(suite, item).pipe(
            Effect.flatMap((attempt) =>
              attempt.execution === undefined
                ? Effect.succeed(attempt)
                : Effect.forEach(suite.scorers, (scorer) => scoreOne(item, attempt.execution!, scorer, at), {
                  concurrency: 1
                }).pipe(Effect.map((observations): Attempt => ({ ...attempt, observations })))
            )
          ), { concurrency: suite.concurrency }),
      { concurrency: 1 }
    )
    const outcomes: Array<[string, ReadonlyArray<boolean>]> = []
    const cases = suite.cases.map((item, index): CaseResult => {
      const attempts = trials.map((trial) => trial[index]!)
      const passed = attempts.map((attempt) =>
        attempt.error === undefined && attempt.observations.length > 0 &&
        attempt.observations.every((observation) => observation.kind === "score" && observation.score === 1)
      )
      outcomes.push([item.name, passed])
      const failed = attempts.find((attempt) => attempt.error !== undefined)
      return {
        case: item.name,
        ...(attempts[0]!.execution === undefined ? {} : { execution: attempts[0]!.execution }),
        ...(failed === undefined ? {} : { error: failed.error }),
        observations: attempts.flatMap((attempt) => attempt.observations),
        trials: summarize(passed, k)
      }
    })
    // fromEntries defines own properties, so a case named `__proto__` stays a case.
    const perCase: Record<string, TrialSummary> = Object.fromEntries(cases.map((item) => [item.case, item.trials]))
    const summaries = cases.map((item) => item.trials)
    return {
      runId,
      suite: suite.name,
      at,
      cases,
      observations: cases.flatMap((item) => item.observations),
      trials: {
        cases: summaries.length,
        passAt1: mean(summaries.map((summary) => summary.passAt1)),
        passAtK: mean(summaries.map((summary) => summary.passAtK)),
        passHatK: mean(summaries.map((summary) => summary.passHatK)),
        allPass: mean(summaries.map((summary) => summary.passes === summary.n ? 1 : 0)),
        perCase
      },
      k
    }
  }).pipe(Effect.withSpan("Eval.run", { attributes: { suite: suite.name } }))

// ---------------------------------------------------------------------------
// JSON Lines
// ---------------------------------------------------------------------------

/**
 * Options of {@link fromJsonLines}: everything {@link suite} takes but the
 * cases, plus the suite's name.
 *
 * @category models
 * @since 0.0.13
 */
export interface JsonLinesOptions<
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R,
  S extends ReadonlyArray<Scorer.Scorer<Scorer.Run<Args, A>, any>>
> extends Omit<SuiteOptions<Args, A, E, R, S>, "cases"> {
  readonly name: string
}

/**
 * Reads cases from JSON Lines, one `{ "name", "input", "expected"? }` object
 * per line, where `input` is the array of the target's arguments. Blank lines
 * and a leading byte-order mark are skipped. The cases are data: their types
 * are the target's, unchecked.
 *
 * @category constructors
 * @since 0.0.13
 */
export const fromJsonLines = <
  Args extends ReadonlyArray<unknown>,
  A,
  E = never,
  R = never,
  const S extends ReadonlyArray<Scorer.Scorer<Scorer.Run<NoInfer<Args>, NoInfer<A>>, any>> = readonly []
>(
  source: string,
  options: JsonLinesOptions<Args, A, E, R, S>
): Effect.Effect<Suite<Args, A, R | ServicesOf<S[number]>>, EvalError> =>
  Effect.gen(function*() {
    if (typeof source !== "string" || source.length > limits.fixtureLength) {
      return yield* Effect.fail(invalid(`JSON Lines text must be at most ${limits.fixtureLength} characters`, "text"))
    }
    const cases: Array<Case<Args, A>> = []
    const body = source.startsWith("﻿") ? source.slice(1) : source
    for (const [index, line] of body.split(/\r?\n/).entries()) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      const at = `line[${index + 1}]`
      if (cases.length === limits.cases) {
        return yield* Effect.fail(invalid(`A suite must contain at most ${limits.cases} cases`, "cases"))
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(trimmed)
      } catch (cause) {
        return yield* Effect.fail(new EvalError({ code: "invalid_suite", message: `Invalid JSON on line ${index + 1}`, path: at, cause }))
      }
      if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
        return yield* Effect.fail(invalid(`Line ${index + 1} must be a JSON object`, at))
      }
      const record = decoded as { readonly name?: unknown; readonly input?: unknown; readonly expected?: unknown }
      if (typeof record.name !== "string") return yield* Effect.fail(invalid(`Line ${index + 1} needs a string name`, `${at}.name`))
      if (!Array.isArray(record.input)) {
        return yield* Effect.fail(invalid(`Line ${index + 1} needs an input array of the target's arguments`, `${at}.input`))
      }
      cases.push({
        name: record.name,
        input: record.input as unknown as Args,
        ...(record.expected === undefined ? {} : { expected: record.expected as A })
      })
    }
    const { name, ...rest } = options
    const declared = suite<Args, A, E, R, S>(name, { ...rest, cases })
    const problem = suiteProblem(declared as unknown as Suite<ReadonlyArray<unknown>, unknown, unknown>)
    return problem === undefined ? declared : yield* Effect.fail(problem)
  })

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

/**
 * The baseline format version, Smithers' `Baseline.version`.
 *
 * @category baselines
 * @since 0.0.13
 */
export const baselineVersion = 1 as const

/**
 * One committed score.
 *
 * @category models
 * @since 0.0.13
 */
export interface BaselineRecord {
  readonly suite: string
  readonly case: string
  readonly scorer: string
  readonly scorerName?: string | undefined
  readonly stepKey: string
  readonly score: number
}

/**
 * The scores a run is compared with.
 *
 * @category models
 * @since 0.0.13
 */
export interface Baseline {
  readonly version: typeof baselineVersion
  readonly suite: string
  readonly records: ReadonlyArray<BaselineRecord>
}

const baselineError = (message: string, path?: string): EvalError =>
  new EvalError({ code: "invalid_baseline", message, ...(path === undefined ? {} : { path }) })

const shown = (value: unknown): string =>
  typeof value === "number"
    ? String(value)
    : typeof value === "string"
    ? text.flattenControlCharacters(value)
    : value === null
    ? "null"
    : typeof value

const textField = (value: unknown, field: string, path: string): string | EvalError => {
  if (typeof value !== "string") return baselineError(`Baseline record field '${field}' must be a string, got ${typeof value}`, path)
  const control = text.controlCharacter(value)
  return control === undefined
    ? value
    : baselineError(`Baseline record field '${field}' must not contain the control character ${control}`, path)
}

const decodeRecord = (value: unknown, index: number): BaselineRecord | EvalError => {
  const at = `records[${index}]`
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return baselineError(`Baseline record must be an object, got ${value === null ? "null" : typeof value}`, at)
  }
  const source = value as { readonly [key: string]: unknown }
  const fields: Record<string, string> = {}
  for (const field of ["suite", "case", "scorer", "stepKey"] as const) {
    const read = textField(source[field], field, `${at}.${field}`)
    if (read instanceof EvalError) return read
    fields[field] = read
  }
  const score = source.score
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
    return baselineError(`Baseline record field 'score' must be a finite number in [0, 1], got ${shown(score)}`, `${at}.score`)
  }
  let scorerName: string | undefined
  if (source.scorerName !== undefined) {
    const read = textField(source.scorerName, "scorerName", `${at}.scorerName`)
    if (read instanceof EvalError) return read
    scorerName = read
  }
  return {
    suite: fields.suite!,
    case: fields.case!,
    scorer: fields.scorer!,
    ...(scorerName === undefined ? {} : { scorerName }),
    stepKey: fields.stepKey!,
    score: Object.is(score, -0) ? 0 : score
  }
}

const validateBaseline = (value: unknown): Effect.Effect<Baseline, EvalError> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return Effect.fail(baselineError("Baseline must be an object"))
  const artifact = value as { readonly version?: unknown; readonly suite?: unknown; readonly records?: unknown }
  if (artifact.version !== baselineVersion) {
    return Effect.fail(baselineError(`Baseline version must be ${baselineVersion}, got ${shown(artifact.version)}`, "version"))
  }
  if (artifact.suite !== undefined) {
    const read = textField(artifact.suite, "suite", "suite")
    if (read instanceof EvalError) return Effect.fail(read)
  }
  if (!Array.isArray(artifact.records)) return Effect.fail(baselineError("Baseline records must be an array", "records"))
  const records: Array<BaselineRecord> = []
  for (const [index, item] of artifact.records.entries()) {
    const record = decodeRecord(item, index)
    if (record instanceof EvalError) return Effect.fail(record)
    records.push(record)
  }
  let suite = artifact.suite as string | undefined
  if (suite === undefined) {
    // A Smithers baseline written before `suite` was a top-level field.
    const first = records[0]
    if (first === undefined) return Effect.fail(baselineError("Cannot infer the baseline's suite: it has no records", "suite"))
    if (records.some((record) => record.suite !== first.suite)) {
      return Effect.fail(baselineError("Cannot infer the baseline's suite: its records name several suites", "suite"))
    }
    suite = first.suite
  }
  return Effect.succeed({ version: baselineVersion, suite, records: Object.freeze(records) })
}

/**
 * A baseline from a run's successful scores. Inconclusive observations and
 * failed cases record nothing. A baseline never updates itself: {@link write}
 * it to a file and commit the diff.
 *
 * @category baselines
 * @since 0.0.13
 */
export const baseline = (run: RunResult): Effect.Effect<Baseline, EvalError> =>
  validateBaseline({
    version: baselineVersion,
    suite: run.suite,
    records: run.observations.flatMap((observation) =>
      observation.kind === "score"
        ? [{
          suite: run.suite,
          case: observation.case,
          scorer: observation.scorer,
          ...(observation.scorerName === undefined ? {} : { scorerName: observation.scorerName }),
          stepKey: observation.stepKey,
          score: observation.score
        }]
        : []
    )
  })

const recordOrder = (left: BaselineRecord, right: BaselineRecord): number =>
  text.compareText(
    text.tupleKey(left.suite, left.case, left.scorer, left.stepKey),
    text.tupleKey(right.suite, right.case, right.scorer, right.stepKey)
  ) ||
  left.score - right.score ||
  text.compareText(left.scorerName ?? "", right.scorerName ?? "")

/**
 * A baseline as text to commit: canonical JSON (keys sorted, records sorted),
 * one record per line so a review sees one changed line per changed score.
 * The text is Smithers' baseline format and reads back with {@link load}.
 *
 * @category baselines
 * @since 0.0.13
 */
export const write = (baseline: Baseline): string => {
  const records = [...baseline.records].sort(recordOrder).map((record) =>
    canonical.canonicalJson({
      suite: record.suite,
      case: record.case,
      scorer: record.scorer,
      ...(record.scorerName === undefined ? {} : { scorerName: record.scorerName }),
      stepKey: record.stepKey,
      score: record.score
    })
  )
  const body = records.length === 0 ? "[]" : `[\n${records.join(",\n")}\n]`
  return `{"records":${body},"suite":${canonical.canonicalJson(baseline.suite)},"version":${baseline.version}}\n`
}

/**
 * Reads a baseline written by {@link write} or by Smithers.
 *
 * @category baselines
 * @since 0.0.13
 */
export const load = (source: string): Effect.Effect<Baseline, EvalError> => {
  if (typeof source !== "string" || source.length > limits.baselineLength) {
    return Effect.fail(baselineError(`Baseline text must be at most ${limits.baselineLength} characters`, "text"))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (cause) {
    return Effect.fail(new EvalError({ code: "invalid_baseline", message: "Baseline is not valid JSON", cause }))
  }
  return validateBaseline(parsed)
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * How far a score may move before it counts. A move counts only when it
 * exceeds both; both default to 0, which counts every move.
 *
 * @category models
 * @since 0.0.13
 */
export interface Tolerances {
  readonly absolute?: number | undefined
  readonly relative?: number | undefined
}

/**
 * A score that dropped at a changed step key: the target gave a different
 * answer and it graded worse.
 *
 * @category models
 * @since 0.0.13
 */
export interface Regression {
  readonly case: string
  readonly scorer: string
  readonly baseline: BaselineRecord
  readonly actual: ScoreObservation
  readonly drop: number
}

/**
 * A score that moved at the same step key: the same answer graded
 * differently twice.
 *
 * @category models
 * @since 0.0.13
 */
export interface Nondeterminism {
  readonly case: string
  readonly scorer: string
  readonly baseline: BaselineRecord
  readonly actual: ScoreObservation
  readonly delta: number
}

/**
 * A score on one side only. `side` is where it is missing: `"run"` for a
 * baseline record the run did not reproduce, `"baseline"` for a score no
 * baseline record accounts for.
 *
 * @category models
 * @since 0.0.13
 */
export interface MissingObservation {
  readonly side: "baseline" | "run"
  readonly case: string
  readonly scorer: string
  readonly scorerName?: string | undefined
  readonly stepKey: string
}

/**
 * A comparison of a run with a baseline.
 *
 * @category models
 * @since 0.0.13
 */
export interface Report {
  readonly suite: string
  readonly baseline: Baseline
  readonly run: RunResult
  readonly regressions: ReadonlyArray<Regression>
  readonly nondeterminism: ReadonlyArray<Nondeterminism>
  readonly missing: ReadonlyArray<MissingObservation>
  readonly samples: ReadonlyArray<ScoreObservation>
  readonly inconclusive: ReadonlyArray<InconclusiveObservation>
}

const validTolerance = (value: number): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0

// Decimal scores are inexact: 0.8 - 0.7 is 0.10000000000000009. A move counts
// only when it clears a positive tolerance by more than a few ulps.
const exceeds = (move: number, tolerance: number): boolean =>
  tolerance === 0 ? move > 0 : move - tolerance > 8 * Number.EPSILON * Math.max(1, tolerance)

const groupBy = <A>(items: ReadonlyArray<A>, of: (item: A) => string): Map<string, Array<A>> => {
  const groups = new Map<string, Array<A>>()
  for (const item of items) {
    const key = of(item)
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [item])
    else bucket.push(item)
  }
  return groups
}

const byScore = <A extends { readonly score: number }>(items: ReadonlyArray<A>): Array<A> =>
  [...items].sort((left, right) => left.score - right.score)

type Pair =
  | { readonly kind: "matched"; readonly expected: BaselineRecord; readonly observed: ScoreObservation }
  | { readonly kind: "missing-run"; readonly expected: BaselineRecord }
  | { readonly kind: "missing-baseline"; readonly observed: ScoreObservation }

// Pairs records at equal step keys first, then the leftovers in order, so a
// trial count that differs from the baseline's shows as missing scores.
const pairsFor = (expected: ReadonlyArray<BaselineRecord>, observed: ReadonlyArray<ScoreObservation>): ReadonlyArray<Pair> => {
  const pairs: Array<Pair> = []
  const expectedByStep = groupBy(expected, (record) => record.stepKey)
  const observedByStep = groupBy(observed, (record) => record.stepKey)
  const leftoverExpected: Array<BaselineRecord> = []
  const leftoverObserved: Array<ScoreObservation> = []
  for (const stepKey of [...expectedByStep.keys()].sort(text.compareText)) {
    const atStep = byScore(expectedByStep.get(stepKey)!)
    const observedAtStep = byScore(observedByStep.get(stepKey) ?? [])
    const count = Math.min(atStep.length, observedAtStep.length)
    for (let index = 0; index < count; index++) pairs.push({ kind: "matched", expected: atStep[index]!, observed: observedAtStep[index]! })
    leftoverExpected.push(...atStep.slice(count))
    leftoverObserved.push(...observedAtStep.slice(count))
  }
  for (const [stepKey, atStep] of observedByStep) {
    if (!expectedByStep.has(stepKey)) leftoverObserved.push(...atStep)
  }
  // Leftovers at step keys that changed pair by score rank: their step keys
  // are hashes, and pairing in hash order would invent regressions.
  const remainingExpected = byScore(leftoverExpected)
  const remainingObserved = byScore(leftoverObserved)
  const matched = Math.min(remainingExpected.length, remainingObserved.length)
  for (let index = 0; index < matched; index++) {
    pairs.push({ kind: "matched", expected: remainingExpected[index]!, observed: remainingObserved[index]! })
  }
  for (const record of remainingExpected.slice(matched)) pairs.push({ kind: "missing-run", expected: record })
  for (const record of remainingObserved.slice(matched)) pairs.push({ kind: "missing-baseline", observed: record })
  return pairs
}

/**
 * Compares a run with a baseline of the same suite: regressions,
 * nondeterminism and missing scores, as a value.
 *
 * @category comparing
 * @since 0.0.13
 */
export const compare = (baseline: Baseline, run: RunResult, tolerances: Tolerances = {}): Effect.Effect<Report, EvalError> => {
  const absolute = tolerances.absolute ?? 0
  const relative = tolerances.relative ?? 0
  for (const [name, value] of [["absolute", absolute], ["relative", relative]] as const) {
    if (!validTolerance(value)) {
      return Effect.fail(
        new EvalError({
          code: "invalid_tolerance",
          message: `Tolerance '${name}' must be finite and non-negative, got ${String(value)}`,
          path: `tolerances.${name}`
        })
      )
    }
  }
  if (baseline.suite !== run.suite) {
    return Effect.fail(baselineError(
      text.flattenControlCharacters(`The baseline belongs to suite '${baseline.suite}', but the run is suite '${run.suite}'`),
      "baseline.suite"
    ))
  }
  const foreign = [...new Set(baseline.records.filter((record) => record.suite !== run.suite).map((record) => record.suite))]
  if (foreign.length > 0) {
    return Effect.fail(baselineError(
      text.flattenControlCharacters(
        `The baseline holds records of suite ${foreign.map((name) => `'${name}'`).join(", ")}, but the run is suite '${run.suite}'`
      ),
      "baseline.records"
    ))
  }
  for (const [index, record] of baseline.records.entries()) {
    if (typeof record.score !== "number" || !Number.isFinite(record.score) || record.score < 0 || record.score > 1) {
      return Effect.fail(baselineError("A baseline score must be a finite number in [0, 1]", `baseline.records[${index}].score`))
    }
  }
  const actual = run.observations.filter((observation): observation is ScoreObservation => observation.kind === "score")
  const inconclusive = run.observations.filter((observation): observation is InconclusiveObservation =>
    observation.kind === "inconclusive"
  )
  const baselineByKey = groupBy(baseline.records, (record) => text.tupleKey(record.case, record.scorer))
  const actualByKey = groupBy(actual, (observation) => text.tupleKey(observation.case, observation.scorer))
  // A scorer that could not decide is inconclusive, not missing: each
  // inconclusive observation accounts for one baseline record of its pair.
  const undecided = new Map<string, number>()
  for (const observation of inconclusive) {
    const key = text.tupleKey(observation.case, observation.scorer)
    undecided.set(key, (undecided.get(key) ?? 0) + 1)
  }
  const regressions: Array<Regression> = []
  const nondeterminism: Array<Nondeterminism> = []
  const missing: Array<MissingObservation> = []
  for (const key of new Set([...baselineByKey.keys(), ...actualByKey.keys()])) {
    for (const pair of pairsFor(baselineByKey.get(key) ?? [], actualByKey.get(key) ?? [])) {
      if (pair.kind === "missing-run" && (undecided.get(key) ?? 0) > 0) {
        undecided.set(key, undecided.get(key)! - 1)
        continue
      }
      if (pair.kind !== "matched") {
        const side = pair.kind === "missing-run" ? "run" : "baseline"
        const present = pair.kind === "missing-run" ? pair.expected : pair.observed
        missing.push({
          side,
          case: present.case,
          scorer: present.scorer,
          ...(present.scorerName === undefined ? {} : { scorerName: present.scorerName }),
          stepKey: present.stepKey
        })
        continue
      }
      const { expected, observed } = pair
      const delta = observed.score - expected.score
      const magnitude = Math.max(Math.abs(expected.score), 1e-12)
      if (observed.stepKey === expected.stepKey) {
        if (exceeds(Math.abs(delta), absolute) && exceeds(Math.abs(delta) / magnitude, relative)) {
          nondeterminism.push({ case: observed.case, scorer: observed.scorer, baseline: expected, actual: observed, delta })
        }
      } else if (delta < 0 && exceeds(-delta, absolute) && exceeds(-delta / magnitude, relative)) {
        regressions.push({ case: observed.case, scorer: observed.scorer, baseline: expected, actual: observed, drop: -delta })
      }
    }
  }
  return Effect.succeed({ suite: run.suite, baseline, run, regressions, nondeterminism, missing, samples: actual, inconclusive })
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/**
 * A gate's decision. `Failed` and `Passed` carry the inconclusive
 * observations they saw; `Inconclusive` means the gate could not decide.
 *
 * @category models
 * @since 0.0.13
 */
export type Verdict =
  | { readonly _tag: "Passed"; readonly inconclusive: ReadonlyArray<string> }
  | { readonly _tag: "Failed"; readonly reasons: ReadonlyArray<string>; readonly inconclusive: ReadonlyArray<string> }
  | { readonly _tag: "Inconclusive"; readonly reasons: ReadonlyArray<string> }

/**
 * A verdict and its CI grade: exit code `0` when every case cleared the
 * gate, `1` when a score fell, moved, went missing or a target failed, and
 * `5` when the gate could not decide. A partial pass never exits `0`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Grade {
  readonly verdict: Verdict
  readonly exitCode: 0 | 1 | 5
  readonly summary: string
}

const unique = (reasons: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(reasons)]

const label = (identity: { readonly scorer: string; readonly scorerName?: string | undefined }): string =>
  identity.scorerName === undefined || identity.scorerName.length === 0
    ? identity.scorer
    : `${identity.scorerName} (${identity.scorer.slice(0, 8)})`

const rounded = (value: number): number => Number(value.toPrecision(6))

const breach = (code: string, threshold: number, actual: number): string =>
  `${code}: threshold ${rounded(threshold)}, actual ${rounded(actual) === rounded(threshold) ? actual : rounded(actual)}`

const meanTolerance = 1e-9

const grade = (verdict: Verdict): Grade => {
  switch (verdict._tag) {
    case "Failed": {
      const unresolved = verdict.inconclusive.length === 0 ? [] : [`unresolved: ${verdict.inconclusive.join("; ")}`]
      return { verdict, exitCode: 1, summary: text.flattenControlCharacters(`failed: ${[...verdict.reasons, ...unresolved].join("; ")}`) }
    }
    case "Inconclusive":
      return { verdict, exitCode: 5, summary: text.flattenControlCharacters(`inconclusive: ${verdict.reasons.join("; ")}`) }
    case "Passed":
      return verdict.inconclusive.length === 0
        ? { verdict, exitCode: 0, summary: "passed" }
        : {
          verdict,
          exitCode: 5,
          summary: text.flattenControlCharacters(`passed every gate with unresolved: ${verdict.inconclusive.join("; ")}`)
        }
  }
}

/**
 * Grades a report. Pure: the same report and options give the same grade.
 * With no `mean`, `min` or `perCase`, any score passes and only regressions,
 * nondeterminism, missing scores, failed targets and inconclusive scorers
 * decide. `tolerance` ignores moves no larger than it.
 *
 * @category gating
 * @since 0.0.13
 */
export const gate = (report: Report, gateOptions: GateOptions = {}): Grade => {
  const options: GateOptions = gateOptions ?? {}
  const problem = gateProblem(options, "options")
  if (problem !== undefined) return grade({ _tag: "Inconclusive", reasons: [`invalid_threshold: ${problem.message}`] })
  const tolerance = options.tolerance ?? 0
  const observed = report.run.observations
  const unresolved = [...unique(observed.flatMap((observation) =>
    observation.kind === "inconclusive" ? [`${observation.case}/${label(observation)}: ${observation.reason}`] : []
  ))]
  const scores = observed.flatMap((observation) => observation.kind === "score" ? [observation] : [])
  const failures: Array<string> = []
  const undecided: Array<string> = []
  const thresholds = options.mean !== undefined || options.min !== undefined || options.perCase !== undefined
  if (thresholds && scores.length === 0) undecided.push("No scores to gate")
  if (options.mean !== undefined && scores.length > 0) {
    const actual = mean(scores.map((score) => score.score))
    if (actual < options.mean - meanTolerance) failures.push(breach("mean_below_threshold", options.mean, actual))
  }
  if (options.min !== undefined && scores.length > 0) {
    const actual = scores.reduce((low, score) => score.score < low ? score.score : low, Number.POSITIVE_INFINITY)
    if (actual < options.min) failures.push(breach("min_below_threshold", options.min, actual))
  }
  const named = Object.entries(options.perCase ?? {})
  const unmeasured: Array<string> = []
  for (const [name, threshold] of named) {
    const values = scores.filter((score) => score.case === name).map((score) => score.score)
    if (values.length === 0) {
      unmeasured.push(`No scores for case ${name}`)
      continue
    }
    const actual = values.reduce((low, value) => value < low ? value : low, Number.POSITIVE_INFINITY)
    if (actual < threshold) failures.push(breach(`case_below_threshold: case '${name}'`, threshold, actual))
  }
  // Every named case unmeasured decides nothing; some unmeasured ride along.
  if (named.length > 0 && unmeasured.length === named.length) undecided.push(...unmeasured)
  else unresolved.push(...unmeasured)
  for (const item of report.run.cases) {
    if (item.error !== undefined) failures.push(`target failed for case '${item.case}': ${item.error.message}`)
  }
  for (const item of report.regressions) {
    if (exceeds(item.drop, tolerance)) failures.push(`regression for ${item.case}/${label({ scorer: item.scorer, scorerName: item.actual.scorerName })}`)
  }
  for (const item of report.nondeterminism) {
    if (exceeds(Math.abs(item.delta), tolerance)) {
      failures.push(`nondeterminism for ${item.case}/${label({ scorer: item.scorer, scorerName: item.actual.scorerName })}`)
    }
  }
  for (const item of report.missing) {
    failures.push(`missing ${item.side} score for ${item.case}/${label(item)}/${item.stepKey}`)
  }
  if (failures.length > 0) return grade({ _tag: "Failed", reasons: unique(failures), inconclusive: unique(unresolved) })
  if (undecided.length > 0) return grade({ _tag: "Inconclusive", reasons: unique([...undecided, ...unresolved]) })
  if (scores.length === 0) return grade({ _tag: "Inconclusive", reasons: unresolved.length > 0 ? unique(unresolved) : ["No scores to gate"] })
  return grade({ _tag: "Passed", inconclusive: unique(unresolved) })
}
