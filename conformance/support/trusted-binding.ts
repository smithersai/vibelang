/**
 * A trusted host binding: the sanctioned place a capability's *live*
 * implementation reads the host.
 *
 * `specification/compatibility.mdx`, "Host Globals", scopes its prohibition to
 * **authored `.sm`** — "Platform-specific globals ... MUST NOT be unconditional
 * globals in authored `.sm` code. Host functionality MUST be represented by
 * typed capabilities". `reference/capabilities.mdx`, "Platform Services", then
 * assigns the other side explicitly: "JavaScript hosts provide live
 * implementations; tests supply deterministic ones." And §Source Relationship
 * guarantees this file its own semantics — `.ts` modules "MUST retain their own
 * complete syntax and behavior when imported by Smithers."
 *
 * So the opt-out is the module boundary, and it is already specified. There is
 * no implementation-side opt-out claimable from `.sm`, which is what makes
 * `20-host-globals/a-class-that-looks-like-a-capability-implementation-still-cannot-read-a-host-global`
 * refusable: a look-alike has nothing to claim.
 *
 * The value is a fixed constant rather than a real `Date.now()` because a
 * corpus case declares its exact stdout. What is under test is where the read
 * is *allowed to live*, not what a clock returns.
 *
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function wallClockMillis(): number {
  return 1_700_000_000_000;
}
