/**
 * Scorers: functions that grade one answer with a number from 0 to 1.
 *
 * A scorer has an identity. Its name, version and configuration hash into a
 * `scorerKey` that `Experimental.Eval` writes on every score it produces, so
 * a score recorded a month ago still names the exact grader. Change what a
 * scorer does, bump its `version`.
 *
 * A score is a finite number in `[0, 1]`; anything else is refused with
 * `invalid_score`. A scorer that fails, or that cannot grade the answer it is
 * given, fails with `inconclusive`: `Experimental.Eval` records that as an
 * inconclusive observation with its reason, never as a score of zero.
 *
 * Declaring a scorer never throws. A declaration this module cannot give a
 * stable identity, such as a blank name or a configuration holding a
 * function, is kept on the scorer as {@link Scorer.problem}: every score it
 * attempts fails with `invalid_declaration`, and `Experimental.Eval.run`
 * refuses a suite that uses it.
 *
 * {@link rubric} asks a model, the judge, to grade an answer against written
 * criteria, and {@link decide} asks Effect's `DecisionModel` one typed
 * question; {@link calibrate} measures a judge on answers whose verdict is
 * known. {@link bind} scores a durable workflow's live runs: each finished
 * run of the workflow is graded once, sampled by a rule a replay repeats, and
 * kept in a {@link ScoreStore}, in memory or in a SQL database.
 *
 * Ported from Smithers' `@smthrs/scorers` (`Scorer`, `Scorers`, `Checks`,
 * `Rubric`, `Binding`, `Sampling`, `ScoreStore`, `SqlScoreStore`).
 *
 * @experimental
 * @since 0.0.13
 */
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as EffectResult from "effect/Result"
import * as Schema from "effect/Schema"
import * as Decision from "effect/ai/Decision"
import * as DecisionModel from "effect/ai/DecisionModel"
import * as LanguageModel from "effect/ai/LanguageModel"
import type { SqlClient } from "effect/sql"
import { type Workflow, WorkflowEngine } from "effect/workflow"
import * as canonical from "./internal/canonical.js"
import * as text from "./internal/evalText.js"
import * as rubricText from "./internal/rubric.js"
import * as scoreStore from "./internal/scoreStore.js"
import { sha256Hex } from "./internal/sha256.js"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/Scorer"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/Scorer"

/**
 * What a scorer grades in a suite: the case's `input` (the target's
 * arguments), the target's `output`, and the case's `expected` value. A case
 * that declares no `expected` passes `undefined`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Run<Input = unknown, Output = unknown> {
  readonly input: Input
  readonly output: Output
  readonly expected: Output
}

/**
 * A graded answer: a score in `[0, 1]`, with an optional reason and data.
 *
 * @category models
 * @since 0.0.13
 */
export interface Result {
  readonly score: number
  readonly reason?: string | undefined
  readonly meta?: unknown
}

/**
 * What a score function may return: a number, a {@link Result}, or an
 * Effect of either.
 *
 * @category models
 * @since 0.0.13
 */
export type Outcome = number | Result

/**
 * Why a scorer could not produce a score.
 *
 * - `invalid_declaration`: the scorer has no stable identity; see {@link Scorer.problem}.
 * - `invalid_score`: the score function returned something other than a finite number in `[0, 1]`.
 * - `inconclusive`: the score function failed, or the answer is not something it can grade.
 * - `invalid_sampling`: a sampling policy other than `"all"`, `"none"` or `{ ratio, seed }` with `0 < ratio < 1`.
 *
 * @category models
 * @since 0.0.13
 */
export type ScorerErrorCode = "invalid_declaration" | "invalid_score" | "inconclusive" | "invalid_sampling"

/**
 * @category errors
 * @since 0.0.13
 */
