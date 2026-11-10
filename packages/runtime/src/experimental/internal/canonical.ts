/**
 * VIP-44 identity: what counts as the same input. A value is copied with its
 * sets and maps in sorted order, encoded with its Schema's JSON codec, and
 * written as RFC 8785 canonical JSON. Equal values give equal text however
 * their sets, maps and object keys were built, and a SHA-256 of that text is
 * the value's hash. `sortCollections` is ported from Smithers'
 * `@smthrs/canonical`, which defines it for the same VIP.
 *
 * @internal
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { WebCrypto } from "effect/crypto"

// Objects whose state lives in internal slots. None can hold a collection.
const isSlotted = (value: object): boolean =>
  value instanceof Date ||
  value instanceof RegExp ||
  value instanceof ArrayBuffer ||
  ArrayBuffer.isView(value) ||
  value instanceof WeakMap ||
  value instanceof WeakSet ||
  value instanceof Promise ||
  (typeof URL === "function" && value instanceof URL)

const isObject = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function"

const children = (value: object): Array<unknown> => {
  if (typeof value === "function" || isSlotted(value)) return []
  const out: Array<unknown> = []
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)!
    if ("value" in descriptor) out.push(descriptor.value)
  }
  if (value instanceof Set) {
    for (const entry of value) out.push(entry)
  } else if (value instanceof Map) {
    for (const [key, entry] of value) out.push(key, entry)
  }
  return out
}

// Every object that reaches a Set or a Map, the collections included.
const dirtyObjects = (root: unknown): Set<object> => {
  const parents = new Map<object, Array<object>>()
  const pending: Array<object> = []
  const dirty = new Set<object>()
  if (isObject(root)) {
    parents.set(root, [])
    pending.push(root)
  }
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    let kids: Array<unknown>
    try {
      kids = children(next)
      if (next instanceof Set || next instanceof Map) dirty.add(next)
    } catch {
      kids = []
    }
    for (const child of kids) {
      if (!isObject(child)) continue
      const known = parents.get(child)
      if (known === undefined) {
        parents.set(child, [next])
        pending.push(child)
      } else {
        known.push(next)
      }
    }
  }
  const spread = [...dirty]
  for (let next = spread.pop(); next !== undefined; next = spread.pop()) {
    for (const parent of parents.get(next)!) {
      if (!dirty.has(parent)) {
        dirty.add(parent)
        spread.push(parent)
      }
    }
  }
  return dirty
}

const constructorName = (prototype: object | null): string => {
  if (prototype === null) return ""
  const descriptor = Reflect.getOwnPropertyDescriptor(prototype, "constructor")
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "function"
    ? String(descriptor.value.name)
    : ""
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

// A stable text rank of a sorted value; distinct data never shares a rank.
const rank = (value: unknown, path: Array<object> = []): string => {
  switch (typeof value) {
    case "string":
      return `s${JSON.stringify(value)}`
    case "number":
      return `n${value}`
    case "bigint":
      return `b${value}`
    case "boolean":
      return value ? "t" : "f"
    case "undefined":
      return "u"
    case "symbol":
      return `y${JSON.stringify(value.description ?? "")}`
    case "function":
      try {
        return `F${JSON.stringify(value.name)}`
      } catch {
        return "x"
      }
  }
  if (value === null) return "z"
  try {
    return rankObject(value as object, path)
  } catch {
    return "x"
  }
}

const rankObject = (object: object, path: Array<object>): string => {
  const back = path.lastIndexOf(object)
  if (back !== -1) return `^${path.length - back}`
  if (object instanceof Date) return `d${object.getTime()}`
  if (object instanceof RegExp) return `r${JSON.stringify(object.source)}${JSON.stringify(object.flags)}`
  if (typeof URL === "function" && object instanceof URL) return `l${JSON.stringify(object.href)}`
  if (ArrayBuffer.isView(object)) {
    const bytes = new Uint8Array(object.buffer, object.byteOffset, object.byteLength)
    return `v${JSON.stringify(object.constructor.name)}[${bytes.join(",")}]`
  }
  if (object instanceof ArrayBuffer) return `a[${new Uint8Array(object).join(",")}]`
  path.push(object)
  try {
    let entries = ""
    if (object instanceof Set) {
      entries = `S[${Array.from(object, (entry) => rank(entry, path)).join(",")}]`
    } else if (object instanceof Map) {
      entries = `M[${Array.from(object, ([key, entry]) => `${rank(key, path)}:${rank(entry, path)}`).join(",")}]`
    }
    const members = Reflect.ownKeys(object)
      .filter((key): key is string => typeof key === "string")
      .sort(compareText)
      .map((key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key)!
        const member = "value" in descriptor ? rank(descriptor.value, path) : "get"
        return `${JSON.stringify(key)}:${member}`
      })
    return `o${JSON.stringify(constructorName(Object.getPrototypeOf(object)))}${entries}{${members.join(",")}}`
  } finally {
    path.pop()
  }
}

const byRank = <A>(values: ReadonlyArray<A>, rankOf: (value: A) => string): Array<A> =>
  values
    .map((value) => ({ value, rank: rankOf(value) }))
    .sort((left, right) => compareText(left.rank, right.rank))
    .map(({ value }) => value)

const keepIntegrity = (source: object, copy: object): void => {
  if (Object.isFrozen(source)) Object.freeze(copy)
  else if (Object.isSealed(source)) Object.seal(copy)
  else if (!Object.isExtensible(source)) Object.preventExtensions(copy)
}

const shellOf = (value: object): object => {
  const prototype = Object.getPrototypeOf(value)
  const shell: object = value instanceof Set
    ? new Set()
    : value instanceof Map
    ? new Map()
    : Array.isArray(value)
    ? []
    : Object.create(prototype)
  if (Object.getPrototypeOf(shell) !== prototype) Object.setPrototypeOf(shell, prototype)
  return shell
}

/**
 * Copies `value` with every Set's and every Map's entries in sorted order, at
 * every depth. Arrays keep their order; object keys are left to the canonical
 * writer. Only what reaches a collection is copied, so cycles and shared
 * references survive.
 */
