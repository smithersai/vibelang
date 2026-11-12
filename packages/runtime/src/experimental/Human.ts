/**
 * Asking a person from a workflow. A question parks the run: no process
 * waits while the person thinks, and the answer wakes the run on any engine
 * over the same store.
 *
 * Four calls ask, one per shape of answer: {@link confirm} (yes or no),
 * {@link ask} (prose), {@link select} (one of a list) and {@link json} (a
 * value a schema accepts). Each takes a `name`, which addresses the question
 * within its run, and a `prompt` for the person. {@link answer} records an
 * answer from Effect code outside the run.
 *
 * - An answer that does not fit is recorded and refused, and the run asks
 *   again on a new attempt, at most `maxAttempts` times. Refusing is an
 *   answer; it is not a failure of the transport.
 * - `timeout` bounds how long the question stays open, across attempts and
 *   restarts: the deadline is journaled when the question is first asked.
 * - The first answer to an attempt wins.
 * - An answer approves the workflow's question and nothing else. It grants
 *   no file, network or process permission.
 * - The address of a question is the workflow, the run and the name. It is
 *   not a credential: the endpoint that calls {@link answer} authorizes its
 *   caller first.
 *
 * Built over Effect's `DurableDeferred` and
 * `DurableClock`.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Clock from "effect/Clock"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { Activity, DurableClock, DurableDeferred, WorkflowEngine } from "effect/workflow"
import type { Workflow } from "effect/workflow"
import { Durable } from "./Durable.js"
import { canonicalJson } from "./internal/canonical.js"
import { encodeExit } from "./internal/durableEngine.js"
import { encodeName, isWellFormed } from "./internal/durableSteps.js"
import { isTerminal } from "./internal/durableStore.js"
import * as waits from "./internal/durableWaits.js"

/**
 * The shape a person is asked for.
 *
 * @category models
 * @since 0.0.13
 */
export type Kind = "ask" | "confirm" | "select" | "json"

/**
 * A question that ended without an answer it could accept.
 *
 * - `request_invalid`: the question itself is wrong, such as a `select` with
 *   no choices or a `maxAttempts` below 1. Nobody was asked.
 * - `rejected`: every attempt got an answer that did not fit. `rejections`
 *   lists why.
 * - `timeout`: nobody answered before the deadline.
 *
 * @category errors
 * @since 0.0.13
 */
export class Failed extends Schema.TaggedError<Failed>()("HumanFailed", {
  code: Schema.Literals(["request_invalid", "rejected", "timeout"]),
  /** The question's name. */
  question: Schema.String,
  /** The attempts made. */
  attempts: Schema.Number,
  rejections: Schema.Array(Schema.String),
  message: Schema.String
}) {}

/**
 * An answer {@link answer} did not record.
 *
 * - `answer_invalid`: the value is not JSON, or is larger than
 *   {@link maxAnswerBytes}.
 * - `answer_not_open`: the run is not parked on a question with this name.
 *
 * @category errors
 * @since 0.0.13
 */
export class AnswerInvalid extends Schema.TaggedError<AnswerInvalid>()("HumanAnswerInvalid", {
  code: Schema.Literals(["answer_invalid", "answer_not_open"]),
  message: Schema.String
}) {}

/**
 * The attempts a question gets when it names none.
 *
 * @category limits
 * @since 0.0.13
 */
export const defaultMaxAttempts = 10

/**
 * The most attempts one question may ask for.
 *
 * @category limits
 * @since 0.0.13
 */
export const maxAttemptBudget = 1_000

/**
 * The largest answer, as encoded JSON, that enters the journal.
 *
 * @category limits
 * @since 0.0.13
 */
export const maxAnswerBytes = 256 * 1024

/**
 * The largest question name, in UTF-8 bytes.
 *
 * @category limits
 * @since 0.0.13
 */
export const maxNameBytes = 1_024

/**
 * The largest prompt, in UTF-8 bytes.
 *
 * @category limits
 * @since 0.0.13
 */
export const maxPromptBytes = 64 * 1024

