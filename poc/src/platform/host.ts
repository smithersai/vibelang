/**
 * @module
 * The one place `poc/src/platform/**` reaches a host global.
 *
 * **Why this module exists.** `specification/compatibility.mdx`, "Host Globals",
 * is a Locked MUST: "Platform-specific globals such as `process`, `window`,
 * `document`, filesystem, and network MUST NOT be unconditional globals in
 * authored `.sm` code", and "Host-sensitive operations such as clock and random
 * access MUST still use capabilities." That prohibition is scoped to *authored
 * `.sm`*, and it has no implementation-side carve-out — a class that extends a
 * `Context` subclass, or that is named `SystemClock`, buys nothing, because the
 * rule never consults either.
 *
 * The route out is not an opt-out; it is the module boundary, and it is already
 * specified. `reference/capabilities.mdx`, "Platform Services": "Standard
 * capabilities include `FileSystem`, `HttpClient`, `Clock`, `Random`,
 * `Environment`, and `Console`. **JavaScript hosts provide live
 * implementations**; tests supply deterministic ones." The live implementation
 * belongs to the JavaScript host, and "Source Relationship" guarantees that side
 * its own semantics: `.ts` modules "MUST retain their own complete syntax and
 * behavior when imported by Smithers." "Foreign Boundary" then says how `.sm`
 * reaches them: "Calling an unannotated foreign runtime value MUST add the
 * checked `panic` case … Trusted `@throws {never}` metadata opts out."
 *
 * So: the abstract capability and its live implementation are authored in `.sm`,
 * and the single host read per operation lives here, in ordinary TypeScript,
 * where the prohibition does not apply.
 *
 * **The marker is a claim, and every claim here is true.** `@throws {never}` is
 * not a formality — "Foreign Boundary" makes it the opt-out from the checked
 * panic case, so a false claim would silently remove a real failure channel from
 * a caller's row. Each function below is marked only because it provably cannot
 * throw for any argument its own signature admits, and each one says why. An
 * operation that *can* throw does not belong in this module: it keeps the panic
 * channel, which is the correct outcome, not a wall to be worked around.
 *
 * Every export is primitive-valued or `void`. That is deliberate, and most of it
 * is enforced: a trusted binding that *returns* a host object is refused with
 * `SMITHERS1508` ("returning an executable foreign value would lose its panic
 * provenance"), because a trust claim clears the panic channel for the *call*
 * while the returned value stays foreign. Where a caller needs a collection, the
 * binding fills a Smithers-owned one that the caller allocated.
 *
 * This paragraph used to claim the shape was **forced**, and that was wrong. A
 * `Promise` is neither primitive nor caught by `SMITHERS1508`, so a trusted
 * `async` binding — the exact shape the next platform binding takes, a trusted
 * `readFile` or `fetch` — slipped through: `@throws {never}` removes the panic
 * case for the *call*, and an `async` function does not throw at the call, it
 * rejects afterwards. The claim was true of the code and false as a guarantee.
 * `@throws {never}` on an `async` or `Promise`-returning binding is now refused
 * outright (`SMITHERS1502`), so the discipline this module follows by hand is
 * checked for that shape too; the rest of it — that no export hands back a host
 * object — remains an author's discipline backed by `SMITHERS1508`, not a
 * property of the language. Read the marker on every export below as a claim
 * about a SYNCHRONOUS throw, because that is the only channel it can describe.
 *
 * @throws {never}
 */

import { webcrypto } from "node:crypto";

/** `getRandomValues` rejects any single request above this many bytes. */
const GET_RANDOM_VALUES_QUOTA = 65_536;

/**
 * One uniform uint32 from the host CSPRNG.
 *
 * Cannot throw: the buffer is allocated here at a fixed 4 bytes, which is far
 * inside `getRandomValues`' quota and is one of the integer view types it
 * accepts, so neither `QuotaExceededError` nor `TypeMismatchError` is reachable.
 *
 * @throws {never}
 */
export function randomUint32(): number {
  const buffer = new Uint32Array(1);
  webcrypto.getRandomValues(buffer);
  return buffer[0] as number;
}

