/**
 * Durable wire codecs and descriptor validation. This module only processes
 * data: it never imports a compiler, parses source, or grants compiler trust.
 */
import {
  assertJson, canonicalJson, deepFreeze, digest,
  type ActionDescriptor, type ActionRouteManifest, type DurableSchema,
  type DurableTypeDescriptor, type JsonValue, type StructuralDurableSchema, type WorkerExit
} from "./value.ts"

const MAX_DESCRIPTOR_DEPTH = 64
const MAX_DESCRIPTOR_NODES = 10_000
const MAX_UNION_VARIANTS = 128
const MAX_OBJECT_FIELDS = 1_024

/** Every nominal failure identity a validated structural descriptor can carry. */
export const failureIdentities = (schema: DurableSchema, into: Set<string>): void => {
  if (schema.shape !== "structural") return
  const pending: DurableTypeDescriptor[] = [(schema as StructuralDurableSchema).descriptor]
  while (pending.length > 0) {
    const descriptor = pending.pop()!
    switch (descriptor.kind) {
      case "error": into.add(descriptor.identity); pending.push(descriptor.payload); break
      case "union": pending.push(...descriptor.variants); break
      case "array": pending.push(descriptor.element); break
      case "tuple": pending.push(...descriptor.items); break
      case "object": pending.push(...descriptor.fields.map(field => field.value)); break
    }
  }
}


export class DurableCodecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DurableCodecError"
  }
}


const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0


const identifier = (value: string, label: string): string => {
  if (!/^[$A-Z_a-z][$0-9A-Z_a-z]*$/.test(value)) throw new TypeError(`${label} must be an identifier`)
  return value
}


const descriptorKey = (descriptor: DurableTypeDescriptor): string => canonicalJson(descriptor as unknown as JsonValue)

/** @internal Renders a checked descriptor as TypeScript type syntax for virtual declarations. */
export const descriptorTypeScript = (descriptor: DurableTypeDescriptor): string => {
  switch (descriptor.kind) {
    case "never": return "never"
    case "null": return "null"
    case "boolean": return "boolean"
    case "number": return "number"
    case "string": return "string"
    case "literal": return JSON.stringify(descriptor.value)
    case "array": return `readonly (${descriptorTypeScript(descriptor.element)})[]`
    case "tuple": return `readonly [${descriptor.items.map(descriptorTypeScript).join(", ")}]`
    case "object": return `{ ${descriptor.fields.map((field) =>
      `readonly ${JSON.stringify(field.name)}${field.optional ? "?" : ""}: ${descriptorTypeScript(field.value)}`
    ).join("; ")} }`
    case "union": return descriptor.variants.map((variant) => `(${descriptorTypeScript(variant)})`).join(" | ")
    case "error": return `{ readonly version: 1; readonly identity: ${JSON.stringify(descriptor.identity)}; readonly payload: ${descriptorTypeScript(descriptor.payload)} }`
  }
}


export const actionDeclarationFromDescriptor = (exportName: string, descriptor: ActionDescriptor): string => {
  identifier(exportName, "Action export name")
  if (descriptor.inputSchema.shape !== "structural" || descriptor.successSchema.shape !== "structural") {
    // A legacy json-value descriptor carries no static shape to expose. `any`
    // is confined to this compiler-owned declaration; the durable lowerer
    // still resolves the Action binding and validates its descriptor before a
    // postfix propagation point can enter Plan IR.
    return `export declare const ${exportName}: { run(input: unknown): any | undefined };`
  }
  return `export declare const ${exportName}: { run(input: ${descriptorTypeScript(descriptor.inputSchema.descriptor)}): ${descriptorTypeScript(descriptor.successSchema.descriptor)} | undefined };`
}

