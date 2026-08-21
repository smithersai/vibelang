import { createHash } from "node:crypto";

/** Canonical JSON is the temporary cross-target wire format for this spike. */
export function canonical(value: unknown): string {
  if (value === undefined) throw new TypeError("value is not durable JSON: undefined");
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("durable values cannot contain non-finite numbers");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`value[${index}] is not durable JSON: sparse array hole`);
      items.push(canonical(value[index]));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  throw new TypeError(`value is not durable JSON: ${typeof value}`);
}

export function digest(value: unknown): string {
  const input = typeof value === "string" ? value : canonical(value);
  return createHash("sha256").update(input).digest("hex");
}
