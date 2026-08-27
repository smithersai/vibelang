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
      schema: "smithers.agent.model-adapter/v1",
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
    schema: "smithers.agent.model-request/v1",
    turnId: request.turnId,
    attempt: request.attempt,
    callableSurface: request.callableSurface,
    messages: jsonSnapshot(request.messages, "Model request messages"),
    diagnostics: jsonSnapshot(request.diagnostics, "Model request diagnostics"),
  })
}

/**
 * A fenced code block, parsed rather than pattern-matched.
 *
 * The previous implementation used `/```(?:typescript|ts)?\s*\n?([\s\S]*?)```/`,
 * which recognises the *prefix* of an info string instead of the info string:
 * ```` ```tsx ```` matched the `ts` alternative and the capture began at `x`,
 * so the module the model actually wrote was silently corrupted before it was
 * compiled, journaled, and echoed back to the model as its own output.
 */
interface FencedBlock {
  /** First word of the info string, lowercased; `""` when untagged. */
  readonly language: string
  readonly content: string
  readonly closed: boolean
}

/** `indent`(0-3) + 3-or-more backticks/tildes + info string. */
const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/

const TYPESCRIPT_LANGUAGES: ReadonlySet<string> = new Set([
  "ts", "tsx", "mts", "cts", "typescript",
  "js", "jsx", "mjs", "cjs", "javascript",
])

/**
 * CommonMark fenced-code scan: an opening fence may be indented up to three
 * spaces and may use three or more backticks or tildes; it is closed only by a
 * line of the same character, at least as long, carrying nothing else. A
 * backtick fence's info string may not contain a backtick, so an inline
 * ```` `code` ```` span never opens a block. An unterminated fence runs to the
 * end of the document, which is what a `max_tokens` cutoff produces.
 */
function fencedBlocks(response: string): readonly FencedBlock[] {
  const lines = response.split("\n")
  const blocks: FencedBlock[] = []
  let index = 0
  while (index < lines.length) {
    const open = FENCE_LINE.exec(lines[index]!.replace(/\r$/, ""))
    if (open === null) {
      index += 1
      continue
    }
    const indent = open[1]!.length
    const marker = open[2]!
    const info = open[3]!.trim()
    if (marker.startsWith("`") && info.includes("`")) {
      index += 1
      continue
    }
    const body: string[] = []
    let closed = false
    index += 1
    while (index < lines.length) {
      const raw = lines[index]!
      const close = FENCE_LINE.exec(raw.replace(/\r$/, ""))
      if (
        close !== null && close[2]![0] === marker[0] &&
        close[2]!.length >= marker.length && close[3]!.trim() === ""
      ) {
        closed = true
        index += 1
        break
      }
      let stripped = raw
      for (let removed = 0; removed < indent && stripped.startsWith(" "); removed += 1) {
        stripped = stripped.slice(1)
      }
      body.push(stripped)
      index += 1
    }
    blocks.push({
      language: info.split(/[\s,]+/)[0]!.toLowerCase(),
      content: body.join("\n"),
      closed,
    })
  }
  return blocks
}

/**
 * Default extraction. A TypeScript/JavaScript-tagged block wins over an
 * untagged one, an untagged one over a foreign-language one (so a long
 * ```` ```bash ```` transcript never outranks the module), and the longest
 * candidate wins within a tier. With no fence at all the whole reply is the
 * module, exactly as before.
 */
export function extractTypeScript(response: string): string {
  const blocks = fencedBlocks(response)
  if (blocks.length === 0) return response.trim()
  const tagged = blocks.filter((block) => TYPESCRIPT_LANGUAGES.has(block.language))
  const untagged = blocks.filter((block) => block.language === "")
  const candidates = tagged.length > 0 ? tagged : untagged.length > 0 ? untagged : blocks
  return candidates
    .reduce((best, block) => (block.content.length > best.content.length ? block : best))
    .content
    .trim()
}

export function extractModelSource(model: ModelAdapter, response: ModelResponse): string {
  const extracted = typeof model.extractSource === "function"
    ? model.extractSource(response)
    : extractTypeScript(response.text)
  if (typeof extracted !== "string") throw new TypeError("ModelAdapter extractSource must return a string")
  return extracted
}