const validateSchemaContract = (value: JsonValue, role: DurableSchema["role"], path: string): DurableSchema => {
  const record = exactRecord(value, path)
  if (record.format !== "canonical-json" || record.schemaVersion !== 1 || record.role !== role || typeof record.digest !== "string") {
    throw new DurableCodecError(`${path} has an unsupported schema envelope`)
  }
  if (record.shape === "json-value" && record.source === "compiler-derived-poc-stub") {
    if (canonicalJson(Object.keys(record).sort()) !== canonicalJson(["digest", "format", "role", "schemaVersion", "shape", "source"])) {
      throw new DurableCodecError(`${path} has unexpected fields`)
    }
    const semantic = { format: "canonical-json", schemaVersion: 1, role, shape: "json-value", source: "compiler-derived-poc-stub" }
    if (digest(semantic) !== record.digest) throw new DurableCodecError(`${path} digest mismatch`)
    return record as unknown as DurableSchema
  }
  if (record.shape !== "structural" || record.source !== "compiler-derived" ||
    canonicalJson(Object.keys(record).sort()) !== canonicalJson(["descriptor", "digest", "format", "role", "schemaVersion", "shape", "source"])) {
    throw new DurableCodecError(`${path} has an unsupported structural schema envelope`)
  }
  const descriptor = validateDurableTypeDescriptor(record.descriptor)
  const semantic = { format: "canonical-json", schemaVersion: 1, role, shape: "structural", source: "compiler-derived", descriptor }
  if (digest(semantic) !== record.digest) throw new DurableCodecError(`${path} digest mismatch`)
  return record as unknown as DurableSchema
}

/** Validate persisted/compiler-emitted schema evidence before trusting it. */
export const validateDurableSchema = (
  value: unknown,
  role: DurableSchema["role"],
  label = "durable schema"
): DurableSchema => validateSchemaContract(assertJson(value, label), role, label)

/** Validate compiler output before using it to synthesize a trusted declaration. */
export const validateActionContractDescriptor = (value: unknown): ActionDescriptor => {
  const normalized = assertJson(value, "Action descriptor")
  const record = exactRecord(normalized, "Action descriptor")
  if (canonicalJson(Object.keys(record).sort()) !== canonicalJson([
    "contractDigest", "errorSchema", "id", "inputSchema", "successSchema", "version"
  ])) throw new DurableCodecError("Action descriptor has unexpected fields")
  if (typeof record.id !== "string" || record.id.trim() === "" || !Number.isSafeInteger(record.version) || (record.version as number) < 1 ||
    typeof record.contractDigest !== "string" || !/^[0-9a-f]{64}$/.test(record.contractDigest)) {
    throw new DurableCodecError("Action descriptor has invalid identity fields")
  }
  const inputSchema = validateSchemaContract(record.inputSchema, "input", "Action input schema")
  const successSchema = validateSchemaContract(record.successSchema, "success", "Action success schema")
  const errorSchema = validateSchemaContract(record.errorSchema, "error", "Action error schema")
  const semantic = { id: record.id, version: record.version, inputSchema, successSchema, errorSchema }
  if (digest(semantic) !== record.contractDigest) throw new DurableCodecError("Action contract digest mismatch")
  return deepFreeze({ ...semantic, contractDigest: record.contractDigest } as ActionDescriptor)
}


const exactRecord = (value: JsonValue, path: string): Record<string, JsonValue> => {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new DurableCodecError(`${path} expected an exact object`)
  }
  return value
}

