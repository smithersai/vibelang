import { createHash } from "node:crypto";

export type StableJson = null | boolean | number | string | StableJson[] | { [key: string]: StableJson };

/** Clone the only values permitted in build identities and cached loader IR. */
export function stableClone(value: unknown, path = "value", seen = new Set<object>()): StableJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is not durable JSON: non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new TypeError(`${path} is not durable JSON: ${typeof value}`);
  if (seen.has(value)) throw new TypeError(`${path} is not durable JSON: cyclic value`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError(`${path} is not durable JSON: exotic array`);
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          throw new TypeError(`${path} is not durable JSON: unsupported array property ${String(key)}`);
        }
      }
      const output: StableJson[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}] is not durable JSON: sparse array hole`);
        output.push(stableClone(value[index], `${path}[${index}]`, seen));
      }
      return output;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} is not durable JSON: ${prototype?.constructor?.name ?? "exotic object"}`);
    }
    const output = Object.create(null) as Record<string, StableJson>;
    for (const key of Reflect.ownKeys(value).sort((left, right) => String(left).localeCompare(String(right)))) {
      if (typeof key !== "string") throw new TypeError(`${path} is not durable JSON: symbol property`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
        throw new TypeError(`${path}.${key} is not durable JSON: accessor or non-enumerable property`);
      }
      output[key] = stableClone(descriptor.value, `${path}.${key}`, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function freezeStable<T extends StableJson>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Array.isArray(value) ? value : Object.values(value)) freezeStable(child);
    Object.freeze(value);
  }
  return value;
}

function canonicalStable(value: StableJson): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStable(value[key]!)}`).join(",")}}`;
}

/** Canonical JSON is the temporary cross-target wire format for this spike. */
export function canonical(value: unknown): string {
  return canonicalStable(stableClone(value));
}

export function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
