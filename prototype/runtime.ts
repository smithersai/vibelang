// VibeLang runtime — the tiny ambient-context + failure-branding kernel.
// Everything here is deliberately minimal; see NOTES.md for shortcuts taken.

/** Well-known brand: anything thrown that carries this symbol is a "failure".
 *  Everything else thrown is a "defect" and must not be swallowed by catch-expressions. */
export const FAILURE: unique symbol = Symbol.for("vibelang.failure") as any;

/** Base class for lowered `error Name { ... }` declarations.
 *  (Spec says "class extending Error" — declared errors extend this, which extends Error.
 *  The brand is set in the constructor to dodge computed-symbol class-field fussiness.) */
export class __VSError extends Error {
  readonly _tag: string;
  constructor(tag: string, fields?: Record<string, unknown>) {
    super(fields && Object.keys(fields).length ? `${tag} ${JSON.stringify(fields)}` : tag);
    this.name = tag;
    this._tag = tag;
    (this as any)[FAILURE] = true;
    if (fields) Object.assign(this, fields);
  }
}

export function __vsIsFailure(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as any)[FAILURE] === true;
}

/** `try expr` lowering. Pass-through: JS `throw` already propagates; this exists so
 *  try-expressions have a lowering target (and a place to hook typed channels later). */
export function __vsTry<T>(thunk: () => T): T {
  return thunk();
}

/** `expr catch |e| fallback` lowering. Branded failures are handled; defects rethrow. */
export function __vsCatch<T, R>(thunk: () => T, handler: (e: any) => R): T | R {
  try {
    return thunk();
  } catch (e) {
    if (__vsIsFailure(e)) return handler(e);
    throw e; // defect: not ours to catch
  }
}

// ---- capabilities / ambient DI: a module-global stack of frames ----

const __ctxStack: Array<Record<string, unknown>> = [];

/** `provide { A: a } { ... }` lowering: push frame, run body, always pop. */
export function __vsProvide<T>(frame: Record<string, unknown>, body: () => T): T {
  __ctxStack.push(frame);
  try {
    return body();
  } finally {
    __ctxStack.pop();
  }
}

/** `uses A` lowering target: nearest enclosing provide-frame wins.
 *  A missing capability is a DEFECT (plain Error, unbranded) on purpose. */
export function __vsUse(name: string): any {
  for (let i = __ctxStack.length - 1; i >= 0; i--) {
    if (name in __ctxStack[i]) return __ctxStack[i][name];
  }
  throw new Error(`VibeLang defect: capability '${name}' not provided`);
}
