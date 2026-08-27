/**
 * Deliberately trusted test-only adapter that builds the callable shapes the
 * `.sm` frontend does not spell, so `smithers test` can be pinned against every
 * way a generator can reach the runner.
 *
 * Each of these was measured to pass without running before the runner learned
 * to refuse them: a bound generator function and a `Proxy` over one still
 * report `[object GeneratorFunction]` (a bound function inherits its target's
 * prototype; a `Proxy` forwards the `Symbol.toStringTag` read), while an
 * ordinary or `async` function that merely *returns* a generator object is
 * invisible on the function and shows up only in the returned value.
 *
 * `ranMarker` is the runtime oracle: if a body ever executes, it throws, so a
 * fixture assertion that expects the runner's refusal cannot be satisfied by a
 * body that quietly ran.
 *
 * @module
 * @throws {never}
 */

/** @throws {never} */
function ranMarker(name: string): never {
  throw new Error(`EXOTIC BODY RAN: ${name}`);
}

/** @throws {never} */
export function* rawGenerator(): Generator<string> {
  ranMarker("rawGenerator");
}

/** @throws {never} */
export async function* rawAsyncGenerator(): AsyncGenerator<string> {
  ranMarker("rawAsyncGenerator");
}

/** @throws {never} */
export const boundGenerator = rawGenerator.bind(null) as () => Generator<string>;

/** @throws {never} */
export const proxiedGenerator = new Proxy(rawGenerator, {}) as () => Generator<string>;

class Holder {
  /** @throws {never} */
  ordinaryMethod(): never {
    ranMarker("ordinaryMethod");
  }

  /** @throws {never} */
  *generatorMethod(): Generator<string> {
    ranMarker("generatorMethod");
  }
}

const holder = new Holder();

/**
 * The control for the class-method row: an ordinary method pulled off an
 * instance runs, and must keep running. Only the generator sibling is refused.
 *
 * @throws {never}
 */
export const classOrdinaryMethod = holder.ordinaryMethod.bind(holder) as () => never;

/** @throws {never} */
export const classGeneratorMethod = holder.generatorMethod.bind(holder) as () => Generator<string>;

/** @throws {never} */
export function returnsGenerator(): Generator<string> {
  return rawGenerator();
}

/** @throws {never} */
export async function asyncReturnsGenerator(): Promise<Generator<string>> {
  return rawGenerator();
}

/** @throws {never} */
export const arrowReturnsGenerator = (): Generator<string> => rawGenerator();
