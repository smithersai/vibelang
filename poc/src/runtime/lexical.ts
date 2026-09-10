/** Compiler-only references preserve a method's home object across a moved body. */
export function __vsSuperReference<A>(get: () => A, set?: (value: A) => void): { value: A } {
  return Object.defineProperty({}, "value", { get, ...(set === undefined ? {} : { set }) }) as { value: A };
}

const apply = Reflect.apply;

/** Used only in callee/tag position; reading a super member itself stays unbound. */
export function __vsBindSuper<F>(fn: F, receiver: unknown): F {
  // Keep optional calls lazy, and let a non-callable fail *after* its arguments
  // have been evaluated, exactly as an ordinary method call would.
  if (fn === undefined || fn === null) return fn;
  return ((...args: unknown[]) => apply(fn as (...args: unknown[]) => unknown, receiver, args)) as F;
}
