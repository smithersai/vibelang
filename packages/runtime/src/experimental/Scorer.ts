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
 * Ported from Smithers' `@smthrs/scorers` (`Scorer`, `Scorers`, `Checks`).
 *
 * @experimental
 * @since 0.0.13
 */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as canonical from "./internal/canonical.js"
import * as text from "./internal/evalText.js"
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
 *
 * @category models
 * @since 0.0.13
 */
export type ScorerErrorCode = "invalid_declaration" | "invalid_score" | "inconclusive"

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
  const { config, description, name, score, version } = options
  let problem = declarationProblem(name, version, config)
  const scorerKey = problem === undefined ? identity(name, version, config) : ""
  if (problem === undefined && scorerKey === "") problem = "A scorer configuration could not be written as canonical JSON"
  return Object.freeze({
    [TypeId]: TypeId,
    name: typeof name === "string" ? name : String(name),
    version: typeof version === "string" ? version : String(version),
    description,
    config: config ?? null,
    scorerKey,
    problem,
    score: (run: In): Effect.Effect<Result, ScorerError, R> =>
      problem !== undefined
        ? Effect.fail(new ScorerError({ code: "invalid_declaration", message: problem }))
        : Effect.suspend(() => {
          const outcome = score(run)
          return Effect.isEffect(outcome) ? outcome : Effect.succeed(outcome)
        }).pipe(
          Effect.mapError((cause) => cause instanceof ScorerError ? cause : inconclusive(describe(cause), cause)),
          Effect.flatMap(validate)
        )
  })
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
    const { max, min } = item.words ?? {}
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
  const problem = Array.isArray(list)
    ? list.map(checkProblem).find((found) => found !== undefined)
    : "checks needs an array of checks"
  const scorer = make({
    name: options.name ?? "checks",
    version: options.version ?? "1",
    config: problem === undefined ? { checks: list } : null,
    score: ({ output }: { readonly output: unknown }) => {
      if (typeof output !== "string") return Effect.fail(inconclusive("checks grades text output"))
      const results = list.map((item) => runCheck(item, output))
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
  return problem === undefined
    ? scorer
    : Object.freeze({
      ...scorer,
      scorerKey: "",
      problem,
      score: () => Effect.fail(new ScorerError({ code: "invalid_declaration", message: problem }))
    })
}