export class ScorerError extends Data.TaggedError("ScorerError")<{
  readonly code: ScorerErrorCode
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * A grader with an identity. `In` is the record it grades; `R` the services
 * its score function needs.
 *
 * @category models
 * @since 0.0.13
 */
export interface Scorer<In = Run, R = never> {
  readonly [TypeId]: TypeId
  readonly name: string
  readonly version: string
  readonly description: string | undefined
  /** The canonical configuration that is part of the identity, or `null`. */
  readonly config: unknown
  /** SHA-256 of the canonical JSON of `{ id: name, version, config }`, as 64 hex characters. */
  readonly scorerKey: string
  /** Why this declaration has no stable identity, or `undefined` when it has one. */
  readonly problem: string | undefined
  /** Grades one record. Fails with a {@link ScorerError}, never with the score function's own error. */
  readonly score: (run: In) => Effect.Effect<Result, ScorerError, R>
}

/**
 * Options of {@link make}.
 *
 * @category models
 * @since 0.0.13
 */
export interface MakeOptions<In, R> {
  /** The scorer's stable name. Part of its identity. */
  readonly name: string
  /** The scorer's contract version. Part of its identity: bump it when grading changes. */
  readonly version: string
  readonly description?: string | undefined
  /** Inert JSON that changes how the scorer grades. Part of its identity. */
  readonly config?: unknown
  readonly score: (run: In) => Outcome | Effect.Effect<Outcome, unknown, R>
}

const maxReasonLength = 2048

const bounded = (reason: string): string =>
  text.flattenControlCharacters(reason.length <= maxReasonLength ? reason : `${reason.slice(0, maxReasonLength)}[truncated]`)

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

const inconclusive = (message: string, cause?: unknown) =>
  new ScorerError({ code: "inconclusive", message: bounded(message), ...(cause === undefined ? {} : { cause }) })

const received = (value: unknown): string => {
  try {
    if (typeof value === "number") return String(value)
    if (typeof value === "object" && value !== null && "score" in value) return String((value as { readonly score: unknown }).score)
    return typeof value
  } catch {
    return typeof value
  }
}

/**
 * Checks a score function's result: a finite number in `[0, 1]`, or a
 * record whose `score` is one, with an optional string `reason`.
 *
 * @category validation
 * @since 0.0.13
 */
export const validate = (value: unknown): Effect.Effect<Result, ScorerError> => {
  const result: { readonly score?: unknown; readonly reason?: unknown; readonly meta?: unknown } | undefined =
    typeof value === "number"
      ? { score: value }
      : typeof value === "object" && value !== null && !Array.isArray(value)
      ? value
      : undefined
  const score = result?.score
  if (result === undefined || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
    return Effect.fail(
      new ScorerError({ code: "invalid_score", message: `A score must be a finite number in [0, 1], received ${received(value)}` })
    )
  }
  const reason = result.reason
  if (reason !== undefined && typeof reason !== "string") {
    return Effect.fail(new ScorerError({ code: "invalid_score", message: "A score's reason must be a string" }))
  }
  const meta = result.meta
  return Effect.succeed({
    score: Object.is(score, -0) ? 0 : score,
    ...(reason === undefined ? {} : { reason: bounded(reason) }),
    ...(meta === undefined ? {} : { meta })
  })
}

const declarationProblem = (name: unknown, version: unknown, config: unknown): string | undefined => {
  if (typeof name !== "string" || name.trim().length === 0) return "A scorer name must be a non-empty string"
  if (typeof version !== "string" || version.trim().length === 0) return "A scorer version must be a non-empty string"
  const control = text.controlCharacter(name)
  if (control !== undefined) return `A scorer name must not contain the control character ${control}`
  if (config === undefined) return undefined
  try {
    const lossy = text.lossyPath(config, "config")
    return lossy === undefined ? undefined : `A scorer configuration must be plain JSON: ${lossy}`
  } catch {
    return "A scorer configuration could not be inspected"
  }
}

const identity = (name: string, version: string, config: unknown): string => {
  try {
    return sha256Hex(canonical.canonicalJson({ id: name, version, config: config ?? null }))
  } catch {
    return ""
  }
}

/**
 * Declares a scorer. `score` grades one record and returns a number in
 * `[0, 1]`, a {@link Result}, or an Effect of either. Runs nothing.
 *
 * @category constructors
 * @since 0.0.13
 */
export const make = <In, R = never>(options: MakeOptions<In, R>): Scorer<In, R> => {
  // Each field is read once, and nothing here throws: a declaration this
  // module cannot use keeps the reason as its problem.
  const field = (key: keyof MakeOptions<In, R>): unknown => {
    try {
      return typeof options === "object" && options !== null ? options[key] : undefined
    } catch {
      return undefined
    }
  }
  const name = field("name"), version = field("version"), config = field("config"), score = field("score")
  const description = field("description")
  let problem = typeof options === "object" && options !== null ? declarationProblem(name, version, config) : "A scorer needs { name, version, score }"
  if (problem === undefined && typeof score !== "function") problem = "A scorer's score must be a function"
  const scorerKey = problem === undefined ? identity(name as string, version as string, config) : ""
  if (problem === undefined && scorerKey === "") problem = "A scorer configuration could not be written as canonical JSON"
  // The configuration is copied at declaration, so mutating the caller's
  // object later cannot change grading under the same scorerKey.
  const frozen = problem === undefined && config !== undefined ? deepFreeze(JSON.parse(canonical.canonicalJson(config))) : null
  const grade = score as MakeOptions<In, R>["score"]
  return Object.freeze({
    [TypeId]: TypeId,
    name: typeof name === "string" ? name : "",
    version: typeof version === "string" ? version : "",
    description: typeof description === "string" ? description : undefined,
    config: frozen,
    scorerKey,
    problem,
    score: (run: In): Effect.Effect<Result, ScorerError, R> =>
      problem !== undefined
        ? Effect.fail(new ScorerError({ code: "invalid_declaration", message: problem }))
        : Effect.suspend(() => {
          const outcome = grade(run)
          return Effect.isEffect(outcome) ? outcome : Effect.succeed(outcome)
        }).pipe(
          // A typed failure or a defect is the scorer's failure; an
          // interruption stays an interruption.
          Effect.catchCause((cause): Effect.Effect<Outcome, ScorerError> => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause as Cause.Cause<never>)
            const reason = Cause.squash(cause)
            return Effect.fail(reason instanceof ScorerError ? reason : inconclusive(describe(reason), reason))
          }),
          Effect.flatMap(validate)
        )
  })
}

