/**
 * Foreign TypeScript whose `@throws` claims are the subject.
 *
 * `specification/compatibility.mdx`, "Foreign Boundary": "Calling an
 * unannotated foreign runtime value MUST add the checked `panic` case, because
 * JavaScript and TypeScript may throw, reject, or violate a declaration.
 * Trusted `@throws {never}` metadata opts out; `@throws {T}` declares a more
 * precise channel."
 *
 * Every export below carries a claim that is either unusable (it describes a
 * channel it cannot cover, or contradicts a sibling claim on the same
 * declaration) or is honest and must keep working. Several are deliberately
 * paired so an acceptance sits beside each refusal.
 *
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function giveString(): string { return "s"; }

/** @throws {never} */
export function trustedTag(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
  return strings.raw.join("|");
}

/** @throws {never} */
export async function giveAsync(): Promise<string> { throw new Error("async-throw"); }

/** @throws {never} */
export function givePromise(): Promise<string> { return Promise.reject(new Error("promise")); }

/** @throws {never} */
export function giveUnionPromise(): string | Promise<string> { return Promise.reject(new Error("union")); }

export async function untrustedAsync(): Promise<string> { throw new Error("untrusted-async"); }

/** @throws {TypeError} */
export async function declaredAsync(): Promise<string> { throw new TypeError("declared-async"); }

/** A dangerous overload: it throws, and it is documented as throwing. */
export function readValue(key: string): string;
/** @throws {never} A safe overload: an integer key is bounds-checked. */
export function readValue(key: number): string;
export function readValue(key: string | number): string {
  if (typeof key === "string") throw new Error("unknown key");
  return "value";
}

/**
 * @throws {never}
 * @throws {TypeError}
 */
export function neverFirst(): string { throw new TypeError("neverFirst"); }

/**
 * @throws {TypeError}
 * @throws {never}
 */
export function declaredFirst(): string { throw new TypeError("declaredFirst"); }

/**
 * @throws {never}
 * @throws {never}
 */
export function neverTwice(): string { return "ok"; }

export function untrustedUnionPromise(): string | Promise<string> { return Promise.reject(new Error("untrusted-union")); }
