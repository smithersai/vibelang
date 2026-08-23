import { __vsOptionalNone, __vsOptionalSome } from "./optional.ts";
import { __vsResultFailure, __vsResultSuccess } from "./result.ts";

/**
 * The construction surface for hand-written library code, and only for it.
 *
 * Smithers authors never build variants by hand: `return`, `throw`, `?`, and
 * `.unwrap()` construct every Result and Optional, which is why the authoring
 * namespaces deliberately omit `Result.ok`, `Result.err`, `Optional.some`, and
 * `Optional.none` (see docs/DECISIONS.md, "Typed failures"). That ban is about
 * the authoring surface. The platform library, codecs, and other runtime-adjacent
 * TypeScript are written by hand *below* the language, so they do need a way to
 * produce variants — until now they reached for the `__vs*` compiler lowering
 * hooks, which are an emitter contract, not an API.
 *
 * `RuntimeValues` is that API: one clearly non-authoring namespace whose members
 * are the very same constructors the compiler emits, so the values it produces
 * are the same frozen, WeakSet-branded, unforgeable instances. It is not
 * re-exported into any author-visible namespace and must never be re-exported
 * under a name a Smithers author could reach.
 *
 * - `success(value)` / `failure(error)` build the two Result variants. A failure
 *   must be a locally constructed or decoded `Error`; anything else panics.
 * - `present(value)` / `absent()` build the two Optional variants. A present
 *   value may not be `null` or `undefined`; that panics too.
 */
export const RuntimeValues = Object.freeze({
  success: __vsResultSuccess,
  failure: __vsResultFailure,
  present: __vsOptionalSome,
  absent: __vsOptionalNone,
});