/**
 * The most choices of one `select`, and the largest choice in UTF-8 bytes.
 *
 * @category limits
 * @since 0.0.13
 */
export const maxChoices = 256

/**
 * @category limits
 * @since 0.0.13
 */
export const maxChoiceBytes = 4 * 1024

/** The most characters of a refusal kept in a diagnostic. */
const maxDiagnosticChars = 512

/** The most characters kept across a failure's `rejections`. */
const maxRetainedRejectionChars = 8_192

/**
 * What {@link validate} checks an answer against.
 *
 * @category models
 * @since 0.0.13
 */
export interface Request {
  readonly kind: Kind
  /** For `select`: the answers a person may give. */
  readonly choices?: ReadonlyArray<string> | undefined
  /** For `json`: the schema the question was asked with. Without one, any JSON value fits. */
  readonly schema?: Schema.Top | undefined
}

/**
 * The question a parked run publishes, as the `request` of its `approval`
 * wait in `Experimental.Durable.waiting`: what an inbox needs to show it. It
 * is a {@link Request} without the schema, so it can be passed to
 * {@link validate}.
 *
 * @category models
 * @since 0.0.13
 */
export interface Question {
  readonly kind: Kind
  readonly prompt: string
  readonly maxAttempts: number
  readonly choices?: ReadonlyArray<string> | undefined
  /** For `json`: the JSON Schema derived from the question's schema, when it has one. */
  readonly jsonSchema?: unknown
}

/**
 * What a question may set.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options {
  /** How long the question stays open, across attempts. Without one it waits until answered. */
  readonly timeout?: Duration.Input | undefined
  /** How many answers are tried before the question fails with `rejected`. By default {@link defaultMaxAttempts}. */
  readonly maxAttempts?: number | undefined
}

const encoder = new TextEncoder()
const fits = (text: string, maximumBytes: number): boolean =>
  text.length <= maximumBytes && encoder.encode(text).length <= maximumBytes

const truncate = (text: string): string =>
  text.length <= maxDiagnosticChars ? text : `${text.slice(0, maxDiagnosticChars)}…`

const render = (value: unknown): string => {
  try {
    return truncate(JSON.stringify(value) ?? String(value))
  } catch {
    return truncate(String(value))
  }
}

/** Why `value` is not a JSON value that can enter the journal, or `undefined` when it is. */
const admit = (value: unknown): string | undefined => {
  const seen = new Set<object>()
  const visit = (value: unknown, depth: number): string | undefined => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return undefined
    if (typeof value === "number") return Number.isFinite(value) ? undefined : "The answer holds a number that is not finite."
    if (typeof value !== "object") return `The answer holds a ${typeof value}, which is not JSON.`
    if (depth > 64) return "The answer nests deeper than 64 levels."
    if (seen.has(value)) return "The answer refers to itself."
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        const complaint = visit(item, depth + 1)
        if (complaint !== undefined) return complaint
      }
    } else {
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) return "The answer holds an object that is not plain JSON."
      for (const item of Object.values(value)) {
        const complaint = visit(item, depth + 1)
        if (complaint !== undefined) return complaint
      }
    }
    seen.delete(value)
    return undefined
  }
  const complaint = visit(value, 0)
  if (complaint !== undefined) return complaint
  return encoder.encode(JSON.stringify(value)).length <= maxAnswerBytes
    ? undefined
    : `The answer is larger than ${maxAnswerBytes} bytes of JSON.`
}

type Checked<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly reason: string }

const check = (value: unknown, request: Request): Checked<unknown> => {
  switch (request.kind) {
    case "ask":
      return typeof value === "string" ? { ok: true, value } : { ok: false, reason: "The answer must be a string." }
    case "confirm":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, reason: "The answer must be a boolean." }
    case "select": {
      const choices = request.choices ?? []
      if (choices.length === 0) return { ok: false, reason: "The question has no choices." }
      return choices.some((choice) => choice === value)
        ? { ok: true, value }
        : { ok: false, reason: `The answer ${render(value)} is not one of ${truncate(choices.join(", "))}.` }
    }
    case "json": {
      const complaint = admit(value)
      if (complaint !== undefined) return { ok: false, reason: complaint }
      if (request.schema === undefined) return { ok: true, value }
      const decoded = Schema.decodeUnknownExit(
        Schema.toCodecJson(request.schema) as unknown as Schema.Codec<unknown, unknown>
      )(value)
      return Exit.isSuccess(decoded)
        ? { ok: true, value: decoded.value }
        : { ok: false, reason: truncate(`The answer does not fit the schema: ${String(decoded.cause)}`) }
    }
  }
}

