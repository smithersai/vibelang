/**
 * The cell loop behind `Experimental.Agent.run` and `Agent.stream` (VIP-63).
 *
 * Each turn the model answers with a cell, a short JavaScript program in a
 * fenced block. The cell runs in a QuickJS realm (`agentRealm.ts`) whose only
 * way to act is the tools the run was handed. The cell's prints, its calls'
 * outcome and any failure go back to the model as the next user message,
 * until a cell calls `done(answer)` with an answer the output schema
 * decodes.
 *
 * - The model is the `LanguageModel` in context.
 * - Every tool call is its own recorded step inside a workflow; a resumed
 *   run re-runs the cell and reads settled calls from the journal.
 * - Limits are always set. A caller may change one; none can be removed.
 * - A miss against `output` spends one correction. A judge, when asked for,
 *   checks a completion claim against the run's evidence; a judge that cannot
 *   be reached fails the run and never approves.
 *
 * @internal
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as AiError from "effect/ai/AiError"
import * as Decision from "effect/ai/Decision"
import * as DecisionModel from "effect/ai/DecisionModel"
import * as LanguageModel from "effect/ai/LanguageModel"
import type * as Prompt from "effect/ai/Prompt"
import * as Tool from "effect/ai/Tool"
import type * as Toolkit from "effect/ai/Toolkit"
import * as Realm from "./agentRealm.js"
import { recorded } from "./toolsRecord.js"

/** The limits a run applies when the caller sets none: the reference engine's defaults. */
export const defaultLimits: Realm.Limits = {
  calls: 64,
  timeMs: 30_000,
  callMs: 120_000,
  memoryBytes: 128 * 1024 * 1024
}

/** Frames a run may spend unless the caller says otherwise. */
export const defaultMaxTurns = 100

/** Characters of evidence a judge reads. */
const evidenceChars = 16_384

/** Characters of one tool result shown in the evidence log. */
const evidenceItemChars = 1_024

export type FailureReason =
  | "invalid_options"
  | "sandbox_unavailable"
  | "turns_exhausted"
  | "output_invalid"
  | "judge_unavailable"

export interface LoopFailure {
  readonly _tag: "LoopFailure"
  readonly reason: FailureReason
  readonly message: string
  readonly turns: number
}

export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export type Event =
  | { readonly _tag: "TurnStarted"; readonly turn: number }
  | { readonly _tag: "TextDelta"; readonly turn: number; readonly delta: string }
  | { readonly _tag: "Cell"; readonly turn: number; readonly source: string }
  | { readonly _tag: "ToolCall"; readonly turn: number; readonly tool: string; readonly input: unknown }
  | { readonly _tag: "ToolResult"; readonly turn: number; readonly tool: string; readonly ok: boolean }
  | {
    readonly _tag: "CellEnded"
    readonly turn: number
    readonly outcome: "continue" | "done" | "raised" | "rejected" | "missing"
    readonly prints: string
  }
  | { readonly _tag: "Correction"; readonly turn: number; readonly issues: string }
  | { readonly _tag: "Judged"; readonly turn: number; readonly approved: boolean; readonly probability: number }

export interface Options {
  readonly prompt: string
  readonly output: Schema.Top
  readonly system?: string | undefined
  readonly tools?: Toolkit.WithHandler<any> | Effect.Effect<Toolkit.WithHandler<any>, any, any> | undefined
  readonly maxTurns?: number | undefined
  readonly corrections?: number | undefined
  readonly limits?: Partial<Realm.Limits> | undefined
  readonly judge?: number | undefined
  readonly load?: (() => Promise<Realm.Build>) | undefined
}

export interface Result {
  readonly output: unknown
  readonly turns: number
  readonly usage: Usage
}

const failure = (reason: FailureReason, message: string, turns: number): LoopFailure => ({
  _tag: "LoopFailure",
  reason,
  message,
  turns
})

const count = (value: number | undefined, fallback: number, least: number): number | undefined =>
  value === undefined ? fallback : Number.isSafeInteger(value) && value >= least ? value : undefined

const fence = /```([A-Za-z]*)[^\n]*\n([\s\S]*?)```/g
const cellTags = new Set(["", "cell", "js", "javascript", "mjs"])

/**
 * The program a reply holds: every fenced block tagged `cell`, `js` or
 * `javascript` (or untagged), in reply order. `undefined` when there is none.
 */
