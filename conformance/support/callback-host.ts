/**
 * A host module that takes callbacks — the shape `process.on`, `setTimeout`,
 * `socket.on` and `readline` all have.
 *
 * `specification/compatibility.mdx`, "Foreign Boundary" (Locked): "Calling an
 * unannotated foreign runtime value MUST add the checked `panic` case ...
 * Trusted `@throws {never}` metadata opts out; `@throws {T}` declares a more
 * precise channel." The subject of that sentence is the **call**, so a trust
 * claim covers what the call does with an argument it was handed.
 *
 * The *deferred* half — a listener the host invokes on a later turn, outside
 * the call — is assigned separately and explicitly:
 * `specification/requirements.mdx`, "Scoping" (Locked): "Imported JavaScript or
 * TypeScript that starts hidden background work owns that work. Caller-
 * controlled background APIs MUST expose explicit completion or disposal
 * handles through their adapters." The obligation lands on the adapter, in
 * TypeScript, not on the Smithers caller.
 *
 * The exports below are deliberately four spellings of one call so the cases
 * that use them differ in nothing but the marker:
 *
 *   onSignal        a trusted registration        — accepted
 *   onSignalUnsafe  the same, with no claim       — refused, SMITHERS1509
 *   getHandler      hands a foreign callable BACK — refused at the use site,
 *                                                   SMITHERS1508
 *   registerAll     a trusted registration taking a list of listeners
 *
 * Each listener is invoked synchronously so a corpus case can declare what it
 * printed. What is under test is which registrations the language admits, not
 * when a host happens to call back.
 *
 * @module
 * @throws {never}
 */

/** A trusted registration: this call cannot throw, and it owns the invocation.
 * @throws {never}
 */
export function onSignal(name: string, listener: (name: string) => void): void {
  listener(name);
}

/** No `@throws` claim: every call keeps the default checked panic case. */
export function onSignalUnsafe(name: string, listener: (name: string) => void): void {
  listener(name);
}

/** A foreign callable handed BACK to Smithers.
 * @throws {never}
 */
export function getHandler(): (name: string) => void {
  return () => {};
}

/** A trusted registration over a list of listeners.
 * @throws {never}
 */
export function registerAll(listeners: readonly ((value: string) => void)[]): void {
  for (const listener of listeners) listener("");
}
