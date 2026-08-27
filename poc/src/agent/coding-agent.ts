import { createHash } from "node:crypto"
import {
  declareCallableSurface,
  functionTableIdentity,
  snapshotFunctionTable,
} from "./bindings.ts"
import { CliTypeScriptCompiler } from "./compiler.ts"
import { DenoSubprocessSandbox } from "./sandbox.ts"
import {
  canonicalIdentityJson,
  componentIdentityJson,
  sha256Json,
  snapshotComponentIdentity,
} from "./identity.ts"
import {
  extractModelSource,
  jsonSnapshot,
  modelDescriptorJson,
  modelRequestDigest,
  modelResponseJson,
  normalizeModelResponse,
  snapshotModelDescriptor,
} from "./model.ts"
import { callableSurfaceManifest } from "./tools.ts"
import type {
  AgentDiagnostic,
  AgentFunctionTable,
  AgentMessage,
  AgentRunResult,
  ComponentIdentity,
  JsonValue,
  ModelAdapter,
  ModelCallIdentity,
  ModelDescriptor,
  ModelRequest,
  ModelResponse,
  PromptRenderer,
  TurnProvenance,
  TurnJournal,
  TypeScriptCompiler,
  TypeScriptSandbox,
} from "./types.ts"

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function ownDataProperty(value: object, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
    throw new TypeError(`${label}.${key} must be an enumerable own data property`)
  }
  return descriptor.value
}

function componentIdentityOf(value: object, label: string): ComponentIdentity {
  return snapshotComponentIdentity(
    ownDataProperty(value, "identity", label) as ComponentIdentity,
    `${label}.identity`,
  )
}

function modelDescriptorOf(model: ModelAdapter): ModelDescriptor {
  return snapshotModelDescriptor(ownDataProperty(model, "model", "ModelAdapter"), "ModelAdapter.model")
}

function snapshotMessages(value: readonly AgentMessage[]): readonly AgentMessage[] {
  const canonical = canonicalIdentityJson(value, "Rendered prompt")
  const detached = JSON.parse(canonical) as AgentMessage[]
  for (const [index, message] of detached.entries()) {
    if (
      message === null || typeof message !== "object" ||
      !["system", "user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      Reflect.ownKeys(message).some((key) =>
        typeof key !== "string" || !["role", "content"].includes(key))
    ) {
      throw new TypeError(`Rendered prompt message ${index} is invalid`)
    }
    Object.freeze(message)
  }
  return Object.freeze(detached)
}

function provenanceDetails(provenance: TurnProvenance): Record<string, JsonValue> {
  const functions: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  for (const [name, identity] of Object.entries(provenance.functions)) {
    functions[name] = componentIdentityJson(identity)
  }
  return {
    schema: provenance.schema,
    promptDigest: provenance.promptDigest,
    callableDigest: provenance.callableDigest,
    functionTableDigest: provenance.functionTableDigest,
    agentConfigDigest: provenance.agentConfigDigest,
    modelIdentity: componentIdentityJson(provenance.model),
    modelVersion: modelDescriptorJson(provenance.modelVersion),
    compilerIdentity: componentIdentityJson(provenance.compiler),
    sandboxIdentity: componentIdentityJson(provenance.sandbox),
    functionIdentities: functions,
  }
}

function diagnosticsDigest(diagnostics: readonly AgentDiagnostic[]): string {
  return sha256Json({
    schema: "smithers.agent.diagnostics/v1",
    diagnostics: jsonSnapshot(diagnostics, "Compiler diagnostics"),
  })
}

function formatDiagnostics(diagnostics: readonly AgentDiagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const location = diagnostic.file
        ? `${diagnostic.file}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0}: `
        : ""
      const code = diagnostic.code ? `TS${diagnostic.code}: ` : ""
      return `${location}${code}${diagnostic.message}`
    })
    .join("\n")
}

/**
 * Why one attempt did not produce a runnable module. The kind decides the
 * repair instruction and the terminal error name, so a size-guard rejection is
 * never reported as a type error from a compiler that never ran.
 */
type AttemptFailureKind = "type-check" | "source-size" | "model-incomplete" | "model-refusal"

const FAILURE_ERROR_NAME: Readonly<Record<AttemptFailureKind, string>> = Object.freeze({
  "type-check": "TypeCheckError",
  "source-size": "GeneratedSourceTooLarge",
  "model-incomplete": "ModelResponseIncomplete",
  "model-refusal": "ModelRefusal",
})

