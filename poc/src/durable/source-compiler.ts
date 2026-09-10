/**
 * Thin durable compiler host. All source parsing, binding, type derivation,
 * effect reachability and Plan construction are performed by the native Go
 * compiler. This module validates JSON artifacts and preserves the public API.
 */
import { getNativeCompiler } from "../compiler/native.ts"
import type { NativeDiagnostic, NativePlanSourceRequest } from "../compiler/protocol.ts"
import type { CompiledFlow } from "./authoring.ts"
import { encodePlanArtifact, loadCompiledFlow, validatePlanTemplate } from "./artifact.ts"
import type { EffectManifest } from "./effect-manifest.ts"
import { validateEffectManifest } from "./manifest-artifact.ts"
import { canonicalJson, type ActionDescriptor, type PlanTemplate } from "./ir.ts"
import { validateActionContractDescriptor } from "./schema-runtime.ts"
import { identityFileName } from "./site-id.ts"
import { compileDurableBody, type DurableBodyArtifact } from "./body-compiler.ts"

export interface DurableSourceActionBinding {
  readonly moduleSpecifier: string
  readonly exportName: string
  readonly descriptor: ActionDescriptor
}
export interface DurableSourceFlowBinding {
  readonly moduleSpecifier: string
  readonly exportName: string
  readonly plan: PlanTemplate
  /** The independently compiled child Manifest; absent means no parent Manifest. */
  readonly manifest?: EffectManifest
}
export interface DurableSourceCompileOptions {
  readonly fileName?: string
  readonly flowId?: string
  readonly flowVersion?: number
  readonly actions?: readonly DurableSourceActionBinding[]
  readonly flows?: readonly DurableSourceFlowBinding[]
  readonly sourceOrigin?: {
    readonly text: string
    readonly sourceMap: string
    readonly loweringIdentity: string
  }
}
/** Authored UTF-16 declaration spans, including modifiers; not compiler ASTs. */
export interface DurableSourceDerivedAction {
  readonly name: string
  readonly id: string
  readonly start: number
  readonly end: number
}
export interface DurableSourceDiagnostic {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly length: number
}
export interface DurableSourceCompileSuccess {
  readonly ok: true
  readonly diagnostics: readonly []
  readonly plan: PlanTemplate
  readonly artifact: Uint8Array
  readonly flow: CompiledFlow<unknown, unknown>
  readonly derivedActions: readonly DurableSourceDerivedAction[]
  /** Independent source traversal, never a projection out of the returned Plan. */
  readonly manifest: EffectManifest | undefined
  readonly manifestFailure: string | undefined
}
export interface DurableSourceCompileFailure {
  readonly ok: false
  readonly diagnostics: readonly DurableSourceDiagnostic[]
}
export type DurableSourceCompileResult = DurableSourceCompileSuccess | DurableSourceCompileFailure

/** Source has no bounded Plan representation; not a verdict on executable bodies. */
export class PlanUnrepresentable extends Error {
  constructor(readonly node: Readonly<{ start: number; end: number }>, readonly reason: string) {
    super(`the Plan lowerer has no representation for ${reason}`)
    this.name = "PlanUnrepresentable"
  }
}

export interface EffectManifestCompileSuccess {
  readonly ok: true
  readonly diagnostics: readonly []
  readonly manifest: EffectManifest
  readonly derivedActions: readonly DurableSourceDerivedAction[]
}
export type EffectManifestCompileResult = EffectManifestCompileSuccess | DurableSourceCompileFailure
export interface DurableFlowDescriptor {
  readonly artifactSource: "static-plan-artifact" | "effect-manifest"
  readonly id: string
  readonly version: number
  readonly manifest: EffectManifest | undefined
  readonly plan?: PlanTemplate
  readonly body?: DurableBodyArtifact
}
export interface DurableFlowCompileSuccess {
  readonly ok: true
  readonly diagnostics: readonly []
  readonly flow: DurableFlowDescriptor
  readonly plan: PlanTemplate | undefined
  readonly artifact: Uint8Array | undefined
  readonly manifest: EffectManifest | undefined
  readonly derivedActions: readonly DurableSourceDerivedAction[]
}
export type DurableFlowCompileResult = DurableFlowCompileSuccess | DurableSourceCompileFailure

