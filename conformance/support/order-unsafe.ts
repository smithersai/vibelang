/**
 * A trusted foreign boundary whose *shapes* are the subject, not its trust.
 *
 * Every export here carries the `@throws {never}` its own call needs, so a case
 * that imports this module and is still refused is refused for the shape of the
 * expression rather than for an untrusted call. The trust claim below is the
 * module-initialization one (`SMITHERS1510`); it never doubles as a
 * function-level opt-out.
 *
 * @module
 * @throws {never}
 */

/**
 * A foreign *factory*. Calling the factory is total — building the closure
 * cannot throw — but the closure it returns is not: it throws on bad input and
 * carries no `@throws` claim, so every call through it must charge Panic.
 *
 * That split is the whole point. `makeParser()` is trusted, so nothing about
 * the factory call itself is refusable; only `makeParser()(text)` is, and only
 * because the checked result of the factory would have to sit in callee
 * position before it was unwrapped.
 *
 * @throws {never}
 */
export function makeParser(): (text: string) => number {
  return (text: string) => {
    const parsed = Number.parseInt(text, 10);
    if (Number.isNaN(parsed)) throw new RangeError(`${text} is not an integer`);
    return parsed;
  };
}
