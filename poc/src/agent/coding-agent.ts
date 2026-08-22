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
    schema: "vibelang.agent.diagnostics/v1",
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
    if (!Number.isSafeInteger(options.maxRepairs ?? 1) || (options.maxRepairs ?? 1) < 0 ||
      (options.maxRepairs ?? 1) > 20) {
      throw new RangeError("CodingAgent maxRepairs must be between 0 and 20")
    }
    if (!Number.isSafeInteger(options.maxSourceBytes ?? 128 * 1024) ||
      (options.maxSourceBytes ?? 128 * 1024) < 1024 ||
      (options.maxSourceBytes ?? 128 * 1024) > 16 * 1024 * 1024) {
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
    this.#maxRepairs = options.maxRepairs ?? 1
    this.#maxSourceBytes = options.maxSourceBytes ?? 128 * 1024
    this.#callableSurface = declareCallableSurface(this.#functions)
    const functionIdentity = functionTableIdentity(this.#functions)
    this.#functionTableDigest = functionIdentity.digest
    this.#functionIdentities = functionIdentity.identities
    this.#agentConfigDigest = sha256Json({
      schema: "vibelang.agent.run-policy/v1",
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
      schema: "vibelang.agent.turn/v3",
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
    const messages: AgentMessage[] = [...baseMessages]
    const attempts: AgentRunResult<Result>["attempts"] = []
    let diagnostics: AgentDiagnostic[] = []
    let compiler: string | undefined
    let replayedModelResponses = 0

    await this.#journal?.append({
      type: "turn.started",
      turnId,
      details: {
        ...provenanceDetails(provenance),
        callableManifestDigest: this.#callableManifestDigest,
        callableManifest: this.#callableManifest,
      },
    })

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
      // instead of asking the model again.
      const recalled = await this.#journal?.recallModelCall?.(modelCall)
      const replayed = recalled !== undefined
      const response = replayed
        ? normalizeModelResponse(recalled)
        : normalizeModelResponse(await this.#model.generate(request))
      if (replayed) replayedModelResponses += 1
      else await this.#journal?.recordModelCall?.(modelCall, response)
      const source = extractModelSource(this.#model, response)
      const sourceDigest = digest(source)
      await this.#journal?.putArtifact?.({
        kind: "generated-source",
        turnId,
        digest: sourceDigest,
        content: source,
      })
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
          modelIdentity: componentIdentityJson(this.#modelIdentity),
          modelVersion: modelDescriptorJson(this.#modelDescriptor),
        },
      })

      if (Buffer.byteLength(source, "utf8") > this.#maxSourceBytes) {
        diagnostics = [
          {
            category: "error",
            message: `Generated source exceeded ${this.#maxSourceBytes} bytes`,
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
          await this.#journal?.append({
            type: "turn.completed",
            turnId,
            attempt,
            sourceDigest,
            ok: execution.ok,
            details: {
              attempts: attempts.length,
              replayedModelResponses,
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
        messages.push(
          { role: "assistant", content: source },
          {
            role: "user",
            content:
              "The generated TypeScript did not type-check. Return a complete corrected " +
              `TypeScript module only.\n\n${formatDiagnostics(diagnostics)}`,
          },
        )
      }
    }

    const lastAttempt = attempts.at(-1)
    await this.#journal?.append({
      type: "turn.completed",
      turnId,
      attempt: lastAttempt?.attempt,
      sourceDigest: lastAttempt?.sourceDigest,
      ok: false,
      details: {
        attempts: attempts.length,
        replayedModelResponses,
      },
    })
    return {
      ok: false,
      error: {
        name: "TypeCheckError",
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