const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const authoredLogicalName = (name: string | undefined): string => {
  const named = name === undefined || name.trim() === "" ? undefined : identityFileName(name)
  return named === undefined || named === "" || named === "." || named === ".." ? "durable-source.ts" : named
}
// Keep existing diagnostic display names without making that suffix an artifact identity.
const diagnosticFileName = (name: string): string => /\.[cm]?tsx?$/.test(name) ? name : `${name}.ts`
const failure = (file: string, code: string, message: string): DurableSourceCompileFailure =>
  Object.freeze({ ok: false, diagnostics: [Object.freeze({ code, message, file, line: 1, column: 1, length: 1 })] })

const diagnostic = (source: string, file: string, issue: NativeDiagnostic): DurableSourceDiagnostic => {
  const start = issue.span?.start ?? 0
  const lines = source.slice(0, start).split(/\r\n?|\n|\u2028|\u2029/)
  return Object.freeze({ code: issue.code, message: issue.message, file, line: lines.length,
    column: lines[lines.length - 1]!.length + 1, length: Math.max(1, issue.span?.length ?? 1) })
}

const prepareRequest = (source: string, options: DurableSourceCompileOptions, mode: "plan" | "manifest"):
  NativePlanSourceRequest | DurableSourceCompileFailure => {
  if (typeof source !== "string") throw new TypeError("Durable source must be a string")
  if (options === null || typeof options !== "object") throw new TypeError("Durable source compiler options are required")
  const fileName = authoredLogicalName(options.fileName)
  const file = diagnosticFileName(fileName)
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) return failure(file, "VIBE4101", "durable source exceeds the compiler input size limit")
  if (options.flowId !== undefined && (typeof options.flowId !== "string" || !options.flowId.trim())) return failure(file, "VIBE4101", "durable Flow id must be non-empty")
  if (!Number.isSafeInteger(options.flowVersion ?? 1) || (options.flowVersion ?? 1) < 1) return failure(file, "VIBE4101", "durable Flow version must be a positive safe integer")
  return {
    source, fileName, flowId: options.flowId ?? "", flowVersion: options.flowVersion ?? 1, mode,
    actions: (options.actions ?? []).map(binding => ({
      moduleSpecifier: binding.moduleSpecifier, exportName: binding.exportName,
      descriptorJson: canonicalJson(validateActionContractDescriptor(binding.descriptor)),
    })),
    flows: (options.flows ?? []).map(binding => ({
      moduleSpecifier: binding.moduleSpecifier, exportName: binding.exportName,
      // Full runtime graph validation precedes the native binding query. That
      // query validates the envelopes and schemas it uses, not execution safety.
      planJson: canonicalJson(validatePlanTemplate(binding.plan)),
      ...(binding.manifest === undefined ? {} : { manifestJson: canonicalJson(validateEffectManifest(binding.manifest)) }),
    })),
  }
}

