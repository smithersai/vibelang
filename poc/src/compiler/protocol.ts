/** Serializable native compiler API. No compiler-library objects cross it. */
import { decodeComptimeValue } from "../build/comptime-value.ts"
import { isAbsolute, relative, resolve, sep } from "node:path"

export const NATIVE_API_VERSION = 53

/** Native disk reads and file probes, missing directory probes, and directory
 * membership reads. Positive directory-existence checks alone are excluded:
 * resolution records individual file probes beneath those directories instead.
 * Explicit overlays and pinned libraries are not mutable disk dependencies. */
export interface NativeDependencyTrace {
  readonly files: readonly string[]
  readonly directories: readonly string[]
}

function validateDependencyTrace(value: unknown, requested: boolean, root?: string): void {
  if (!requested) {
    if (value !== undefined) reject("unsolicited native dependency trace")
    return
  }
  const trace = record(value, "native dependency trace", ["files", "directories"])
  let count = 0, bytes = 0
  for (const key of ["files", "directories"] as const) {
    const paths = trace[key]
    if (!Array.isArray(paths)) reject("invalid native dependency path list")
    let previous = ""
    for (const name of paths) {
      if (typeof name !== "string" || name.length > 16 * 1024 || Buffer.byteLength(name) > 16 * 1024 || name.includes("\0") || name.includes("\\") ||
        !isAbsolute(name) || resolve(name).replaceAll("\\", "/") !== name || name <= previous) reject("invalid native dependency path")
      if (root !== undefined) {
        const inside = relative(root, name)
        if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) reject("native dependency escaped the resolution root")
      }
      previous = name
      count++
      bytes += Buffer.byteLength(name, "utf8")
      if (count > 8192 || bytes > 2 * 1024 * 1024) reject("native dependency trace budget exceeded")
    }
  }
}

/** Inert data only: a verified Plan is not an approval or cache authority. */
export interface NativeKeyedPlanRequest {
  readonly operation: "compile" | "verify" | "append" | "derive-key"
  readonly inputJson: string
}
export interface NativeKeyedPlanResult {
  readonly ok: boolean
  readonly planJson: string
  readonly key: string
  readonly errorCode: string
  readonly message: string
}

/** Static source modules; declarations do not approve provider execution. */
export interface NativeKeyedSourceRequest {
  readonly source: string
  readonly fileName: string
  /** Select one exported Flow when the entry module declares several. */
  readonly exportName?: string
  readonly flowId: string
  readonly flowVersion: number
  readonly planId: string
  readonly inputJson: string
  readonly providersJson: string
  readonly dependencies?: readonly {readonly fileName: string; readonly source: string}[]
}
export interface NativeKeyedSourceResult {
  readonly ok: boolean
  readonly planJson: string
  readonly diagnostics: readonly NativeDiagnostic[]
}

/** Data artifacts only; this API does not certify arbitrary source execution. */
export interface NativePlanSourceRequest {
  readonly source: string
  readonly fileName: string
  readonly flowId: string
  readonly flowVersion: number
  readonly mode: "plan" | "manifest"
  readonly actions?: readonly {
    readonly moduleSpecifier: string
    readonly exportName: string
    readonly descriptorJson: string
  }[]
  readonly flows?: readonly {
    readonly moduleSpecifier: string
    readonly exportName: string
    readonly planJson: string
    readonly manifestJson?: string
  }[]
}
export interface NativePlanSourceResult {
  readonly status: "plan" | "manifest" | "unrepresentable" | "refused"
  readonly diagnostics: readonly NativeDiagnostic[]
  readonly planJson: string
  readonly manifestJson: string
  readonly manifestFailure: string
  readonly derivedActions: readonly { readonly name: string; readonly id: string; readonly start: number; readonly end: number }[]
}

export type CompilerJson = null | boolean | number | string | readonly CompilerJson[] |
  { readonly [key: string]: CompilerJson }

export interface NativeSourceFile {
  readonly path: string
  readonly kind: "typescript" | "vibelang" | "asset"
  readonly text: string
}

export interface NativeSourcePolicy {
  readonly files: readonly string[]
  readonly diagnosticCode: string
  readonly messagePrefix: string
  readonly forbidModuleSyntax: boolean
  readonly forbiddenIdentifiers: readonly string[]
}

export interface NativeCompileRequest {
  readonly rootNames: readonly string[]
  readonly files: readonly NativeSourceFile[]
  readonly options?: Readonly<Record<string, CompilerJson>>
  readonly lowering: "internal" | "typescript"
  readonly configFile?: { readonly path: string; readonly text: string }
  readonly sourcePolicy?: NativeSourcePolicy
}

export interface NativeDiagnostic {
  readonly code: string
  readonly category: "error" | "warning" | "suggestion" | "message"
  readonly message: string
  readonly file?: string
  readonly span?: { readonly start: number; readonly length: number }
  readonly phase?: "parse" | "bind" | "check" | "lower" | "emit" | "comptime"
}
export interface NativeSpan { readonly start: number; readonly length: number }

export interface NativeActionContractRequest {
  readonly source: string
  readonly fileName: string
  readonly exportName: string
  readonly id: string
  readonly version: number
}
export interface NativeActionContractResult {
  readonly ok: boolean
  readonly diagnostics: readonly NativeDiagnostic[]
  readonly contractJson: string
}

export interface NativeCheckedFunctionRequest {
  /** Complete explicit source closure; every input is checked, even if unused. */
  readonly files: readonly NativeSourceFile[]
  readonly entryFile: string
  readonly exportName: string
  /** Also derive single-input durable provider input/success schemas. */
  readonly durableBoundary?: boolean
}

export interface NativeLanguageAnalysisRequest {
  readonly traceDependencies?: boolean
  /** Check retained static Flow bodies. Query-only: cannot authorize emission. */
  readonly staticPlanCheck?: boolean
  /** Explicit source bytes always win over disk dependencies. */
  readonly files: readonly NativeSourceFile[]
  /** Optional read-only, root-confined native dependency discovery. No tsconfig
   * is loaded; omitted means an explicit immutable source closure only. */
  readonly resolutionRoot?: string
  /** Keep the authored .vibe module set explicit while discovering ordinary
   * foreign dependencies beneath resolutionRoot. Supplied bytes still win. */
  readonly explicitVibeLangSources?: boolean
  /** Checker-only runtime aliases. A compilerData claim is revalidated as a
   * closed inert-data graph by Go, not accepted as transport-level authority. */
  readonly runtimeModules?: readonly NativeLanguageAnalysisRuntimeModule[]
  /** Explicit SDK declaration target, distinct from the standalone runtime. */
  readonly sdkRuntimeImport?: string
}
export interface NativeLanguageAnalysisRuntimeModule {
  readonly path: string
  readonly aliases: readonly string[]
  readonly compilerData?: boolean
}
export interface NativeAnalyzedError {
  readonly name: string
  readonly fieldsSource: string
  readonly start: number
  readonly end: number
}
export interface NativeAnalyzedFunction {
  readonly name: string
  readonly exported: boolean
  readonly async: boolean
  readonly channel: "plain" | "result"
  readonly explicitReturn: boolean
  readonly start: number
  readonly end: number
  readonly bodyStart: number
  readonly bodyEnd: number
  readonly moduleScope: boolean
  readonly failures: readonly string[]
  readonly requirements: readonly string[]
}
export interface NativeAnalyzedFile {
  readonly path: string
  /** False when a syntax/global refusal prevented semantic analysis. */
  readonly analyzed: boolean
  readonly errors: readonly NativeAnalyzedError[]
  readonly functions: readonly NativeAnalyzedFunction[]
}
export interface NativeLanguageAnalysisResult {
  readonly dependencies?: NativeDependencyTrace
  /** Language roots and compiler-owned support passed native checked lowering.
   * Foreign types are resolved, not certified under the SDK's compiler options.
   * Provisional rows on a refusal are editor information, never deployment proofs. */
  readonly checked: boolean
  readonly diagnostics: readonly NativeDiagnostic[]
  readonly files: readonly NativeAnalyzedFile[]
}

export interface NativeLanguageLoweringRequest {
  readonly project: NativeLanguageAnalysisRequest
  readonly runtimeImport: string
  readonly outputs?: readonly NativeLanguageLoweringOutput[]
  readonly preserveVibeLangSpecifiers?: boolean
}
export interface NativeLanguageLoweringOutput {
  readonly path: string
  readonly outputFileName?: string
  readonly sourceName?: string
  readonly stripImportAttributes?: boolean
}
export interface NativeLanguageLoweringResult {
  /** Authored language checked; generated SDK TypeScript still needs checking. */
  readonly ok: boolean
  readonly analysis: NativeLanguageAnalysisResult
  readonly diagnostics: readonly NativeDiagnostic[]
  readonly files: readonly { readonly path: string; readonly text: string; readonly sourceMap: string }[]
}

export interface NativeConfigRequest {
  /** Diagnostic label only; no file or inherited configuration is read. */
  readonly path: string
  readonly text: string
}
export interface NativeConfigResult {
  readonly diagnostics: readonly NativeDiagnostic[]
}
export interface NativeGeneratedProjectRequest {
  readonly traceDependencies?: boolean
  /** Absolute normalized paths of generated TS, including TS held at .js paths. */
  readonly files: readonly { readonly path: string; readonly text: string; readonly configuration?: "language" | "typescript" }[]
  readonly currentDirectory: string
  /** Explicitly permits bounded, read-only upstream disk dependency resolution. */
  readonly diskDependencies: boolean
  readonly moduleOverrides?: Readonly<Record<string, string>>
}
export interface NativeGeneratedProjectResult {
  readonly dependencies?: NativeDependencyTrace
  /** Root/global findings only; imported files keep their own configuration. */
  readonly diagnostics: readonly NativeDiagnostic[]
}
export interface NativeBodyContractRequest {
  readonly project: NativeGeneratedProjectRequest
  readonly entryFile: string
  readonly entry: string
  readonly logicalFileName: string
  readonly runtimeSpecifier: string
  readonly resumable: boolean
  readonly async: boolean
}
/** Intermediate private calling convention, never an executable-body proof. */
export interface NativeBodyLoweringRequest {
  readonly source: string
  readonly fileName: string
  readonly flowId: string
  readonly flowVersion: number
  readonly runtimeImport: string
  readonly outputFileName: string
  readonly sourceOrigin?: { readonly text: string; readonly sourceMap: string; readonly loweringIdentity: string }
}
export interface NativeBodyLoweringResult {
  readonly ok: boolean
  readonly reason: "" | "source" | "entry" | "boundary" | "unsupported" | "provenance"
  readonly diagnostics: readonly NativeDiagnostic[]
  readonly code: string
  readonly sourceMap: string
  readonly manifestJson: string
  readonly entry: string
  readonly entrySpan: NativeSpan | null
  readonly functionSpan: NativeSpan | null
  readonly async: boolean
  readonly resumable: boolean
  readonly derivedActions: readonly { readonly name: string; readonly id: string; readonly start: number; readonly end: number }[]
  readonly errors: readonly { readonly durable: string; readonly nominal: string }[]
}
export interface NativeBodyContractResult {
  readonly ok: boolean
  readonly diagnostics: readonly NativeDiagnostic[]
  readonly reason: "" | "check" | "entry" | "boundary"
  readonly message: string
  readonly schemasJson: string
}
export interface NativeDeclarationRows {
  readonly failures: readonly string[]
  readonly requirements: readonly string[]
}
export interface NativeDeclarationTextRequest {
  readonly operation: "read" | "normalize" | "annotate"
  readonly path: string
  readonly text: string
  readonly effects?: Readonly<Record<string, NativeDeclarationRows>>
  readonly runtimes?: readonly string[]
}
export interface NativeDeclarationTextResult {
  readonly text: string
  readonly effects: Readonly<Record<string, NativeDeclarationRows>>
}
export interface NativeGeneratedDeclarationsRequest {
  readonly project: NativeGeneratedProjectRequest
  readonly metadata?: Readonly<Record<string, {
    readonly effects?: Readonly<Record<string, NativeDeclarationRows>>
    readonly runtimeModule?: string
  }>>
}
export interface NativeGeneratedDeclarationsResult {
  readonly ok: boolean
  readonly outputs: readonly { readonly path: string; readonly text: string }[]
  readonly diagnostics: readonly NativeDiagnostic[]
}
export interface NativeCheckedFunctionFacts {
  readonly file: string
  readonly name: string
  readonly span: { readonly start: number; readonly length: number }
  readonly requirements: readonly string[]
  readonly typedFailures: readonly string[]
  readonly panic: boolean
  readonly failureSchemaJson: string
  /** Empty unless durableBoundary was requested; otherwise completion/inputSchema/successSchema. */
  readonly valueSchemasJson: string
}
export interface NativeCheckedFunctionResult {
  readonly ok: boolean
  readonly diagnostics: readonly NativeDiagnostic[]
  readonly message: string
  readonly function: NativeCheckedFunctionFacts | null
}

export interface NativeCompileResult {
  readonly diagnostics: readonly NativeDiagnostic[]
  readonly artifacts: readonly { readonly path: string; readonly content: string }[]
  readonly emitSkipped: boolean
}

export interface NativeInspectionSource {
  readonly path: string
  readonly text: string
  readonly scriptKind: "typescript" | "javascript" | "tsx" | "jsx" | "json"
  /** Syntax inventory, not exports or runtime authority. Non-JSON only. */
  readonly declarationBindings?: boolean
}