/**
 * Messages API terminal reasons that do **not** deliver a complete answer.
 *
 * `end_turn` is the only reason that means "the model finished what it was
 * asked for". Everything here stops the reply early or replaces it with
 * something that is not a module, so compiling the bytes and reporting the
 * result as a type error turns a truncation into a silent wrong answer:
 * the model is then asked to fix an error it did not make, and on a refusal
 * the decline prose is stored as the generated module.
 *
 * A reason this table does not know is treated as complete: an adapter is free
 * to use a different vocabulary, and failing closed on an unknown string would
 * break every such adapter for no evidence of a defect.
 */
const INCOMPLETE_FINISH_REASONS: ReadonlyMap<string, string> = new Map([
  ["max_tokens", "the reply hit the model's max_tokens ceiling and is truncated"],
  ["stop_sequence", "the reply stopped at a stop sequence before the module ended"],
  ["pause_turn", "the model paused its turn; the reply is not a complete answer"],
  ["tool_use", "the model asked to use a tool; the reply is not a module"],
  ["refusal", "the model declined the request"],
])

function incompleteFinishReason(finishReason: string | undefined): string | undefined {
  return finishReason === undefined ? undefined : INCOMPLETE_FINISH_REASONS.get(finishReason)
}

function errorLabel(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/**
 * The repair turn names the failure that actually happened. Telling a model
 * that its reply "did not type-check" after a size guard discarded it unread —
 * or after it declined the request — describes work no compiler did.
 */
function repairInstruction(
  kind: AttemptFailureKind,
  diagnostics: readonly AgentDiagnostic[],
  sourceBytes: number,
  maxSourceBytes: number,
): string {
  switch (kind) {
    case "type-check":
      return "The generated TypeScript did not type-check. Return a complete corrected " +
        `TypeScript module only.\n\n${formatDiagnostics(diagnostics)}`
    case "source-size":
      return `The previous reply was ${sourceBytes} bytes, over the ${maxSourceBytes} byte ` +
        "limit, and was discarded unread. Return a complete TypeScript module only, " +
        "under that limit."
    case "model-incomplete":
    case "model-refusal":
      return "The previous reply was not a complete TypeScript module. " +
        `${formatDiagnostics(diagnostics)}\n\nReturn the complete TypeScript module only.`
  }
}

export interface CodingAgentOptions<Input> {
  model: ModelAdapter
  prompt: PromptRenderer<Input>
  functions: AgentFunctionTable
  sandbox?: TypeScriptSandbox
  compiler?: TypeScriptCompiler
  journal?: TurnJournal
  maxRepairs?: number
  maxSourceBytes?: number
}

export class CodingAgent<Input, Result extends JsonValue = JsonValue> {
  readonly #model: ModelAdapter
  readonly #prompt: PromptRenderer<Input>
  readonly #functions: AgentFunctionTable
  readonly #sandbox: TypeScriptSandbox
  readonly #compiler: TypeScriptCompiler
  readonly #journal?: TurnJournal
  readonly #maxRepairs: number
  readonly #maxSourceBytes: number
  readonly #callableSurface: string
  readonly #modelIdentity: ComponentIdentity
  readonly #modelDescriptor: ModelDescriptor
  readonly #callableManifestDigest: string
  readonly #callableManifest: JsonValue
  readonly #compilerIdentity: ComponentIdentity
  readonly #sandboxIdentity: ComponentIdentity
  readonly #functionTableDigest: string
  readonly #functionIdentities: Readonly<Record<string, ComponentIdentity>>
  readonly #agentConfigDigest: string

  private constructor(options: CodingAgentOptions<Input>) {
    // Every bounded option is read from `options` exactly once, into the local
    // that is both validated and stored. Reading twice — once for the range
    // check, once for the field — lets an accessor-backed options object return
    // a legal value to the check and an illegal one to the agent; measured at
    // 1000 model calls against a ceiling of 21.
    const maxRepairs = options.maxRepairs ?? 1
    const maxSourceBytes = options.maxSourceBytes ?? 128 * 1024
    if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > 20) {
      throw new RangeError("CodingAgent maxRepairs must be between 0 and 20")
    }
    if (!Number.isSafeInteger(maxSourceBytes) ||
      maxSourceBytes < 1024 || maxSourceBytes > 16 * 1024 * 1024) {
      throw new RangeError("CodingAgent maxSourceBytes must be between 1024 and 16777216")
    }
    this.#model = options.model
    this.#prompt = options.prompt
    this.#functions = snapshotFunctionTable(options.functions)
    this.#sandbox = options.sandbox ?? new DenoSubprocessSandbox()
    this.#compiler = options.compiler ?? new CliTypeScriptCompiler()
    this.#modelIdentity = componentIdentityOf(this.#model, "ModelAdapter")
    this.#modelDescriptor = modelDescriptorOf(this.#model)
    const manifest = callableSurfaceManifest(this.#functions)
    this.#callableManifestDigest = manifest.digest
    this.#callableManifest = jsonSnapshot(manifest.entries, "Callable surface manifest")
    this.#compilerIdentity = componentIdentityOf(this.#compiler, "TypeScriptCompiler")
    this.#sandboxIdentity = componentIdentityOf(this.#sandbox, "TypeScriptSandbox")
    this.#journal = options.journal
    this.#maxRepairs = maxRepairs
    this.#maxSourceBytes = maxSourceBytes
    this.#callableSurface = declareCallableSurface(this.#functions)
    const functionIdentity = functionTableIdentity(this.#functions)
    this.#functionTableDigest = functionIdentity.digest
    this.#functionIdentities = functionIdentity.identities
    this.#agentConfigDigest = sha256Json({
      schema: "smithers.agent.run-policy/v1",
      maxRepairs: this.#maxRepairs,
      maxSourceBytes: this.#maxSourceBytes,
      repairInstruction: "complete corrected TypeScript module only",
    })
  }

  static make<Input, Result extends JsonValue = JsonValue>(
    options: CodingAgentOptions<Input>,
  ): CodingAgent<Input, Result> {
    return new CodingAgent<Input, Result>(options)
  }

  async run(input: Input): Promise<AgentRunResult<Result>> {
    const baseMessages = snapshotMessages(await this.#prompt.render(input))
    const callableDigest = digest(this.#callableSurface)
    const promptDigest = digest(canonicalIdentityJson(baseMessages))
    const provenance: TurnProvenance = Object.freeze({
      schema: "smithers.agent.turn/v3",
      promptDigest,
      callableDigest,
      functionTableDigest: this.#functionTableDigest,
      agentConfigDigest: this.#agentConfigDigest,
      model: this.#modelIdentity,
      modelVersion: this.#modelDescriptor,
      compiler: this.#compilerIdentity,
      sandbox: this.#sandboxIdentity,
      functions: this.#functionIdentities,
    })
    const turnId = `turn_${sha256Json(provenanceDetails(provenance))}`
    const attempts: AgentRunResult<Result>["attempts"] = []
    const counters = { replayedModelResponses: 0 }

    await this.#journal?.append({
      type: "turn.started",
      turnId,
      details: {
        ...provenanceDetails(provenance),
        callableManifestDigest: this.#callableManifestDigest,
        callableManifest: this.#callableManifest,
      },
    })

    // Single exit point. `turn.started` is emitted above and its terminal
    // `turn.completed` exactly once below, on every path: an ordinary return, a
    // typed failure, and any collaborator throwing — model, journal, compiler
    // or sandbox. `#executeTurn` emits no terminal event at all, so no future
    // failure path can be added that forgets one. Six of eight paths used to
    // leave the turn open, because closing it was a statement each `return` had
    // to remember rather than a property of the structure.
    let outcome: AgentRunResult<Result> | undefined
    let aborted: { readonly error: unknown } | undefined
    try {
      outcome = await this.#executeTurn(turnId, provenance, baseMessages, attempts, counters)
    } catch (error) {
      aborted = { error }
    }
    const lastAttempt = attempts.at(-1)
    try {
      await this.#journal?.append({
        type: "turn.completed",
        turnId,
        attempt: lastAttempt?.attempt,
        sourceDigest: lastAttempt?.sourceDigest,
        ok: outcome?.ok ?? false,
        details: {
          attempts: attempts.length,
          replayedModelResponses: counters.replayedModelResponses,
          outcome: aborted !== undefined ? "aborted" : outcome?.ok === true ? "succeeded" : "failed",
          abortedBy: aborted === undefined ? null : errorLabel(aborted.error),
        },
      })
    } catch (journalError) {
      // A finalizer that cannot append must not mask the failure that ended the
      // turn; it is only allowed to surface when nothing else went wrong.
      if (aborted === undefined) throw journalError
    }
    if (aborted !== undefined) throw aborted.error
    return outcome as AgentRunResult<Result>
  }

  async #executeTurn(
    turnId: string,
    provenance: TurnProvenance,
    baseMessages: readonly AgentMessage[],
    attempts: AgentRunResult<Result>["attempts"],
    counters: { replayedModelResponses: number },
  ): Promise<AgentRunResult<Result>> {
    const messages: AgentMessage[] = [...baseMessages]
    let diagnostics: AgentDiagnostic[] = []
    let compiler: string | undefined
    let failureKind: AttemptFailureKind = "type-check"

    for (let attempt = 0; attempt <= this.#maxRepairs; attempt++) {
      const request: ModelRequest = Object.freeze({
        turnId,
        messages: snapshotMessages(messages),
        attempt,
        diagnostics: Object.freeze([...diagnostics]),
        callableSurface: this.#callableSurface,
      })
      const requestDigest = modelRequestDigest(request)
      const modelCall: ModelCallIdentity = Object.freeze({
        turnId,
        attempt,
        requestDigest,
        modelIdentity: this.#modelIdentity,
        model: this.#modelDescriptor,
      })
      await this.#journal?.append({
        type: "model.requested",
        turnId,
        attempt,
        details: {
          requestDigest,
          modelIdentity: componentIdentityJson(this.#modelIdentity),
          modelVersion: modelDescriptorJson(this.#modelDescriptor),
        },
      })
      // Replay reuses the recorded response for the same turn and attempt
      // instead of asking the model again. A journal that reports "no record"
      // as `null` — an ordinary spelling, and the one the three sibling recall
      // sites already accept — must not be read as a replay hit.
      const recalled = await this.#journal?.recallModelCall?.(modelCall)
      const replayed = recalled !== undefined && recalled !== null
      const response = replayed
        ? normalizeModelResponse(recalled)
        : normalizeModelResponse(await this.#model.generate(request))
      if (replayed) counters.replayedModelResponses += 1
      else await this.#journal?.recordModelCall?.(modelCall, response)

      const incomplete = incompleteFinishReason(response.finishReason)
      const source = extractModelSource(this.#model, response)
      const sourceDigest = digest(source)
      const sourceBytes = Buffer.byteLength(source, "utf8")
      const oversized = sourceBytes > this.#maxSourceBytes
      const accepted = !oversized && incomplete === undefined

      // The bound is enforced *before* the durable append, so it bounds what
      // reaches the journal. Enforced afterwards it bounded nothing: every
      // attempt's full oversized reply was already persisted. Bytes that are
      // not a module — a truncated reply, a refusal — are likewise never
      // stored under the `generated-source` kind.
      if (accepted) {
        await this.#journal?.putArtifact?.({
          kind: "generated-source",
          turnId,
          digest: sourceDigest,
          content: source,
        })
      }
      await this.#journal?.append({
        type: "model.responded",
        turnId,
        attempt,
        sourceDigest,
        details: {
          source: replayed ? "replay" : "live",
          requestDigest,
          responseDigest: sha256Json(modelResponseJson(response)),
          servedModel: response.model === undefined ? null : modelDescriptorJson(response.model),
          finishReason: response.finishReason ?? null,
          accepted,
          sourceBytes,
          maxSourceBytes: this.#maxSourceBytes,
          modelIdentity: componentIdentityJson(this.#modelIdentity),
          modelVersion: modelDescriptorJson(this.#modelDescriptor),
        },
      })

      if (incomplete !== undefined) {
        const refused = response.finishReason === "refusal"
        failureKind = refused ? "model-refusal" : "model-incomplete"
        diagnostics = [
          {
            category: "error",
            message: `Model reply is not a complete answer (${response.finishReason}): ${incomplete}`,
          },
        ]
        attempts.push({ attempt, source, sourceDigest, diagnostics })
        await this.#journal?.append({
          type: "compile.completed",
          turnId,
          attempt,
          sourceDigest,
          ok: false,
          details: {
            diagnosticCount: diagnostics.length,
            diagnosticsDigest: diagnosticsDigest(diagnostics),
            compiler: "model-response-guard",
            finishReason: response.finishReason ?? null,
            compilerIdentity: componentIdentityJson(this.#compilerIdentity),
          },
        })
        // A refusal is a decision, not a mistake the model can repair. Asking
        // it again to "fix the type errors" spends the whole repair budget on a
        // request it has already declined.
        if (refused) break
      } else if (oversized) {
        failureKind = "source-size"
        diagnostics = [
          {
            category: "error",
            message:
              `Generated source was ${sourceBytes} bytes, over the ${this.#maxSourceBytes} byte limit`,
          },
        ]
        attempts.push({ attempt, source, sourceDigest, diagnostics })
        await this.#journal?.append({
          type: "compile.completed",
          turnId,
          attempt,
          sourceDigest,
          ok: false,
          details: {
            diagnosticCount: diagnostics.length,
            diagnosticsDigest: diagnosticsDigest(diagnostics),
            compiler: "source-size-guard",
            compilerIdentity: componentIdentityJson(this.#compilerIdentity),
          },
        })
      } else {
        failureKind = "type-check"
        const compilation = await this.#compiler.compile(source, this.#callableSurface)
        diagnostics = compilation.diagnostics
        compiler = compilation.compiler
        attempts.push({ attempt, source, sourceDigest, diagnostics })
        await this.#journal?.append({
          type: "compile.completed",
          turnId,
          attempt,
          sourceDigest,
          ok: compilation.ok,
          details: {
            diagnosticCount: diagnostics.length,
            diagnosticsDigest: diagnosticsDigest(diagnostics),
            compiler: compilation.compiler,
            compilerIdentity: componentIdentityJson(this.#compilerIdentity),
          },
        })

        if (compilation.ok && compilation.javascript !== undefined) {
          const compiledJavascriptDigest = digest(compilation.javascript)
          await this.#journal?.putArtifact?.({
            kind: "compiled-javascript",
            turnId,
            digest: compiledJavascriptDigest,
            content: compilation.javascript,
          })
          await this.#journal?.append({
            type: "sandbox.started",
            turnId,
            attempt,
            sourceDigest,
            details: {
              sandbox: this.#sandbox.kind,
              sandboxIdentity: componentIdentityJson(this.#sandboxIdentity),
              functionTableDigest: this.#functionTableDigest,
              callableManifestDigest: this.#callableManifestDigest,
              compiledJavascriptDigest,
            },
          })
          const execution = await this.#sandbox.execute(compilation.javascript, this.#functions, {
            sourceDigest,
            journal: this.#journal,
            turnId,
          })
          await this.#journal?.append({
            type: "sandbox.completed",
            turnId,
            attempt,
            sourceDigest,
            ok: execution.ok,
            details: {
              durationMs: execution.durationMs,
              sandboxIdentity: componentIdentityJson(this.#sandboxIdentity),
              logCount: execution.logs.length,
              resultDigest: execution.ok ? sha256Json(execution.result ?? null) : null,
              error: execution.error === undefined
                ? null
                : { name: execution.error.name, message: execution.error.message },
            },
          })
          return {
            ok: execution.ok,
            result: execution.result as Result | undefined,
            error: execution.error,
            diagnostics,
            logs: execution.logs,
            source,
            sourceDigest,
            attempts,
            compiler,
            sandbox: this.#sandbox.kind,
            turnId,
            provenance,
          }
        }
      }

      if (attempt < this.#maxRepairs) {
        // An oversized reply is never echoed back. Replaying the bytes the
        // guard just rejected into the repair transcript is what turned a
        // resource bound into a resource multiplier: 4 bytes of prompt became
        // 400 KB by the third attempt.
        if (failureKind !== "source-size") {
          messages.push({ role: "assistant", content: source })
        }
        messages.push({
          role: "user",
          content: repairInstruction(failureKind, diagnostics, sourceBytes, this.#maxSourceBytes),
        })
      }
    }

    const lastAttempt = attempts.at(-1)
    return {
      ok: false,
      error: {
        name: FAILURE_ERROR_NAME[failureKind],
        message: formatDiagnostics(diagnostics) || "Generated source did not type-check",
      },
      diagnostics,
      logs: [],
      source: lastAttempt?.source,
      sourceDigest: lastAttempt?.sourceDigest,
      attempts,
      compiler,
      sandbox: this.#sandbox.kind,
      turnId,
      provenance,
    }
  }
}