export const compileDurableSource = (source: string, options: DurableSourceCompileOptions): DurableSourceCompileResult => {
  let file = "durable-source.ts"
  try {
    const request = prepareRequest(source, options, "plan")
    if ("ok" in request) return request
    file = diagnosticFileName(request.fileName)
    const compiled = getNativeCompiler().compilePlanSource(request)
    if (compiled.status === "unrepresentable") throw new PlanUnrepresentable(Object.freeze({ start: 0, end: source.length }), "this source body")
    if (compiled.status === "refused") return { ok: false, diagnostics: compiled.diagnostics.map(issue => diagnostic(source, file, issue)) }
    const plan = validatePlanTemplate(JSON.parse(compiled.planJson))
    const artifact = encodePlanArtifact(plan)
    const manifest = compiled.manifestJson ? validateEffectManifest(JSON.parse(compiled.manifestJson)) : undefined
    return Object.freeze({
      ok: true, diagnostics: [] as const, plan, artifact, flow: loadCompiledFlow(artifact), manifest,
      manifestFailure: compiled.manifestFailure || undefined, derivedActions: compiled.derivedActions,
    })
  } catch (error) {
    if (error instanceof PlanUnrepresentable) throw error
    return failure(file, "VIBE4199", `durable source compiler failed closed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Independent Manifest compilation; the native query never lowers a Plan. */
export const compileEffectManifest = (source: string, options: DurableSourceCompileOptions): EffectManifestCompileResult => {
  const executable = compileDurableBody(source, options)
  if (executable.ok) return Object.freeze({ ok: true, diagnostics: [] as const,
    manifest: executable.body.manifest, derivedActions: executable.derivedActions })
  if (executable.invalidEntry || executable.invalidProvenance || executable.invalidBoundary) return executable
  let file = "durable-source.ts"
  try {
    const request = prepareRequest(source, options, "manifest")
    if ("ok" in request) return request
    file = diagnosticFileName(request.fileName)
    const compiled = getNativeCompiler().compilePlanSource(request)
    if (compiled.status === "refused") return { ok: false, diagnostics: compiled.diagnostics.map(issue => diagnostic(source, file, issue)) }
    return Object.freeze({ ok: true, diagnostics: [] as const,
      manifest: validateEffectManifest(JSON.parse(compiled.manifestJson)), derivedActions: compiled.derivedActions })
  } catch (error) {
    return failure(file, "VIBE4199", `durable effect manifest derivation failed closed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const compileDurableFlow = (
  source: string,
  options: DurableSourceCompileOptions
): DurableFlowCompileResult => {
  // The executable path owns ordinary statements and Result lifting. A legacy
  // Plan, when representable, remains a compatibility artifact beside the body;
  // inability to build that artifact cannot reject an executable Flow.
  const executable = compileDurableBody(source, options)
  if (executable.ok) {
    let legacy: DurableSourceCompileResult | undefined
    try { legacy = compileDurableSource(source, options) }
    catch (error) { if (!(error instanceof PlanUnrepresentable)) throw error }
    const plan = legacy?.ok ? legacy.plan : undefined
    const artifact = legacy?.ok ? legacy.artifact : undefined
    const manifest = executable.body.manifest
    return Object.freeze({
      ok: true as const, diagnostics: [] as const,
      flow: Object.freeze({
        artifactSource: plan ? "static-plan-artifact" as const : "effect-manifest" as const,
        id: manifest.flowId, version: manifest.flowVersion, manifest, body: executable.body,
        ...(plan ? { plan } : {}),
      }),
      plan, artifact, manifest, derivedActions: executable.derivedActions,
    })
  }
  // Imported legacy bindings and not-yet-connected intrinsic drivers retain
  // their existing path while executable closure support is completed.
  // A legacy Plan cannot repair missing or invalid executable provenance.
  if (executable.invalidProvenance || executable.invalidEntry || executable.invalidBoundary) return executable
  if (!executable.unsupported && executable.diagnostics.some(issue =>
    issue.code === "VIBE4110" || /^(TS|VIBE(?:11|12|13|14|15|16|18|21))/.test(issue.code))) return executable
  let lowered: DurableSourceCompileResult
  try {
    lowered = compileDurableSource(source, options)
  } catch (error) {
    if (!(error instanceof PlanUnrepresentable)) throw error
    // The body is a program, not a plan. Publish the Manifest.
    const derived = compileEffectManifest(source, options)
    if (!derived.ok) return derived
    const manifest = derived.manifest
    return Object.freeze({
      ok: true as const,
      diagnostics: [] as const,
      flow: Object.freeze({
        artifactSource: "effect-manifest" as const,
        id: manifest.flowId,
        version: manifest.flowVersion,
        manifest
      }),
      plan: undefined,
      artifact: undefined,
      manifest,
      derivedActions: derived.derivedActions
    })
  }
  if (!lowered.ok) return lowered
  return Object.freeze({
    ok: true as const,
    diagnostics: [] as const,
    flow: Object.freeze({
      artifactSource: "static-plan-artifact" as const,
      id: lowered.plan.flowId,
      version: lowered.plan.flowVersion,
      manifest: lowered.manifest,
      plan: lowered.plan
    }),
    plan: lowered.plan,
    artifact: lowered.artifact,
    manifest: lowered.manifest,
    derivedActions: lowered.derivedActions
  })
}

export const DurableSourceCompiler = Object.freeze({ compile: compileDurableSource })
