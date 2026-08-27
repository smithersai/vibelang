/**
 * @module
 * The trusted adapter between a Smithers `Result` and the runtime's foreign
 * `ValueCodec` interface, whose `decode` **must throw**.
 *
 * **Why this exists.** `runtime/wire.ts` types a value codec as
 * `{ encode: (value: T) => JsonValue; decode: (payload: JsonValue) => T }` and
 * calls `decode` inside a `try`, turning whatever it throws into a
 * `ValueCodecError`. That is a plain return type with a *recoverable* failure
 * path, and `specification/failures.mdx` is explicit that authored Smithers
 * cannot spell it: a reachable recoverable `Error` exit MUST widen the return
 * type into `Result<A, E>` (`SMITHERS1101`), and every alternative spelling is
 * refused too — `match({ ok, error: (e) => { throw e } })` is `SMITHERS1303`,
 * and aborting through a foreign `never`-returning function is `SMITHERS1301`
 * or `SMITHERS1101` depending on where the call sits. The one exit that keeps a
 * plain return type is `panic(...)`, and using it here would be **wrong**:
 * `decodedPayload` catches everything, so a panic would be swallowed into an
 * ordinary `ValueCodecError` — precisely what `failures.mdx` forbids when it
 * says "Ordinary Result recovery MUST NOT swallow panic implicitly."
 *
 * So the module boundary does the adapting, which is the role
 * `specification/compatibility.mdx`, "Source Relationship", assigns it: `.ts`
 * modules "MUST retain their own complete syntax and behavior when imported by
 * Smithers." The *decision* about what is malformed stays in the `.sm`, as an
 * ordinary `Result` failure carrying the module's own `TypeError`; only the
 * conversion from that failure into the throw the foreign interface demands
 * lives here.
 *
 * **The `@throws {never}` claim is true and narrow.** `valueCodec` builds a
 * frozen object and returns; it closes over two functions and calls neither.
 * The codec it produces *does* throw, later, when `runtime/wire.ts` calls it —
 * TypeScript calling TypeScript, with no Smithers row involved.
 *
 * @throws {never}
 */

import type { JsonValue } from "../runtime/errors.ts";
import type { Result } from "../runtime/result.ts";
import type { ValueCodec } from "../runtime/wire.ts";

/**
 * A `ValueCodec` whose `decode` throws the failure its Smithers implementation
 * returned.
 *
 * The rethrown value is the author's own error object, unchanged — the same
 * instance a `Result` failure carries — so `runtime/wire.ts` reports it as the
 * `cause` of its `ValueCodecError` exactly as it did when the codec was written
 * in TypeScript.
 *
 * @throws {never}
 */
export function valueCodec<T>(
  encode: (value: T) => JsonValue,
  decode: (payload: JsonValue) => Result<T, Error>,
): ValueCodec<T> {
  return Object.freeze({
    encode,
    decode: (payload: JsonValue): T =>
      decode(payload).match({
        ok: (value) => value,
        error: (error) => {
          throw error;
        },
      }),
  });
}
