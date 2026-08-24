import { registerErrorType } from "./errors.ts";

/** Compatibility representation used only by the historical syntax spike. */
export const SMITHERS_FAILURE = Symbol.for("smithers.failure");
const localFailures = new WeakSet<object>();

export class SmithersFailure extends Error {
  declare readonly _tag: string;

  constructor(tag: string, fields?: Record<string, unknown>) {
    super(formatFailure(tag, fields));
    this.name = tag;
    if (fields) {
      if (Object.getPrototypeOf(fields) !== Object.prototype && Object.getPrototypeOf(fields) !== null) {
        throw new TypeError("failure payload must be a plain object");
      }
      for (const name of Reflect.ownKeys(fields)) {
        if (typeof name !== "string") throw new TypeError("failure payload cannot contain symbol fields");
        if (["_tag", "name", "message", "stack", "cause", "__proto__", "is", "matches", "match", "matchPartial", "rootCause"].includes(name)) {
          throw new TypeError(`failure payload field '${name}' is reserved`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(fields, name);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(`failure payload field '${name}' must be an enumerable data property`);
        }
        Object.defineProperty(this, name, { value: descriptor.value, enumerable: true });
      }
    }
    Object.defineProperty(this, "_tag", { value: tag, enumerable: true });
    Object.defineProperty(this, SMITHERS_FAILURE, { value: true });
    localFailures.add(this);
  }
}

function formatFailure(tag: string, fields?: Record<string, unknown>): string {
  if (!fields || Object.keys(fields).length === 0) return tag;
  try {
    return `${tag} ${JSON.stringify(fields)}`;
  } catch {
    return tag;
  }
}

registerErrorType(SmithersFailure, "smithers:legacy/SmithersFailure@1");

export function isSmithersFailure(value: unknown): value is SmithersFailure {
  return typeof value === "object" && value !== null && localFailures.has(value);
}

export function throwExpression(error: unknown): never {
  throw error;
}

function recoverOrRethrow<R>(error: unknown, recover: (failure: SmithersFailure) => R): R {
  if (isSmithersFailure(error)) return recover(error);
  throw error;
}

/**
 * Lowering target for a Smithers catch expression. It deliberately supports
 * both eager values and promises so the failure/defect split is identical on
 * both sides of an await.
 */
export function catchFailure<T, R>(
  body: () => T | Promise<T>,
  recover: (failure: SmithersFailure) => R | Promise<R>,
): T | R | Promise<T | R> {
  try {
    const value = body();
    if (isPromiseLike(value)) {
      return Promise.resolve(value).catch((error) => recoverOrRethrow(error, recover));
    }
    return value;
  } catch (error) {
    return recoverOrRethrow(error, recover);
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

// The spike compiler aliases these imports when source bindings collide.
export { SmithersFailure as __VSError, catchFailure as __vsCatch };
export { throwExpression as __vsThrow };