export interface NativeDeclarationBinding {
  readonly kind: "variable" | "function"
  readonly span: NativeSpan
  /** Decoded identifier; null for a binding pattern or anonymous function. */
  readonly name: string | null
  /** Exact authored spelling; null only for an anonymous function. */
  readonly nameSpan: NativeSpan | null
}

export type NativeModuleSyntaxKind = "import-declaration" | "import-equals" | "module-re-export" |
  "import-type" | "import-meta" | "dynamic-import" | "require" | "require-resolve" | "module-url"

export interface NativeInspectionResult {
  readonly files: readonly {
    readonly path: string
    readonly diagnostics: readonly NativeDiagnostic[]
    readonly moduleSyntax: readonly {
      readonly kind: NativeModuleSyntaxKind
      readonly topLevel: boolean
      readonly span: { readonly start: number; readonly length: number }
      readonly specifier?: string
      /** Exact authored literal, including quotes, distinct from the whole module use. */
      readonly specifierSpan?: { readonly start: number; readonly length: number }
      readonly specifierKind?: "string" | "template"
    }[]
    /** JSON/config only; spans name duplicate key literals, not decoded values. */
    readonly jsonDuplicateKeys?: readonly { readonly start: number; readonly length: number }[]
    /** Opt-in top-level variable/function syntax, empty on parse failure. */
    readonly declarationBindings?: readonly NativeDeclarationBinding[]
  }[]
}

export interface NativeFormatRequest {
  readonly text: string
  readonly fileName?: string
  readonly indentSize?: number
  readonly newLine?: "\n" | "\r\n"
}

export type NativeFormatDiagnosticCode = "VIBE1900" | "VIBE1901" | "VIBE1902"
export interface NativeFormatDiagnostic {
  readonly severity: "error"
  readonly code: NativeFormatDiagnosticCode
  readonly message: string
  readonly start: number
  readonly line: number
  readonly column: number
}
export interface NativeFormatResult {
  readonly ok: boolean
  readonly code: string
  readonly changed: boolean
  readonly diagnostics: readonly NativeFormatDiagnostic[]
}
export interface NativeSourceToken {
  /** Symbolic native token kind, not a TypeScript 5.9 enum value. */
  readonly kind: string
  readonly text: string
  readonly start: number
  readonly end: number
}
export interface NativeTokenRequest {
  readonly text: string
  readonly offset: number
}
export interface NativeTokenResult {
  readonly token: NativeSourceToken | null
}

export interface NativeLoaderRegistrationRequest {
  readonly mode: "discover" | "recognize"
  readonly fileName: string
  readonly source: string
}
export type NativeLoaderRegistrationCode = `VCT130${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
export interface NativeLoaderRegistrationDiagnostic {
  readonly code: NativeLoaderRegistrationCode
  readonly severity: "error"
  readonly message: string
  readonly fileName: string
  readonly line: number
  readonly column: number
}
export interface NativeLoaderRegistration {
  readonly fileName: string
  readonly type: string
  readonly sandboxSource: string
  readonly line: number
  readonly column: number
}
export interface NativeLoaderRegistrationResult {
  readonly candidate: boolean
  readonly ok: boolean
  readonly identified: boolean
  readonly registration?: NativeLoaderRegistration
  readonly diagnostics: readonly NativeLoaderRegistrationDiagnostic[]
}

export interface NativeAssetOutputRequest {
  readonly source: string
  readonly declaredLogicalKeys: readonly string[]
}
export interface NativeAssetOutputResult {
  readonly ok: boolean
  readonly message: string
  readonly references: readonly string[]
}

export interface NativeAssetImportSource {
  readonly path: string
  readonly text: string
}
export interface NativeAssetImportsRequest {
  readonly files: readonly NativeAssetImportSource[]
  /** Explicit read-only disk scope for the native module resolver; no fallback. */
  readonly resolutionRoot?: string
}
export interface NativeAssetImportPosition {
  readonly start: number
  readonly line: number
  readonly column: number
}
export interface NativeAssetImport {
  readonly specifier: string
  readonly attributes: Readonly<Record<string, string>>
  readonly form: "import" | "re-export" | "dynamic-import"
  readonly site: NativeAssetImportPosition
  readonly specifierSite: NativeAssetImportPosition
}
export interface NativeAssetImportDiagnostic {
  readonly code: string
  readonly severity: "error"
  readonly message: string
  readonly fileName: string
  readonly line: number
  readonly column: number
}
export interface NativeAssetImportsFile {
  readonly path: string
  readonly requests: readonly NativeAssetImport[]
  readonly ordinaryImports: readonly { readonly specifier: string; readonly resolvedPath?: string }[]
  readonly diagnostics: readonly NativeAssetImportDiagnostic[]
}
export interface NativeAssetImportsResult {
  readonly files: readonly NativeAssetImportsFile[]
}

/** Syntax/emit only: never a type check, VibeLang lowering, or module resolver. */
export interface NativeTranspileRequest {
  readonly files: readonly { readonly path: string; readonly text: string }[]
  readonly options?: Readonly<Record<string, CompilerJson>>
}
export interface NativeTranspiledSource {
  readonly path: string
  readonly emitSkipped: boolean
  readonly javascript: string
  readonly sourceMap: string
  readonly diagnostics: readonly NativeDiagnostic[]
}
export interface NativeTranspileResult {
  readonly files: readonly NativeTranspiledSource[]
}

/** Read module-closure and bound-registration facts from already-lowered TS. */
export interface NativeBundleModulesRequest {
  readonly files: readonly { readonly path: string; readonly text: string }[]
  readonly runtimeSpecifier: string
  readonly runtimeHelpers: readonly string[]
  readonly registrationExport: string
}
export interface NativeBundleModulesResult {
  readonly diagnostics: readonly { readonly path: string; readonly message: string }[]
  readonly registrations: readonly { readonly path: string; readonly className: string; readonly identity: string }[]
}

export interface NativeCanonicalFunctionResult {
  readonly ok: boolean
  readonly code: string
  readonly message: string
}

/** Bound rewrite ranges, not a descriptor, type-check certificate or AST. */
export interface NativeDurableModuleResult {
  readonly diagnostics: readonly NativeDiagnostic[]
  readonly imports: readonly { readonly start: number; readonly length: number }[]
  readonly calls: readonly { readonly start: number; readonly length: number }[]
  readonly removals: readonly { readonly start: number; readonly length: number }[]
}

/** Limited validator IR as JSON data; no AST or language-check certificate. */
export interface NativeSyntaxSchemaResult {
  readonly ok: boolean
  readonly schemaJson: string
  readonly message: string
  readonly parseError: boolean
}

/** Exact call-site type queries, not intrinsic authorization or a language gate. */
export interface NativeCheckedSchemasRequest {
  readonly files: readonly NativeInspectionSource[]
  readonly modules: Readonly<Record<string, string>>
  readonly queries: readonly { readonly file: string; readonly span: { readonly start: number; readonly length: number } }[]
}
export interface NativeCheckedSchemasResult {
  readonly schemas: readonly {
    readonly ok: boolean
    readonly schemaJson: string
    readonly failure: "" | "unsupported" | "budget"
    readonly message: string
  }[]
}

export interface NativeSourceRecoveryResult {
  readonly code: string
  readonly changed: boolean
  readonly identityFallback: boolean
  readonly diagnostics: readonly {readonly severity:"error";readonly code:"VIBE1717";readonly message:string;readonly start:number}[]
  readonly rejectedStarts: readonly number[]
  readonly verbatim: readonly {readonly derivedStart:number;readonly authoredStart:number;readonly length:number}[]
  readonly glue: readonly {readonly derivedStart:number;readonly length:number;readonly anchor:number}[]
  readonly tokens: readonly {readonly kind:string;readonly text:string;readonly start:number;readonly end:number;readonly endsExpression:boolean}[]
}

export interface NativeComptimePlanRange {
  readonly file: string
  readonly span: { readonly start: number; readonly length: number }
}
export interface NativeComptimePlanRequest {
  readonly files: readonly NativeInspectionSource[]
  readonly target: string
  readonly schemaRuntimeImport: string
  readonly inputs: readonly {readonly file:string;readonly specifier:string;readonly text:string;readonly error:string}[]
}
export interface NativeComptimePlanResult {
  readonly complete: boolean
  readonly diagnostics: readonly {readonly at:NativeComptimePlanRange;readonly code:string;readonly message:string}[]
  readonly reads: readonly {readonly at:NativeComptimePlanRange;readonly specifier:string}[]
  readonly calls: readonly {
    readonly at: NativeComptimePlanRange
    readonly argument: NativeComptimePlanRange
    readonly mappedOrigin: NativeComptimePlanRange
    readonly origins: readonly NativeComptimePlanRange[]
    readonly inputs: readonly number[]
    readonly valueJson: string
    readonly schemaType: string
  }[]
  readonly edits: readonly {
    readonly at: NativeComptimePlanRange
    readonly kind: "remove-import"|"function-marker"|"intrinsic-call"|"schema-runtime-import"|"type-alias"
    readonly text: string
    readonly mappedOrigin: NativeComptimePlanRange
    readonly origins: readonly NativeComptimePlanRange[]
  }[]
}

/** Erasure/assembly only; callers must supply checked lowered module source. */
export interface NativeRuntimeFactoryRequest {
  readonly source: string
  readonly entry: string
  readonly runtimeSpecifier: string
}
export type NativeRuntimeFactoryResult = NativeCanonicalFunctionResult

/** Runtime graph facts, never a successful parse or a checked-program proof. */
export interface NativeRuntimeModulesRequest {
  readonly files: readonly { readonly path: string; readonly text: string; readonly deferComputedDynamicSpecifier?: boolean }[]
  readonly resolutionRoot?: string
}
export interface NativeRuntimeModuleEdge {
  readonly kind: "import" | "export" | "import-equals" | "dynamic-import" | "require"
  readonly specifier: string
  readonly start: number
  readonly end: number
  readonly typeOnly: boolean
  readonly moduleInitialization: boolean
  readonly attributes: boolean
}
export interface NativeRuntimeModuleFile {
  readonly path: string
  readonly edges: readonly NativeRuntimeModuleEdge[]
  readonly leadingNoThrow: boolean
  readonly firstStatement: NativeAssetImportPosition
  readonly diagnostics: readonly (NativeAssetImportPosition & { readonly message: string })[]
  readonly parseDiagnostics: readonly NativeDiagnostic[]
  readonly resolutions: readonly {
    readonly specifier: string
    readonly runtimePath?: string
    readonly typePath?: string
    readonly message: string
  }[]
}
export interface NativeRuntimeModulesResult { readonly files: readonly NativeRuntimeModuleFile[] }

export class NativeCompilerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "NativeCompilerError"
  }
}

/** Preserve the source/identity bytes: Go's JSON decoder otherwise repairs a
 * lone UTF-16 surrogate to U+FFFD. ASCII source escapes such as `\\ud800` and
 * paired UTF-16 remain valid. The replacer also checks object keys and toJSON
 * results, so options and policy names cannot acquire a different identity. */
export function encodeNativeRequest(value: unknown): string {
  const encoded = JSON.stringify(value, (key, item: unknown) => {
    if (!wellFormed(key) || (typeof item === "string" && !wellFormed(item))) {
      throw new NativeCompilerError("VIBELANG_GO_PROTOCOL", "compiler request contains an unpaired UTF-16 surrogate")
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      throw new NativeCompilerError("VIBELANG_GO_PROTOCOL", "compiler request contains a non-finite number")
    }
    return item
  })
  if (encoded === undefined) throw new NativeCompilerError("VIBELANG_GO_PROTOCOL", "compiler request is not a JSON value")
  return encoded
}

function wellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xdc00 && unit <= 0xdfff) return false
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    }
  }
  return true
}

function wireString(value: unknown): value is string {
  return typeof value === "string" && wellFormed(value)
}

function reject(message: string): never {
  throw new NativeCompilerError("VIBELANG_GO_PROTOCOL", message)
}

function record(value: unknown, label: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(`${label} must be an object`)
  const result = value as Record<string, unknown>
  if (required.some((key) => !Object.hasOwn(result, key)) ||
    Object.keys(result).some((key) => !required.includes(key) && !optional.includes(key))) {
    reject(`${label} has missing or unknown fields`)
  }
  return result
}

function decodeEnvelope(text: string, revision: string): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(text) } catch { return reject("native compiler returned invalid JSON") }
  const envelope = record(value, "native response", ["apiVersion", "compilerRevision", "result"], ["error"])
  if (envelope.apiVersion !== NATIVE_API_VERSION || envelope.compilerRevision !== revision) {
    reject("native compiler response API or source revision does not match the host")
  }
  if (envelope.error !== undefined) {
    const error = record(envelope.error, "native error", ["code", "message"])
    if (!wireString(error.code) || !wireString(error.message)) reject("malformed native error")
    throw new NativeCompilerError(error.code, error.message)
  }
  return envelope
}

/** Strict wire decoding: a malformed response never becomes partial success. */
export function decodeNativeResult(text: string, revision: string): NativeCompileResult {
  const envelope = decodeEnvelope(text, revision)
  const result = record(envelope.result, "native result", ["diagnostics", "artifacts", "emitSkipped"])
  if (!Array.isArray(result.diagnostics) || !Array.isArray(result.artifacts) || typeof result.emitSkipped !== "boolean") {
    reject("malformed native result collections")
  }
  validateDiagnostics(result.diagnostics)
  const paths = new Set<string>()
  for (const value of result.artifacts) {
    const item = record(value, "native artifact", ["path", "content"])
    if (!wireString(item.path) || !item.path || item.path.includes("\\") || item.path.includes(":") ||
      item.path.split("/").some((part) => part === "" || part === "." || part === "..") || paths.has(item.path)) {
      reject("unsafe or duplicate native artifact path")
    }
    paths.add(item.path)
    if (typeof item.content !== "string" || Buffer.from(item.content, "base64").toString("base64") !== item.content) {
      reject("native artifact content is not canonical base64")
    }
  }
  if (result.emitSkipped && result.artifacts.length !== 0) reject("skipped emit returned native artifacts")
  return result as unknown as NativeCompileResult
}

function validateDiagnostics(values: unknown[]): void {
  for (const value of values) {
    const item = record(value, "native diagnostic", ["code", "category", "message"], ["file", "span", "phase"])
    if (!wireString(item.code) || !wireString(item.message) ||
      !["error", "warning", "suggestion", "message"].includes(item.category as string) ||
      (item.file !== undefined && !wireString(item.file)) ||
      (item.phase !== undefined && !["parse", "bind", "check", "lower", "emit", "comptime"].includes(item.phase as string))) {
      reject("malformed native diagnostic")
    }
    if (item.span !== undefined) {
      const span = record(item.span, "native span", ["start", "length"])
      if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.length) ||
        (span.start as number) < 0 || (span.length as number) < 0 || !item.file) reject("malformed native diagnostic span")
    }
  }
}

export function decodeNativeKeyedPlan(text: string, revision: string, request: NativeKeyedPlanRequest): NativeKeyedPlanResult {
  if (Buffer.byteLength(text, "utf8") > 40*1024*1024) reject("keyed Plan response budget exceeded")
  const result = record(decodeEnvelope(text, revision).result, "keyed Plan", ["ok", "planJson", "key", "errorCode", "message"])
  if (typeof result.ok !== "boolean" || !wireString(result.planJson) || !wireString(result.key) ||
    !wireString(result.errorCode) || !wireString(result.message) || Buffer.byteLength(result.planJson, "utf8") > 16*1024*1024 ||
    result.key.length > 69 || result.errorCode.length > 64 || result.message.length > 16*1024) reject("invalid keyed Plan completion")
  if (!result.ok) {
    if (result.planJson !== "" || result.key !== "" || !result.message ||
      !["invalid_json", "invalid_operation", "invalid_node", "invalid_plan", "graph_too_large", "cycle",
        "unknown_dependency", "missing_dependency", "duplicate_node", "overlap_forbidden", "invalid_effects"].includes(result.errorCode)) reject("inconsistent keyed Plan refusal")
  } else {
    if (result.errorCode !== "" || result.message !== "") reject("successful keyed Plan has a refusal")
    if (request.operation === "derive-key") {
      if (result.planJson !== "" || !/^key1_[0-9a-f]{64}$/.test(result.key)) reject("invalid derived key")
    } else {
      if (!["compile", "verify", "append"].includes(request.operation) || result.key !== "" || !result.planJson) reject("inconsistent keyed Plan artifact")
      let plan: unknown
      try { plan = JSON.parse(result.planJson) } catch { reject("invalid keyed Plan artifact JSON") }
      let visited = 0
      const bound = (value: unknown, depth: number): void => {
        if (++visited > 1_000_000 || depth > 256) reject("keyed Plan artifact traversal budget exceeded")
        if (typeof value === "string" && !wellFormed(value)) reject("keyed Plan contains non-scalar text")
        if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) reject("keyed Plan contains a non-canonical number")
        if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
          if (!wellFormed(key)) reject("keyed Plan contains a non-scalar property")
          bound(child, depth + 1)
        }
      }
      bound(plan, 0)
      const fields = record(plan, "keyed Plan artifact", ["planId", "flow", "generation", "baseDigest", "digest", "nodes"])
      if (!wireString(fields.planId) || !fields.planId || !wireString(fields.flow) || !fields.flow ||
        !Number.isSafeInteger(fields.generation) || (fields.generation as number) < 0 ||
        !Array.isArray(fields.nodes) || fields.nodes.length > 10000 || (fields.generation as number) > fields.nodes.length ||
        typeof fields.baseDigest !== "string" || !/^key1_[0-9a-f]{64}$/.test(fields.baseDigest) ||
        typeof fields.digest !== "string" || !/^key1_[0-9a-f]{64}$/.test(fields.digest)) reject("invalid keyed Plan artifact envelope")
      // Semantic reconstruction belongs to the authenticated native compiler,
      // not a second TypeScript implementation of Plan.verify.
    }
  }
  return result as unknown as NativeKeyedPlanResult
}

export function decodeNativeKeyedSource(text: string, revision: string, request: NativeKeyedSourceRequest): NativeKeyedSourceResult {
  if (Buffer.byteLength(text, "utf8") > 40*1024*1024) reject("keyed source response budget exceeded")
  const result = record(decodeEnvelope(text, revision).result, "keyed source", ["ok", "planJson", "diagnostics"])
  if (typeof result.ok !== "boolean" || !wireString(result.planJson) || !Array.isArray(result.diagnostics) ||
    result.diagnostics.length > 4096 || result.ok !== (result.diagnostics.length === 0) ||
    result.ok !== (result.planJson !== "")) reject("inconsistent keyed source completion")
  validateDiagnostics(result.diagnostics)
  const sources = new Map([[request.fileName, request.source], ...(request.dependencies ?? []).map(file => [file.fileName, file.source] as const)])
  for (const issue of result.diagnostics as NativeDiagnostic[]) {
    const source = sources.get(issue.file ?? "")
    if (issue.category !== "error" || source === undefined || !issue.code || !issue.message ||
      !["parse", "bind", "check", "lower", "comptime"].includes(issue.phase ?? "") || !issue.span ||
      issue.span.start > source.length || issue.span.length < 1 ||
      issue.span.length > Math.max(1, source.length - issue.span.start)) reject("invalid keyed source diagnostic")
  }
  if (result.ok) {
    decodeNativeKeyedPlan(JSON.stringify({apiVersion: NATIVE_API_VERSION, compilerRevision: revision,
      result: {ok: true, planJson: result.planJson, key: "", errorCode: "", message: ""}}), revision,
      {operation: "compile", inputJson: ""})
    const plan = JSON.parse(result.planJson) as {planId: string; flow: string}
    if (plan.planId !== request.planId || (request.flowId && plan.flow !== request.flowId)) reject("incorrect keyed source identity")
  }
  return result as unknown as NativeKeyedSourceResult
}

export function decodeNativePlanSource(text: string, revision: string, request: NativePlanSourceRequest): NativePlanSourceResult {
  if (Buffer.byteLength(text, "utf8") > 40*1024*1024) reject("Plan source response budget exceeded")
  const result = record(decodeEnvelope(text, revision).result, "Plan source", ["status", "diagnostics", "planJson", "manifestJson", "manifestFailure", "derivedActions"])
  if (!["plan", "manifest", "unrepresentable", "refused"].includes(result.status as string) ||
    !Array.isArray(result.diagnostics) || result.diagnostics.length > 4096 ||
    !Array.isArray(result.derivedActions) || result.derivedActions.length > 100_000 ||
    !wireString(result.planJson) || Buffer.byteLength(result.planJson, "utf8") > 16*1024*1024 ||
    !wireString(result.manifestJson) || Buffer.byteLength(result.manifestJson, "utf8") > 16*1024*1024 ||
    !wireString(result.manifestFailure) || Buffer.byteLength(result.manifestFailure, "utf8") > 16*1024) reject("invalid Plan source completion")
  validateDiagnostics(result.diagnostics)
  for (const issue of result.diagnostics as NativeDiagnostic[]) {
    if (issue.file !== request.fileName || !issue.code || !issue.message || issue.category !== "error" ||
      !["parse", "bind", "check", "lower"].includes(issue.phase ?? "") || !issue.span || issue.span.start > request.source.length ||
      issue.span.length < 1 || issue.span.length > Math.max(1, request.source.length - issue.span.start)) reject("invalid Plan source diagnostic")
  }
  if ((result.status === "refused") !== (result.diagnostics.length > 0)) reject("inconsistent Plan source refusal")
  if (result.status === "refused" || result.status === "unrepresentable") {
    if (result.planJson !== "" || result.manifestJson !== "" || result.manifestFailure !== "" || result.derivedActions.length !== 0 ||
      (result.status === "unrepresentable" && request.mode !== "plan")) reject("refused Plan source leaked artifacts")
    return result as unknown as NativePlanSourceResult
  }
  if (result.status !== request.mode || (result.status === "plan") !== (result.planJson !== "") ||
    (result.manifestJson !== "") === (result.manifestFailure !== "") || (result.status === "manifest" && result.manifestFailure !== "")) reject("inconsistent Plan source artifacts")
  for (const artifact of [result.planJson, result.manifestJson]) {
    if (!artifact) continue
    let value: unknown
    try { value = JSON.parse(artifact) } catch { reject("invalid Plan source artifact JSON") }
    let nodes = 0
    const bound = (item: unknown, depth: number): void => {
      if (++nodes > 100_000 || depth > 256) reject("Plan source artifact exceeds its traversal budget")
      if (typeof item === "string" && !wellFormed(item)) reject("non-scalar Plan artifact text")
      if (typeof item === "number" && (!Number.isFinite(item) || Object.is(item, -0))) reject("non-canonical Plan artifact number")
      if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) {
        if (!wellFormed(key)) reject("non-scalar Plan artifact key")
        bound(child, depth + 1)
      }
    }
    bound(value, 0)
    if (!value || typeof value !== "object" || Array.isArray(value)) reject("invalid Plan source artifact object")
    const identity = value as Record<string, unknown>
    if (!wireString(identity.flowId) || !identity.flowId || (request.flowId && identity.flowId !== request.flowId) || identity.flowVersion !== request.flowVersion) reject("incorrect Plan source artifact identity")
  }
  let previous = -1
  for (const item of result.derivedActions) {
    const action = record(item, "Plan Action declaration", ["name", "id", "start", "end"])
    if (!wireString(action.name) || !action.name || action.id !== `${request.fileName}#${action.name}` ||
      !Number.isSafeInteger(action.start) || !Number.isSafeInteger(action.end) || (action.start as number) < 0 ||
      (action.start as number) < previous || (action.end as number) <= (action.start as number) || (action.end as number) > request.source.length) reject("invalid Plan source Action declaration")
    previous = action.start as number
  }
  return result as unknown as NativePlanSourceResult
}