const deepFreeze = <A>(value: A): A => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** A frozen deep copy of plain data, or `undefined` when it is not plain JSON. */
const frozenCopy = <A>(value: A): A | undefined => {
  try {
    return text.lossyPath(value, "value") === undefined ? deepFreeze(JSON.parse(canonical.canonicalJson(value)) as A) : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether `value` is a scorer.
 *
 * @category guards
 * @since 0.0.13
 */
export const isScorer = (value: unknown): value is Scorer<never, unknown> =>
  typeof value === "object" && value !== null && (value as { readonly [TypeId]?: unknown })[TypeId] === TypeId

const normalize = (value: string) => value.trim().replace(/\s+/g, " ")

const jsonText = (value: unknown): string | undefined => {
  try {
    return canonical.canonicalJson(value)
  } catch {
    return undefined
  }
}

/**
 * Equality with `expected`. Text is compared after trimming the ends and
 * collapsing runs of whitespace; any other value by its canonical JSON. A
 * case with no `expected`, or a value that is not JSON, is inconclusive.
 *
 * @category scorers
 * @since 0.0.13
 */
export const exact: Scorer<{ readonly output: unknown; readonly expected: unknown }> = /* @__PURE__ */ make({
  name: "exact",
  version: "1",
  score: ({ expected, output }: { readonly output: unknown; readonly expected: unknown }) => {
    if (expected === undefined) return Effect.fail(inconclusive("exact needs the case's expected value"))
    if (typeof output === "string" && typeof expected === "string") {
      const same = normalize(output) === normalize(expected)
      return { score: same ? 1 : 0, reason: same ? "Text matches" : "Text differs" }
    }
    const left = jsonText(output), right = jsonText(expected)
    if (left === undefined || right === undefined) return Effect.fail(inconclusive("exact compares text or JSON values"))
    return { score: left === right ? 1 : 0, reason: left === right ? "Values match" : "Values differ" }
  }
})

/**
 * Case-sensitive containment: the output text contains `needle`, or the
 * case's `expected` text when `needle` is omitted.
 *
 * @category scorers
 * @since 0.0.13
 */
export const contains = (needle?: string): Scorer<{ readonly output: unknown; readonly expected: unknown }> =>
  make({
    name: "contains",
    version: "1",
    ...(needle === undefined ? {} : { config: { needle } }),
    score: ({ expected, output }: { readonly output: unknown; readonly expected: unknown }) => {
      const wanted = needle ?? expected
      if (typeof output !== "string") return Effect.fail(inconclusive("contains grades text output"))
      if (typeof wanted !== "string") return Effect.fail(inconclusive("contains needs a text needle or a text expected value"))
      return { score: output.includes(wanted) ? 1 : 0 }
    }
  })

/**
 * One text check of {@link checks}. Each is plain data, so a list of checks
 * is the scorer's configuration and part of its identity.
 *
 * - `includes`: every entry appears. An entry is a case-insensitive whole word
 *   or phrase, a stem written `renew*`, or a regular expression written
 *   `/source/flags`; an array entry passes when any of its members appears.
 * - `excludes`: no entry appears, matched the same way.
 * - `words`: the word count is within the inclusive bounds. A link counts as
 *   its label's words.
 * - `excludesOpener`: the text does not open with any of the phrases.
 * - `complete`: the text has no unclosed code fence and no ellipsis that cuts
 *   it off.
 *
 * @category models
 * @since 0.0.13
 */
export type Check =
  | { readonly includes: ReadonlyArray<string | ReadonlyArray<string>> }
  | { readonly excludes: ReadonlyArray<string> }
  | { readonly words: { readonly min?: number | undefined; readonly max?: number | undefined } }
  | { readonly excludesOpener: ReadonlyArray<string> }
  | { readonly complete: true }

/**
 * The result of one check, in a {@link checks} score's `meta.checks`.
 *
 * @category models
 * @since 0.0.13
 */
export type CheckResult = text.Check

const checkProblem = (item: Check, index: number): string | undefined => {
  const at = `checks[${index}]`
  if (typeof item !== "object" || item === null) return `${at} must be a check record`
  const keys = Object.keys(item)
  if (keys.length !== 1) return `${at} must name exactly one check`
  const patterns = (entries: unknown): string | undefined => {
    if (!Array.isArray(entries)) return `${at}.${keys[0]} must be an array`
    if (entries.some((entry) => Array.isArray(entry) && entry.length === 0)) return `${at}.${keys[0]} has an empty any-of group`
    for (const entry of entries.flat()) {
      if (typeof entry !== "string") return `${at}.${keys[0]} entries must be text`
      const invalid = text.invalidPattern(entry)
      if (invalid !== undefined) return `${at}.${keys[0]} has an invalid pattern ${JSON.stringify(entry)}: ${invalid}`
    }
    return undefined
  }
  if ("includes" in item) return patterns(item.includes)
  if ("excludes" in item) return patterns(item.excludes)
  if ("excludesOpener" in item) return patterns(item.excludesOpener)
  if ("words" in item) {
    if (typeof item.words !== "object" || item.words === null) return `${at}.words must be { min?, max? }`
    const { max, min } = item.words
    for (const bound of [min, max]) {
      if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 0)) return `${at}.words bounds must be non-negative integers`
    }
    return undefined
  }
  if ("complete" in item) return item.complete === true ? undefined : `${at}.complete must be true`
  return `${at} names an unknown check ${JSON.stringify(keys[0])}`
}

