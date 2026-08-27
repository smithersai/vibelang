/**
 * Foreign TypeScript reached through the language's *implicit* invocation
 * protocols rather than through a call expression.
 *
 * Nothing below is written as `f(x)` at a use site. `.sm` invokes
 * `Symbol.iterator`, an own enumerable getter,
 * `Symbol.toPrimitive`/`valueOf`/`toString`, a template tag, a base
 * constructor, or a decorator on the author's behalf, and every one of those
 * members here aborts. `specification/compatibility.mdx`, "Foreign Boundary",
 * scopes the panic case to *calling* an unannotated foreign runtime value, and
 * each of these positions is such a call with no call expression to see.
 *
 * The leading claim is module-initialization trust only (`SMITHERS1510`); no
 * export carries a function-level `@throws` contract, which is the point.
 *
 * @module
 * @throws {never}
 */

export const iterable: Iterable<number> = {
  [Symbol.iterator](): Iterator<number> { throw new Error("iterator"); },
};

export const spreadable = {
  get a(): number { throw new Error("spread-getter"); },
};

export const stringy = {
  toString(): string { throw new Error("toString"); },
  valueOf(): number { throw new Error("valueOf"); },
};

export function tag(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
  throw new Error("tag");
}

export class BoomBase {
  constructor() { throw new Error("base-ctor"); }
}

export function boomDecorator(target: unknown): void { throw new Error("decorator"); }

/**
 * A member reached through an index signature: no declaration spells `width`,
 * so a rule that walks a property's declarations finds none to consult.
 */
export const keyed: Record<string, number> = { width: 3 };
