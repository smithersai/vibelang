import { createHash } from "node:crypto"
import { declareCallableSurface } from "./bindings.ts"
import { CliTypeScriptCompiler } from "./compiler.ts"
import { DenoSubprocessSandbox } from "./sandbox.ts"
import type {
  AgentDiagnostic,
  AgentFunctionTable,
  AgentMessage,
  AgentRunResult,
  JsonValue,
  ModelAdapter,
  ModelResponse,
  PromptRenderer,
  TurnJournal,
  TypeScriptCompiler,
  TypeScriptSandbox,
} from "./types.ts"

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function extractTypeScript(response: string): string {
  const fences = [...response.matchAll(/```(?:typescript|ts)?\s*\n?([\s\S]*?)```/gi)]
  if (fences.length === 0) return response.trim()
  return fences.sort((left, right) => right[1].length - left[1].length)[0][1].trim()
}

function normalizeModelResponse(response: string | ModelResponse): ModelResponse {
  return typeof response === "string" ? { source: response } : response
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

  private constructor(options: CodingAgentOptions<Input>) {
    this.#model = options.model
    this.#prompt = options.prompt
    this.#functions = options.functions
    this.#sandbox = options.sandbox ?? new DenoSubprocessSandbox()
    this.#compiler = options.compiler ?? new CliTypeScriptCompiler()
    this.#journal = options.journal
    this.#maxRepairs = options.maxRepairs ?? 1
    this.#maxSourceBytes = options.maxSourceBytes ?? 128 * 1024
    this.#callableSurface = declareCallableSurface(options.functions)
  }

  static make<Input, Result extends JsonValue = JsonValue>(
    options: CodingAgentOptions<Input>,
  ): CodingAgent<Input, Result> {
    return new CodingAgent<Input, Result>(options)
  }

  async run(input: Input): Promise<AgentRunResult<Result>> {
    const baseMessages = [...(await this.#prompt.render(input))]
    const callableDigest = digest(this.#callableSurface)
    const promptDigest = digest(JSON.stringify(baseMessages))
    const turnId = `turn_${digest(`${promptDigest}:${callableDigest}`).slice(0, 20)}`
    const messages: AgentMessage[] = [...baseMessages]
    const attempts: AgentRunResult<Result>["attempts"] = []
    let diagnostics: AgentDiagnostic[] = []
    let compiler: string | undefined

    await this.#journal?.append({
      type: "turn.started",
      turnId,
      details: { promptDigest, callableDigest },
    })

    for (let attempt = 0; attempt <= this.#maxRepairs; attempt++) {
      await this.#journal?.append({ type: "model.requested", turnId, attempt })
      const rawResponse = await this.#model.generate({
        messages,
        attempt,
        diagnostics,
        callableSurface: this.#callableSurface,
      })
      const response = normalizeModelResponse(rawResponse)
      const source = extractTypeScript(response.source)
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
          provider: response.provider ?? "unknown",
          model: response.model ?? "unknown",
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
          details: { diagnosticCount: diagnostics.length, compiler: "source-size-guard" },
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
          details: { diagnosticCount: diagnostics.length, compiler: compilation.compiler },
        })

        if (compilation.ok && compilation.javascript !== undefined) {
          await this.#journal?.putArtifact?.({
            kind: "compiled-javascript",
            turnId,
            digest: digest(compilation.javascript),
            content: compilation.javascript,
          })
          await this.#journal?.append({
            type: "sandbox.started",
            turnId,
            attempt,
            sourceDigest,
            details: { sandbox: this.#sandbox.kind },
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
            details: { durationMs: execution.durationMs },
          })
          await this.#journal?.append({
            type: "turn.completed",
            turnId,
            attempt,
            sourceDigest,
            ok: execution.ok,
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
    }
  }
}