export const sortCollections = <A>(value: A): A => {
  const dirty = dirtyObjects(value)
  if (dirty.size === 0) return value
  const copies = new Map<object, object>()
  const copy = (current: unknown): unknown => {
    if (!isObject(current) || !dirty.has(current)) return current
    const known = copies.get(current)
    if (known !== undefined) return known
    const shell = shellOf(current)
    copies.set(current, shell)
    if (current instanceof Set) {
      const target = shell as Set<unknown>
      for (const entry of byRank(Array.from(current, copy), (entry) => rank(entry))) target.add(entry)
    } else if (current instanceof Map) {
      const target = shell as Map<unknown, unknown>
      const entries = Array.from(current, ([key, entry]) => [copy(key), copy(entry)] as const)
      for (const [key, entry] of byRank(entries, ([key, entry]) => `${rank(key)}\u0000${rank(entry)}`)) {
        target.set(key, entry)
      }
    }
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key)!
      if ("value" in descriptor) descriptor.value = copy(descriptor.value)
      Reflect.defineProperty(shell, key, descriptor)
    }
    keepIntegrity(current, shell)
    return shell
  }
  return copy(value) as A
}

/**
 * RFC 8785 canonical JSON of a JSON value: object keys sorted by UTF-16 code
 * units, numbers and strings as ECMAScript's `JSON.stringify` writes them.
 * A non-finite number, a lone surrogate or a value that is not JSON throws.
 */
export const canonicalJson = (value: unknown): string => {
  switch (typeof value) {
    case "string":
      for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index)
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = value.charCodeAt(index + 1)
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("canonical JSON: lone surrogate")
          index++
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          throw new TypeError("canonical JSON: lone surrogate")
        }
      }
      return JSON.stringify(value)
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`canonical JSON: ${value} is not a JSON number`)
      return JSON.stringify(value)
    case "boolean":
      return value ? "true" : "false"
    case "object":
      if (value === null) return "null"
      if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? "null" : canonicalJson(item)).join(",")}]`
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new TypeError("canonical JSON: only plain objects and arrays")
      }
      return `{${
        Object.keys(value)
          .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
          .sort(compareText)
          .map((key) => `${canonicalJson(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
          .join(",")
      }}`
  }
  throw new TypeError(`canonical JSON: a ${typeof value} is not JSON`)
}

/** The value's encoded snapshot: sorted collections through the Schema's JSON codec. */
export const snapshot = <S extends Schema.Top>(schema: S, value: S["Type"]): unknown =>
  Schema.encodeSync(Schema.toCodecJson(schema) as unknown as Schema.Codec<unknown, unknown>)(sortCollections(value))

/** The value's identity text. Equal inputs give equal text. */
export const identity = <S extends Schema.Top>(schema: S, value: S["Type"]): string => canonicalJson(snapshot(schema, value))

const encoder = new TextEncoder()

/** SHA-256 of `text`, as 64 hex characters. */
export const sha256 = (text: string): Effect.Effect<string> =>
  Effect.gen(function*() {
    const crypto = yield* WebCrypto.WebCrypto
    const bytes = new Uint8Array(yield* Effect.promise(() => crypto.subtle.digest("SHA-256", encoder.encode(text))))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  })
