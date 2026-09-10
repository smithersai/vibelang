/**
 * Value encoding for keyed-source/v2 nodes. Canonical JSON may sort object
 * properties; authored property order is therefore explicit DATA on the wire.
 * Both arrays and objects project through `items`, so the native compiler can
 * translate a Ref path without inspecting a provider's eventual answer.
 * This module is a runtime data codec, not a source compiler or an authority.
 */
import type { JsonPrimitive, JsonValue } from "./value.ts"

export type KeyedValue = JsonPrimitive
  | { readonly kind: "array"; readonly items: readonly KeyedValue[] }
  | { readonly kind: "object"; readonly items: Readonly<Record<string, KeyedValue>>; readonly order: readonly string[] }

// Limits apply to the ENCODED tree, including codec metadata. They fit the
// reviewed scheduler's cache and durable-attempt JSON boundary.
export const KEYED_VALUE_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024, depth: 128, nodes: 100_000, keyBytes: 16 * 1024 })

export class KeyedValueError extends TypeError {
  constructor(message: string) { super(message); this.name = "KeyedValueError" }
}

function refuse(message: string): never { throw new KeyedValueError(message) }
const wellFormed = (value: string): boolean => !/[\ud800-\udfff]/u.test(value)

/**
 * Platform-neutral codec implementation. The supplied predicate must be the
 * runtime's native proxy inspector, never a heuristic that touches the value.
 * Node/Bun bind node:util; a sandbox runner supplies its local native inspector
 * explicitly. No provider callback or imported source compiler participates.
 */