export const cellOf = (text: string): string | undefined => {
  const blocks: Array<string> = []
  for (const match of text.matchAll(fence)) {
    if (cellTags.has(match[1]!.toLowerCase())) blocks.push(match[2]!)
  }
  return blocks.length === 0 ? undefined : blocks.join("\n")
}

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const clip = (text: string, max: number): string => text.length <= max ? text : `${text.slice(0, max)}… [${text.length - max} more characters]`

const instructions = (options: Options, tools: ReadonlyArray<Tool.Any>): string => {
  const outputSchema = safeJson(Tool.getJsonSchemaFromSchema(options.output as any))
  const toolLines = tools.length === 0
    ? "This run has no tools."
    : tools.map((tool) =>
      `- tools[${JSON.stringify(tool.name)}](input)${tool.description === undefined ? "" : `: ${tool.description}`}\n  input JSON Schema: ${
        safeJson(Tool.getJsonSchema(tool))
      }`
    ).join("\n")
  return [
    ...(options.system === undefined ? [] : [options.system, ""]),
    "You complete the task by writing JavaScript cells. Each reply holds one cell in a fenced block:",
    "```cell",
    "const found = await tools.example({ query: \"x\" })",
    "console.log(found)",
    "```",
    "The cell runs in a sandbox. Its only ways to act:",
    "- `await tools[name](input)` calls a tool. It resolves to the tool's result, or to { ok: false, error: { code, message } } when the call fails.",
    "- `console.log(...)` prints. The next message shows what the cell printed.",
    "- `done(answer)` ends the run with your answer. The answer must match this JSON Schema:",
    outputSchema,
    "Top-level variables persist from one cell to the next. There is no file system, network, Date or Math.random.",
    "",
    "Tools:",
    toolLines
  ].join("\n")
}

const describeFrame = (frame: Realm.Frame): string => {
  const printed = frame.prints === "" ? "(nothing printed)" : frame.prints
  switch (frame.outcome._tag) {
    case "Continue":
      return `The cell ran with ${frame.calls} tool call(s). It printed:\n${printed}\nWrite the next cell, or call done(answer).`
    case "Raised":
      return `The cell threw ${frame.outcome.name}: ${frame.outcome.message}\nIt printed:\n${printed}\nFix the cell and try again.`
    case "Rejected":
      return `The cell was stopped (${frame.outcome.code}${
        frame.outcome.limit === undefined ? "" : `, limit ${frame.outcome.limit}`
      }): ${frame.outcome.message}${frame.spent ? "\nThe sandbox was reset: variables from earlier cells are gone." : ""}\nIt printed:\n${printed}`
    case "Done":
      return `It printed:\n${printed}`
  }
}

const outcomeName = (frame: Realm.Frame): "continue" | "done" | "raised" | "rejected" =>
  frame.outcome._tag === "Continue"
    ? "continue"
    : frame.outcome._tag === "Done"
    ? "done"
    : frame.outcome._tag === "Raised"
    ? "raised"
    : "rejected"

const CallResultSchema = Schema.Unknown

const Judgement = Decision.make({
  input: Schema.Struct({ task: Schema.String, answer: Schema.String, evidence: Schema.String }),
  decisions: {
    supported: Decision.probability({
      instructions: "The answer is supported by the evidence: the tool calls and results the run recorded show the task was done.",
      criteria: { false: "The evidence does not show the claimed work", true: "The evidence shows the claimed work" }
    })
  }
})

// One tool call settled through the toolkit's handler. Every outcome is a
// value the cell reads: an unknown name, input the tool's schema refuses, a
// handler failure. Only interruption and defects end the cell.
const settle = (toolkit: Toolkit.WithHandler<any> | undefined, call: Realm.Call): Effect.Effect<Realm.CallResult> => {
  if (toolkit === undefined || !Object.hasOwn(toolkit.tools, call.tool)) {
    return Effect.succeed({ ok: false, error: { code: "unknown_tool", message: `No tool named ${call.tool} was handed to this run.` } })
  }
  return toolkit.handle(call.tool, call.input as any).pipe(
    Effect.flatMap((stream) => Stream.runLast(stream as Stream.Stream<Tool.HandlerResult<any>, unknown>)),
    Effect.map((last): Realm.CallResult => {
      if (Option.isNone(last)) return { ok: false, error: { code: "no_result", message: `${call.tool} gave no result.` } }
      const result = last.value
      if (!result.isFailure) return { ok: true, value: result.encodedResult }
      const encoded = result.encodedResult as { readonly code?: unknown; readonly message?: unknown } | null
      return {
        ok: false,
        error: {
          code: typeof encoded?.code === "string" ? encoded.code : result.failureOrigin === "parameters" ? "invalid_input" : "tool_failed",
          message: typeof encoded?.message === "string" ? encoded.message : `${call.tool} failed.`,
          value: result.encodedResult
        }
      }
    }),
    Effect.catch((error: unknown) =>
      Effect.succeed<Realm.CallResult>({
        ok: false,
        error: {
          code: (error as { readonly _tag?: string })?._tag === "AiError" ? "invalid_input" : "tool_failed",
          message: clip(error instanceof Error ? error.message : safeJson(error), 2000)
        }
      })
    )
  ) as Effect.Effect<Realm.CallResult>
}