export function decodeNativeInspection(text: string, revision: string, sources: readonly NativeInspectionSource[]): NativeInspectionResult {
  const result = record(decodeEnvelope(text, revision).result, "native inspection", ["files"])
  if (!Array.isArray(result.files) || result.files.length !== sources.length) reject("native inspection returned a different source set")
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]!
    const file = record(result.files[index], "inspected file", ["path", "diagnostics", "moduleSyntax"], ["jsonDuplicateKeys", "declarationBindings"])
    if (file.path !== source.path || !Array.isArray(file.diagnostics) || !Array.isArray(file.moduleSyntax)) reject("malformed inspected source")
    validateDiagnostics(file.diagnostics)
    for (const value of file.diagnostics) {
      const diagnostic = value as NativeDiagnostic
      if (diagnostic.file !== source.path || (diagnostic.span !== undefined &&
        diagnostic.span.start + diagnostic.span.length > source.text.length)) reject("inspection diagnostic escapes its source")
    }
    if (source.declarationBindings === true) {
      if (source.scriptKind === "json" || !Array.isArray(file.declarationBindings) || file.declarationBindings.length > 100_000 ||
        (file.diagnostics.length !== 0 && file.declarationBindings.length !== 0)) reject("invalid declaration inventory")
      let previousEnd = 0
      for (const value of file.declarationBindings) {
        const item = record(value, "declaration binding", ["kind", "span", "name", "nameSpan"])
        if ((item.kind !== "variable" && item.kind !== "function") ||
          (item.name !== null && (!wireString(item.name) || item.name === ""))) reject("invalid declaration binding identity")
        const span = record(item.span, "declaration span", ["start", "length"])
        if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.length) || (span.start as number) < previousEnd ||
          (span.length as number) < 1 || (span.start as number) + (span.length as number) > source.text.length) reject("declaration span escapes or overlaps its source")
        previousEnd = (span.start as number) + (span.length as number)
        if (item.nameSpan === null) {
          if (item.kind !== "function" || item.name !== null) reject("only anonymous functions omit a name span")
        } else {
          const name = record(item.nameSpan, "declaration name span", ["start", "length"])
          if (!Number.isSafeInteger(name.start) || !Number.isSafeInteger(name.length) || (name.start as number) < (span.start as number) ||
            (name.length as number) < 1 || (name.start as number) + (name.length as number) > previousEnd ||
            (item.kind === "function" && item.name === null)) reject("declaration name escapes its declaration")
        }
      }
    } else if (file.declarationBindings !== undefined) reject("unrequested declaration inventory")
    for (const value of file.moduleSyntax) {
      const item = record(value, "module syntax", ["kind", "span", "topLevel"], ["specifier", "specifierSpan", "specifierKind"])
      if (!["import-declaration", "import-equals", "module-re-export", "import-type", "import-meta", "dynamic-import",
        "require", "require-resolve", "module-url"].includes(item.kind as string) ||
        typeof item.topLevel !== "boolean" ||
        (item.topLevel && !["import-declaration", "import-equals", "module-re-export"].includes(item.kind as string)) ||
        (item.specifier !== undefined && !wireString(item.specifier))) reject("invalid native module syntax")
      const span = record(item.span, "module syntax span", ["start", "length"])
      if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.length) ||
        (span.start as number) < 0 || (span.length as number) < 0 ||
        (span.start as number) + (span.length as number) > source.text.length) reject("module syntax escapes its source")
      if (item.specifier === undefined) {
        if (item.specifierSpan !== undefined || item.specifierKind !== undefined) reject("nonliteral module use claimed literal facts")
      } else {
        if (item.specifierKind !== "string" && item.specifierKind !== "template") reject("invalid module literal kind")
        const literal = record(item.specifierSpan, "module literal span", ["start", "length"])
        if (!Number.isSafeInteger(literal.start) || !Number.isSafeInteger(literal.length) || (literal.length as number) < 0 ||
          (literal.start as number) < (span.start as number) || (literal.start as number) > (span.start as number) + (span.length as number) ||
          (literal.length as number) > (span.start as number) + (span.length as number) - (literal.start as number)) reject("module literal escapes its module use")
      }
    }
    if (source.scriptKind === "json") {
      if (!Array.isArray(file.jsonDuplicateKeys) || file.moduleSyntax.length !== 0) reject("JSON inspection must return key spans, not module syntax")
      const seen = new Set<number>()
      for (const value of file.jsonDuplicateKeys) {
        const span = record(value, "duplicate JSON key", ["start", "length"])
        if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.length) || (span.start as number) < 0 ||
          (span.length as number) < 2 || (span.start as number)+(span.length as number) > source.text.length ||
          seen.has(span.start as number)) reject("duplicate JSON key span escapes its source or repeats a token")
        seen.add(span.start as number)
      }
    } else if (file.jsonDuplicateKeys !== undefined) reject("non-JSON inspection claimed JSON key facts")
  }
  return result as unknown as NativeInspectionResult
}

