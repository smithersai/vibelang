/** Runtime representation of the language's recoverable failure channel. */
export const VIBE_FAILURE = Symbol.for("vibelang.failure");
const localFailures = new WeakSet<object>();

export class VibeFailure extends Error {
  declare readonly _tag: string;

  constructor(tag: string, fields?: Record<string, unknown>) {
    super(formatFailure(tag, fields));
    this.name = tag;
    if (fields) {
      for (const [name, value] of Object.entries(fields)) {
        if (["_tag", "name", "message", "stack", "__proto__"].includes(name)) {
          throw new TypeError(`failure payload field '${name}' is reserved`);
        }
        Object.defineProperty(this, name, { value, enumerable: true });
      }
    }
    Object.defineProperty(this, "_tag", { value: tag, enumerable: true });
    Object.defineProperty(this, VIBE_FAILURE, { value: true });
    localFailures.add(this);
  }
}

function formatFailure(tag: string, fields?: Record<string, unknown>): string {
  if (!fields || Object.keys(fields).length === 0) return tag;
  return `${tag} ${JSON.stringify(fields)}`;
}

export function isVibeFailure(value: unknown): value is VibeFailure {
  return typeof value === "object" && value !== null && localFailures.has(value);
}

/** Optional asserted unwrap. Absence is a defect, not a recoverable failure. */
export function unwrapOptional<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("VibeLang defect: asserted optional was absent");
  }
  return value;
}

export function throwExpression(error: unknown): never {
  throw error;
}

function recoverOrRethrow<R>(error: unknown, recover: (failure: VibeFailure) => R): R {
  if (isVibeFailure(error)) return recover(error);
  throw error;
}

/**
 * Lowering target for a VibeLang catch expression. It deliberately supports
 * both eager values and promises so the failure/defect split is identical on
 * both sides of an await.
 */
export function catchFailure<T, R>(
  body: () => T | Promise<T>,
  recover: (failure: VibeFailure) => R | Promise<R>,
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
export { VibeFailure as __VSError, catchFailure as __vsCatch };
export { unwrapOptional as __vsUnwrap };
export { throwExpression as __vsThrow };
