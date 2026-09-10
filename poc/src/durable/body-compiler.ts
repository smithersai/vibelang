import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getNativeCompiler } from "../compiler/native.ts"
import type { NativeSpan } from "../compiler/protocol.ts"
import { withGeneratedPositions } from "../language/generated-check.ts"
import { originalPosition } from "../language/source-map.ts"
import { validateEffectManifest } from "./manifest-artifact.ts"
import { failureIdentities, validateDurableSchema } from "./schema-runtime.ts"
import { identityFileName } from "./site-id.ts"
import { deepFreeze, digest, type StructuralDurableSchema } from "./value.ts"
import type { DurableBodyArtifact } from "./body-artifact.ts"
import type { DurableSourceCompileOptions, DurableSourceDiagnostic, DurableSourceDerivedAction } from "./source-compiler.ts"
export type { DurableBodyArtifact } from "./body-artifact.ts"

export type DurableBodyCompileResult =
  | { readonly ok: true; readonly body: DurableBodyArtifact; readonly code: string; readonly derivedActions: readonly DurableSourceDerivedAction[] }
  | { readonly ok: false; readonly unsupported?: true; readonly invalidProvenance?: true; readonly invalidEntry?: true; readonly invalidBoundary?: true; readonly diagnostics: readonly DurableSourceDiagnostic[] }

