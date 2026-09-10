import * as runtime from "../runtime/index.ts"
import { __vsCreateErrorRegistry } from "../runtime/errors.ts"
import { validateEffectManifest } from "./manifest-artifact.ts"
import { DURABLE_SLEEP_KEY } from "./body-intrinsics.ts"
import { __vsDispatchRequest, __vsExecutionScope, type AnyRequest, type DispatchedRequest, type AsyncResumable, type Resumable } from "../runtime/effect.ts"
import type { Result } from "../runtime/result.ts"
import type { EffectManifest } from "./effect-manifest.ts"
import type { DispatchedEffectRequest } from "./replay.ts"
import { materializeDurableValue, validateDurableSchema, validateDurableValue } from "./schema-runtime.ts"
import { assertJson, canonicalJson, deepFreeze, digest, type JsonValue, type StructuralDurableSchema } from "./value.ts"

/** Executable source closure, independent of the legacy Plan representation. */
export interface DurableBodyArtifact {
  /** Version 2 adds coordinator-owned executable timers; version 1 remains readable. */
  readonly bodyVersion: 1 | 2
  readonly source: { readonly fileName: string; readonly text: string }
  readonly sourceIdentity: string
  /** Earlier-stage tracked-input identity, when compilation transformed source. */
  readonly loweringIdentity?: string
  readonly manifest: EffectManifest
  readonly entry: string
  /** Strict JavaScript module factory, accepting only the generated-code ABI. */
  readonly javascript: string
  readonly resumable: boolean
  readonly async: boolean
  readonly inputSchema: StructuralDurableSchema
  readonly successSchema: StructuralDurableSchema
  readonly failureSchema: StructuralDurableSchema
  /** Explicit bridge from durable structural contracts to nominal Error codecs. */
  readonly errors: readonly { readonly durable: string; readonly nominal: string }[]
  readonly digest: string
}

const SHA256 = /^[0-9a-f]{64}$/
const exact = (record: object, fields: readonly string[]): void => {
  if (canonicalJson(Object.keys(record).sort()) !== canonicalJson([...fields].sort())) {
    throw new TypeError("Executable Flow artifact has an unexpected field set")
  }
}

/** Integrity validation is not signature authorization; deployments supply that. */
export function validateDurableBodyArtifact(value: unknown): DurableBodyArtifact {
  const normalized = assertJson(value, "executable Flow artifact")
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) throw new TypeError("Expected an executable Flow artifact")
  const body = normalized as unknown as DurableBodyArtifact
  exact(body, ["bodyVersion", "source", "sourceIdentity", "manifest", "entry", "javascript", "resumable", "async", "inputSchema", "successSchema", "failureSchema", "errors", "digest",
    ...("loweringIdentity" in body ? ["loweringIdentity"] : [])])
  if ((body.bodyVersion !== 1 && body.bodyVersion !== 2) || typeof body.resumable !== "boolean" || typeof body.async !== "boolean" ||
    typeof body.entry !== "string" || !/^[$A-Z_a-z][$\w]*$/.test(body.entry) ||
    typeof body.javascript !== "string" || body.javascript.length > 4 * 1024 * 1024 ||
    !body.source || typeof body.source.fileName !== "string" || typeof body.source.text !== "string" ||
    body.source.text.length > 2 * 1024 * 1024) throw new TypeError("Invalid executable Flow artifact header")
  exact(body.source, ["fileName", "text"])
  const { digest: claimed, ...identity } = body
  if (!SHA256.test(claimed) || digest(identity) !== claimed) throw new TypeError("Executable Flow artifact digest mismatch")
  if (digest(body.source) !== body.sourceIdentity) throw new TypeError("Executable Flow pinned source identity mismatch")
  if ("loweringIdentity" in body && (typeof body.loweringIdentity !== "string" || !SHA256.test(body.loweringIdentity))) {
    throw new TypeError("Executable Flow lowering identity must be a SHA-256 digest")
  }
  validateDurableSchema(body.inputSchema, "input")
  validateDurableSchema(body.successSchema, "success")
  validateDurableSchema(body.failureSchema, "error")
  if (body.inputSchema.shape !== "structural" || body.successSchema.shape !== "structural" || body.failureSchema.shape !== "structural") {
    throw new TypeError("Executable Flow boundaries require structural codecs")
  }
  validateEffectManifest(body.manifest)
  if (body.bodyVersion === 1 && body.manifest.sites.some(site => site.kind === "sleep")) {
    throw new TypeError("Executable timer sites require Flow body version 2")
  }
  if (!Array.isArray(body.errors) || new Set(body.errors.map(error => error.durable)).size !== body.errors.length ||
    new Set(body.errors.map(error => error.nominal)).size !== body.errors.length ||
    body.errors.some(error => typeof error.durable !== "string" || !error.durable || typeof error.nominal !== "string" || !error.nominal)) {
    throw new TypeError("Invalid executable Flow Error codec table")
  }
  for (const error of body.errors) exact(error, ["durable", "nominal"])
  return deepFreeze(body)
}