const runCheck = (item: Check, output: string): text.Check =>
  "includes" in item
    ? text.includesCheck(output, item.includes)
    : "excludes" in item
    ? text.excludesCheck(output, item.excludes)
    : "words" in item
    ? text.lengthCheck(output, item.words)
    : "excludesOpener" in item
    ? text.openerCheck(output, item.excludesOpener)
    : text.completeCheck(output)

/**
 * Grades text output with a list of pure {@link Check}s. The score is the
 * fraction that pass (1 for an empty list), the reason names each failure,
 * and `meta` is `{ pass, checks }`.
 *
 * @category scorers
 * @since 0.0.13
 */
export const checks = (
  list: ReadonlyArray<Check>,
  options: { readonly name?: string | undefined; readonly version?: string | undefined } = {}
): Scorer<{ readonly output: unknown }> => {
  const settings = typeof options === "object" && options !== null ? options : {}
  let problem: string | undefined
  try {
    problem = Array.isArray(list) ? list.map(checkProblem).find((found) => found !== undefined) : "checks needs an array of checks"
  } catch {
    problem = "checks could not read its list"
  }
  // Copied and frozen at declaration: the list is the scorer's identity.
  const frozen = problem === undefined ? frozenCopy(list) : undefined
  if (problem === undefined && frozen === undefined) problem = "checks needs a list of plain data"
  const scorer = make({
    name: typeof settings.name === "string" ? settings.name : "checks",
    version: typeof settings.version === "string" ? settings.version : "1",
    config: problem === undefined ? { checks: frozen } : null,
    score: ({ output }: { readonly output: unknown }) => {
      if (typeof output !== "string") return Effect.fail(inconclusive("checks grades text output"))
      const results = frozen!.map((item) => runCheck(item, output))
      const failed = results.filter((result) => !result.pass)
      return {
        score: results.length === 0 ? 1 : (results.length - failed.length) / results.length,
        reason: [
          `${results.length - failed.length}/${results.length} checks passed`,
          ...failed.map((result) => `${result.id}: ${result.detail}`)
        ].join("; "),
        meta: { pass: failed.length === 0, checks: results }
      }
    }
  })
  return problem === undefined ? scorer : withProblem(scorer, problem)
}

// ---------------------------------------------------------------------------
// Live runs
// ---------------------------------------------------------------------------

/**
 * Which live runs a bound scorer grades: every run, none, or a fraction
 * chosen by a hash of the run id, the scorer's identity and `seed`. The
 * choice depends on nothing else, so a replay samples the same runs.
 *
 * @category models
 * @since 0.0.13
 */
export type Sampling = "all" | "none" | { readonly ratio: number; readonly seed: string }

const fnv = (input: string): number => {
  let value = 2166136261
  for (const byte of new TextEncoder().encode(input)) {
    value ^= byte
    value = Math.imul(value, 16777619)
  }
  return (value >>> 0) / 4294967296
}

const samplingProblem = (sampling: unknown): string | undefined => {
  if (sampling === "all" || sampling === "none") return undefined
  if (typeof sampling === "object" && sampling !== null) {
    const { ratio, seed } = sampling as { readonly ratio?: unknown; readonly seed?: unknown }
    if (typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 && ratio < 1 && typeof seed === "string" && seed.length > 0) {
      return undefined
    }
  }
  return "A sampling policy must be \"all\", \"none\", or { ratio, seed } with 0 < ratio < 1 and a non-empty seed"
}

/**
 * Whether `sampling` selects the run `run` for the scorer `scorerKey`.
 * Deterministic: the same arguments always give the same answer. `false`
 * for a policy {@link bind} would refuse.
 *
 * @category live runs
 * @since 0.0.13
 */
export const sampled = (sampling: Sampling, run: string, scorerKey: string): boolean => {
  if (samplingProblem(sampling) !== undefined) return false
  if (sampling === "all") return true
  if (sampling === "none") return false
  const material = [run, scorerKey, sampling.seed].map((part) => `${part.length}:${part}`).join("")
  return fnv(material) < sampling.ratio
}

/**
 * One persisted observation of a live run. `run` is the workflow's
 * execution id and `scorer` the scorer's `scorerKey`.
 *
 * @category models
 * @since 0.0.13
 */
export type StoredObservation = scoreStore.StoredObservation

/**
 * Counts, mean and minimum of stored scores.
 *
 * @category models
 * @since 0.0.13
 */
export type Aggregate = scoreStore.Aggregate

/**
 * Selects stored observations by workflow name, run id and `scorerKey`.
 *
 * @category models
 * @since 0.0.13
 */
export type Filter = scoreStore.Filter

/**
 * Where live scores persist.
 *
 * - `recordOnce` keeps the first observation of an identity and answers
 *   whether it was new.
 * - `observations` and `aggregate` read what was kept, oldest first.
 * - `prune` deletes observations older than a duration and answers how many.
 *   Nothing else deletes them.
 *
 * @category models
 * @since 0.0.13
 */