export function decodeNativeFormat(text: string, revision: string, source: string): NativeFormatResult {
  const result = record(decodeEnvelope(text, revision).result, "native format", ["ok", "code", "changed", "diagnostics"])
  if (typeof result.ok !== "boolean" || !wireString(result.code) || typeof result.changed !== "boolean" || !Array.isArray(result.diagnostics) ||
    result.changed !== (result.code !== source) ||
    (!result.ok && (result.code !== source || result.diagnostics.length === 0)) ||
    (result.ok && result.diagnostics.length !== 0)) reject("inconsistent native format result")
  for (const value of result.diagnostics) {
    const item = record(value, "format diagnostic", ["severity", "code", "message", "start", "line", "column"])
    if (item.severity !== "error" || !["VIBE1900", "VIBE1901", "VIBE1902"].includes(item.code as string) || !wireString(item.message) ||
      !Number.isSafeInteger(item.start) || (item.start as number) < 0 || (item.start as number) > source.length ||
      !Number.isSafeInteger(item.line) || (item.line as number) < 1 ||
      !Number.isSafeInteger(item.column) || (item.column as number) < 1) reject("invalid native format diagnostic")
  }
  return result as unknown as NativeFormatResult
}

export function decodeNativeToken(text: string, revision: string, request: NativeTokenRequest): NativeTokenResult {
  const result = record(decodeEnvelope(text, revision).result, "native token lookup", ["token"])
  if (result.token === null) return { token: null }
  const token = record(result.token, "source token", ["kind", "text", "start", "end"])
  if (typeof token.kind !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(token.kind) || !wireString(token.text) ||
    !Number.isSafeInteger(token.start) || !Number.isSafeInteger(token.end) ||
    (token.start as number) < 0 || (token.start as number) >= (token.end as number) || (token.end as number) > request.text.length ||
    (token.start as number) > request.offset || (token.end as number) < request.offset ||
    request.text.slice(token.start as number, token.end as number) !== token.text) reject("native token does not match its authored source and offset")
  return result as unknown as NativeTokenResult
}

export function decodeNativeLoaderRegistration(text: string, revision: string, request: NativeLoaderRegistrationRequest): NativeLoaderRegistrationResult {
  const result = record(decodeEnvelope(text, revision).result, "native loader registration", ["candidate", "ok", "identified", "diagnostics"], ["registration"])
  if (typeof result.candidate !== "boolean" || typeof result.ok !== "boolean" || typeof result.identified !== "boolean" ||
    !Array.isArray(result.diagnostics) || result.ok !== (result.diagnostics.length === 0) ||
    (request.mode === "discover" && (!result.ok || result.identified || result.registration !== undefined)) ||
    (request.mode === "recognize" && result.ok && result.registration === undefined)) reject("inconsistent native loader registration")
  const lines = request.source.split(/\r\n|[\n\r\u2028\u2029]/)
  const located = (item: Record<string, unknown>): void => {
    if (item.fileName !== request.fileName || !Number.isSafeInteger(item.line) || !Number.isSafeInteger(item.column) ||
      (item.line as number) < 1 || (item.line as number) > lines.length ||
      (item.column as number) < 1 || (item.column as number) > lines[(item.line as number) - 1]!.length + 1) {
      reject("native loader position escapes its authored source")
    }
  }
  for (const value of result.diagnostics) {
    const item = record(value, "loader diagnostic", ["code", "severity", "message", "fileName", "line", "column"])
    if (typeof item.code !== "string" || !/^VCT130[0-9]$/.test(item.code) || item.severity !== "error" || !wireString(item.message)) {
      reject("invalid native loader diagnostic")
    }
    located(item)
  }
  if (result.registration !== undefined) {
    const item = record(result.registration, "loader registration", ["fileName", "type", "sandboxSource", "line", "column"])
    if (!result.ok || !result.identified || typeof item.type !== "string" || !/^[a-z][a-z0-9-]*$/.test(item.type) ||
      !wireString(item.sandboxSource)) reject("invalid native loader registration")
    located(item)
  }
  return result as unknown as NativeLoaderRegistrationResult
}

export function decodeNativeAssetOutput(text: string, revision: string, request: NativeAssetOutputRequest): NativeAssetOutputResult {
  const result = record(decodeEnvelope(text, revision).result, "native asset output", ["ok", "message", "references"])
  if (typeof result.ok !== "boolean" || !wireString(result.message) || !Array.isArray(result.references) ||
    result.ok !== (result.message === "") || (!result.ok && result.references.length !== 0)) reject("inconsistent native asset-output validation")
  const declared = new Set(request.declaredLogicalKeys)
  let previous = ""
  for (const key of result.references) {
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key) || !declared.has(key) || key <= previous) {
      reject("native asset output returned an undeclared, unsorted or duplicate dependency key")
    }
    previous = key
  }
  return result as unknown as NativeAssetOutputResult
}

export function decodeNativeAssetImports(text: string, revision: string, request: NativeAssetImportsRequest): NativeAssetImportsResult {
  const result = record(decodeEnvelope(text, revision).result, "native asset imports", ["files"])
  if (!Array.isArray(result.files) || result.files.length !== request.files.length) reject("native asset imports returned a different source set")
  const specifier = (value: unknown): value is string => wireString(value) && value.startsWith(".") && !value.includes("\0")
  for (let index = 0; index < request.files.length; index++) {
    const source = request.files[index]!
    const file = record(result.files[index], "asset import source", ["path", "requests", "ordinaryImports", "diagnostics"])
    if (file.path !== source.path || !Array.isArray(file.requests) || !Array.isArray(file.ordinaryImports) || !Array.isArray(file.diagnostics) ||
      (file.diagnostics.length !== 0 && (file.requests.length !== 0 || file.ordinaryImports.length !== 0))) reject("inconsistent native asset import collections")
    const lines = source.text.split(/\r\n|[\n\r\u2028\u2029]/)
    const starts = [0]
    for (const match of source.text.matchAll(/\r\n|[\n\r\u2028\u2029]/g)) starts.push(match.index + match[0].length)
    const offsetAt = (item: Record<string, unknown>): number => {
      if (!Number.isSafeInteger(item.line) || !Number.isSafeInteger(item.column) ||
        (item.line as number) < 1 || (item.line as number) > lines.length ||
        (item.column as number) < 1 || (item.column as number) > lines[(item.line as number)-1]!.length + 1) {
        reject("native asset import position escapes its authored source")
      }
      return starts[(item.line as number)-1]! + (item.column as number)-1
    }
    const position = (value: unknown): number => {
      const item = record(value, "asset import position", ["start", "line", "column"])
      const offset = offsetAt(item)
      if (item.start !== offset) reject("native asset import offset disagrees with its authored line and column")
      return offset
    }
    let previous = -1
    for (const value of file.requests) {
      const item = record(value, "asset import", ["specifier", "attributes", "form", "site", "specifierSite"])
      if (!specifier(item.specifier) || !["import", "re-export", "dynamic-import"].includes(item.form as string)) reject("invalid native asset import")
      const start = position(item.site)
      if (start <= previous || position(item.specifierSite) < start) reject("native asset imports are not in authored order")
      previous = start
      if (!item.attributes || typeof item.attributes !== "object" || Array.isArray(item.attributes)) reject("invalid native asset attributes")
      const attributes = item.attributes as Record<string, unknown>
      if (!Object.hasOwn(attributes, "type") || !wireString(attributes.type) || attributes.type.trim() === "" ||
        Object.entries(attributes).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9-]*$/.test(key) || !wireString(value))) reject("invalid native asset attribute selection")
    }
    let prior = ""
    for (const value of file.ordinaryImports) {
      const item = record(value, "ordinary asset-preflight edge", ["specifier"], ["resolvedPath"])
      if (!specifier(item.specifier) || item.specifier <= prior) reject("ordinary asset-preflight edges must be sorted and unique")
      prior = item.specifier
      if (item.resolvedPath !== undefined && (request.resolutionRoot === undefined ||
        !wireString(item.resolvedPath) || item.resolvedPath.includes("\\") || item.resolvedPath.includes(":") || item.resolvedPath.includes("\0") ||
        item.resolvedPath.split("/").some((part) => part === "" || part === "." || part === ".."))) reject("asset-preflight resolution escaped its explicit project root")
    }
    for (const value of file.diagnostics) {
      const item = record(value, "asset import diagnostic", ["code", "severity", "message", "fileName", "line", "column"])
      if (item.fileName !== source.path || typeof item.code !== "string" || !/^(?:TS[0-9]+|VIBE100[01]|VIBE1717|VIBE52[0-9]{2})$/.test(item.code) ||
        item.severity !== "error" || !wireString(item.message)) reject("invalid native asset import diagnostic")
      offsetAt(item)
    }
  }
  return result as unknown as NativeAssetImportsResult
}

export function decodeNativeTranspile(text: string, revision: string, request: NativeTranspileRequest): NativeTranspileResult {
  const result = record(decodeEnvelope(text, revision).result, "native transpilation", ["files"])
  if (!Array.isArray(result.files) || result.files.length !== request.files.length) reject("native transpilation returned a different source set")
  for (let index = 0; index < request.files.length; index++) {
    const source = request.files[index]!
    const file = record(result.files[index], "transpiled source", ["path", "emitSkipped", "javascript", "sourceMap", "diagnostics"])
    if (file.path !== source.path || typeof file.emitSkipped !== "boolean" || !wireString(file.javascript) || !wireString(file.sourceMap) ||
      !Array.isArray(file.diagnostics)) reject("malformed native transpilation")
    validateDiagnostics(file.diagnostics)
    if (file.emitSkipped !== file.diagnostics.some((item: NativeDiagnostic) => item.category === "error") ||
      (file.emitSkipped && (file.javascript !== "" || file.sourceMap !== ""))) reject("refused native transpilation returned partial output")
    for (const item of file.diagnostics as NativeDiagnostic[]) {
      if ((item.file !== undefined && item.file !== source.path) ||
        (item.span !== undefined && item.span.start + item.span.length > source.text.length) ||
        (item.phase !== "parse" && item.phase !== "emit")) reject("native transpilation diagnostic escaped its source or claimed type checking")
    }
    if (file.sourceMap !== "") {
      let map: unknown
      try { map = JSON.parse(file.sourceMap) } catch { return reject("native transpilation returned an invalid source map") }
      if (!map || typeof map !== "object" || !("version" in map) || map.version !== 3) reject("native transpilation returned an invalid source map")
    }
  }
  return result as unknown as NativeTranspileResult
}

export function decodeNativeBundleModules(text: string, revision: string, request: NativeBundleModulesRequest): NativeBundleModulesResult {
  const result = record(decodeEnvelope(text, revision).result, "native bundle modules", ["diagnostics", "registrations"])
  if (!Array.isArray(result.diagnostics) || !Array.isArray(result.registrations) ||
    (result.diagnostics.length !== 0 && result.registrations.length !== 0)) reject("refused bundle analysis returned partial registrations")
  const paths = new Set(request.files.map(file => file.path))
  for (const value of result.diagnostics) {
    const item = record(value, "bundle module diagnostic", ["path", "message"])
    if (!wireString(item.path) || !paths.has(item.path) || !wireString(item.message) || item.message === "") reject("invalid native bundle module diagnostic")
  }
  const classes = new Set<string>()
  for (const value of result.registrations) {
    const item = record(value, "bundle registration", ["path", "className", "identity"])
    if (!wireString(item.path) || !paths.has(item.path) || !wireString(item.className) || item.className === "" ||
      classes.has(item.className) || !wireString(item.identity)) reject("invalid or ambiguous native bundle registration")
    classes.add(item.className)
  }
  return result as unknown as NativeBundleModulesResult
}

