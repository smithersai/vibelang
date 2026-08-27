/**
 * A module that carries the initialization trust claim and nothing else.
 *
 * The leading `@module` + `@throws {never}` header answers one question —
 * whether authored `.sm` may take a static edge to this module at all
 * (`SMITHERS1510`, "foreign module initialization can panic before a checked
 * call boundary"). It has never doubled as a per-call opt-out, and it must not
 * start: `specification/compatibility.mdx`, "Foreign Boundary", attaches the
 * checked panic case to the **call**, and the thing that removes it there is a
 * trust claim on the *called function*.
 *
 * `onSignalModuleOnly` deliberately carries no claim of its own, so a callback
 * handed to it is still refused. Without a module with exactly this shape, a
 * lane widening the argument-position rule could let the module header confer
 * call-site trust, which would open every export of every trusted module at
 * once.
 *
 * @module
 * @throws {never}
 */
export function onSignalModuleOnly(name: string, listener: (name: string) => void): void {
  listener(name);
}