export interface ScoreStore {
  readonly recordOnce: (observation: StoredObservation) => Effect.Effect<boolean>
  readonly observations: (filter?: Filter) => Effect.Effect<ReadonlyArray<StoredObservation>>
  readonly aggregate: (filter?: Filter) => Effect.Effect<Aggregate>
  readonly prune: (options: { readonly olderThan: Duration.Input }) => Effect.Effect<number>
}

/**
 * @category services
 * @since 0.0.13
 */
export const ScoreStore: Context.Service<ScoreStore, ScoreStore> = /* @__PURE__ */ Context.Service<ScoreStore>(
  "vibelang/experimental/Scorer/ScoreStore"
)

const fromStore = (store: scoreStore.Store): ScoreStore => ({
  recordOnce: store.recordOnce,
  observations: store.observations,
  aggregate: (filter) => Effect.map(store.observations(filter), scoreStore.aggregate),
  prune: ({ olderThan }) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) => {
      const age = Duration.toMillis(Duration.fromInputUnsafe(olderThan))
      return Number.isFinite(age) ? store.prune(Math.floor(now - age)) : Effect.succeed(0)
    })
})

/**
 * A score store in this process's memory.
 *
 * @category layers
 * @since 0.0.13
 */
export const memory: Layer.Layer<ScoreStore> = /* @__PURE__ */ Layer.sync(ScoreStore, () => fromStore(scoreStore.makeMemory()))

/**
 * A score store over Effect's `SqlClient`: SQLite or PostgreSQL, through
 * the client the program provides. It creates the table
 * `score_observations` if it is missing. A SQL failure is a defect.
 *
 * @category layers
 * @since 0.0.13
 */
export const layerSql: Layer.Layer<ScoreStore, never, SqlClient.SqlClient> = /* @__PURE__ */ Layer.effect(
  ScoreStore,
  /* @__PURE__ */ Effect.map(/* @__PURE__ */ Effect.orDie(scoreStore.makeSql), fromStore)
)

/**
 * Options of {@link bind}.
 *
 * @category models
 * @since 0.0.13
 */
export interface BindOptions {
  /** Which runs to score. Default `"all"`. */
  readonly sampling?: Sampling | undefined
  /** How long one score may take before it is inconclusive. Default one minute. */
  readonly timeout?: Duration.Input | undefined
}

type PayloadOf<W> = W extends Workflow.Workflow<any, infer P, any, any> ? P["Type"] : never
type SuccessOf<W> = W extends Workflow.Workflow<any, any, infer S, any> ? S["Type"] : never

/**
 * Scores a workflow's live runs. The layer wraps the `WorkflowEngine` it is
 * given: when a run of `workflow` finishes with a result, the scorer grades
 * `{ input: payload, output: result }` and the {@link ScoreStore} keeps the
 * observation under the run's execution id. A run that is executed again,
 * joined or resumed records its score once. A run that fails is not scored.
 *
 * Scoring never changes a run's result: a scorer that fails records an
 * inconclusive observation, and a store that fails logs a warning. A
 * scorer with no stable identity, or an invalid sampling policy, fails the
 * layer when it is built.
 *
 * @category live runs
 * @since 0.0.13
 */
export const bind = <W extends Workflow.Any, R = never>(
  scorer: Scorer<Run<PayloadOf<W>, SuccessOf<W>>, R>,
  workflow: W,
  options: BindOptions = {}
): Layer.Layer<WorkflowEngine.WorkflowEngine, ScorerError, WorkflowEngine.WorkflowEngine | ScoreStore | R> =>
  Layer.effect(
    WorkflowEngine.WorkflowEngine,
    Effect.gen(function*() {
      const settings = typeof options === "object" && options !== null ? options : {}
      const sampling = settings.sampling ?? "all"
      const timeout = settings.timeout ?? "1 minute"
      const problem = scorer.problem ?? samplingProblem(sampling)
      if (problem !== undefined) {
        return yield* Effect.fail(
          new ScorerError({ code: scorer.problem === undefined ? "invalid_sampling" : "invalid_declaration", message: problem })
        )
      }
      const engine = yield* WorkflowEngine.WorkflowEngine
      const store = yield* ScoreStore
      const services = yield* Effect.context<R>()
      const grade = (payload: PayloadOf<W>, output: SuccessOf<W>, run: string) =>
        Effect.gen(function*() {
          if (!sampled(sampling, run, scorer.scorerKey)) return
          const at = yield* Clock.currentTimeMillis
          const base = {
            identity: text.tupleKey("live", workflow._tag, run, scorer.scorerKey),
            workflow: workflow._tag,
            run,
            scorer: scorer.scorerKey,
            scorerName: scorer.name,
            at
          }
          const observation = yield* Effect.suspend(() =>
            scorer.score({ input: payload, output, expected: undefined as SuccessOf<W> })
          ).pipe(
            Effect.provideContext(services),
            Effect.timeout(timeout),
            Effect.map((result): StoredObservation => ({
              ...base,
              kind: "score",
              score: result.score,
              ...(result.reason === undefined ? {} : { reason: result.reason }),
              ...(result.meta === undefined ? {} : { meta: result.meta })
            })),
            // Any cause, a timeout or an interruption the scorer raised
            // itself included, is inconclusive and never reaches the run.
            Effect.catchCause((cause): Effect.Effect<StoredObservation> => {
              const reason = Cause.squash(cause)
              const failure = reason instanceof ScorerError ? reason : undefined
              return Effect.succeed({
                ...base,
                kind: "inconclusive",
                code: failure?.code === "invalid_sampling" ? "inconclusive" : failure?.code ?? "inconclusive",
                reason: bounded(`Scorer ${scorer.name} could not decide: ${failure?.message ?? describe(reason)}`)
              })
            })
          )
          yield* store.recordOnce(observation).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not record a live score", Cause.squash(cause)).pipe(
                  Effect.annotateLogs({ workflow: workflow._tag, run, scorer: scorer.scorerKey })
                )
            )
          )
        })
      return WorkflowEngine.WorkflowEngine.of({
        ...engine,
        register: (registered: any, execute: any) =>
          registered._tag !== workflow._tag
            ? engine.register(registered, execute)
            : engine.register(registered, (payload: any, run: string) =>
              Effect.tap(execute(payload, run), (output: any) => grade(payload, output, run)))
      } as WorkflowEngine.WorkflowEngine["Service"])
    })
  )