export function decodeNativeCanonicalFunction(text: string, revision: string): NativeCanonicalFunctionResult {
  const result = record(decodeEnvelope(text, revision).result, "native canonical function", ["ok", "code", "message"])
  if (typeof result.ok !== "boolean" || !wireString(result.code) || !wireString(result.message) ||
    result.ok !== (result.message === "") || result.ok !== (result.code !== "")) reject("native canonical function returned inconsistent output")
  return result as unknown as NativeCanonicalFunctionResult
}

export function decodeNativeDurableModule(text: string, revision: string, source: string): NativeDurableModuleResult {
  const result = record(decodeEnvelope(text, revision).result, "native durable module", ["diagnostics", "imports", "calls", "removals"])
  if (!Array.isArray(result.diagnostics) || !Array.isArray(result.imports) || !Array.isArray(result.calls) || !Array.isArray(result.removals) ||
    (result.diagnostics.length !== 0 && result.imports.length + result.calls.length + result.removals.length !== 0) ||
    (result.calls.length !== 1 && result.removals.length !== 0)) reject("native durable module returned partial rewrite facts")
  validateDiagnostics(result.diagnostics)
  for (const value of result.diagnostics) {
    const diagnostic = value as NativeDiagnostic
    if (diagnostic.file !== "durable-module.vibe" || !["parse", "bind"].includes(diagnostic.phase ?? "") ||
      (diagnostic.span !== undefined && diagnostic.span.start + diagnostic.span.length > source.length)) reject("durable module diagnostic escapes its source or phase")
  }
  for (const [name, values] of [["imports", result.imports], ["calls", result.calls], ["removals", result.removals]] as const) {
    if (values.length > 100_000) reject("durable module spans exceed their budget")
    let previous = -1
    for (const value of values) {
      const item = record(value, "durable module span", ["start", "length"])
      if (!Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.length) || (item.start as number) < 0 ||
        (item.length as number) < 1 || (item.start as number) + (item.length as number) > source.length ||
        (item.start as number) <= previous) reject("durable module spans escape their source or order")
      // Nested calls may overlap; rewrite removals and imports cannot.
      previous = name === "calls" ? item.start as number : (item.start as number) + (item.length as number) - 1
    }
  }
  const edits = [...result.imports, ...result.removals, ...(result.calls.length === 1 ? result.calls : [])] as { start: number; length: number }[]
  edits.sort((left, right) => left.start - right.start)
  let end = 0
  for (const item of edits) {
    if (item.start < end) reject("durable module rewrite ranges overlap")
    end = item.start + item.length
  }
  return result as unknown as NativeDurableModuleResult
}

export function decodeNativeSyntaxSchema(text: string, revision: string): NativeSyntaxSchemaResult {
  const result = record(decodeEnvelope(text, revision).result, "native syntax schema", ["ok", "schemaJson", "message", "parseError"])
  if (typeof result.ok !== "boolean" || !wireString(result.schemaJson) || !wireString(result.message) || typeof result.parseError !== "boolean" ||
    result.ok !== (result.schemaJson !== "") || result.ok !== (result.message === "") || (result.ok && result.parseError) ||
    result.schemaJson.length > 16 * 1024 * 1024) reject("native syntax schema returned inconsistent output")
  if (result.ok) {
    let schema: unknown
    try { schema = JSON.parse(result.schemaJson) } catch { reject("native syntax schema returned invalid JSON") }
    let nodes = 0
    const visit = (value: unknown, depth: number): void => {
      if (++nodes > 10_000 || depth > 128) reject("native syntax schema exceeds its node/depth budget")
      const node = record(value, "syntax schema node", ["kind"], ["value", "element", "elements", "variants", "properties"])
      switch (node.kind) {
        case "string": case "number": case "boolean": case "null": case "unknown":
          record(value, "primitive syntax schema", ["kind"]); break
        case "literal":
          record(value, "literal syntax schema", ["kind", "value"])
          // JSON data may contain any JS UTF-16 string, including escaped lone
          // surrogates. It is not scalar source/identity text from the wire.
          if (typeof node.value !== "string" && typeof node.value !== "boolean" &&
            !(typeof node.value === "number" && Number.isFinite(node.value) && !Object.is(node.value, -0))) reject("invalid syntax schema literal")
          break
        case "array":
          record(value, "array syntax schema", ["kind", "element"]); visit(node.element, depth + 1); break
        case "tuple": case "union": {
          const key = node.kind === "tuple" ? "elements" : "variants"
          record(value, "compound syntax schema", ["kind", key])
          const items = node[key]
          if (!Array.isArray(items) || items.length > 10_000 || (node.kind === "union" && items.length < 2)) reject("invalid compound syntax schema")
          for (const item of items) visit(item, depth + 1)
          break
        }
        case "object": {
          record(value, "object syntax schema", ["kind", "properties"])
          if (typeof node.properties !== "object" || node.properties === null || Array.isArray(node.properties)) reject("invalid syntax schema properties")
          const properties = Object.values(node.properties)
          if (properties.length > 10_000) reject("syntax schema properties exceed their budget")
          for (const property of properties) {
            const item = record(property, "syntax schema property", ["optional", "schema"])
            if (typeof item.optional !== "boolean") reject("invalid syntax schema optionality")
            visit(item.schema, depth + 1)
          }
          break
        }
        default: reject("unsupported native syntax schema kind")
      }
    }
    visit(schema, 0)
  }
  return result as unknown as NativeSyntaxSchemaResult
}

export function decodeNativeCheckedSchemas(text: string, revision: string, request: NativeCheckedSchemasRequest): NativeCheckedSchemasResult {
  const result = record(decodeEnvelope(text, revision).result, "native checked schemas", ["schemas"])
  if (!Array.isArray(result.schemas) || result.schemas.length !== request.queries.length || result.schemas.length > 512) reject("checked-schema query count mismatch")
  for (const value of result.schemas) {
    const schema = record(value, "native checked schema", ["ok", "schemaJson", "failure", "message"])
    if (typeof schema.ok !== "boolean" || !wireString(schema.schemaJson) || !wireString(schema.message) ||
      schema.schemaJson.length > 2*1024*1024 || schema.ok !== (schema.schemaJson !== "") || schema.ok !== (schema.message === "") ||
      (schema.ok ? schema.failure !== "" : schema.failure !== "unsupported" && schema.failure !== "budget")) reject("inconsistent checked-schema result")
    if (!schema.ok) continue
    let descriptor: unknown
    try { descriptor = JSON.parse(schema.schemaJson) } catch { reject("invalid checked-schema descriptor JSON") }
    let nodes = 0
    const visit = (value: unknown, depth: number): void => {
      if (++nodes > 512 || depth > 16) reject("checked-schema descriptor exceeds its node/depth budget")
      const node = record(value, "checked schema node", ["kind"], ["value", "element", "elements", "variants", "properties"])
      switch (node.kind) {
        case "string": case "number": case "boolean": case "null":
          record(value, "primitive checked schema", ["kind"]); break
        case "literal":
          record(value, "literal checked schema", ["kind", "value"])
          if (!wireString(node.value) && typeof node.value !== "boolean" &&
            !(typeof node.value === "number" && Number.isFinite(node.value) && !Object.is(node.value, -0))) reject("invalid checked-schema literal")
          break
        case "array":
          record(value, "array checked schema", ["kind", "element"]); visit(node.element, depth + 1); break
        case "tuple": case "union": {
          const key = node.kind === "tuple" ? "elements" : "variants"
          record(value, "compound checked schema", ["kind", key])
          const items = node[key]
          if (!Array.isArray(items) || items.length > 64 || (node.kind === "union" && items.length < 2)) reject("invalid compound checked schema")
          for (const item of items) visit(item, depth + 1)
          break
        }
        case "object": {
          record(value, "object checked schema", ["kind", "properties"])
          if (!Array.isArray(node.properties) || node.properties.length > 128) reject("invalid checked-schema properties")
          let previous: string | undefined
          for (const property of node.properties) {
            const item = record(property, "checked schema property", ["name", "optional", "value"])
            if (!wireString(item.name) || typeof item.optional !== "boolean" || (previous !== undefined && previous >= item.name)) reject("invalid checked-schema property identity/order")
            previous = item.name
            visit(item.value, depth + 1)
          }
          break
        }
        default: reject("unsupported checked-schema kind")
      }
    }
    visit(descriptor, 0)
  }
  return result as unknown as NativeCheckedSchemasResult
}

export function decodeNativeComptimePlan(text: string, revision: string, request: NativeComptimePlanRequest): NativeComptimePlanResult {
  const result=record(decodeEnvelope(text,revision).result,"comptime phase plan",["complete","diagnostics","reads","calls","edits"])
  if(typeof result.complete!=="boolean"||!Array.isArray(result.diagnostics)||!Array.isArray(result.reads)||!Array.isArray(result.calls)||!Array.isArray(result.edits)||
    result.complete!==(result.diagnostics.length===0&&result.reads.length===0)||(!result.complete&&(result.calls.length!==0||result.edits.length!==0))) reject("invalid or partial comptime phase plan")
  const sources=new Map(request.files.map(file=>[file.path,file.text]))
  const integer=(value:unknown,max:number):value is number=>Number.isSafeInteger(value)&&(value as number)>=0&&(value as number)<=max
  const range=(value:unknown):NativeComptimePlanRange=>{
    const at=record(value,"comptime authored range",["file","span"])
    if(!wireString(at.file)||!sources.has(at.file)) reject("comptime range names a foreign source")
    const span=record(at.span,"comptime authored span",["start","length"]),source=sources.get(at.file)!
    if(!integer(span.length,source.length)||!integer(span.start,source.length-span.length)) reject("comptime range escapes its authored source")
    return at as unknown as NativeComptimePlanRange
  }
  const compare=(a:NativeComptimePlanRange,b:NativeComptimePlanRange):number=>a.file<b.file?-1:a.file>b.file?1:a.span.start-b.span.start||a.span.length-b.span.length
  const origins=(value:unknown):void=>{
    if(!Array.isArray(value)||value.length===0) reject("missing comptime source observations")
    let previous:NativeComptimePlanRange|undefined
    for(const item of value){const at=range(item);if(previous&&compare(previous,at)>=0) reject("duplicate or unordered comptime source observations");previous=at}
  }
  for(const value of result.diagnostics){
    const item=record(value,"comptime diagnostic",["at","code","message"]);range(item.at)
    if(typeof item.code!=="string"||!/^VCT(?:10(?:0[0-9]|1[0-3])|120[0-7])$/.test(item.code)||!wireString(item.message)||!item.message) reject("invalid comptime diagnostic identity/message")
  }
  const readKeys=new Set<string>()
  for(const value of result.reads){
    const item=record(value,"comptime tracked read",["at","specifier"]),at=range(item.at)
    if(!wireString(item.specifier)||item.specifier===""||item.specifier.length>16*1024||item.specifier.includes("\0")||at.span.length===0) reject("invalid comptime tracked read")
    const key=JSON.stringify([at.file,at.span.start,at.span.length,item.specifier]);if(readKeys.has(key)) reject("duplicate comptime tracked read");readKeys.add(key)
    if(request.inputs.some(input=>input.file===at.file&&input.specifier===item.specifier)) reject("comptime requested an already supplied input")
  }
  let previous:NativeComptimePlanRange|undefined,bytes=0
  for(const value of result.calls){
    const item=record(value,"comptime evaluated call",["at","argument","mappedOrigin","origins","inputs","valueJson","schemaType"])
    const at=range(item.at),argument=range(item.argument);range(item.mappedOrigin);origins(item.origins)
    if(at.span.length===0||argument.span.length===0||argument.file!==at.file||argument.span.start<at.span.start||argument.span.start+argument.span.length>at.span.start+at.span.length||
      (previous&&compare(previous,at)>=0)||!Array.isArray(item.inputs)||!wireString(item.valueJson)||Buffer.byteLength(item.valueJson,"utf8")>8*1024*1024||!wireString(item.schemaType)) reject("invalid comptime evaluated-call shape")
    previous=at
    bytes+=Buffer.byteLength(item.valueJson,"utf8");if(bytes>16*1024*1024) reject("comptime values exceed the batch output budget")
    let inputIndex=-1
    for(const index of item.inputs){if(!integer(index,request.inputs.length-1)||index<=inputIndex||request.inputs[index]!.error!=="") reject("invalid comptime input receipt");inputIndex=index}
    try{decodeComptimeValue(JSON.parse(item.valueJson))}catch{reject("invalid ordered comptime value graph")}
  }
  previous=undefined
  for(const value of result.edits){
    const item=record(value,"comptime replacement",["at","kind","text","mappedOrigin","origins"]),at=range(item.at)
    range(item.mappedOrigin);origins(item.origins)
    if(!["remove-import","function-marker","intrinsic-call","schema-runtime-import","type-alias"].includes(item.kind as string)||!wireString(item.text)||
      (previous&&(compare(previous,at)>0||(previous.file===at.file&&previous.span.start+previous.span.length>at.span.start)))) reject("invalid or overlapping comptime replacements")
    if((item.kind==="remove-import"||item.kind==="function-marker")&&(item.text!==""||at.span.length===0)) reject("invalid comptime erasure")
    if(item.kind==="schema-runtime-import"&&(at.span.start!==0||at.span.length!==0)) reject("invalid comptime generated module edge")
    bytes+=Buffer.byteLength(item.text,"utf8");if(bytes>32*1024*1024) reject("comptime replacements exceed the batch output budget")
    previous=at
  }
  return result as unknown as NativeComptimePlanResult
}