/**
 * Checks an answer against the question that was asked: the same check the
 * run makes. Returns why the answer is refused, or `undefined` when it fits.
 * An interface runs it before it calls {@link answer}, so a person hears
 * about a wrong answer at once and no attempt is spent on it.
 *
 * @category answering
 * @since 0.0.13
 */
export const validate = (value: unknown, request: Request): string | undefined => {
  const checked = check(value, request)
  return checked.ok ? undefined : checked.reason
}

const answerDeferred = (name: string, attempt: number) =>
  DurableDeferred.make(`Human/${encodeName(name)}#${attempt}`, { success: Schema.Json })

/** The largest instant a deadline accepts: JavaScript's largest `Date`. */
const maxInstant = 8.64e15

const Settled = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("answered"), value: Schema.Json }),
  Schema.Struct({ _tag: Schema.Literal("timeout") })
])
type Settled = typeof Settled.Type

const Rejection = Schema.Struct({ question: Schema.String, attempt: Schema.Number, reason: Schema.String })

type Wait = WorkflowEngine.WorkflowEngine | WorkflowEngine.WorkflowInstance

const invalid = (name: string, message: string) =>
  Effect.fail(new Failed({ code: "request_invalid", question: name, attempts: 0, rejections: [], message }))

/** Keeps a failure's rejection list bounded: the newest reasons give way to a count. */
const retain = (kept: Array<string>, state: { chars: number; omitted: number }, rejection: string): void => {
  if (state.omitted === 0 && state.chars + rejection.length <= maxRetainedRejectionChars) {
    kept.push(rejection)
    state.chars += rejection.length
    return
  }
  if (state.omitted > 0) kept.pop()
  state.omitted++
  kept.push(`${state.omitted} further rejections were omitted.`)
}