// ---------------------------------------------------------------------------
// Model judges
// ---------------------------------------------------------------------------

/**
 * One rubric criterion: a question the judge answers with an integer from
 * 1 (`low`) to 5 (`high`).
 *
 * @category models
 * @since 0.0.13
 */
export type Criterion = rubricText.Criterion

/**
 * A labelled answer shown to the judge as an example.
 *
 * @category models
 * @since 0.0.13
 */
export type RubricExample = rubricText.Example

/**
 * When a judgement passes: every criterion at least `minEach` and their
 * mean at least `minMean`. Default `{ minEach: 3, minMean: 3.8 }`.
 *
 * @category models
 * @since 0.0.13
 */
export type RubricRule = rubricText.Rule

/**
 * Options of {@link rubric}.
 *
 * @category models
 * @since 0.0.13
 */
export interface RubricOptions<E, R> {
  /** The judge's seat, such as `"anthropic:claude-sonnet-5-5"`. Part of the scorer's identity. */
  readonly model: string
  /** The `LanguageModel` that answers for the seat. A test passes a scripted model here. */
  readonly layer: Layer.Layer<LanguageModel.LanguageModel, E, R>
  readonly name?: string | undefined
  readonly version?: string | undefined
  readonly examples?: ReadonlyArray<RubricExample> | undefined
  readonly rule?: RubricRule | undefined
  readonly instructions?: string | undefined
}

const withProblem = <In, R>(scorer: Scorer<In, R>, problem: string): Scorer<In, R> =>
  Object.freeze({
    ...scorer,
    scorerKey: "",
    problem,
    score: () => Effect.fail(new ScorerError({ code: "invalid_declaration", message: problem }))
  })

/**
 * A scorer whose judge is a model. The judge scores each criterion from 1
 * to 5; the score is their mean mapped onto `[0, 1]`, and `meta` holds the
 * criterion scores, whether the {@link RubricRule} passed, and the judge's
 * seat. The seat is part of the scorer's identity, so a different judge is a
 * different scorer. Nothing defaults to the model under test.
 *
 * The case input is the context the judge reads; an input `{ context, focus }`
 * also tells the judge what ideal behaviour is. Everything the judge reads
 * is fenced as data. A judge that cannot be reached, or whose reply holds no
 * score for every criterion, is inconclusive: it never passes.
 *
 * @category scorers
 * @since 0.0.13
 */
export const rubric = <E = never, R = never>(
  criteria: ReadonlyArray<Criterion>,
  options: RubricOptions<E, R>
): Scorer<{ readonly input: unknown; readonly output: unknown }, R> => {
  const settings = (typeof options === "object" && options !== null ? options : {}) as Partial<RubricOptions<E, R>>
  const seat = settings.model
  const rule = settings.rule ?? rubricText.defaultRule
  const instructions = settings.instructions
  // Criteria, examples and rule are copied and frozen at declaration: they
  // are the scorer's identity.
  const declared = frozenCopy({ criteria, examples: settings.examples ?? [], rule })
  let problem = typeof seat !== "string" || seat.trim().length === 0
    ? "A rubric must name its judge's seat"
    : declared === undefined
    ? "A rubric's criteria, examples and rule must be plain data"
    : rubricText.criteriaProblem(declared.criteria, declared.rule) ?? rubricText.examplesProblem(declared.examples)
  if (problem === undefined && instructions !== undefined && typeof instructions !== "string") problem = "A rubric's instructions must be text"
  if (problem === undefined && !Layer.isLayer(settings.layer)) problem = "A rubric needs the layer of its judge's LanguageModel"
  const scorer = make({
    name: typeof settings.name === "string" ? settings.name : "rubric",
    version: typeof settings.version === "string" ? settings.version : "1",
    config: problem === undefined ? { model: seat, ...declared, instructions: instructions ?? null } : null,
    score: ({ input, output }: { readonly input: unknown; readonly output: unknown }) =>
      Effect.gen(function*() {
        // A suite passes the target's arguments; one argument is the subject.
        const { context, focus } = rubricText.subject(Array.isArray(input) && input.length === 1 ? input[0] : input)
        const request = rubricText.render({
          criteria: declared!.criteria,
          examples: declared!.examples,
          instructions,
          context,
          focus,
          output: rubricText.asText(output)
        })
        const reply = yield* LanguageModel.generateText({
          prompt: [{ role: "system", content: request.system }, { role: "user", content: request.prompt }]
        }).pipe(
          Effect.provide(settings.layer!),
          Effect.mapError((cause) => inconclusive(`The judge ${seat} could not answer: ${describe(cause)}`, cause))
        )
        const judgement = rubricText.parse(reply.text, declared!.criteria)
        if (typeof judgement === "string") {
          return yield* Effect.fail(new ScorerError({ code: "invalid_score", message: `The judge ${seat} replied without a usable score: ${judgement}` }))
        }
        return {
          score: rubricText.normalized(judgement.scores),
          reason: judgement.reason,
          meta: { scores: judgement.scores, pass: rubricText.decide(judgement.scores, declared!.rule), judge: seat }
        }
      })
  })
  return problem === undefined ? scorer : withProblem(scorer, problem)
}

