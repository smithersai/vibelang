import { createHash } from "node:crypto"
import { closeSync, openSync, readSync } from "node:fs"
import type { ComponentIdentity, JsonValue } from "./types.ts"

const IDENTITY_NAME = /^[A-Za-z0-9][A-Za-z0-9$._/@:+-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const FUNCTION_TO_STRING = Function.prototype.toString

function ownData(
  value: object,
  key: PropertyKey,
  path: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
    throw new TypeError(`${path}.${String(key)} must be an enumerable data property`)
  }
  return descriptor.value
}

function plainRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must have Object.prototype or null prototype`)
  }
}

/** Strict canonical JSON used only for durable identity inputs. */
export function canonicalIdentityJson(
  value: unknown,
  path = "identity value",
  seen = new Set<object>(),
): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`)
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (typeof value !== "object") throw new TypeError(`${path} is not canonical JSON`)
  if (seen.has(value)) throw new TypeError(`${path} is cyclic`)
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError(`${path} is an exotic array`)
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          throw new TypeError(`${path} has unsupported array property ${String(key)}`)
        }
      }
      const parts: string[] = []
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}] is an array hole`)
        parts.push(canonicalIdentityJson(ownData(value, String(index), path), `${path}[${index}]`, seen))
      }
      return `[${parts.join(",")}]`
    }

    plainRecord(value, path)
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError(`${path} contains a symbol property`)
    }
    const names = (keys as string[]).sort()
    return `{${names.map((name) =>
      `${JSON.stringify(name)}:${canonicalIdentityJson(ownData(value, name, path), `${path}.${name}`, seen)}`,
    ).join(",")}}`
  } finally {
    seen.delete(value)
  }
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function sha256Json(value: unknown): string {
  return sha256Text(canonicalIdentityJson(value))
}

/** Hash a real artifact without materializing a large runtime binary. */
export function sha256File(file: string | URL): string {
  const descriptor = openSync(file, "r")
  const hash = createHash("sha256")
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null)
      if (count === 0) break
      hash.update(buffer.subarray(0, count))
    }
    return hash.digest("hex")
  } finally {
    closeSync(descriptor)
  }
}

export function functionArtifactDigest(fn: Function): string {
  return sha256Text(FUNCTION_TO_STRING.call(fn))
}

/** Validate, detach, and freeze an externally supplied identity. */
export function snapshotComponentIdentity(
  value: ComponentIdentity,
  path = "component identity",
): ComponentIdentity {
  plainRecord(value, path)
  const keys = Reflect.ownKeys(value)
  if (keys.length !== 3 || !keys.every((key) =>
    typeof key === "string" && ["name", "artifactDigest", "configDigest"].includes(key))) {
    throw new TypeError(`${path} must contain exactly name, artifactDigest, and configDigest`)
  }
  const name = ownData(value, "name", path)
  const artifactDigest = ownData(value, "artifactDigest", path)
  const configDigest = ownData(value, "configDigest", path)
  if (typeof name !== "string" || !IDENTITY_NAME.test(name)) {
    throw new TypeError(`${path}.name is not a stable component name`)
  }
  if (typeof artifactDigest !== "string" || !SHA256.test(artifactDigest)) {
    throw new TypeError(`${path}.artifactDigest must be a lowercase SHA-256 digest`)
  }
  if (typeof configDigest !== "string" || !SHA256.test(configDigest)) {
    throw new TypeError(`${path}.configDigest must be a lowercase SHA-256 digest`)
  }
  return Object.freeze({ name, artifactDigest, configDigest })
}

export function defineComponentIdentity(options: {
  readonly name: string
  readonly artifactDigest?: string
  readonly artifact?: string
  readonly configDigest?: string
  readonly config?: JsonValue
}): ComponentIdentity {
  const artifactDigest = options.artifactDigest ??
    (options.artifact === undefined ? undefined : sha256Text(options.artifact))
  const configDigest = options.configDigest ?? sha256Json(options.config ?? null)
  if (!artifactDigest) throw new TypeError("component identity needs artifact or artifactDigest")
  return snapshotComponentIdentity({ name: options.name, artifactDigest, configDigest })
}

export function componentIdentityJson(identity: ComponentIdentity): Record<string, JsonValue> {
  const stable = snapshotComponentIdentity(identity)
  return {
    name: stable.name,
    artifactDigest: stable.artifactDigest,
    configDigest: stable.configDigest,
  }
}