const question = <A>(
  name: string,
  prompt: string,
  request: Request,
  options: Options | undefined
): Effect.Effect<A, Failed, Wait> =>
  Effect.gen(function*() {
    const engine = yield* WorkflowEngine.WorkflowEngine
    if (!fits(name, maxNameBytes) || !isWellFormed(name)) {
      return yield* invalid(truncate(encodeName(name)), `A question's name is well-formed text of at most ${maxNameBytes} bytes.`)
    }
    if (!fits(prompt, maxPromptBytes)) return yield* invalid(name, `The prompt of "${name}" is larger than ${maxPromptBytes} bytes.`)
    const maxAttempts = options?.maxAttempts ?? defaultMaxAttempts
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      return yield* invalid(name, `"${name}" was asked with maxAttempts ${maxAttempts}. A question is asked at least once.`)
    }
    if (maxAttempts > maxAttemptBudget) {
      return yield* invalid(name, `"${name}" was asked with maxAttempts ${maxAttempts}. The most is ${maxAttemptBudget}.`)
    }
    if (request.kind === "select") {
      const choices = request.choices ?? []
      if (choices.length === 0) return yield* invalid(name, `"${name}" is a select with no choices.`)
      if (choices.length > maxChoices || choices.some((choice) => typeof choice !== "string" || !fits(choice, maxChoiceBytes))) {
        return yield* invalid(name, `"${name}" has more than ${maxChoices} choices, or a choice larger than ${maxChoiceBytes} bytes.`)
      }
    }
    // Duration reads NaN and a negative number as zero, which would turn a
    // mistake into a question that times out at once.
    const raw = options?.timeout
    const timeout = raw === undefined || (typeof raw === "number" && !(raw >= 0))
      ? undefined
      : Option.getOrUndefined(Duration.fromInput(raw))
    const timeoutMs = timeout === undefined ? undefined : Duration.toMillis(timeout)
    // A Duration can be negative, and a deadline no Date reaches never comes.
    if (
      raw !== undefined &&
      (timeoutMs === undefined || !(timeoutMs >= 0) || (yield* Clock.currentTimeMillis) + timeoutMs > maxInstant)
    ) {
      return yield* invalid(name, `"${name}" was asked with a timeout that is not a finite length of time.`)
    }
    const key = `Human/${encodeName(name)}`
    // One deadline for the question, journaled once: asking again does not
    // extend it, and neither does a restart.
    const dueAt = timeoutMs === undefined ? undefined : yield* Activity.make({
      name: `${key}/deadline`,
      success: Schema.Number,
      execute: Effect.map(Clock.currentTimeMillis, (now) => now + timeoutMs)
    })
    let jsonSchema: unknown
    if (request.kind === "json" && request.schema !== undefined) {
      try {
        jsonSchema = Schema.toJsonSchemaDocument(request.schema)
      } catch {
        // A schema with no JSON Schema form still validates answers.
      }
    }
    const asked: Question = {
      kind: request.kind,
      prompt,
      maxAttempts,
      ...(request.choices === undefined ? {} : { choices: [...request.choices] }),
      ...(jsonSchema === undefined ? {} : { jsonSchema })
    }
    const rejections: Array<string> = []
    const retained = { chars: 0, omitted: 0 }
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const deferred = answerDeferred(name, attempt)
      const race = `${key}#${attempt}`
      yield* waits.announce(
        `${deferred.name}/asked`,
        {
          reason: "approval",
          name,
          attempt,
          deferred: deferred.name,
          wakeAt: dueAt,
          request: asked,
          closedBy: dueAt === undefined ? [deferred.name] : [deferred.name, `raceAll/${race}`]
        },
        Schema.Void,
        Effect.void
      )
      const answered = Effect.map(DurableDeferred.await(deferred), (value): Settled => ({ _tag: "answered", value }))
      let settled: Settled
      if (dueAt === undefined) {
        settled = yield* answered
      } else {
        // A recorded race stays decided: an answer that reaches the journal
        // after the deadline won does not change the outcome on a replay.
        // Otherwise an answer already in the journal wins over a deadline
        // that has also passed.
        const decided = yield* engine.deferredResult(DurableDeferred.make(`raceAll/${race}`, { success: Settled }))
        const early = Option.isSome(decided) ? Option.none() : yield* engine.deferredResult(deferred)
        settled = Option.isSome(early) ? yield* answered : yield* DurableDeferred.raceAll({
          name: race,
          success: Settled,
          error: Schema.Never,
          effects: [
            answered,
            Effect.flatMap(Clock.currentTimeMillis, (now) =>
              Effect.as(
                DurableClock.sleep({
                  name: `${key}/timeout`,
                  duration: Duration.millis(Math.max(0, dueAt - now)),
                  inMemoryThreshold: Duration.zero
                }),
                { _tag: "timeout" } as const
              ))
          ]
        })
      }
      if (settled._tag === "timeout") {
        return yield* Effect.fail(
          new Failed({
            code: "timeout",
            question: name,
            attempts: attempt,
            rejections,
            message: `Nobody answered "${name}" within ${timeoutMs} ms.`
          })
        )
      }
      const checked = check(settled.value, request)
      if (checked.ok) return checked.value as A
      retain(rejections, retained, `attempt ${attempt}: ${checked.reason}`)
      // The refusal is a step, so the judgment sits in the journal beside
      // the answer it judged.
      yield* Activity.make({
        name: `${deferred.name}/rejected`,
        success: Rejection,
        execute: Effect.succeed({ question: name, attempt, reason: checked.reason })
      })
    }
    return yield* Effect.fail(
      new Failed({
        code: "rejected",
        question: name,
        attempts: maxAttempts,
        rejections,
        message: `"${name}" was asked ${maxAttempts} times without an answer it could accept.`
      })
    )
  })

