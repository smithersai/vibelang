import type {
  ComponentIdentity,
  JsonValue,
  ModelAdapter,
  ModelDescriptor,
  ModelRequest,
  ModelResponse,
} from "./types.ts"
import { canonicalIdentityJson, defineComponentIdentity, sha256Json } from "./identity.ts"

const DESCRIPTOR_FIELD = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,127}$/

/**
 * Drop `undefined`-valued members so an ordinary optional-property object can
 * still be canonicalized for a digest.
 */
export function jsonSnapshot(value: unknown, label = "value"): JsonValue {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError(`${label} is not JSON`)
  return JSON.parse(encoded) as JsonValue
}

function ownData(value: object, key: string, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
    throw new TypeError(`${path}.${key} must be an enumerable own data property`)
  }
  return descriptor.value
}

/** Validate, detach, and freeze a provider/model/version triple. */
export function snapshotModelDescriptor(
  value: unknown,
  path = "model descriptor",
): ModelDescriptor {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.length !== 3 || !keys.every((key) =>
    typeof key === "string" && ["provider", "name", "version"].includes(key))) {
    throw new TypeError(`${path} must contain exactly provider, name, and version`)
  }
  const fields = ["provider", "name", "version"].map((key) => {
    const field = ownData(value, key, path)
    if (typeof field !== "string" || !DESCRIPTOR_FIELD.test(field)) {
      throw new TypeError(`${path}.${key} is not a stable model ${key}`)
    }
    return field
  })
  return Object.freeze({ provider: fields[0], name: fields[1], version: fields[2] })
}

export function modelDescriptorJson(descriptor: ModelDescriptor): Record<string, JsonValue> {
  const stable = snapshotModelDescriptor(descriptor)
  return { provider: stable.provider, name: stable.name, version: stable.version }
}

/**
 * Identity for a model adapter. The served provider/model/version is folded
 * into the configuration digest, so a version bump changes the turn id and can
 * never be answered from another version's recorded response.
 */
export function defineModelIdentity(options: {
  readonly name: string
  readonly artifactDigest: string
  readonly model: ModelDescriptor
  readonly config?: JsonValue
}): ComponentIdentity {
  return defineComponentIdentity({
    name: options.name,
    artifactDigest: options.artifactDigest,
    configDigest: sha256Json({
      schema: "vibelang.agent.model-adapter/v1",
      model: modelDescriptorJson(options.model),
      config: options.config ?? null,
    }),
  })
}

/** Detached, validated view of whatever an adapter returned. */
export function normalizeModelResponse(response: string | ModelResponse): ModelResponse {
  if (typeof response === "string") return Object.freeze({ text: response })
  const canonical = canonicalIdentityJson(jsonSnapshot(response, "Model response"), "Model response")
  const detached = JSON.parse(canonical) as ModelResponse
  if (typeof detached.text !== "string") throw new TypeError("Model response text must be a string")
  if (detached.finishReason !== undefined && typeof detached.finishReason !== "string") {
    throw new TypeError("Model response finishReason must be a string")
  }
  const model = detached.model === undefined
    ? undefined
    : snapshotModelDescriptor(detached.model, "Model response model")
  return Object.freeze({
    text: detached.text,
    ...(model === undefined ? {} : { model }),
    ...(detached.finishReason === undefined ? {} : { finishReason: detached.finishReason }),
    ...(detached.metadata === undefined ? {} : { metadata: Object.freeze(detached.metadata) }),
  })
}

export function modelResponseJson(response: ModelResponse): Record<string, JsonValue> {
  return {
    text: response.text,
    model: response.model === undefined ? null : modelDescriptorJson(response.model),
    finishReason: response.finishReason ?? null,
    metadata: response.metadata === undefined ? null : jsonSnapshot(response.metadata, "Model response metadata"),
  }
}

export function modelRequestDigest(request: ModelRequest): string {
  return sha256Json({
    schema: "vibelang.agent.model-request/v1",
    turnId: request.turnId,
    attempt: request.attempt,
    callableSurface: request.callableSurface,
    messages: jsonSnapshot(request.messages, "Model request messages"),
    diagnostics: jsonSnapshot(request.diagnostics, "Model request diagnostics"),
  })
}

/** Default extraction: the longest fenced block, else the whole reply. */
export function extractTypeScript(response: string): string {
  const fences = [...response.matchAll(/```(?:typescript|ts)?\s*\n?([\s\S]*?)```/gi)]
  if (fences.length === 0) return response.trim()
  return fences.sort((left, right) => right[1].length - left[1].length)[0][1].trim()
}

export function extractModelSource(model: ModelAdapter, response: ModelResponse): string {
  const extracted = typeof model.extractSource === "function"
    ? model.extractSource(response)
    : extractTypeScript(response.text)
  if (typeof extracted !== "string") throw new TypeError("ModelAdapter extractSource must return a string")
  return extracted
}
