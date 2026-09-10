const localPanics = new WeakSet<object>();

/**
 * The distinguished checked panic channel. Instances are recognized by local
 * construction, never by a public symbol or a user-controlled string tag.
 */
export class Panic extends Error {
  declare private readonly __panicTypeBrand: void;

  constructor(message = "VibeLang panic", options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "Panic";
    localPanics.add(this);
  }
}

export function isPanic(value: unknown): value is Panic {
  return typeof value === "object" && value !== null && localPanics.has(value);
}

export function makePanic(value?: unknown): Panic {
  if (isPanic(value)) return value;
  if (typeof value === "string") return new Panic(value);
  if (value instanceof Error) {
    return new Panic(value.message ? `VibeLang panic: ${value.message}` : "VibeLang panic", { cause: value });
  }
  if (value === undefined) return new Panic();
  return new Panic("VibeLang panic", { cause: value });
}

export function panic(value?: unknown): never {
  throw makePanic(value);
}

/** Catch only the distinguished panic channel. All other throws remain throws. */
export function catchPanic<T, R>(body: () => T, recover: (failure: Panic) => R): T | R {
  try {
    return body();
  } catch (error) {
    if (isPanic(error)) return recover(error);
    throw error;
  }
}

/** Async counterpart kept separate so thenable inspection cannot blur boundaries. */
export async function catchPanicPromise<T, R>(
  body: () => PromiseLike<T>,
  recover: (failure: Panic) => R | PromiseLike<R>,
): Promise<T | R> {
  try {
    return await body();
  } catch (error) {
    if (isPanic(error)) return await recover(error);
    throw error;
  }
}

declare global {
  namespace Reflect {
    function panic(value?: unknown): never;
  }
}

const reflectPanic = Object.getOwnPropertyDescriptor(Reflect, "panic");
if (reflectPanic === undefined) {
  Object.defineProperty(Reflect, "panic", {
    value: panic,
    enumerable: false,
    configurable: false,
    writable: false,
  });
} else if (reflectPanic.value !== panic) {
  throw new TypeError("Reflect.panic is already installed by an incompatible runtime");
}

export { panic as __vsPanic };
export { makePanic as __vsPanicValue };