/**
 * Asks a person yes or no. In a workflow, the run parks until
 * {@link answer} records a boolean.
 *
 * @category questions
 * @since 0.0.13
 */
export const confirm = (name: string, prompt: string, options?: Options): Effect.Effect<boolean, Failed, Wait> =>
  question(name, prompt, { kind: "confirm" }, options)

/**
 * Asks a person for prose.
 *
 * @category questions
 * @since 0.0.13
 */
export const ask = (name: string, prompt: string, options?: Options): Effect.Effect<string, Failed, Wait> =>
  question(name, prompt, { kind: "ask" }, options)

/**
 * Asks a person to pick one of `choices`. The result's type is the union of
 * the choices.
 *
 * @category questions
 * @since 0.0.13
 */
export const select = <const Choices extends ReadonlyArray<string>>(
  name: string,
  prompt: string,
  choices: Choices,
  options?: Options
): Effect.Effect<Choices[number], Failed, Wait> => question(name, prompt, { kind: "select", choices }, options)

/**
 * Asks a person for a value `schema` accepts. The answer arrives as JSON and
 * is decoded with the schema's JSON codec, so the one schema both validates
 * the answer and types the result. The JSON Schema an inbox shows is derived
 * from it.
 *
 * @category questions
 * @since 0.0.13
 */
export const json = <S extends Schema.Top>(
  name: string,
  prompt: string,
  schema: S,
  options?: Options
): Effect.Effect<S["Type"], Failed, Wait> => question(name, prompt, { kind: "json", schema }, options)

/**
 * Records `value` as the answer to the question `name` that run `run` of `W`
 * is parked on, and wakes the run. It reads the open attempt from the run's
 * waiting row, so the caller names no attempt. The value is recorded as it
 * is: the run validates it, and a value that does not fit is refused there
 * and asked for again. Call {@link validate} first to refuse it sooner.
 *
 * @category answering
 * @since 0.0.13
 */
export const answer = <W extends Workflow.Any>(
  W: W,
  run: string,
  name: string,
  value: unknown
): Effect.Effect<void, AnswerInvalid, WorkflowEngine.WorkflowEngine | Durable> =>
  Effect.gen(function*() {
    const complaint = admit(value)
    if (complaint !== undefined) {
      return yield* Effect.fail(new AnswerInvalid({ code: "answer_invalid", message: `The answer was not recorded: ${complaint}` }))
    }
    const durable = yield* Durable
    const store = durable.internals.store
    const row = yield* store.get(run)
    const known = Option.isSome(row) && row.value.workflow === W._tag ? row.value : undefined
    const entries = known === undefined ? [] : yield* store.entries(run)
    const open = known === undefined
      ? undefined
      : waits.openWaits(known, entries).find((wait) => wait.reason === "approval" && wait.name === name)
    if (open === undefined || open.attempt === undefined) {
      // This answer may already be in the journal: an earlier call recorded
      // it and its process died before the run woke. Recording is not
      // repeated, and the run is woken, so the call can be retried.
      const last = known === undefined || isTerminal(known.status) ? undefined : waits.lastAsked(entries, name)
      if (last?.answer !== undefined && canonicalJson(last.answer) === canonicalJson(encodeExit(Exit.succeed(value)))) {
        return yield* (yield* WorkflowEngine.WorkflowEngine).resume(W, run)
      }
      return yield* Effect.fail(
        new AnswerInvalid({
          code: "answer_not_open",
          message: `The answer was not recorded: run ${run} of ${W._tag} is not parked on the question "${truncate(name)}".`
        })
      )
    }
    const deferred = answerDeferred(name, open.attempt)
    yield* DurableDeferred.succeed(deferred, {
      token: DurableDeferred.tokenFromExecutionId(deferred, { workflow: W, executionId: run }),
      value: value as Schema.Json
    })
    // An engine that has not loaded the run, such as one started after a
    // crash, loads it here, so the answer wakes it.
    yield* (yield* WorkflowEngine.WorkflowEngine).resume(W, run)
  })