const validateDescriptorInner = (
  value: JsonValue,
  path: string,
  depth: number,
  counter: { value: number }
): DurableTypeDescriptor => {
  if (depth > MAX_DESCRIPTOR_DEPTH) throw new DurableCodecError(`${path} exceeds the descriptor depth limit`)
  counter.value += 1
  if (counter.value > MAX_DESCRIPTOR_NODES) throw new DurableCodecError(`${path} exceeds the descriptor node limit`)
  const record = exactRecord(value, path)
  if (typeof record.kind !== "string") throw new DurableCodecError(`${path}.kind must be a string`)
  const keys = (expected: readonly string[]): void => {
    const actual = Object.keys(record).sort()
    const wanted = [...expected].sort()
    if (canonicalJson(actual) !== canonicalJson(wanted)) throw new DurableCodecError(`${path} has unexpected fields`)
  }
  switch (record.kind) {
    case "never": case "null": case "boolean": case "number": case "string":
      keys(["kind"])
      return record as unknown as DurableTypeDescriptor
    case "literal":
      keys(["kind", "value"])
      if (!(record.value === null || typeof record.value === "boolean" || typeof record.value === "string" ||
        (typeof record.value === "number" && Number.isFinite(record.value) && !Object.is(record.value, -0)))) {
        throw new DurableCodecError(`${path}.value is not a canonical scalar literal`)
      }
      return record as unknown as DurableTypeDescriptor
    case "array":
      keys(["kind", "element"])
      return { kind: "array", element: validateDescriptorInner(record.element, `${path}.element`, depth + 1, counter) }
    case "tuple":
      keys(["kind", "items"])
      if (!Array.isArray(record.items)) throw new DurableCodecError(`${path}.items must be an array`)
      return { kind: "tuple", items: record.items.map((item, index) => validateDescriptorInner(item, `${path}.items[${index}]`, depth + 1, counter)) }
    case "object": {
      keys(["kind", "fields"])
      if (!Array.isArray(record.fields) || record.fields.length > MAX_OBJECT_FIELDS) {
        throw new DurableCodecError(`${path}.fields must be a bounded array`)
      }
      const fields = record.fields.map((item, index) => {
        const field = exactRecord(item, `${path}.fields[${index}]`)
        if (canonicalJson(Object.keys(field).sort()) !== canonicalJson(["name", "optional", "value"])) {
          throw new DurableCodecError(`${path}.fields[${index}] has unexpected fields`)
        }
        if (typeof field.name !== "string" || field.name === "" || typeof field.optional !== "boolean") {
          throw new DurableCodecError(`${path}.fields[${index}] has an invalid name/optional flag`)
        }
        return {
          name: field.name,
          optional: field.optional,
          value: validateDescriptorInner(field.value, `${path}.fields[${index}].value`, depth + 1, counter)
        }
      })
      const names = fields.map((field) => field.name)
      if (canonicalJson(names) !== canonicalJson([...new Set(names)].sort(compareText))) {
        throw new DurableCodecError(`${path}.fields must be sorted and unique`)
      }
      return { kind: "object", fields }
    }
    case "union": {
      keys(["kind", "variants"])
      if (!Array.isArray(record.variants) || record.variants.length < 2 || record.variants.length > MAX_UNION_VARIANTS) {
        throw new DurableCodecError(`${path}.variants must contain 2-${MAX_UNION_VARIANTS} items`)
      }
      const variants = record.variants.map((item, index) => validateDescriptorInner(item, `${path}.variants[${index}]`, depth + 1, counter))
      const identities = variants.map(descriptorKey)
      if (canonicalJson(identities) !== canonicalJson([...new Set(identities)].sort(compareText))) {
        throw new DurableCodecError(`${path}.variants must be canonically sorted and unique`)
      }
      return { kind: "union", variants }
    }
    case "error": {
      keys(["kind", "identity", "name", "payload"])
      // Class names are authored ECMAScript identifiers. The wire identity
      // remains separately escaped/bounded; this data name must not turn an
      // accepted Unicode class into an unloadable durable artifact.
      if (typeof record.identity !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,255}$/.test(record.identity) ||
        typeof record.name !== "string" || !/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(record.name)) {
        throw new DurableCodecError(`${path} has invalid nominal Error identity`)
      }
      const payload = validateDescriptorInner(record.payload, `${path}.payload`, depth + 1, counter)
      if (payload.kind !== "object") throw new DurableCodecError(`${path}.payload must be an object descriptor`)
      return { kind: "error", identity: record.identity, name: record.name, payload }
    }
    default:
      throw new DurableCodecError(`${path}.kind is unsupported`)
  }
}