/**
 * How often a judge agreed with known verdicts. A judgement passes when its
 * `meta.pass` is `true`, or, for a scorer without one, when its score is at
 * least the threshold. An inconclusive judgement agrees with nothing.
 *
 * @category models
 * @since 0.0.13
 */
export interface Agreement {
  readonly total: number
  readonly agree: number
  readonly accuracy: number
  readonly truePass: number
  readonly trueFail: number
  readonly falsePass: number
  readonly falseFail: number
  readonly inconclusive: number
}

/**
 * One answer whose verdict is known.
 *
 * @category models
 * @since 0.0.13
 */
export interface Labelled {
  readonly input?: unknown
  readonly output: unknown
  readonly verdict: "pass" | "fail"
}

/**
 * Measures a judge: grades answers whose verdict is known and counts how
 * often the judge agreed. Run it before trusting a rubric's scores.
 *
 * @category scorers
 * @since 0.0.13
 */
export const calibrate = <R>(
  scorer: Scorer<{ readonly input: unknown; readonly output: unknown }, R>,
  labelled: ReadonlyArray<Labelled>,
  options: { readonly threshold?: number | undefined; readonly concurrency?: number | undefined } = {}
): Effect.Effect<Agreement, never, R> =>
  Effect.forEach(labelled, (item) =>
    Effect.suspend(() => scorer.score({ input: item.input, output: item.output })).pipe(
      Effect.map((result) => {
        const pass = (result.meta as { readonly pass?: unknown } | undefined)?.pass
        return typeof pass === "boolean" ? pass : result.score >= (options.threshold ?? 1)
      }),
      Effect.map((pass) => ({ expected: item.verdict, actual: pass ? "pass" as const : "fail" as const })),
      Effect.catchCause((cause) =>
        Effect.succeed({ expected: item.verdict, actual: "inconclusive" as const, cause })
      )
    ), { concurrency: options.concurrency ?? 1 }).pipe(
      Effect.map((pairs): Agreement => {
        const tally = (expected: "pass" | "fail", actual: "pass" | "fail") =>
          pairs.filter((pair) => pair.expected === expected && pair.actual === actual).length
        const truePass = tally("pass", "pass"), trueFail = tally("fail", "fail")
        const agree = truePass + trueFail
        return {
          total: pairs.length,
          agree,
          accuracy: pairs.length === 0 ? 0 : agree / pairs.length,
          truePass,
          trueFail,
          falsePass: tally("fail", "pass"),
          falseFail: tally("pass", "fail"),
          inconclusive: pairs.filter((pair) => pair.actual === "inconclusive").length
        }
      })
    )

// ---------------------------------------------------------------------------
// Decision-model judges
// ---------------------------------------------------------------------------

/**
 * A decision {@link decide} grades with: Effect's `Decision.classify`,
 * `Decision.rate` or `Decision.probability`.
 *
 * @category models
 * @since 0.0.13
 */
export type Graded = Decision.Classify<string> | Decision.Rate<string> | Decision.Probability

/**
 * Options of {@link decide}.
 *
 * @category models
 * @since 0.0.13
 */
export interface DecideOptions<E, R> {
  /** The judge's seat, such as `"openai:gpt-5"`. Part of the scorer's identity. */
  readonly model: string
  /** The `DecisionModel` that answers for the seat. A test passes `Experimental.Test.decisions` here. */
  readonly layer: Layer.Layer<DecisionModel.DecisionModel, E, R>
  /** For a classify decision, the labels that pass. Required for classify, refused otherwise. */
  readonly pass?: ReadonlyArray<string> | undefined
  readonly name?: string | undefined
  readonly version?: string | undefined
}

/** What the judge reads: the case input as context, the ideal behaviour when given, and the output. */
const Judged = Schema.Struct({
  context: Schema.String,
  focus: Schema.optional(Schema.String),
  output: Schema.String
})

