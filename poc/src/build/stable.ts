import { createHash } from "node:crypto";

export type StableJson = null | boolean | number | string | StableJson[] | { [key: string]: StableJson };

const MAX_STABLE_DEPTH = 512;
const MAX_STABLE_NODES = 1_000_000;

interface CloneState {
  readonly seen: Set<object>;
  nodes: number;
}

/** Locale-independent ordering for values that participate in build identities. */
export function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Clone the only values permitted in build identities and cached loader IR. */
export function stableClone(value: unknown, path = "value"): StableJson {
  return cloneStable(value, path, { seen: new Set<object>(), nodes: 0 }, 0);
}

function cloneStable(value: unknown, path: string, state: CloneState, depth: number): StableJson {
  if (depth > MAX_STABLE_DEPTH) throw new TypeError(`${path} is not durable JSON: nesting is too deep`);
  if (++state.nodes > MAX_STABLE_NODES) throw new TypeError(`${path} is not durable JSON: value is too large`);
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is not durable JSON: non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new TypeError(`${path} is not durable JSON: ${typeof value}`);
  if (state.seen.has(value)) throw new TypeError(`${path} is not durable JSON: cyclic value`);
  state.seen.add(value);
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
        output.push(cloneStable(value[index], `${path}[${index}]`, state, depth + 1));
      }
      return output;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} is not durable JSON: ${prototype?.constructor?.name ?? "exotic object"}`);
    }
    const output = Object.create(null) as Record<string, StableJson>;
    for (const key of Reflect.ownKeys(value).sort((left, right) => compareStableStrings(String(left), String(right)))) {
      if (typeof key !== "string") throw new TypeError(`${path} is not durable JSON: symbol property`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
        throw new TypeError(`${path}.${key} is not durable JSON: accessor or non-enumerable property`);
      }
      output[key] = cloneStable(descriptor.value, `${path}.${key}`, state, depth + 1);
    }
    return output;
  } finally {
    state.seen.delete(value);
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