export function decodeNativeSourceRecovery(text: string, revision: string, source: string): NativeSourceRecoveryResult {
  const result=record(decodeEnvelope(text,revision).result,"source recovery",["code","changed","identityFallback","diagnostics","rejectedStarts","verbatim","glue","tokens"])
  if(!wireString(result.code)||result.code.length>4*1024*1024+65536||typeof result.changed!=="boolean"||result.changed!==(result.code!==source)||
    typeof result.identityFallback!=="boolean"||!Array.isArray(result.diagnostics)||!Array.isArray(result.rejectedStarts)||
    !Array.isArray(result.verbatim)||!Array.isArray(result.glue)||!Array.isArray(result.tokens)||result.tokens.length>1_000_000) reject("invalid source recovery envelope")
  const code=result.code
  const integer=(v:unknown,max:number):v is number=>Number.isSafeInteger(v)&&(v as number)>=0&&(v as number)<=max
  const ranges:{start:number;end:number}[]=[]
  let previous=-1
  for(const value of result.verbatim){
    const run=record(value,"recovery verbatim run",["derivedStart","authoredStart","length"])
    if(!integer(run.length,source.length)||!integer(run.authoredStart,source.length-run.length)||!integer(run.derivedStart,code.length-run.length)||
      run.derivedStart<previous||source.slice(run.authoredStart,run.authoredStart+run.length)!==code.slice(run.derivedStart,run.derivedStart+run.length)) reject("invalid or altered recovery verbatim run")
    previous=run.derivedStart+run.length
    ranges.push({start:run.derivedStart,end:previous})
  }
  previous=-1
  for(const value of result.glue){
    const run=record(value,"recovery glue run",["derivedStart","length","anchor"])
    if(!integer(run.length,code.length)||run.length===0||!integer(run.derivedStart,code.length-run.length)||!integer(run.anchor,source.length)||run.derivedStart<previous) reject("invalid recovery glue run")
    previous=run.derivedStart+run.length
    ranges.push({start:run.derivedStart,end:previous})
  }
  ranges.sort((a,b)=>a.start-b.start||a.end-b.end)
  let covered=0
  for(const range of ranges){if(range.start!==covered) reject("recovery mapping overlaps or has gaps");covered=range.end}
  if(covered!==code.length) reject("recovery mapping is incomplete")
  previous=-1
  for(const offset of result.rejectedStarts){if(!integer(offset,code.length)||offset<=previous) reject("invalid recovery rejection order");previous=offset}
  for(const value of result.diagnostics){
    const issue=record(value,"recovery diagnostic",["severity","code","message","start"])
    if(issue.severity!=="error"||issue.code!=="VIBE1717"||!wireString(issue.message)||issue.message===""||!integer(issue.start,source.length)) reject("invalid recovery diagnostic")
  }
  previous=0
  for(const value of result.tokens){
    const token=record(value,"recovery token",["kind","text","start","end","endsExpression"])
    if(!wireString(token.kind)||!/^[A-Za-z][A-Za-z0-9]*$/.test(token.kind)||!wireString(token.text)||
      !integer(token.start,source.length)||!integer(token.end,source.length)||token.start<previous||token.end<=token.start||
      token.text!==source.slice(token.start,token.end)||typeof token.endsExpression!=="boolean") reject("invalid recovery token span/spelling")
    previous=token.end
  }
  if(result.identityFallback&&(result.changed||result.diagnostics.length!==1||result.rejectedStarts.length!==0||result.glue.length!==0)) reject("invalid recovery identity fallback")
  return result as unknown as NativeSourceRecoveryResult
}

export function decodeNativeRuntimeFactory(text: string, revision: string): NativeRuntimeFactoryResult {
  const result = decodeNativeCanonicalFunction(text, revision)
  if (result.code.length > 4 * 1024 * 1024) reject("native runtime factory exceeds its source budget")
  return result
}

export function decodeNativeConfig(text: string, revision: string, request: NativeConfigRequest): NativeConfigResult {
  const result = record(decodeEnvelope(text, revision).result, "native configuration", ["diagnostics"])
  if (!Array.isArray(result.diagnostics) || result.diagnostics.length > 4096) reject("invalid native configuration diagnostics")
  validateDiagnostics(result.diagnostics)
  for (const issue of result.diagnostics as NativeDiagnostic[]) {
    if (issue.file !== request.path || issue.category !== "error" || issue.span === undefined ||
      issue.span.start > request.text.length || issue.span.length > request.text.length - issue.span.start ||
      (!/^VIBE600[1-3]$/.test(issue.code) && !/^TS[0-9]+$/.test(issue.code))) reject("invalid native configuration finding")
    if ((issue.code.startsWith("TS") && issue.phase !== "parse") ||
      (issue.code.startsWith("VIBE") && issue.phase !== undefined)) reject("invalid native configuration phase")
  }
  return result as unknown as NativeConfigResult
}

export function decodeNativeGeneratedProject(text: string, revision: string, request: NativeGeneratedProjectRequest): NativeGeneratedProjectResult {
  const result = record(decodeEnvelope(text, revision).result, "native generated project", ["diagnostics"], request.traceDependencies ? ["dependencies"] : [])
  validateDependencyTrace(result.dependencies, request.traceDependencies === true)
  if (request.traceDependencies && !request.diskDependencies &&
    ((result.dependencies as NativeDependencyTrace).files.length || (result.dependencies as NativeDependencyTrace).directories.length)) reject("closed generated project reported disk dependencies")
  validateGeneratedDiagnostics(result.diagnostics, request, ["parse", "bind", "check"])
  return result as unknown as NativeGeneratedProjectResult
}

export function decodeNativeBodyLowering(text: string, revision: string, request: NativeBodyLoweringRequest): NativeBodyLoweringResult {
  if (Buffer.byteLength(text, "utf8") > 48*1024*1024) reject("body lowering response exceeds its byte budget")
  const result = record(decodeEnvelope(text, revision).result, "native body lowering", ["ok", "reason", "diagnostics", "code", "sourceMap", "manifestJson",
    "entry", "entrySpan", "functionSpan", "async", "resumable", "derivedActions", "errors"])
  if (typeof result.ok !== "boolean" || typeof result.async !== "boolean" || typeof result.resumable !== "boolean" ||
    !["", "source", "entry", "boundary", "unsupported", "provenance"].includes(result.reason as string) || result.ok !== (result.reason === "") ||
    !Array.isArray(result.diagnostics) || result.diagnostics.length > 4096 || !Array.isArray(result.derivedActions) || result.derivedActions.length > 100_000 ||
    !Array.isArray(result.errors) || result.errors.length > 100_000) reject("invalid body lowering result")
  validateDiagnostics(result.diagnostics)
  for (const issue of result.diagnostics as NativeDiagnostic[]) {
    if (issue.file !== undefined && issue.file !== request.fileName) reject("body diagnostic names a different source")
    if (!["parse", "bind", "check", "lower"].includes(issue.phase as string)) reject("invalid body diagnostic phase")
    if (issue.span && (issue.span.start > request.source.length || issue.span.length > Math.max(1, request.source.length-issue.span.start))) reject("body diagnostic exceeds its source")
  }
  if (result.ok === (result.diagnostics as NativeDiagnostic[]).some(issue => issue.category === "error")) reject("body lowering completion disagrees with diagnostics")
  for (const key of ["code", "sourceMap", "manifestJson", "entry"] as const) {
    if (!wireString(result[key]) || result[key].length > (key === "entry" ? 2048 : key === "code" ? 8*1024*1024 : 16*1024*1024) ||
      result.ok !== (result[key] !== "")) reject("invalid body intermediate output")
  }
  const boundSpan = (value: unknown): void => {
    const where = record(value, "body source span", ["start", "length"])
    if (!Number.isSafeInteger(where.start) || !Number.isSafeInteger(where.length) || (where.start as number) < 0 || (where.length as number) < 1 ||
      (where.start as number) > request.source.length || (where.length as number) > request.source.length-(where.start as number)) reject("invalid body source span")
  }
  if (!result.ok) {
    if (result.entrySpan !== null || result.functionSpan !== null || result.async || result.resumable || result.derivedActions.length || result.errors.length) reject("refused body leaked partial artifacts")
    return result as unknown as NativeBodyLoweringResult
  }
  boundSpan(result.entrySpan); boundSpan(result.functionSpan)
  let parsed: unknown
  try { parsed = JSON.parse(result.sourceMap as string) } catch { reject("invalid body source map JSON") }
  const map = record(parsed, "body source map", ["version", "file", "sourceRoot", "sources", "sourcesContent", "names", "mappings"])
  if (map.version !== 3 || map.file !== request.outputFileName.split("/").at(-1) || map.sourceRoot !== "" ||
    JSON.stringify(map.sources) !== JSON.stringify([request.fileName]) || JSON.stringify(map.sourcesContent) !== JSON.stringify([request.source]) ||
    !Array.isArray(map.names) || map.names.some(name => !wireString(name)) || !wireString(map.mappings) || !/^[A-Za-z0-9+/;,]*$/.test(map.mappings)) reject("invalid body source map identity")
  validateSDKMappings(map.mappings, map.names.length, request.source, result.code as string)
  try { parsed = JSON.parse(result.manifestJson as string) } catch { reject("invalid body manifest JSON") }
  // Structural/digest validation is the durable artifact layer's job. This
  // boundary binds the native table to the requested source/Flow, not trust.
  const manifest = record(parsed, "body manifest", ["manifestVersion", "flowId", "flowVersion", "actions", "requirements", "contracts", "failures", "sites", "digest"])
  if (manifest.manifestVersion !== 1 || manifest.flowId !== (request.flowId || `${request.fileName}#${result.entry}`) || manifest.flowVersion !== request.flowVersion ||
    !wireString(manifest.digest) || !/^[a-f0-9]{64}$/.test(manifest.digest)) reject("invalid body manifest identity")
  for (const key of ["actions", "requirements", "contracts", "failures", "sites"]) if (!Array.isArray(manifest[key]) || manifest[key].length > 100_000) reject("invalid body manifest table")
  const names = new Set<string>()
  let end = 0
  for (const value of result.derivedActions) {
    const action = record(value, "body derived Action", ["name", "id", "start", "end"])
    if (!wireString(action.name) || !action.name || names.has(action.name) || action.id !== `${request.fileName}#${action.name}` ||
      !Number.isSafeInteger(action.start) || !Number.isSafeInteger(action.end) || (action.start as number) < end || (action.end as number) <= (action.start as number) ||
      (action.end as number) > request.source.length) reject("invalid body derived Action identity/span")
    names.add(action.name); end = action.end as number
  }
  let previous = ""
  for (const value of result.errors) {
    const error = record(value, "body Error identity", ["durable", "nominal"])
    if (!wireString(error.durable) || error.durable <= previous || error.durable.length > 4096 || !wireString(error.nominal) || !error.nominal || error.nominal.length > 4096) reject("invalid body Error identity")
    previous = error.durable
  }
  return result as unknown as NativeBodyLoweringResult
}

export function decodeNativeBodyContract(text: string, revision: string, request: NativeBodyContractRequest): NativeBodyContractResult {
  const result = record(decodeEnvelope(text, revision).result, "native body contract", ["ok", "diagnostics", "reason", "message", "schemasJson"])
  if (typeof result.ok !== "boolean" || !wireString(result.message) || result.message.length > 16 * 1024 ||
    !wireString(result.schemasJson) || result.schemasJson.length > 16 * 1024 * 1024 ||
    !["", "check", "entry", "boundary"].includes(result.reason as string) ||
    result.ok !== (result.reason === "") || result.ok !== (result.message === "") || result.ok !== (result.schemasJson !== "")) reject("inconsistent native body contract")
  validateGeneratedDiagnostics(result.diagnostics, request.project, ["parse", "bind", "check"])
  const hasErrors = (result.diagnostics as NativeDiagnostic[]).some(issue => issue.category === "error")
  if (hasErrors !== (result.reason === "check")) reject("inconsistent native body checking refusal")
  if (result.ok) {
    let value: unknown
    try { value = JSON.parse(result.schemasJson) } catch { reject("invalid native body schema JSON") }
    const schemas = record(value, "body schemas", ["inputSchema", "successSchema", "failureSchema"])
    let nodes = 0
    const bound = (item: unknown, depth: number): void => {
      if (++nodes > 100_000 || depth > 256) reject("native body schemas exceed their traversal budget")
      if (typeof item === "string" && !wellFormed(item)) reject("native body schemas contain non-scalar text")
      if (typeof item === "number" && (!Number.isFinite(item) || Object.is(item, -0))) reject("native body schemas contain a non-canonical number")
      if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) {
        if (!wellFormed(key)) reject("native body schemas contain a non-scalar key")
        bound(child, depth + 1)
      }
    }
    bound(value, 0)
    for (const [key, role] of [["inputSchema", "input"], ["successSchema", "success"], ["failureSchema", "error"]] as const) {
      const schema = record(schemas[key], "body schema", ["format", "schemaVersion", "role", "shape", "source", "descriptor", "digest"])
      if (schema.format !== "canonical-json" || schema.schemaVersion !== 1 || schema.role !== role || schema.shape !== "structural" ||
        schema.source !== "compiler-derived" || !wireString(schema.digest) || !/^[a-f0-9]{64}$/.test(schema.digest) ||
        !schema.descriptor || typeof schema.descriptor !== "object" || Array.isArray(schema.descriptor)) reject("invalid native body schema envelope")
    }
  }
  return result as unknown as NativeBodyContractResult
}

