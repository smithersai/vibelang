import { expect, test } from "bun:test";
import * as host from "./host.ts";

/**
 * The determinism perimeter, checked instead of promised.
 *
 * `host.ts`'s module comment says every export is primitive-valued or `void`,
 * and then says the honest thing about that claim: the part of it that no rule
 * enforces "remains an author's discipline backed by `SMITHERS1508`, not a
 * property of the language." `SMITHERS1508` refuses a *trusted binding* that
 * returns an executable foreign value; it does not see a plain object. So a
 * future binding that hands back `{ handle, openedAtMs }` — a host object
 * carrying timing-dependent state — passes every gate in the tree today, and
 * silently un-journals whatever an effect derives from it.
 *
 * This file is the missing gate. It is deliberately written against the module
 * NAMESPACE rather than against a hand-written list of six names, because the
 * failure mode it exists to catch is a SEVENTH export appearing later. A test
 * that only checked the six known functions would stay green through exactly
 * the change it is here to refuse.
 *
 * Two obligations, and both are needed:
 *
 *  1. The roster is closed. Every export must be named in {@link invocations},
 *     so a new export cannot join the module without an author deciding how it
 *     is exercised. This is what makes a seventh export visible at all.
 *  2. Nothing structural crosses back. Every export is either a primitive value
 *     itself, or a function whose return is a primitive or `undefined`. This is
 *     what makes a seventh export that returns an object RED rather than merely
 *     unlisted.
 *
 * What this cannot check, stated so nobody reads it as more than it is: the
 * return of the arguments actually passed here, not of every argument the
 * signature admits. It is a perimeter over the module's shape, not a proof
 * about its callees. The caller-allocated-collection pattern
 * (`fillRandomBytes`, `collectEnvironmentNames`) is unaffected on purpose:
 * filling a Smithers-owned collection is precisely the sanctioned way for a
 * host value to reach the other side, and both of those return `void`.
 */

/**
 * One representative invocation per export, keyed by export name.
 *
 * Arguments are chosen to be inert: an empty string writes nothing to a stream
 * but still yields the stream's own backpressure boolean, and `PATH` is read
 * for its value rather than asserted to exist.
 */
const invocations: Readonly<Record<string, () => unknown>> = Object.freeze({
  randomUint32: () => host.randomUint32(),
  fillRandomBytes: () => host.fillRandomBytes(new Uint8Array(8)),
  environmentValue: () => host.environmentValue("PATH"),
  collectEnvironmentNames: () => host.collectEnvironmentNames([]),
  writeStandardOut: () => host.writeStandardOut(""),
  writeStandardError: () => host.writeStandardError(""),
});

/**
 * `undefined` and the six primitive `typeof` answers. `null` is excluded on
 * purpose: no export produces it, and admitting it would widen the perimeter
 * for nothing.
 */
const PRIMITIVE_TYPES: ReadonlySet<string> = new Set([
  "undefined",
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
]);

const isPrimitiveOrUndefined = (value: unknown): boolean =>
  value !== null && PRIMITIVE_TYPES.has(typeof value);

const describeValue = (value: unknown): string =>
  value === null ? "null" : `${typeof value}`;

const exportNames = (): readonly string[] => Object.keys(host).sort();

test("the host perimeter's roster is closed: every export is exercised here", () => {
  const exported = exportNames();
  const registered = Object.keys(invocations).sort();

  // The count is asserted separately from the names so a diff reads clearly:
  // an added export shows up as a count mismatch first, then as a name.
  expect(
    exported.length,
    `host.ts exports ${exported.length} names; add every new one to \`invocations\` in this file ` +
      `and state what it returns. The determinism perimeter is only as wide as this roster.`,
  ).toBe(registered.length);
  expect(exported).toEqual(registered);
});

test("every host.ts export is primitive-valued or void", () => {
  for (const name of exportNames()) {
    const exported = (host as Record<string, unknown>)[name];
    const invoke = invocations[name];

    // An export that is not a function must itself be a primitive: a bare
    // `export const cache = new Map()` hands a mutable host object across the
    // boundary without any call at all.
    if (typeof exported !== "function") {
      expect(
        isPrimitiveOrUndefined(exported),
        `host.ts export \`${name}\` is a ${describeValue(exported)}. A non-function export must be a ` +
          `primitive: a host object reachable as a module binding carries host state across the perimeter.`,
      ).toBe(true);
      continue;
    }

    expect(
      invoke,
      `host.ts export \`${name}\` has no entry in \`invocations\`; register one so its return is checked.`,
    ).toBeDefined();

    const returned = invoke!();
    expect(
      isPrimitiveOrUndefined(returned),
      `host.ts export \`${name}\` returned a ${describeValue(returned)}. Every export must return a ` +
        `primitive or undefined: SMITHERS1508 refuses a trusted binding that returns an EXECUTABLE ` +
        `foreign value, and sees nothing wrong with a plain object, so a returned object carrying ` +
        `host state — a handle, a timestamp, an iterator — would cross the determinism perimeter ` +
        `unchecked. Fill a caller-allocated Smithers collection instead, as fillRandomBytes and ` +
        `collectEnvironmentNames do.`,
    ).toBe(true);
  }
});

test("the six exports return the shapes their documentation claims", () => {
  // Not redundant with the perimeter test above: that one would stay green if
  // `randomUint32` started returning a string. This pins the documented shape
  // of each individual export, so the perimeter test can stay generic.
  expect(typeof host.randomUint32()).toBe("number");
  expect(Number.isInteger(host.randomUint32())).toBe(true);
  expect(host.fillRandomBytes(new Uint8Array(4))).toBeUndefined();
  expect(["string", "undefined"]).toContain(typeof host.environmentValue("PATH"));
  expect(host.collectEnvironmentNames([])).toBeUndefined();
  expect(typeof host.writeStandardOut("")).toBe("boolean");
  expect(typeof host.writeStandardError("")).toBe("boolean");
});