/**
 * Fill `target` with uniform bytes from the host CSPRNG.
 *
 * `target` is allocated by the caller, in Smithers, and is filled in place — the
 * binding returns nothing, so no foreign value crosses back.
 *
 * The chunking loop lives here rather than in the caller because the quota is a
 * property of *this host call*, and it is what makes the `@throws {never}` claim
 * true: for any `Uint8Array` of any length, every individual request this makes
 * is quota-bounded, so `QuotaExceededError` is unreachable. A caller-side loop
 * could not make that claim on the binding's behalf.
 *
 * @throws {never}
 */
export function fillRandomBytes(target: Uint8Array): void {
  for (let offset = 0; offset < target.length; offset += GET_RANDOM_VALUES_QUOTA) {
    webcrypto.getRandomValues(target.subarray(offset, Math.min(offset + GET_RANDOM_VALUES_QUOTA, target.length)));
  }
}

/**
 * The value of one environment variable, or `undefined` when it is unset.
 *
 * Cannot throw: `process.env` is an ordinary object on every supported host and
 * a missing key reads as `undefined`. Absence is absence, not failure, which is
 * why this returns `string | undefined` rather than a Result.
 *
 * *Ordinary* is exactly the problem for one family of names: `process.env`
 * inherits from `Object.prototype`, so `process.env[name]` answers
 * `constructor`, `toString`, `valueOf`, `hasOwnProperty` and their siblings with
 * a function and `__proto__` with an object — none of which is a variable, and
 * none of which {@link collectEnvironmentNames} ever lists. Reading the own
 * descriptor keeps the declared `string | undefined` true for every name.
 *
 * @throws {never}
 */
export function environmentValue(name: string): string | undefined {
  const value: unknown = Object.getOwnPropertyDescriptor(process.env, name)?.value;
  return typeof value === "string" ? value : undefined;
}

/**
 * Append every defined environment variable name to `into`, sorted.
 *
 * `into` is allocated by the caller, in Smithers. Returning the host's own array
 * instead is refused (`SMITHERS1508`), so the collection crosses the boundary by
 * being filled rather than by being handed over.
 *
 * Cannot throw: `Object.keys` of an ordinary object and `Array.prototype.sort`
 * with the default comparator over strings are both total.
 *
 * @throws {never}
 */
export function collectEnvironmentNames(into: string[]): void {
  for (const name of Object.keys(process.env).sort()) into.push(name);
}

/**
 * Write `text` to the host's standard output. Answers the stream's own
 * backpressure signal, exactly as `process.stdout.write` does.
 *
 * **Why the `@throws {never}` claim is true, measured rather than assumed.** A
 * previous lane recorded this call as unportable on the premise that
 * `process.stdout.write` throws `ERR_STREAM_DESTROYED` on a destroyed stream.
 * That premise does not hold. Measured on Node v22.4.1 and on Bun 1.2.20:
 *
 * | state of the stream | `write("x")` |
 * |---|---|
 * | ordinary | returns `true` |
 * | after `process.stdout.destroy()` | returns `true` — no throw |
 * | after `process.stdout.end()` | returns `false` — no throw |
 * | a closed pipe (EPIPE), 2 MB written | returns, no throw |
 * | a non-string chunk | **throws `ERR_INVALID_ARG_TYPE`** |
 *
 * Node's `Writable.prototype.write` reports a broken, ended, or destroyed
 * stream through the stream's own `error` event, not through the call: it
 * routes to `errorOrDestroy`, which emits. The one synchronous throw is the
 * argument-type check, and this signature admits only a `string`, so it is
 * unreachable — the same shape of argument-bounded claim `fillRandomBytes`
 * makes about `getRandomValues`' quota.
 *
 * **What the claim deliberately does not cover, and who owns it.** The
 * asynchronous `error` event remains: writing after `end()` terminates the
 * process on the next turn with an unhandled `ERR_STREAM_WRITE_AFTER_END`.
 * That is not a failure of this call and no `Result` at this boundary could
 * carry it. specification/requirements.mdx, "Scoping", assigns it: "Imported
 * JavaScript or TypeScript that starts hidden background work owns that work."
 * The host stream owns its own error channel.
 *
 * @throws {never}
 */
export function writeStandardOut(text: string): boolean {
  return process.stdout.write(text);
}

/**
 * Write `text` to the host's standard error. Same claim, same evidence, and the
 * same residual as {@link writeStandardOut}.
 *
 * @throws {never}
 */
export function writeStandardError(text: string): boolean {
  return process.stderr.write(text);
}