function validateGeneratedDiagnostics(diagnostics: unknown, request: NativeGeneratedProjectRequest, phases: readonly string[]): void {
  if (!Array.isArray(diagnostics) || diagnostics.length > 4096) reject("invalid generated-project diagnostics")
  validateDiagnostics(diagnostics)
  const sources = new Map(request.files.map(file => [file.path, file.text]))
  for (const issue of diagnostics as NativeDiagnostic[]) {
    if (!/^TS[0-9]+$/.test(issue.code) || !phases.includes(issue.phase ?? "")) reject("invalid generated-project phase/code")
    if (issue.file === undefined) {
      if (issue.span !== undefined) reject("global generated-project diagnostic has a source span")
    } else {
      const source = sources.get(issue.file)
      if (source === undefined || (issue.span !== undefined &&
        (issue.span.start > source.length || issue.span.length > source.length - issue.span.start))) reject("generated-project diagnostic escapes its roots")
    }
  }
}

export function decodeNativeDeclarationText(text: string, revision: string, request: NativeDeclarationTextRequest): NativeDeclarationTextResult {
  const result = record(decodeEnvelope(text, revision).result, "native declaration text", ["text", "effects"])
  if (!wireString(result.text) || result.text.length > 4 * 1024 * 1024 || !result.effects || typeof result.effects !== "object" || Array.isArray(result.effects)) reject("invalid declaration text result")
  const entries = Object.entries(result.effects)
  if (entries.length > 4096 || (request.operation === "read" ? result.text !== request.text : entries.length !== 0)) reject("inconsistent declaration text operation")
  for (const [name, value] of entries) {
    if (!wireString(name) || !name || name.length > 1024) reject("invalid declaration row name")
    const row = record(value, "declaration row", ["failures", "requirements"])
    for (const list of [row.failures, row.requirements]) {
      if (!Array.isArray(list) || list.length > 1024 || !list.every((name, index) => wireString(name) && name.length > 0 && name.length <= 1024 && (index === 0 || list[index - 1] < name))) reject("invalid declaration row names")
    }
  }
  return result as unknown as NativeDeclarationTextResult
}

export function nativeDeclarationOutputName(path: string): string {
  if (/\.d\.(?:ts|mts|cts)$/.test(path)) return path
  if (/\.(?:mts|mjs)$/.test(path)) return path.replace(/\.(?:mts|mjs)$/, ".d.mts")
  if (/\.(?:cts|cjs)$/.test(path)) return path.replace(/\.(?:cts|cjs)$/, ".d.cts")
  return path.replace(/\.(?:ts|js)$/, ".d.ts")
}

export function decodeNativeGeneratedDeclarations(text: string, revision: string, request: NativeGeneratedDeclarationsRequest): NativeGeneratedDeclarationsResult {
  const result = record(decodeEnvelope(text, revision).result, "native generated declarations", ["ok", "outputs", "diagnostics"])
  if (typeof result.ok !== "boolean" || !Array.isArray(result.outputs) || result.outputs.length > request.project.files.length) reject("invalid generated declaration result")
  validateGeneratedDiagnostics(result.diagnostics, request.project, ["parse", "bind", "check", "emit"])
  const expected = new Set(request.project.files.map(file => nativeDeclarationOutputName(file.path)))
  let size = 0
  for (const output of result.outputs) {
    const file = record(output, "generated declaration", ["path", "text"])
    if (!wireString(file.path) || !expected.delete(file.path) || !wireString(file.text) || file.text.length > 4 * 1024 * 1024) reject("invalid generated declaration output")
    size += file.text.length
  }
  if (size > 16 * 1024 * 1024 || (result.ok ? expected.size !== 0 || (result.diagnostics as NativeDiagnostic[]).some(issue => issue.category === "error") : result.outputs.length !== 0)) reject("inconsistent generated declaration completion")
  return result as unknown as NativeGeneratedDeclarationsResult
}

export function decodeNativeLanguageLowering(text: string, revision: string, request: NativeLanguageLoweringRequest): NativeLanguageLoweringResult {
  if (Buffer.byteLength(text, "utf8") > 64 * 1024 * 1024 + 1024) reject("language lowering response budget exceeded")
  const result = record(decodeEnvelope(text, revision).result, "native language lowering", ["ok", "analysis", "diagnostics", "files"])
  if (typeof result.ok !== "boolean" || !Array.isArray(result.diagnostics) || result.diagnostics.length > 4096 || !Array.isArray(result.files)) reject("invalid language lowering result")
  const analysis = decodeNativeLanguageAnalysis(JSON.stringify({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: result.analysis }), revision, request.project)
  validateDiagnostics(result.diagnostics)
  const sources = new Map(request.project.files.filter(file => file.kind === "vibelang").map(file => [file.path, file.text]))
  for (const issue of result.diagnostics as NativeDiagnostic[]) {
    if (!issue.file || !sources.has(issue.file) || issue.phase !== "lower" || !issue.span || issue.span.start > sources.get(issue.file)!.length ||
      issue.span.length > Math.max(1, sources.get(issue.file)!.length - issue.span.start)) reject("invalid language lowering diagnostic")
  }
  if (result.ok !== (analysis.checked && !(result.diagnostics as NativeDiagnostic[]).some(issue => issue.category === "error")) || (!result.ok && result.files.length !== 0)) reject("inconsistent language lowering completion")
  let previous = "", size = 0
  for (const item of result.files) {
    const file = record(item, "lowered file", ["path", "text", "sourceMap"])
    if (!wireString(file.path) || !sources.has(file.path) || file.path <= previous || !wireString(file.text) || !wireString(file.sourceMap) || Buffer.byteLength(file.text, "utf8") > 8*1024*1024) reject("invalid lowered source identity/budget")
    let parsed: unknown
    try { parsed = JSON.parse(file.sourceMap) } catch { reject("invalid lowered source map JSON") }
    const map = record(parsed, "lowered source map", ["version", "file", "sourceRoot", "sources", "sourcesContent", "names", "mappings"])
    const output = request.outputs?.find(output => output.path === file.path)
    const identity = output?.sourceName || file.path
    const outputName = output?.outputFileName ? output.outputFileName.split("/").at(-1) : file.path.split("/").at(-1) + ".ts"
    if (map.version !== 3 || map.file !== outputName || map.sourceRoot !== "" ||
      JSON.stringify(map.sources) !== JSON.stringify([identity]) || JSON.stringify(map.sourcesContent) !== JSON.stringify([sources.get(file.path)]) ||
      !Array.isArray(map.names) || map.names.some(name => !wireString(name)) || !wireString(map.mappings) || !/^[A-Za-z0-9+/;,]*$/.test(map.mappings)) reject("invalid lowered source map identity/fields")
    validateSDKMappings(map.mappings, map.names.length, sources.get(file.path)!, file.text)
    sources.delete(file.path)
    previous = file.path
    size += Buffer.byteLength(file.text, "utf8") + Buffer.byteLength(file.sourceMap, "utf8")
    if (size > 32*1024*1024) reject("language lowering output budget exceeded")
  }
  if (result.ok && sources.size !== 0) reject("language lowering omitted sources")
  return result as unknown as NativeLanguageLoweringResult
}

// Transport validation only. The Go printer owns generation and provenance;
// the host rejects malformed VLQ and coordinates outside the supplied bytes.
function validateSDKMappings(mappings: string, nameCount: number, source: string, generated: string): void {
  const widths = (text: string) => text.split(/\r\n|[\r\n\u2028\u2029]/).map(line => line.length)
  const sourceWidths = widths(source), generatedWidths = widths(generated)
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let offset = 0, generatedLine = 0, generatedColumn = 0, sourceIndex = 0, sourceLine = 0, sourceColumn = 0, nameIndex = 0
  while (offset < mappings.length) {
    if (mappings[offset] === ";") { offset++; generatedLine++; generatedColumn=0; continue }
    if (mappings[offset] === ",") { offset++; continue }
    const fields: number[] = []
    while (offset < mappings.length && mappings[offset] !== ";" && mappings[offset] !== ",") {
      let encoded = 0, shift = 0
      for (;;) {
        const digit = offset < mappings.length ? alphabet.indexOf(mappings[offset++]!) : -1
        if (digit < 0) reject("invalid lowered source map VLQ")
        encoded += (digit & 31) * 2 ** shift
        if (!(digit & 32)) break
        if ((shift += 5) > 30) reject("lowered source map VLQ overflow")
      }
      fields.push(Math.floor(encoded/2) * (encoded & 1 ? -1 : 1))
      if (fields.length > 5) reject("invalid lowered source map field count")
    }
    if (fields.length !== 1 && fields.length !== 4 && fields.length !== 5) reject("invalid lowered source map field count")
    generatedColumn += fields[0]!
    if (generatedLine >= generatedWidths.length || generatedColumn < 0 || generatedColumn > generatedWidths[generatedLine]!) reject("lowered source map escapes generated text")
    if (fields.length >= 4) {
      sourceIndex += fields[1]!; sourceLine += fields[2]!; sourceColumn += fields[3]!
      if (sourceIndex !== 0 || sourceLine < 0 || sourceLine >= sourceWidths.length || sourceColumn < 0 || sourceColumn > sourceWidths[sourceLine]!) reject("lowered source map escapes authored text")
      if (fields.length === 5) {
        nameIndex += fields[4]!
        if (nameIndex < 0 || nameIndex >= nameCount) reject("invalid lowered source map name index")
      }
    }
  }
}

export function decodeNativeLanguageAnalysis(text: string, revision: string, request: NativeLanguageAnalysisRequest): NativeLanguageAnalysisResult {
  if (Buffer.byteLength(text, "utf8") > 32 * 1024 * 1024 + 1024) reject("language analysis response budget exceeded")
  const result = record(decodeEnvelope(text, revision).result, "native language analysis", ["checked", "diagnostics", "files"], request.traceDependencies ? ["dependencies"] : [])
  validateDependencyTrace(result.dependencies, request.traceDependencies === true, request.resolutionRoot)
  if (request.traceDependencies && request.resolutionRoot === undefined &&
    ((result.dependencies as NativeDependencyTrace).files.length || (result.dependencies as NativeDependencyTrace).directories.length)) reject("closed language project reported disk dependencies")
  if (typeof result.checked !== "boolean" || !Array.isArray(result.diagnostics) || result.diagnostics.length > 4096 ||
    !Array.isArray(result.files)) reject("invalid language analysis result")
  validateDiagnostics(result.diagnostics)
  const sources = new Map(request.files.map(file => [file.path, file.text]))
  const expected = new Map(request.files.filter(file => file.kind === "vibelang").map(file => [file.path, file.text]))
  const integer = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max
  for (const issue of result.diagnostics as NativeDiagnostic[]) {
    if (result.checked && issue.category === "error") reject("language analysis checked a refused program")
    if (issue.file !== undefined && sources.has(issue.file) && issue.span !== undefined) {
      const source = sources.get(issue.file)!
      if (issue.span.start > source.length || issue.span.length > Math.max(1, source.length - issue.span.start)) reject("language analysis diagnostic exceeds its source")
    }
  }
  let previousPath = "", declarations = 0
  for (const item of result.files) {
    const file = record(item, "analyzed file", ["path", "analyzed", "errors", "functions"])
    if (!wireString(file.path) || !expected.has(file.path) || file.path <= previousPath || typeof file.analyzed !== "boolean" ||
      !Array.isArray(file.errors) || !Array.isArray(file.functions) || (!file.analyzed && file.errors.length + file.functions.length !== 0) ||
      (result.checked && !file.analyzed)) reject("invalid analyzed source identity/completion")
    previousPath = file.path
    const source = expected.get(file.path)!
    expected.delete(file.path)
    declarations += file.errors.length + file.functions.length
    if (declarations > 100_000) reject("language analysis declaration budget exceeded")
    let previousStart = -1
    for (const value of file.errors) {
      const error = record(value, "analyzed Error", ["name", "fieldsSource", "start", "end"])
      if (!wireString(error.name) || !error.name || !wireString(error.fieldsSource) || !integer(error.start, source.length) ||
        !integer(error.end, source.length) || error.end <= error.start || error.start <= previousStart ||
        !source.slice(error.start, error.end).includes(error.fieldsSource)) reject("invalid analyzed Error source span")
      previousStart = error.start
    }
    previousStart = -1
    for (const value of file.functions) {
      const fn = record(value, "analyzed function", ["name", "exported", "async", "channel", "explicitReturn", "start", "end", "bodyStart", "bodyEnd", "moduleScope", "failures", "requirements"])
      if (!wireString(fn.name) || !fn.name || fn.name.length > 16*1024 ||
        [fn.exported, fn.async, fn.explicitReturn, fn.moduleScope].some(value => typeof value !== "boolean") ||
        !["plain", "result"].includes(fn.channel as string) || !integer(fn.start, source.length) || !integer(fn.end, source.length) ||
        fn.start <= previousStart || fn.end <= fn.start || !integer(fn.bodyStart, fn.end) || !integer(fn.bodyEnd, fn.end) ||
        fn.bodyStart < fn.start || fn.bodyEnd < fn.bodyStart) reject("invalid analyzed function source span/flags")
      previousStart = fn.start
      for (const key of ["failures", "requirements"] as const) {
        const row = fn[key]
        if (!Array.isArray(row) || row.length > 10_000 || row.some(name => !wireString(name) || !name || name.length > 16*1024 || name.includes("\0")) ||
          JSON.stringify(row) !== JSON.stringify([...new Set(row)].sort())) reject("invalid analyzed function row")
      }
      if (fn.channel === "plain" && (fn.failures as unknown[]).length !== 0) reject("plain analyzed function has a failure row")
    }
  }
  if (expected.size !== 0) reject("language analysis omitted authored files")
  if (!result.checked && !(result.diagnostics as NativeDiagnostic[]).some(issue => issue.category === "error")) reject("unexplained language analysis refusal")
  return result as unknown as NativeLanguageAnalysisResult
}

