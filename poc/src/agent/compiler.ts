import { basename } from "node:path"
import { getNativeCompiler } from "../compiler/native.ts"
import type { NativeCompiler } from "../compiler/native.ts"
import type { NativeDiagnostic, NativeSourceFile } from "../compiler/protocol.ts"
import { defineComponentIdentity, sha256File, sha256Json } from "./identity.ts"
import type { AgentDiagnostic, CompilationResult, ComponentIdentity, TypeScriptCompiler } from "./types.ts"

const SANDBOX_POLICY_CODE = 91001
const FORBIDDEN_RUNTIME_NAMES = Object.freeze([
  "eval", "Function", "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction",
  "require", "Worker", "SharedWorker", "ShadowRealm",
])
const CHECK_SOURCE = [
  'import turn from "./turn.js"',
  "type AgentTurn = (functions: Functions) => unknown | Promise<unknown>",
  "const checkedTurn: AgentTurn = turn",
  "void checkedTurn",
  "",
].join("\n")
const COMPILER_OPTIONS = Object.freeze({
  target: "ES2022", module: "ES2022", moduleResolution: "bundler",
  lib: Object.freeze(["ES2022"]), types: Object.freeze([]),
  strict: true, skipLibCheck: true, noEmitOnError: true, sourceMap: true,
})
const SOURCE_POLICY = Object.freeze({
  files: Object.freeze(["turn.ts"]), diagnosticCode: String(SANDBOX_POLICY_CODE),
  messagePrefix: "Generated-turn sandbox policy: ", forbidModuleSyntax: true,
  forbiddenIdentifiers: FORBIDDEN_RUNTIME_NAMES,
})

/** Position conversion only: offsets arrive from the Go compiler as UTF-16. */
function diagnosticFromNative(item: NativeDiagnostic, files: readonly NativeSourceFile[]): AgentDiagnostic {
  const category = item.category === "suggestion" ? "message" : item.category
  const numeric = /^(?:TS)?(\d+)$/.exec(item.code)?.[1]
  const diagnostic: AgentDiagnostic = {
    category, ...(numeric === undefined ? {} : { code: Number(numeric) }), message: item.message,
  }
  if (!item.file) return diagnostic
  const source = files.find((file) => file.path === item.file)?.text
  if (source === undefined) {
    // Compiler-owned library/config diagnostics remain project-level. Do not
    // invent a position in turn.ts for a source the caller never supplied.
    return diagnostic
  }
  diagnostic.file = basename(item.file)
  if (!item.span) return diagnostic
  const offset = item.span.start
  if (offset > source.length || item.span.length > source.length - offset) {
    throw new TypeError("Native compiler diagnostic span escapes its authored source")
  }
  const prefix = source.slice(0, offset)
  // TypeScript line breaks include lone CR, CRLF and Unicode separators.
  const lines = prefix.split(/\r\n|[\n\r\u2028\u2029]/)
  diagnostic.line = lines.length
  diagnostic.column = (lines.at(-1)?.length ?? 0) + 1
  return diagnostic
}

/**
 * Generated ordinary TypeScript is checked and emitted by the pinned native
 * Go compiler. It sees only these virtual inputs and its embedded libraries.
 * Source policy is defense in depth, not a substitute for the Deno sandbox.
 */
export class NativeTypeScriptCompiler implements TypeScriptCompiler {
  readonly identity: ComponentIdentity
  readonly #native: NativeCompiler

  constructor() {
    this.#native = getNativeCompiler()
    this.identity = defineComponentIdentity({
      name: "typescript-go/in-memory",
      artifactDigest: sha256Json({
        implementation: sha256File(new URL(import.meta.url)),
        transport: this.#native.transportDigest,
        native: this.#native.identity,
      }),
      configDigest: sha256Json({
        schema: "vibelang.agent.native-typescript-policy/v1",
        options: COMPILER_OPTIONS, sourcePolicy: SOURCE_POLICY, checkSource: CHECK_SOURCE,
      }),
    })
  }

  async compile(source: string, callableSurface: string): Promise<CompilationResult> {
    const files: readonly NativeSourceFile[] = [
      { path: "turn.ts", kind: "typescript", text: source },
      { path: "surface.d.ts", kind: "typescript", text: callableSurface },
      { path: "__check.ts", kind: "typescript", text: CHECK_SOURCE },
    ]
    const result = this.#native.compile({
      rootNames: files.map((file) => file.path), files, options: COMPILER_OPTIONS,
      lowering: "typescript", sourcePolicy: SOURCE_POLICY,
    })
    const compiler = "TypeScript " + this.#native.identity.compilerVersion + " native Go (" + this.#native.identity.revision + ")"
    const diagnostics = result.diagnostics.map((item) => diagnosticFromNative(item, files))
    if (result.emitSkipped || diagnostics.some((item) => item.category === "error")) {
      return { ok: false, diagnostics, compiler }
    }
    const artifact = result.artifacts.find((item) => item.path === "turn.js")
    if (!artifact) return { ok: false, compiler, diagnostics: [
      ...diagnostics, { category: "error", message: "Native TypeScript emitted no generated turn module" },
    ] }
    return { ok: true, diagnostics, javascript: Buffer.from(artifact.content, "base64").toString("utf8"), compiler }
  }
}

// Source-compatible names, not alternative implementations or a JS fallback.
export { NativeTypeScriptCompiler as InMemoryTypeScriptCompiler, NativeTypeScriptCompiler as CliTypeScriptCompiler }
