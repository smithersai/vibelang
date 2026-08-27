/**
 * @module
 * The compiler-owned brand-introspection seam for authored `.sm`.
 *
 * `specification/failures.mdx`, "Compiler-Owned Modules": "`smthrs/result` and
 * the Smithers runtime are **compiler-owned** and MUST NOT be required to be
 * authored in Smithers." A `.sm` standard-library module may therefore *call*
 * the runtime, and `specification/compatibility.mdx`, "Foreign Boundary", says
 * how: "Trusted `@throws {never}` metadata opts out" of the default panic case.
 * This module is that trust claim, made once, in the compiler's own tree.
 *
 * The reason it is a separate module rather than a marker on `result.ts` is the
 * forgery guarantee. `result.ts` also exports `__vsResultSuccess` /
 * `__vsResultFailure`, the lowering hooks, and `values.ts` exports
 * `RuntimeValues.success` / `.failure`. `specification/failures.mdx`: "Authors
 * MUST NOT need to write `Result.ok(...)` or `Result.err(...)`. Those
 * constructors MUST NOT be part of the ordinary Smithers authoring API."
 * Trusting a whole runtime module would put a Result *constructor* one import
 * away from authored `.sm`. Every export here is a predicate or an assertion:
 * nothing can construct a Result, a Panic, or an Error, and nothing hands an
 * object back, so trusting it cannot widen the authoring API and cannot launder
 * foreign provenance either.
 *
 * Every export re-exposes the runtime's own private-`WeakSet` brand unchanged.
 * A structural look-alike — `{ isOk: () => true }`, `Object.create(
 * ResultValue.prototype)`, a Proxy — is not in the set and is refused, exactly
 * as it is refused inside the runtime. A shape test would answer differently,
 * which is why authored `.sm` is given this seam instead of one.
 *
 * Module initialization defines no host binding and evaluates no host global,
 * so the module-level claim below is truthful on its own terms.
 * @throws {never}
 */
import { isPanic as isPanicBrand, type Panic } from "./panic.ts";
import { isResult as isResultBrand, rethrowPanics, type Result } from "./result.ts";

/**
 * True only for a Result the Smithers runtime itself constructed.
 *
 * @throws {never}
 */
export function isResult(value: unknown): value is Result<unknown, Error> {
  return isResultBrand(value);
}

/**
 * True only for a Panic the Smithers runtime itself constructed.
 *
 * `specification/failures.mdx`, "Foreign Exceptions": panic is the
 * distinguished channel, and recognizing it MUST NOT depend on a forgeable
 * user tag. `Object.create(Panic.prototype)` is not a Panic here.
 *
 * @throws {never}
 */
export function isPanic(value: unknown): value is Panic {
  return isPanicBrand(value);
}

/**
 * Lets a *materialized* panic resume unwinding, and narrows the Result that
 * carried it back to its recoverable channel.
 *
 * This is the `.sm` seam for the runtime's `rethrowPanics`, and it is
 * deliberately NOT a re-export of it. `rethrowPanics` hands its Result back,
 * and a Result is an object: every `.sm` that received one would then hit
 * `SMITHERS1508` ("returning an executable foreign value would lose its panic
 * provenance") on the very next `return`, plus `SMITHERS1507` on a method read
 * and `SMITHERS1301` because the value it returned was never consumed. A
 * per-function `@throws {never}` marker cannot help: the marker answers the
 * call's panic channel, and the wall is about the *object* crossing back. So
 * the seam performs the effect and returns nothing — the caller keeps the
 * Result it already had, which carries no foreign provenance at all. This is
 * the same shape `isResult` above uses for the same reason: a boolean crosses
 * back, never a value.
 *
 * The assertion signature is what makes it usable rather than merely safe. A
 * `void` function plus a caller-written `as Result<A, E>` was measured to leave
 * `SMITHERS1104` standing even for a Result the caller received as a parameter;
 * `asserts result is Result<A, E>` narrows at the checker, so the parameter and
 * generic-driver shapes the platform actually needs report zero diagnostics.
 *
 * Why re-raising is the required behaviour, not a choice:
 * `specification/failures.mdx`, "Foreign Exceptions": "Ordinary Result recovery
 * MUST NOT swallow panic implicitly." Dropping the panic-valued failure — or
 * reporting it as an ordinary `E` — is the one thing this boundary may not do.
 * And §"Panic Does Not Widen a Return Type": "A function that validates an
 * argument, refuses a forgery, or asserts an invariant MUST therefore be able
 * to abort with `panic(...)` while keeping a plain return type." That is why
 * the narrowed side is `Result<A, E>` and not `Result<A, E | Panic>`: a caller
 * that re-raises is not required to carry the panic in its own channel.
 *
 * A forged Result is refused here exactly as it is everywhere else: the runtime
 * reads its state through the private-`WeakSet` brand and panics with "forged
 * Result value" on anything it did not construct, so a structural look-alike
 * cannot use this seam to assert itself panic-free.
 *
 * @throws {never} It raises only the distinguished panic channel, which
 * `failures.mdx` keeps separate from the checked failure channel this marker
 * speaks about.
 */
export function assertNoPanic<A, E extends Error>(
  result: Result<A, E | Panic>,
): asserts result is Result<A, E> {
  rethrowPanics(result);
}