export const validateDurableTypeDescriptor = (value: unknown): DurableTypeDescriptor => {
  const normalized = assertJson(value, "Durable type descriptor")
  return deepFreeze(validateDescriptorInner(normalized, "descriptor", 0, { value: 0 }))
}

const validateValueInner = (descriptor: DurableTypeDescriptor, value: JsonValue, path: string, depth: number): void => {
  if (depth > MAX_DESCRIPTOR_DEPTH) throw new DurableCodecError(`${path} exceeds the durable value depth limit`)
  switch (descriptor.kind) {
    case "never": break
    case "null": if (value === null) return; break
    case "boolean": if (typeof value === "boolean") return; break
    case "number": if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return; break
    case "string": if (typeof value === "string") return; break
    case "literal": if (Object.is(value, descriptor.value)) return; break
    case "array":
      if (Array.isArray(value)) {
        value.forEach((item, index) => validateValueInner(descriptor.element, item, `${path}[${index}]`, depth + 1))
        return
      }
      break
    case "tuple":
      if (Array.isArray(value) && value.length === descriptor.items.length) {
        descriptor.items.forEach((item, index) => validateValueInner(item, value[index], `${path}[${index}]`, depth + 1))
        return
      }
      break
    case "object": {
      if (value === null || Array.isArray(value) || typeof value !== "object") break
      const actual = Object.keys(value).sort(compareText)
      const allowed = descriptor.fields.map((field) => field.name)
      if (actual.some((name) => !allowed.includes(name))) throw new DurableCodecError(`${path} has an unexpected field`)
      for (const field of descriptor.fields) {
        if (!Object.hasOwn(value, field.name)) {
          if (!field.optional) throw new DurableCodecError(`${path}.${field.name} is required`)
          continue
        }
        validateValueInner(field.value, value[field.name], `${path}.${field.name}`, depth + 1)
      }
      return
    }
    case "union":
      for (const variant of descriptor.variants) {
        try {
          validateValueInner(variant, value, path, depth + 1)
          return
        } catch (error) {
          if (!(error instanceof DurableCodecError)) throw error
        }
      }
      break
    case "error": {
      if (value === null || Array.isArray(value) || typeof value !== "object") break
      if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(["identity", "payload", "version"]) ||
        value.version !== 1 || value.identity !== descriptor.identity) {
        throw new DurableCodecError(`${path} expected nominal Error ${descriptor.identity}`)
      }
      validateValueInner(descriptor.payload, value.payload, `${path}.payload`, depth + 1)
      return
    }
  }
  throw new DurableCodecError(`${path} does not satisfy durable ${descriptor.kind}`)
}

export const validateDurableValue = (schema: DurableSchema, value: unknown, label = "durable value"): JsonValue => {
  const normalized = assertJson(value, label)
  if (schema.shape === "json-value") return normalized
  const descriptor = validateDurableTypeDescriptor(schema.descriptor)
  validateValueInner(descriptor, normalized, label, 0)
  return deepFreeze(normalized)
}

/**
 * Materialize validated wire data for ordinary authored execution. Structural
 * validation returns immutable, null-prototype evidence; the mutable TypeScript
 * input/answer is a separate object graph with ordinary Object/Array behavior.
 * JSON.parse defines an own __proto__ property as data, never as a setter call.
 * This does not change persistence encoding or canonical boundary ordering.
 */
export const materializeDurableValue = (schema: DurableSchema, value: unknown, label = "durable value"): JsonValue =>
  JSON.parse(JSON.stringify(validateDurableValue(schema, value, label))) as JsonValue

/**
 * Names the transport a `WorkerExit` arrived over. This is the only thing the
 * two decode boundaries legitimately differ on, so it is the only parameter.
 */
export interface WorkerExitSurface {
  /** Appears in every diagnostic as `${actionId} ${label} exit`. */
  readonly label: string
  /** Defect name used when `kind` is neither `"success"` nor `"failure"`. */
  readonly protocolDefectName: string
}