export function decodeNativeCheckedFunction(text: string, revision: string, request: NativeCheckedFunctionRequest): NativeCheckedFunctionResult {
  const result = record(decodeEnvelope(text, revision).result, "native checked function", ["ok", "diagnostics", "message", "function"])
  if (typeof result.ok !== "boolean" || !wireString(result.message) || result.message.length > 16 * 1024 ||
    !Array.isArray(result.diagnostics) || result.diagnostics.length > 4096 ||
    result.ok !== (result.function !== null) || result.ok !== (result.message === "")) reject("inconsistent native checked function")
  validateDiagnostics(result.diagnostics)
  if (result.ok && (result.diagnostics as NativeDiagnostic[]).some(issue => issue.category === "error")) reject("invalid checked function proof with errors")
  const sourceByPath = new Map(request.files.map(file => [file.path, file.text]))
  for (const issue of result.diagnostics as NativeDiagnostic[]) {
    if (issue.file !== undefined && sourceByPath.has(issue.file) && issue.span !== undefined) {
      const source = sourceByPath.get(issue.file)!
      if (issue.span.start > source.length || issue.span.length > Math.max(1, source.length - issue.span.start)) reject("native checked function diagnostic exceeds its source")
    }
  }
  if (result.ok) {
    const fn = record(result.function, "checked function facts", ["file", "name", "span", "requirements", "typedFailures", "panic", "failureSchemaJson", "valueSchemasJson"])
    const source = sourceByPath.get(request.entryFile)
    if (source === undefined || fn.file !== request.entryFile || fn.name !== request.exportName || typeof fn.panic !== "boolean" ||
      !wireString(fn.failureSchemaJson) || fn.failureSchemaJson.length > 8 * 1024 * 1024 ||
      !wireString(fn.valueSchemasJson) || fn.valueSchemasJson.length > 16 * 1024 * 1024 ||
      Boolean(request.durableBoundary) !== (fn.valueSchemasJson !== "")) reject("invalid native checked function identity/schema")
    const span = record(fn.span, "checked function span", ["start", "length"])
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.length) || (span.start as number) < 0 ||
      (span.length as number) < 1 || (span.start as number) > source.length ||
      (span.length as number) > source.length - (span.start as number)) reject("invalid native checked function range")
    for (const name of ["requirements", "typedFailures"] as const) {
      const row = fn[name]
      if (!Array.isArray(row) || row.length > 10_000 || row.some(item => !wireString(item) || !item || item.length > 16*1024 || item.includes("\0")) ||
        JSON.stringify(row) !== JSON.stringify([...new Set(row)].sort())) reject("invalid native checked function row")
    }
    let nodes = 0
    const bound = (item: unknown, depth: number): void => {
      if (++nodes > 100_000 || depth > 256) reject("native checked function schema exceeds its traversal budget")
      if (typeof item === "string" && !wellFormed(item)) reject("native checked function schema contains non-scalar text")
      if (typeof item === "number" && (!Number.isFinite(item) || Object.is(item, -0))) reject("native checked function schema contains a non-canonical number")
      if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) {
        if (!wellFormed(key)) reject("native checked function schema contains a non-scalar key")
        bound(child, depth + 1)
      }
    }
    const checkSchema = (value: unknown, role: string): void => {
      const schema = record(value, "checked function schema", ["format", "schemaVersion", "role", "shape", "source", "descriptor", "digest"])
      if (schema.format !== "canonical-json" || schema.schemaVersion !== 1 || schema.role !== role || schema.shape !== "structural" ||
        schema.source !== "compiler-derived" || !wireString(schema.digest) || !/^[a-f0-9]{64}$/.test(schema.digest) ||
        !schema.descriptor || typeof schema.descriptor !== "object" || Array.isArray(schema.descriptor)) reject("invalid native checked function schema")
      bound(value, 0)
    }
    let failure: unknown
    try { failure = JSON.parse(fn.failureSchemaJson) } catch { reject("invalid native checked function failure schema JSON") }
    checkSchema(failure, "error")
    // Native schema publication uses JSON.stringify-compatible scalar spelling
    // and has no whitespace. Requiring a lossless round-trip also detects
    // duplicate fields before a decoded schema can be treated as evidence.
    if (JSON.stringify(failure) !== fn.failureSchemaJson) reject("native checked function failure schema is not lossless JSON")
    if (request.durableBoundary) {
      let value: unknown
      try { value = JSON.parse(fn.valueSchemasJson) } catch { reject("invalid native checked function value schemas JSON") }
      const schemas = record(value, "checked function value schemas", ["completion", "inputSchema", "successSchema"])
      if (schemas.completion !== "value" && schemas.completion !== "promise") reject("invalid native checked function completion convention")
      checkSchema(schemas.inputSchema, "input")
      checkSchema(schemas.successSchema, "success")
      if (JSON.stringify(value) !== fn.valueSchemasJson) reject("native checked function value schemas are not lossless JSON")
    }
  }
  return result as unknown as NativeCheckedFunctionResult
}

export function decodeNativeActionContract(text: string, revision: string, request: NativeActionContractRequest): NativeActionContractResult {
  const result = record(decodeEnvelope(text, revision).result, "native Action contract", ["ok", "diagnostics", "contractJson"])
  if (typeof result.ok !== "boolean" || !wireString(result.contractJson) || result.contractJson.length > 16 * 1024 * 1024 ||
    !Array.isArray(result.diagnostics) || result.diagnostics.length > 32 ||
    result.ok !== (result.contractJson !== "") || result.ok !== (result.diagnostics.length === 0)) reject("inconsistent native Action contract")
  validateDiagnostics(result.diagnostics)
  for (const diagnostic of result.diagnostics as NativeDiagnostic[]) {
    if (!/^VIBE420[0-3]$/.test(diagnostic.code) || diagnostic.category !== "error" || diagnostic.phase !== "check" ||
      diagnostic.file !== request.fileName || !diagnostic.span || diagnostic.span.length < 1 ||
      diagnostic.span.start > request.source.length || diagnostic.span.length > Math.max(1, request.source.length - diagnostic.span.start)) {
      reject("invalid native Action contract diagnostic")
    }
  }
  if (result.ok) {
    let value: unknown
    try { value = JSON.parse(result.contractJson) } catch { reject("invalid native Action contract JSON") }
    const contract = record(value, "Action descriptor", ["id", "version", "contractDigest", "inputSchema", "successSchema", "errorSchema"])
    if (contract.id !== request.id || contract.version !== request.version || !wireString(contract.contractDigest) ||
      !/^[a-f0-9]{64}$/.test(contract.contractDigest)) reject("native Action contract identity mismatch")
    let nodes = 0
    const bound = (item: unknown, depth: number): void => {
      if (++nodes > 100_000 || depth > 256) reject("native Action contract data exceeds its traversal budget")
      if (typeof item === "string" && !wellFormed(item)) reject("native Action contract contains non-scalar text")
      if (typeof item === "number" && (!Number.isFinite(item) || Object.is(item, -0))) reject("native Action contract contains a non-canonical number")
      if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) {
        if (!wellFormed(key)) reject("native Action contract contains a non-scalar key")
        bound(child, depth + 1)
      }
    }
    bound(contract, 0)
    for (const role of ["input", "success", "error"] as const) {
      const schema = record(contract[`${role}Schema`], "Action schema", ["format", "schemaVersion", "role", "shape", "source", "descriptor", "digest"])
      if (schema.format !== "canonical-json" || schema.schemaVersion !== 1 || schema.role !== role || schema.shape !== "structural" ||
        schema.source !== "compiler-derived" || !wireString(schema.digest) || !/^[a-f0-9]{64}$/.test(schema.digest) ||
        !schema.descriptor || typeof schema.descriptor !== "object" || Array.isArray(schema.descriptor)) reject("invalid native Action schema envelope")
    }
  }
  return result as unknown as NativeActionContractResult
}

export function decodeNativeRuntimeModules(text: string, revision: string, request: NativeRuntimeModulesRequest): NativeRuntimeModulesResult {
  const result = record(decodeEnvelope(text, revision).result, "native runtime modules", ["files"])
  if (!Array.isArray(result.files) || result.files.length !== request.files.length) reject("native runtime modules returned a different source set")
  const path = (value: unknown): value is string => wireString(value) && value !== "" && !/[\\:\0]/.test(value) &&
    value.split("/").every(part => part !== "" && part !== "." && part !== "..")
  for (let index = 0; index < request.files.length; index++) {
    const source = request.files[index]!
    const file = record(result.files[index], "runtime module", ["path", "edges", "leadingNoThrow", "firstStatement", "diagnostics", "parseDiagnostics", "resolutions"])
    if (file.path !== source.path || typeof file.leadingNoThrow !== "boolean" || !Array.isArray(file.edges) || !Array.isArray(file.diagnostics) ||
      !Array.isArray(file.parseDiagnostics) || !Array.isArray(file.resolutions) ||
      (file.diagnostics.length !== 0 && (file.edges.length !== 0 || file.resolutions.length !== 0 || file.leadingNoThrow))) reject("inconsistent native runtime module facts")
    const lines = source.text.split(/\r\n|[\n\r\u2028\u2029]/)
    const starts = [0]
    for (const match of source.text.matchAll(/\r\n|[\n\r\u2028\u2029]/g)) starts.push(match.index + match[0].length)
    const position = (item: Record<string, unknown>): void => {
      if (!Number.isSafeInteger(item.line) || !Number.isSafeInteger(item.column) || (item.line as number) < 1 ||
        (item.line as number) > lines.length || (item.column as number) < 1 ||
        (item.column as number) > lines[(item.line as number)-1]!.length+1 ||
        item.start !== starts[(item.line as number)-1]! + (item.column as number)-1) reject("native runtime position escaped its authored source")
    }
    position(record(file.firstStatement, "runtime first statement", ["start", "line", "column"]))
    for (const value of file.diagnostics) {
      const item = record(value, "runtime module diagnostic", ["start", "line", "column", "message"])
      position(item)
      if (!wireString(item.message) || item.message === "") reject("invalid native runtime diagnostic")
    }
    validateDiagnostics(file.parseDiagnostics)
    for (const item of file.parseDiagnostics as NativeDiagnostic[]) {
      if (item.file !== source.path || item.phase !== "parse" || item.span === undefined ||
        item.span.start+item.span.length > source.text.length) reject("native runtime parse diagnostic escaped its source or claimed checking")
    }
    let previous = -1
    const specifiers = new Set<string>()
    for (const value of file.edges) {
      const item = record(value, "runtime module edge", ["kind", "specifier", "start", "end", "typeOnly", "moduleInitialization", "attributes"])
      if (!["import", "export", "import-equals", "dynamic-import", "require"].includes(item.kind as string) ||
        !wireString(item.specifier) || item.specifier.includes("\0") || typeof item.typeOnly !== "boolean" || typeof item.moduleInitialization !== "boolean" ||
        typeof item.attributes !== "boolean" || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) ||
        (item.start as number) < 0 || (item.start as number) < previous || (item.end as number) <= (item.start as number) ||
        (item.end as number) > source.text.length || (item.typeOnly && item.moduleInitialization) ||
        ((item.kind === "dynamic-import" || item.kind === "require") && item.typeOnly) ||
        ((item.kind === "import-equals" || item.kind === "require") && item.attributes) ||
        (["import", "export", "import-equals"].includes(item.kind as string) && item.moduleInitialization === item.typeOnly)) reject("invalid native runtime module edge")
      previous = item.end as number
      if (item.specifier.startsWith(".")) specifiers.add(item.specifier)
    }
    if (/\.(?:js|mjs|cjs)$/i.test(source.path)) specifiers.add(`./${source.path.split("/").at(-1)!}`)
    if (request.resolutionRoot === undefined || file.diagnostics.length !== 0) specifiers.clear()
    if (file.resolutions.length !== specifiers.size) reject("native runtime resolution returned a different specifier set")
    let prior = ""
    for (const value of file.resolutions) {
      const item = record(value, "runtime resolution", ["specifier", "message"], ["runtimePath", "typePath"])
      if (!wireString(item.specifier) || !specifiers.has(item.specifier) || item.specifier <= prior || !wireString(item.message) ||
        (item.runtimePath !== undefined && !path(item.runtimePath)) || (item.typePath !== undefined && !path(item.typePath)) ||
        ((item.runtimePath === undefined) !== (item.typePath === undefined)) ||
        (item.message !== "" && item.runtimePath !== undefined)) reject("native runtime resolution escaped its declared root or returned partial facts")
      prior = item.specifier
    }
  }
  return result as unknown as NativeRuntimeModulesResult
}