export const createKeyedValueCodec = (isProxy: (value: unknown) => boolean) => {
  if (typeof isProxy !== "function") refuse("keyed codec requires a native proxy inspector")
  const encoder = new TextEncoder()
  const byteLength = (value: string): number => encoder.encode(value).length
  // Only fresh inert data from snapshotKeyedJSON reaches this freezer.
  const deepFreeze = <T>(value: T): T => {
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) deepFreeze(child)
      Object.freeze(value)
    }
    return value
  }

  /** @internal Inert JSON snapshot, preserving order and never invoking getters or proxies. */
  const snapshotKeyedJSON = (value: unknown): JsonValue => {
    const active = new Set<object>()
    let visited = 0, bytes = 0
    const charge = (count: number): void => {
      bytes += count
      if (bytes > KEYED_VALUE_LIMITS.bytes) refuse("keyed value exceeds its encoded byte budget")
    }
    const string = (value: string): void => {
      if (!wellFormed(value)) refuse("keyed value contains ill-formed Unicode")
      if (value.length > KEYED_VALUE_LIMITS.bytes) refuse("keyed value string exceeds its byte budget")
      charge(byteLength(JSON.stringify(value)))
    }
    const visit = (input: unknown, depth: number): JsonValue => {
      if (++visited > KEYED_VALUE_LIMITS.nodes || depth > KEYED_VALUE_LIMITS.depth) refuse("keyed value exceeds its traversal budget")
      if (input === null || typeof input === "boolean") { charge(input === null ? 4 : input ? 4 : 5); return input }
      if (typeof input === "string") { string(input); return input }
      if (typeof input === "number") {
        if (!Number.isFinite(input) || Object.is(input, -0)) refuse("keyed value requires a finite number other than negative zero")
        charge(JSON.stringify(input).length)
        return input
      }
      if (typeof input !== "object" || isProxy(input)) refuse("keyed value requires inert JSON, not executable or proxy data")
      if (active.has(input)) refuse("keyed value contains a cycle")
      const array = Array.isArray(input), prototype = Object.getPrototypeOf(input)
      if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) refuse("keyed value has an unsupported prototype")
      const keys = Reflect.ownKeys(input)
      if (keys.length > KEYED_VALUE_LIMITS.nodes + (array ? 1 : 0)) refuse("keyed value exceeds its member budget")
      // Capture each descriptor once. No direct property reads, toJSON, getters,
      // iterators, coercions or provider callbacks participate in serialization.
      const entries: [string, unknown][] = []
      const length = array ? Object.getOwnPropertyDescriptor(input, "length")!.value as number : 0
      for (const key of keys) {
        if (array && key === "length") continue
        if (typeof key !== "string" || !wellFormed(key)) refuse("keyed value requires Unicode string property names")
        if (byteLength(key) > KEYED_VALUE_LIMITS.keyBytes) refuse("keyed value property name exceeds its byte budget")
        if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) !== entries.length)) refuse("keyed value array is sparse or has extra properties")
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!
        if (!("value" in descriptor) || !descriptor.enumerable) refuse("keyed value has an accessor or hidden property")
        entries.push([key, descriptor.value])
      }
      if (array && length !== entries.length) refuse("keyed value array is sparse")
      active.add(input)
      try {
        charge(2 + Math.max(0, entries.length - 1))
        if (array) return entries.map(([, value]) => visit(value, depth + 1))
        const out: Record<string, JsonValue> = Object.create(null)
        for (const [key, value] of entries) {
          string(key); charge(1)
          out[key] = visit(value, depth + 1)
        }
        return out
      } finally { active.delete(input) }
    }
    return visit(value, 0)
  }

  const encodeKeyedValue = (value: unknown): KeyedValue => {
    const snapshot = snapshotKeyedJSON(value)
    const encode = (value: JsonValue): KeyedValue => {
      if (value === null || typeof value !== "object") return value
      if (Array.isArray(value)) return { kind: "array", items: value.map(encode) }
      const order = Object.keys(value), items: Record<string, KeyedValue> = Object.create(null)
      for (const name of order) items[name] = encode(value[name])
      return { kind: "object", items, order }
    }
    // Codec expansion, not merely the smaller authored value, must fit storage.
    return deepFreeze(snapshotKeyedJSON(encode(snapshot)) as KeyedValue)
  }

  const decodeKeyedValue = (value: unknown): JsonValue => {
    const snapshot = snapshotKeyedJSON(value)
    const decode = (value: JsonValue): JsonValue => {
      if (value === null || typeof value !== "object") return value
      if (Array.isArray(value)) return refuse("unwrapped array is not a keyed value")
      const keys = Object.keys(value).sort().join(",")
      if (value.kind === "array" && keys === "items,kind" && Array.isArray(value.items)) {
        return value.items.map(decode)
      }
      if (value.kind !== "object" || keys !== "items,kind,order" || value.items === null ||
        typeof value.items !== "object" || Array.isArray(value.items) || !Array.isArray(value.order)) {
        return refuse("invalid keyed value container")
      }
      const names = Object.keys(value.items), order = value.order, seen = new Set<string>()
      if (names.length !== order.length) refuse("keyed value order does not cover its fields")
      const out: Record<string, JsonValue> = {}
      for (const name of order) {
        if (typeof name !== "string" || seen.has(name) || !Object.hasOwn(value.items, name)) refuse("invalid keyed value field order")
        seen.add(name)
        // A normal mutable authored object, with __proto__ defined as own data.
        Object.defineProperty(out, name, { value: decode(value.items[name]), enumerable: true, writable: true, configurable: true })
      }
      if (Object.keys(out).some((key, index) => key !== order[index])) refuse("keyed value order contradicts integer-index enumeration")
      return out
    }
    return decode(snapshot)
  }

  /** Translate an authored data projection into the bound storage representation. */
  const keyedValuePath = (path: readonly string[]): readonly string[] => {
    const snapshot = snapshotKeyedJSON(path)
    if (!Array.isArray(snapshot) || snapshot.some(key => typeof key !== "string") || snapshot.length > 64) {
      return refuse("keyed value projection requires a bounded string path")
    }
    return Object.freeze((snapshot as string[]).flatMap(key => ["items", key]))
  }

  return Object.freeze({ snapshotKeyedJSON, encodeKeyedValue, decodeKeyedValue, keyedValuePath })
}