/**
 * The one `WorkerExit` decoder.
 *
 * Both boundaries that admit a worker's exit — the coordinator
 * (`engine.ts`) and the bundle worker host (`worker-host.ts`) — route through
 * here, so a shape learned at one is learned at both. They previously spelled
 * this walk out twice, verbatim; the duplication is the shape that has diverged
 * repeatedly in this repository, and the two copies had in fact already
 * diverged on the canonical size limit (see the note on `canonicalJson` below).
 *
 * Never throws: an exit that fails any check becomes a defect exit, because a
 * throw here would escape the coordinator's per-attempt handling.
 */
export const decodeWorkerExit = (
  route: ActionRouteManifest,
  value: unknown,
  surface: WorkerExitSurface
): WorkerExit => {
  const label = `${route.actionId} ${surface.label}`
  let observedKind: unknown
  try {
    const encoded = assertJson(value, `${label} exit`)
    // The canonical encoding's independent 8 MiB limit belongs at this
    // boundary. Every downstream use of an exit canonicalizes it (store commit,
    // digest, memo reuse), so an over-size exit admitted here does not survive
    // — it throws later, outside this try, as an uncaught store error instead
    // of the clean protocol defect this decoder exists to produce. The bundle
    // host got this right by construction (it normalized through
    // `decodeCanonicalJson(encodeCanonicalJson(...))`); the coordinator, which
    // normalized with a bare `assertJson`, admitted it.
    canonicalJson(encoded)
    if (encoded === null || typeof encoded !== "object" || Array.isArray(encoded)) {
      throw new TypeError(`${label} exit must be an object`)
    }
    observedKind = encoded.kind
    if (encoded.kind === "success") {
      if (canonicalJson(Object.keys(encoded).sort()) !== canonicalJson(["kind", "value"])) {
        throw new TypeError(`${label} success exit has invalid fields`)
      }
      return {
        kind: "success",
        value: validateDurableValue(route.schemas.success, encoded.value, `${label} success`)
      }
    }
    if (encoded.kind === "failure") {
      if (canonicalJson(Object.keys(encoded).sort()) !== canonicalJson(["error", "kind"])) {
        throw new TypeError(`${label} failure exit has invalid fields`)
      }
      return {
        kind: "failure",
        error: validateDurableValue(route.schemas.error, encoded.error, `${label} failure`)
      }
    }
    if (encoded.kind === "defect") {
      if (canonicalJson(Object.keys(encoded).sort()) !== canonicalJson(["defect", "kind"])) {
        throw new TypeError(`${label} defect exit has invalid fields`)
      }
      const defect = encoded.defect
      if (defect === null || typeof defect !== "object" || Array.isArray(defect)) {
        throw new TypeError(`${label} defect payload must be an object`)
      }
      const expectedKeys = defect.stack === undefined
        ? ["message", "name"]
        : ["message", "name", "stack"]
      if (
        canonicalJson(Object.keys(defect).sort()) !== canonicalJson(expectedKeys) ||
        typeof defect.name !== "string" ||
        typeof defect.message !== "string" ||
        (defect.stack !== undefined && typeof defect.stack !== "string")
      ) {
        throw new TypeError(`${label} defect payload has invalid fields`)
      }
      return {
        kind: "defect",
        defect: {
          name: defect.name,
          message: defect.message,
          ...(defect.stack === undefined ? {} : { stack: defect.stack })
        }
      }
    }
    throw new TypeError(`${label} exit has an unknown kind`)
  } catch (error) {
    return {
      kind: "defect",
      defect: {
        name: observedKind === "success"
          ? "SuccessCodecDefect"
          : observedKind === "failure"
            ? "FailureCodecDefect"
            : surface.protocolDefectName,
        message: error instanceof Error ? error.message : `${label} exit failed its durable codec`
      }
    }
  }
}

export const durableErrorPayload = (
  schema: StructuralDurableSchema,
  identity: string,
  payload: unknown
): JsonValue => validateDurableValue(schema, { version: 1, identity, payload }, "durable Error")