/** Native lowering, native generated-program checking, then data-only assembly. */
export function compileDurableBody(source: string, options: DurableSourceCompileOptions): DurableBodyCompileResult {
  if (typeof source !== "string" || !options || typeof options !== "object" || Array.isArray(options) ||
    Buffer.byteLength(source, "utf8") > 2*1024*1024 ||
    (options.fileName !== undefined && (typeof options.fileName !== "string" || !options.fileName.trim())) ||
    (options.flowId !== undefined && (typeof options.flowId !== "string" || !options.flowId.trim())) ||
    (options.flowVersion !== undefined && (!Number.isSafeInteger(options.flowVersion) || options.flowVersion < 1))) {
    return { ok: false, diagnostics: [{ code: "VIBE4101", message: "invalid or oversized durable source compilation input",
      file: typeof options?.fileName === "string" ? options.fileName : "flow.vibe", line: 1, column: 1, length: 1 }] }
  }
  const fileName = identityFileName(options.fileName ?? "flow.vibe")
  const diagnostic = (where: NativeSpan | null, code: string, message: string): DurableSourceDiagnostic => {
    const lines = source.slice(0, where?.start ?? 0).split(/\r\n|[\r\n\u2028\u2029]/)
    return { code, message, file: fileName, line: lines.length, column: lines.at(-1)!.length+1, length: where?.length ?? 1 }
  }
  const origin = options.sourceOrigin
  if (origin !== undefined && (!origin || typeof origin !== "object" || typeof origin.text !== "string" ||
    Buffer.byteLength(origin.text, "utf8") > 2*1024*1024 || typeof origin.sourceMap !== "string" ||
    typeof origin.loweringIdentity !== "string" || !/^[a-f0-9]{64}$/.test(origin.loweringIdentity))) {
    return { ok: false, invalidProvenance: true, diagnostics: [diagnostic(null, "VIBE4101", "invalid durable source provenance")] }
  }
  const native = getNativeCompiler()
  const runtimeImport = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../runtime/index.ts" : "../runtime/index.js", import.meta.url))
  const outputFileName = resolve(fileName.replace(/\.[^./\\]+$/, "")+".body.ts")
  const emitted = native.lowerBody({ source, fileName, flowId: options.flowId ?? "", flowVersion: options.flowVersion ?? 1,
    runtimeImport, outputFileName, ...(origin ? { sourceOrigin: origin } : {}) })
  if (!emitted.ok) return { ok: false,
    ...(emitted.reason === "entry" ? { invalidEntry: true as const } : {}),
    ...(emitted.reason === "boundary" ? { invalidBoundary: true as const } : {}),
    ...(emitted.reason === "provenance" ? { invalidProvenance: true as const } : {}),
    ...(emitted.reason === "unsupported" ? { unsupported: true as const } : {}),
    diagnostics: emitted.diagnostics.map(issue => diagnostic(issue.span ?? null, issue.code, issue.message)) }
  const manifest = validateEffectManifest(JSON.parse(emitted.manifestJson))
  const checked = native.bodyContract({ project: { files: [{ path: outputFileName, text: emitted.code }],
    currentDirectory: process.cwd().replaceAll("\\", "/"), diskDependencies: true }, entryFile: outputFileName,
    entry: emitted.entry, logicalFileName: fileName, runtimeSpecifier: runtimeImport, resumable: emitted.resumable, async: emitted.async })
  if (!checked.ok) {
    if (checked.reason === "check") return { ok: false, diagnostics: withGeneratedPositions(checked.diagnostics, new Map([[outputFileName, emitted.code]])).map(issue => {
      const position = issue.position
      const mapped = position ? originalPosition(emitted.sourceMap, position.line, position.character) : undefined
      return { code: issue.code, message: issue.message, file: mapped?.source ?? outputFileName,
        line: (mapped?.line ?? position?.line ?? 0)+1, column: (mapped?.column ?? position?.character ?? 0)+1, length: issue.span?.length ?? 1 }
    }) }
    if (checked.reason === "entry") return { ok: false, invalidEntry: true, diagnostics: [diagnostic(emitted.entrySpan, "VIBE4104", checked.message)] }
    return { ok: false, invalidBoundary: true, diagnostics: [diagnostic(emitted.functionSpan, "VIBE4110", `durable Flow boundary is not structurally encodable: ${checked.message}`)] }
  }
  const schemas = JSON.parse(checked.schemasJson)
  const validate = (value: unknown, role: "input" | "success" | "error"): StructuralDurableSchema => {
    const schema = validateDurableSchema(value, role, `Flow ${role} schema`)
    if (schema.shape !== "structural") throw new TypeError("a Flow boundary requires a structural codec")
    return schema
  }
  const inputSchema = validate(schemas.inputSchema, "input"), successSchema = validate(schemas.successSchema, "success"), failureSchema = validate(schemas.failureSchema, "error")
  const factory = native.runtimeFactory({ source: emitted.code, entry: emitted.entry, runtimeSpecifier: runtimeImport })
  if (!factory.ok) return { ok: false, diagnostics: [diagnostic(emitted.functionSpan, "VIBE4199", `executable Flow factory assembly failed: ${factory.message}`)] }
  const errors = [...emitted.errors], failures = new Set(manifest.failures)
  failureIdentities(failureSchema, failures)
  if (failures.has("javascript:Error@1")) errors.push({ durable: "javascript:Error@1", nominal: "javascript:Error@1" })
  errors.sort((left, right) => left.durable < right.durable ? -1 : left.durable > right.durable ? 1 : 0)
  const { digest: _previousDigest, ...manifestFields } = manifest
  const manifestIdentity = { ...manifestFields, failures: [...failures].sort() }
  const effectManifest = { ...manifestIdentity, digest: digest(manifestIdentity) }
  const pinnedSource = { fileName, text: origin?.text ?? source }
  const body = { bodyVersion: effectManifest.sites.some(site => site.kind === "sleep") ? 2 as const : 1 as const,
    source: pinnedSource, sourceIdentity: digest(pinnedSource), ...(origin ? { loweringIdentity: origin.loweringIdentity } : {}),
    manifest: effectManifest, entry: emitted.entry, javascript: factory.code, resumable: emitted.resumable, async: emitted.async,
    inputSchema, successSchema, failureSchema, errors }
  return { ok: true, body: deepFreeze({ ...body, digest: digest(body) }), code: emitted.code, derivedActions: emitted.derivedActions }
}