export interface LoadedDurableBody {
  readonly artifact: DurableBodyArtifact
  create(input: unknown): DurableBodyAttempt
}

export interface DurableBodyAttempt {
  readonly computation: Resumable<unknown> | AsyncResumable<unknown>
  /** Share dispatch identity with requests answered inside lexical handlers. */
  dispatchRequest(request: AnyRequest): DispatchedRequest
  /** Validate before an invocation is claimed or sent to a worker. */
  validateRequest(request: DispatchedEffectRequest): void
  /** Decode live/replayed Action exits or the timer's null completion identically. */
  decodeAnswer(request: DispatchedEffectRequest, answer: JsonValue): Result<unknown, Error> | null
  encodeFailure(error: Error): JsonValue
}

const loaded = new Map<string, LoadedDurableBody>()

/** Load only after the caller has authenticated the deployment's body digest. */
export function loadDurableBody(value: unknown): LoadedDurableBody {
  const artifact = validateDurableBodyArtifact(value)
  const prior = loaded.get(artifact.digest)
  if (prior) return prior
  // Compilation never invokes source. This is the runtime load boundary for
  // the authenticated executable artifact, with a compiler-owned ABI binding.
  const factory = new Function(`"use strict"; return (${artifact.javascript});`)() as (abi: typeof runtime) => (input: unknown) => unknown
  const actions = new Map(artifact.manifest.actions.map(action => [action.id, action]))
  const sites = new Map(artifact.manifest.sites.map(site => [site.id, site]))
  const errors = new Map(artifact.errors.map(error => [error.durable, error.nominal]))
  const isTimer = (request: DispatchedEffectRequest): boolean => {
    if (request.kind !== "perform" || sites.get(request.site)?.kind !== "sleep") return false
    if (request.key !== DURABLE_SLEEP_KEY) {
      throw new TypeError(`Executable Flow issued an invalid timer key at ${request.site}`)
    }
    return true
  }
  const actionFor = (request: DispatchedEffectRequest) => {
    const site = sites.get(request.site)
    const action = typeof request.key === "string" ? actions.get(request.key) : undefined
    if (request.kind !== "perform" || site?.kind !== "perform" || site.key !== request.key || !action) {
      throw new TypeError(`Executable Flow issued an effect outside its pinned Manifest at ${request.site}`)
    }
    return action
  }
  const body: LoadedDurableBody = Object.freeze({
    artifact,
    create(input: unknown): DurableBodyAttempt {
      const checked = materializeDurableValue(artifact.inputSchema, input, "Flow input")
      const registry = __vsCreateErrorRegistry()
      // Each emitted delimiter uses this same explicit dispatch scope, even
      // when its next step happens after native await. No ambient state stays
      // installed across a Promise or leaks to an overlapping execution.
      const around = __vsExecutionScope()
      const abi: typeof runtime = { ...runtime, __vsRegisterError: registry.register, decodeError: registry.decode,
        __vsResultScope: body => runtime.__vsResultScope(body, around),
        __vsResultScopeAsync: body => runtime.__vsResultScopeAsync(body, around),
        __vsProvide: (layer, body) => runtime.__vsProvide(layer, body, around),
        __vsProvideAsync: (layer, body) => runtime.__vsProvideAsync(layer, body, around),
      }
      const entry = factory(Object.freeze(abi))
      if (typeof entry !== "function") throw new TypeError("Executable Flow artifact did not load a callable entry")
      const validateOutput = (result: unknown): unknown => {
        if (runtime.isResult(result)) {
          const inspected = runtime.__vsInspectResult(result)
          if (inspected.ok) validateDurableValue(artifact.successSchema, inspected.value, "Flow output")
        } else validateDurableValue(artifact.successSchema, result, "Flow output")
        return result
      }
      const computation = artifact.async ? (async function* () {
        const result = artifact.resumable ? yield* entry(checked) as AsyncResumable<unknown> : await entry(checked)
        return validateOutput(result)
      })() : (function* () {
        const result = artifact.resumable ? yield* entry(checked) as Resumable<unknown> : entry(checked)
        return validateOutput(result)
      })()
      return Object.freeze({ computation,
    dispatchRequest(request: AnyRequest): DispatchedRequest {
      return around(() => __vsDispatchRequest(request))
    },
    encodeFailure(error: Error): JsonValue {
      const encoded = JSON.parse(runtime.encodeError(error))
      const durable = artifact.errors.find(entry => entry.nominal === encoded.identity)?.durable
      if (!durable) throw new TypeError("Flow returned an Error outside its pinned codec table")
      return validateDurableValue(artifact.failureSchema, { version: 1, identity: durable, payload: encoded.payload }, "Flow error")
    },
    validateRequest(request: DispatchedEffectRequest): void {
      if (isTimer(request)) {
        if (typeof request.input !== "number" || !Number.isSafeInteger(request.input) || request.input < 0) {
          throw new TypeError("Durable timer duration must be non-negative safe integer milliseconds")
        }
        return
      }
      const action = actionFor(request)
      validateDurableValue(action.inputSchema, request.input, `Action ${action.id} input`)
    },
    decodeAnswer(request: DispatchedEffectRequest, answer: JsonValue): Result<unknown, Error> | null {
      if (isTimer(request)) {
        if (answer !== null) throw new TypeError("Durable timer answer must be null")
        return null
      }
      const action = actionFor(request)
      if (!answer || typeof answer !== "object" || Array.isArray(answer)) throw new TypeError("Action answer requires a worker exit envelope")
      if (answer.kind === "success") {
        exact(answer, ["kind", "value"])
        return runtime.__vsResultSuccess(materializeDurableValue(action.successSchema, answer.value, `Action ${action.id} success`))
      }
      if (answer.kind === "failure") {
        exact(answer, ["kind", "error"])
        const error = validateDurableValue(action.errorSchema, answer.error, `Action ${action.id} error`)
        if (!error || typeof error !== "object" || Array.isArray(error) || error.version !== 1 || typeof error.identity !== "string") {
          throw new TypeError("Action failure requires a nominal Error codec envelope")
        }
        const nominal = errors.get(error.identity)
        if (!nominal) throw new TypeError(`Action failure has no pinned nominal Error codec: ${error.identity}`)
        if (!error.payload || typeof error.payload !== "object" || Array.isArray(error.payload)) {
          throw new TypeError("Action Error payload must be a record")
        }
        const payload = { message: "", ...error.payload }
        const wire = `{"version":1,"identity":${JSON.stringify(nominal)},"payload":${canonicalJson(payload)}}`
        return runtime.__vsResultFailure(registry.decode(wire))
      }
      throw new TypeError("Action answer has an unsupported worker exit kind")
    },
      })
    },
  })
  loaded.set(artifact.digest, body)
  return body
}