const decisionProblem = (decision: unknown, pass: unknown): string | undefined => {
  if (typeof decision !== "object" || decision === null) return "Scorer.decide needs a classify, rate or probability decision"
  const { _tag, criteria, instructions } = decision as { _tag?: unknown; criteria?: unknown; instructions?: unknown }
  if (_tag === "Locate") return "Scorer.decide grades text; a locate decision has no score"
  if (_tag !== "Classify" && _tag !== "Rate" && _tag !== "Probability") return "Scorer.decide needs a classify, rate or probability decision"
  if (instructions === undefined || instructions === null) return "A decision needs instructions"
  if (_tag === "Classify") {
    const labels = typeof criteria === "object" && criteria !== null && !Array.isArray(criteria) ? Object.keys(criteria) : []
    if (labels.length < 2) return "A classify decision needs at least two labels"
    if (!Array.isArray(pass) || pass.length === 0) return "A classify decision needs pass: the labels that pass"
    for (const label of pass) {
      if (typeof label !== "string" || !labels.includes(label)) return `pass names ${JSON.stringify(label)}, which is not one of the decision's labels`
    }
    if (new Set(pass).size === labels.length) return "pass must leave at least one label failing"
    return undefined
  }
  if (pass !== undefined) return "pass applies only to a classify decision"
  if (_tag === "Rate" && (!Array.isArray(criteria) || criteria.length < 2)) return "A rate decision needs at least two levels"
  return undefined
}

const unit = (value: number): number => Math.min(1, Math.max(0, value))

const definedFields = (value: unknown): unknown => {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined))
      : value
  } catch {
    return undefined
  }
}

/**
 * A scorer whose judge is a decision model, Effect's `DecisionModel`: one
 * typed decision instead of a prompt and a parsed reply. The score is the
 * probability for `Decision.probability`, the rating mapped onto `[0, 1]`
 * (lowest level 0, highest 1) for `Decision.rate`, and the probability of the
 * passing labels for `Decision.classify`, whose `meta.pass` says whether
 * the chosen label passes. The seat, the decision and `pass` are the
 * scorer's identity. Nothing defaults to the model under test.
 *
 * The judge reads `{ context, focus?, output }`: the case input as context,
 * as {@link rubric} reads it, and the output as text. A judge that cannot be
 * reached, refuses, or gives no valid answer is inconclusive: it never
 * passes.
 *
 * @category scorers
 * @since 0.0.13
 */
export const decide = <E = never, R = never>(
  decision: Graded,
  options: DecideOptions<E, R>
): Scorer<{ readonly input: unknown; readonly output: unknown }, R> => {
  const settings = (typeof options === "object" && options !== null ? options : {}) as Partial<DecideOptions<E, R>>
  const seat = settings.model
  // The decision and its passing labels are copied and frozen at
  // declaration: they are the scorer's identity. A field Effect's
  // constructors leave undefined, such as a probability's `criteria`, is
  // not part of it.
  const declared = frozenCopy({ decision: definedFields(decision), pass: settings.pass ?? null })
  let problem = typeof seat !== "string" || seat.trim().length === 0
    ? "A decision scorer must name its judge's seat"
    : declared === undefined
    ? "A decision scorer's decision and pass must be plain data"
    : decisionProblem(declared.decision, declared.pass ?? undefined)
  if (problem === undefined && !Layer.isLayer(settings.layer)) problem = "A decision scorer needs the layer of its judge's DecisionModel"
  const scorer = make({
    name: typeof settings.name === "string" ? settings.name : "decide",
    version: typeof settings.version === "string" ? settings.version : "1",
    config: problem === undefined ? { model: seat, decision: declared!.decision, pass: declared!.pass } : null,
    score: ({ input, output }: { readonly input: unknown; readonly output: unknown }) =>
      Effect.gen(function*() {
        const graded = declared!.decision as Graded
        const { context, focus } = rubricText.subject(Array.isArray(input) && input.length === 1 ? input[0] : input)
        const definition = Decision.make({ input: Judged, decisions: { verdict: graded } })
        const response = yield* DecisionModel.decideSettled(definition, {
          input: { context, ...(focus === undefined ? {} : { focus }), output: rubricText.asText(output) }
        }).pipe(
          Effect.provide(settings.layer!),
          Effect.mapError((cause) => inconclusive(`The judge ${seat} could not answer: ${describe(cause)}`, cause))
        )
        const outcome = response.outcomes.verdict as EffectResult.Result<unknown, Decision.Unanswered>
        if (EffectResult.isFailure(outcome)) {
          return yield* Effect.fail(
            inconclusive(`The judge ${seat} gave no answer (${outcome.failure.reason}): ${outcome.failure.description}`)
          )
        }
        const answer = outcome.success
        switch (graded._tag) {
          case "Probability": {
            const { probability } = answer as Decision.ProbabilityAnswer
            return { score: unit(probability), meta: { probability, judge: seat } }
          }
          case "Rate": {
            const { label, probabilities, rating } = answer as Decision.RateAnswer<string>
            return { score: unit(rating / (graded.criteria.length - 1)), meta: { label, rating, probabilities: { ...probabilities }, judge: seat } }
          }
          case "Classify": {
            const { label, probabilities } = answer as Decision.ClassifyAnswer<string>
            const passing = declared!.pass as ReadonlyArray<string>
            const mass = passing.reduce((total, name) => total + (probabilities[name] ?? 0), 0)
            return { score: unit(mass), meta: { label, probabilities: { ...probabilities }, pass: passing.includes(label), judge: seat } }
          }
        }
      })
  })
  return problem === undefined ? scorer : withProblem(scorer, problem)
}