const sumUsage = (a: Usage, response: { readonly usage?: unknown }): Usage => {
  const usage = response.usage as
    | { readonly inputTokens?: { readonly total?: number }; readonly outputTokens?: { readonly total?: number } }
    | undefined
  return {
    inputTokens: a.inputTokens + (usage?.inputTokens?.total ?? 0),
    outputTokens: a.outputTokens + (usage?.outputTokens?.total ?? 0)
  }
}

/**
 * Runs the loop. `emit` sees every event; `streaming` asks the model with
 * `streamText` so text deltas are emitted as they arrive.
 */
export const run = (
  options: Options,
  emit: (event: Event) => Effect.Effect<void>,
  streaming: boolean
): Effect.Effect<Result, LoopFailure | AiError.AiError, LanguageModel.LanguageModel> =>
  Effect.gen(function*() {
    const maxTurns = count(options.maxTurns, defaultMaxTurns, 1)
    const corrections = count(options.corrections, 1, 0)
    const judge = count(options.judge, 0, 0)
    if (maxTurns === undefined || corrections === undefined || judge === undefined) {
      return yield* Effect.fail(
        failure("invalid_options", "maxTurns must be a whole number of at least 1; corrections and judge at least 0.", 0)
      )
    }
    if (typeof options.prompt !== "string" || options.prompt === "") {
      return yield* Effect.fail(failure("invalid_options", "prompt must be a non-empty string.", 0))
    }
    // A limit can be changed, never removed: every field ends up set, and the realm refuses
    // a value that is not finite.
    const limits: Realm.Limits = {
      calls: options.limits?.calls ?? defaultLimits.calls,
      timeMs: options.limits?.timeMs ?? defaultLimits.timeMs,
      callMs: options.limits?.callMs ?? defaultLimits.callMs,
      memoryBytes: options.limits?.memoryBytes ?? defaultLimits.memoryBytes
    }
    const toolkit = options.tools === undefined
      ? undefined
      : Effect.isEffect(options.tools)
      ? yield* (options.tools as Effect.Effect<Toolkit.WithHandler<any>>)
      : options.tools
    const tools = toolkit === undefined ? [] : Object.values(toolkit.tools) as Array<Tool.Any>
    const names = tools.map((tool) => tool.name)
    const decisionModel = yield* Effect.serviceOption(DecisionModel.DecisionModel)
    if (judge > 0 && Option.isNone(decisionModel)) {
      return yield* Effect.fail(
        failure("judge_unavailable", "judge is positive but no DecisionModel is in context. Provide Experimental.Model.decide().", 0)
      )
    }

    // The realm lives in its own scope, so a spent realm is closed and a fresh one opened.
    let realmScope: Scope.Closeable | undefined
    let realm: Realm.Realm | undefined
    const closeRealm = Effect.suspend(() => {
      const scope = realmScope
      realmScope = undefined
      realm = undefined
      return scope === undefined ? Effect.void : Scope.close(scope, Exit.void)
    })
    const openRealm = Effect.gen(function*() {
      yield* closeRealm
      const scope = yield* Scope.make()
      realmScope = scope
      realm = yield* Effect.provideService(Realm.open({ tools: names, limits, load: options.load }), Scope.Scope, scope).pipe(
        Effect.mapError((error) =>
          failure(error.reason === "unavailable" ? "sandbox_unavailable" : "invalid_options", error.message, 0)
        )
      )
      return realm
    })

    const loop = Effect.gen(function*() {
      const messages: Array<Prompt.MessageEncoded> = [
        { role: "system", content: instructions(options, tools) },
        { role: "user", content: options.prompt }
      ]
      const evidence: Array<string> = []
      let usage: Usage = { inputTokens: 0, outputTokens: 0 }
      let correctionsLeft = corrections
      let judged = 0
      for (let turn = 1;; turn++) {
        if (turn > maxTurns) {
          return yield* Effect.fail(
            failure("turns_exhausted", `The run spent its ${maxTurns} turns without a valid answer.`, maxTurns)
          )
        }
        yield* emit({ _tag: "TurnStarted", turn })
        let text = ""
        if (streaming) {
          yield* Stream.runForEach(LanguageModel.streamText({ prompt: messages as any }), (part: any) => {
            if (part.type === "text-delta") {
              text += part.delta
              return emit({ _tag: "TextDelta", turn, delta: part.delta })
            }
            if (part.type === "finish") usage = sumUsage(usage, part)
            return Effect.void
          })
        } else {
          const response = yield* LanguageModel.generateText({ prompt: messages as any })
          text = response.text
          usage = sumUsage(usage, response)
        }
        messages.push({ role: "assistant", content: text })
        const source = cellOf(text)
        if (source === undefined) {
          yield* emit({ _tag: "CellEnded", turn, outcome: "missing", prints: "" })
          messages.push({
            role: "user",
            content: "No cell was found in your reply. Reply with one fenced ```cell block of JavaScript, and call done(answer) when finished."
          })
          continue
        }
        yield* emit({ _tag: "Cell", turn, source })
        const current = realm ?? (yield* openRealm)
        const frame = yield* current.evaluate(
          source,
          (call) =>
            Effect.flatMap(emit({ _tag: "ToolCall", turn, tool: call.tool, input: call.input }), () => settle(toolkit, call)),
          (call, result) =>
            recorded({
              kind: "agent-tool",
              request: [call.tool, call.input],
              success: CallResultSchema,
              error: Schema.Never,
              execute: result
            }).pipe(
              Effect.tap((settled) =>
                Effect.andThen(
                  Effect.sync(() => {
                    if (evidence.join("\n").length < evidenceChars) {
                      evidence.push(
                        `${call.tool}(${clip(safeJson(call.input), 256)}) -> ${clip(safeJson(settled), evidenceItemChars)}`
                      )
                    }
                  }),
                  emit({ _tag: "ToolResult", turn, tool: call.tool, ok: settled.ok })
                )
              )
            )
        ).pipe(
          Effect.mapError((error) =>
            failure("sandbox_unavailable", error.message, turn)
          )
        )
        if (frame.spent) yield* closeRealm
        yield* emit({ _tag: "CellEnded", turn, outcome: outcomeName(frame), prints: frame.prints })
        if (frame.prints !== "") evidence.push(`printed: ${clip(frame.prints, evidenceItemChars)}`)
        if (frame.outcome._tag !== "Done") {
          messages.push({ role: "user", content: describeFrame(frame) })
          continue
        }
        const answer = frame.outcome.value
        const decoded = yield* Effect.exit(Schema.decodeUnknownEffect(options.output as Schema.Codec<unknown, unknown>)(answer))
        if (Exit.isFailure(decoded)) {
          const issues = clip(Cause.pretty(decoded.cause), 4000)
          if (correctionsLeft === 0) {
            return yield* Effect.fail(
              failure("output_invalid", `The answer does not match the output schema:\n${issues}`, turn)
            )
          }
          correctionsLeft--
          yield* emit({ _tag: "Correction", turn, issues })
          messages.push({
            role: "user",
            content: `${describeFrame(frame)}\ndone(answer) was rejected: the answer does not match the output schema.\n${issues}\nCall done again with a valid answer.`
          })
          continue
        }
        if (judged < judge && Option.isSome(decisionModel)) {
          judged++
          const verdict = yield* Effect.provideService(
            DecisionModel.decide(Judgement, {
              input: { task: options.prompt, answer: clip(safeJson(answer), evidenceChars), evidence: evidence.join("\n") }
            }),
            DecisionModel.DecisionModel,
            decisionModel.value
          ).pipe(
            Effect.mapError(() => failure("judge_unavailable", "The judge could not be reached. A run is never approved without it.", turn))
          )
          const probability = verdict.answers.supported.probability
          const approved = probability >= 0.5
          yield* emit({ _tag: "Judged", turn, approved, probability })
          if (!approved) {
            messages.push({
              role: "user",
              content: `${describeFrame(frame)}\nA reviewer checked your answer against the recorded tool calls and found it unsupported. Do the work, show it with tool calls, then call done again.`
            })
            continue
          }
        }
        return { output: decoded.value, turns: turn, usage }
      }
    })
    return yield* loop.pipe(Effect.ensuring(closeRealm))
  })
