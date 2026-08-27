/**
 * The foreign panic channel, for the invocations that no call expression names.
 *
 * Three fail-opens shared one shape: the machinery that charges the checked
 * panic case was keyed on `ts.CallExpression`, `ts.NewExpression` and property
 * reads, and every other way JavaScript reaches foreign code slipped past it.
 *
 *  1. **Implicit invocation.** `for…of`, spread, `yield*`, object spread,
 *     template interpolation, coercing operators, a computed key — each runs a
 *     method on the value (`Symbol.iterator`, the value's own getters,
 *     `Symbol.toPrimitive`/`valueOf`/`toString`) with no call expression in the
 *     source. `specification/compatibility.mdx` §Foreign Boundary is about what
 *     the program DOES — "Calling an unannotated foreign runtime value MUST add
 *     the checked `panic` case, because JavaScript and TypeScript may throw,
 *     reject, or violate a declaration" — and every one of these calls foreign
 *     code, so every one of them adds the case.
 *
 *     They are gated here as ONE predicate over an expression's position rather
 *     than as a list of reporting sites. That is the whole point: this class
 *     reopened repeatedly because each newly discovered sibling was a separate
 *     edit at a separate site, and the siblings nobody thought of stayed
 *     fail-open silently. The table below is therefore written to be extended by
 *     adding a row, and a row that passes without a corresponding edit is
 *     evidence the predicate is total rather than that the case was remembered.
 *
 *  2. **A trust claim about a call cannot describe a rejection.**
 *     `@throws {never}` opts out of the panic case for the CALL. An `async`
 *     binding does not throw at the call; it returns and rejects afterwards. The
 *     UNTRUSTED spelling of the same binding is modelled correctly
 *     (`09-foreign-calls/foreign-rejection-becomes-panic`), which is what makes
 *     the trusted direction the fail-open one.
 *
 *  3. **A trust claim belongs to the resolved signature, not to the symbol.**
 *     Overload signatures are separate declarations of one symbol, so a
 *     symbol-wide tag search let one marked overload certify the unmarked,
 *     throwing overload a call actually resolved to. And two `@throws` tags on
 *     one declaration resolved by SOURCE ORDER: `{never}` then `{TypeError}`
 *     trusted the binding and dropped the declared channel, while the identical
 *     pair reversed refused it. The same two claims must not give opposite
 *     verdicts, and only one of those orders failed closed.
 *
 * The load-bearing half of this file is the NEGATIVE half. Every refusal is
 * paired with the acceptance that proves the rule did not simply widen: ordinary
 * non-foreign iteration, spread and interpolation stay clean; a trusted
 * SYNCHRONOUS binding keeps its trust in every one of these positions; a trusted
 * binding's `string` may still be interpolated, iterated and spread, because
 * `String.prototype`'s protocol members belong to the language and not to the
 * foreign module; a call that resolves to the MARKED overload is still trusted;
 * and the untrusted async case still charges exactly the `Panic` it always did.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAndCheckProject } from "./index.ts";

const workspace = mkdtempSync(join(tmpdir(), "smithers-foreign-implicit-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");

/** Untrusted foreign values whose protocol members all throw. */
writeFileSync(join(workspace, "untrusted.ts"), `/**
 * @module
 * Module-initialization trust only. Nothing below claims @throws {never}.
 * @throws {never}
 */

export const iterable: Iterable<number> = {
  [Symbol.iterator](): Iterator<number> { throw new Error("iterator"); },
};

export const asyncIterable: AsyncIterable<number> = {
  [Symbol.asyncIterator](): AsyncIterator<number> { throw new Error("async-iterator"); },
};

export const spreadable = {
  get a(): number { throw new Error("spread-getter"); },
};

export const stringy = {
  toString(): string { throw new Error("toString"); },
  valueOf(): number { throw new Error("valueOf"); },
};

export function tag(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
  throw new Error(\`tag:\${strings.raw.length}:\${values.length}\`);
}

export class BoomBase {
  constructor() { throw new Error("base-ctor"); }
}

export function boomDecorator(target: unknown): unknown { throw new Error("decorator"); }

export class HasInstance {
  static [Symbol.hasInstance](): boolean { throw new Error("hasInstance"); }
}

export const counter: { k: number } = {
  get k(): number { throw new Error("counter-getter"); },
  set k(value: number) { throw new Error("counter-setter"); },
};
`);

/** Trusted bindings: the marker is true for the synchronous ones and false for the rest. */
writeFileSync(join(workspace, "trusted.ts"), `/**
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function giveString(): string { return "s"; }

/** @throws {never} */
export function giveNumber(): number { return 1; }

/** @throws {never} */
export function giveVoid(): void { }

/** @throws {never} */
export function giveIterable(): Iterable<number> {
  return { [Symbol.iterator](): Iterator<number> { throw new Error("iter"); } };
}

/** @throws {never} */
export function givePromise(): Promise<string> { return Promise.reject(new Error("promise")); }

/** @throws {never} */
export async function giveAsync(): Promise<string> { throw new Error("async-throw"); }

/** @throws {never} */
export function givePromiseLike(): PromiseLike<string> {
  return { then(): never { throw new Error("promiselike"); } } as unknown as PromiseLike<string>;
}

/** @throws {never} */
export const asyncArrow = async (): Promise<string> => { throw new Error("arrow-async"); };

/** @throws {never} */
export function giveUnionPromise(): string | Promise<string> { return Promise.reject(new Error("union")); }

/** @throws {never} */
export function giveThenable(): { then(onOk: (value: string) => void): void } {
  return { then(): never { throw new Error("thenable"); } };
}

/** @throws {never} */
export function trustedTag(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
  return strings.raw.join("|") + String(values.length);
}

/** @throws {TypeError} */
export async function declaredAsync(): Promise<string> { throw new TypeError("declared-async"); }

export async function untrustedAsync(): Promise<string> { throw new Error("untrusted-async"); }

export function untrustedPromise(): Promise<string> { return Promise.reject(new Error("untrusted-promise")); }
`);

/** Overload sets and multi-tag declarations: one symbol, several claims. */
writeFileSync(join(workspace, "overloads.ts"), `/**
 * @module
 * @throws {never}
 */

/** A dangerous overload: it throws, and it is documented as throwing. */
export function readValue(key: string): string;
/** @throws {never} A safe overload. */
export function readValue(key: number): string;
export function readValue(key: string | number): string {
  if (typeof key === "string") throw new Error("unknown key");
  return "value";
}

/** No marker anywhere: the control. */
export function plain(key: string): string;
export function plain(key: number): string;
export function plain(key: string | number): string { throw new Error("plain"); }

export declare function ambient(key: string): string;
/** @throws {never} */
export declare function ambient(key: number): string;

export class Box {
  /** dangerous */
  static make(key: string): string;
  /** @throws {never} */
  static make(key: number): string;
  static make(key: string | number): string {
    if (typeof key === "string") throw new Error("static");
    return "static";
  }
}

export interface Api {
  /** dangerous */
  read(key: string): string;
  /** @throws {never} */
  read(key: number): string;
}
export const api: Api = {
  read(key: string | number): string {
    if (typeof key === "string") throw new Error("api");
    return "api";
  },
} as Api;

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
`);

interface Compiled {
  readonly codes: readonly string[];
  readonly rows: Readonly<Record<string, { failures: readonly string[]; requirements: readonly string[] }>>;
}

let sequence = 0;
function compile(source: string): Compiled {
  sequence += 1;
  const fileName = join(workspace, `case-${sequence}.sm`);
  const checked = compileAndCheckProject([{ fileName, source }], {
    rootDir: workspace,
    outDir: join(workspace, "out"),
    runtimeImport: RUNTIME,
  });
  const errors = checked.result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const file = Object.values(checked.result.files)[0];
  return {
    codes: errors.map((diagnostic) => diagnostic.code),
    rows: (file?.analysis.rows ?? {}) as Compiled["rows"],
  };
}

/**
 * Every position that reaches foreign code without a call expression.
 *
 * Add a row here before adding a reporting site anywhere: a new row that already
 * passes is the evidence that the predicate is total over the grammar rather
 * than a list somebody remembered to extend.
 */
const IMPLICIT_INVOCATIONS: readonly { readonly id: string; readonly body: string }[] = [
  { id: "for…of", body: `let t = 0; for (const n of iterable) t += n; return t` },
  { id: "array spread", body: `return [...iterable].length` },
  { id: "spread into a call's arguments", body: `return Math.max(...(iterable as unknown as number[]))` },
  {
    id: "spread into a constructor's arguments",
    body: `class Local { constructor(...n: readonly number[]) { void n } }
  void new Local(...(iterable as unknown as readonly number[])); return 0`,
  },
  { id: "object spread", body: `const o = { ...spreadable }; return o.a` },
  { id: "template interpolation", body: `return \`x\${stringy}\`.length` },
  { id: "unary +", body: `return +stringy` },
  { id: "unary -", body: `return -stringy` },
  { id: "unary ~", body: `return ~stringy` },
  { id: "loose ==", body: `return ((stringy as unknown as number) == 1) ? 1 : 0` },
  { id: "relational <", body: `return ((stringy as unknown as number) < 1) ? 1 : 0` },
  { id: "binary +", body: `return ((stringy as unknown as number) + 1)` },
  { id: "compound +=", body: `let t = 0; t += (stringy as unknown as number); return t` },
  { id: "a computed property key", body: `const o = { [stringy as unknown as string]: 1 }; return Object.keys(o).length` },
  { id: "an element-access key", body: `const o: Record<string, number> = { a: 1 }; return o[stringy as unknown as string] ?? 0` },
  { id: "the left operand of in", body: `const o: Record<string, number> = { a: 1 }; return ((stringy as unknown as string) in o) ? 1 : 0` },
  { id: "array destructuring assignment", body: `let a = 0; [a] = iterable as unknown as [number]; return a` },
  { id: "object destructuring assignment", body: `let a = 0; ({ a } = spreadable); return a` },
  { id: "an aliased local", body: `const it = iterable; let t = 0; for (const n of it) t += n; return t` },
];

describe("an implicit invocation of a foreign value keeps the checked panic case", () => {
  for (const form of IMPLICIT_INVOCATIONS) {
    test(form.id, () => {
      const compiled = compile(`import { iterable, spreadable, stringy } from "./untrusted.ts"
export function f(): number { ${form.body} }
`);
      expect(compiled.codes).toContain("SMITHERS1506");
      expect(compiled.codes).toContain("SMITHERS1101");
      expect(compiled.rows.f?.failures).toEqual(["Panic"]);
    });
  }

  test("for await…of over a foreign async iterable", () => {
    const compiled = compile(`import { asyncIterable } from "./untrusted.ts"
export async function f(): Promise<number> { let t = 0; for await (const n of asyncIterable) t += n; return t }
`);
    expect(compiled.codes).toContain("SMITHERS1506");
    expect(compiled.rows.f?.failures).toEqual(["Panic"]);
  });

  test("yield* over a foreign iterable", () => {
    const compiled = compile(`import { iterable } from "./untrusted.ts"
export function* f(): Generator<number> { yield* iterable }
`);
    expect(compiled.codes).toContain("SMITHERS1506");
  });

  /**
   * The update operators are in the predicate but cannot be isolated by a test,
   * and that is a fact about JavaScript rather than a gap. `x++` needs an
   * assignable REFERENCE, an ESM import binding is read-only, so the only
   * reachable spelling over a foreign value is a member access — which the
   * neighbouring property rule already owns. The branch stays in the predicate
   * because leaving a hole for a form that becomes reachable later is exactly
   * the shape this file exists to close; the assertion here records that the
   * position is refused, whichever of the two rules gets there first.
   */
  test("a postfix ++ on a foreign member", () => {
    const compiled = compile(`import { counter } from "./untrusted.ts"
export function f(): number { return counter.k++ }
`);
    expect(compiled.codes).toContain("SMITHERS1506");
    expect(compiled.rows.f?.failures).toEqual(["Panic"]);
  });

  test("the right operand of instanceof, which runs Symbol.hasInstance", () => {
    const compiled = compile(`import { HasInstance } from "./untrusted.ts"
export function f(v: unknown): number { return (v instanceof HasInstance) ? 1 : 0 }
`);
    expect(compiled.codes).toContain("SMITHERS1506");
    expect(compiled.rows.f?.failures).toEqual(["Panic"]);
  });
});

describe("a call-like foreign form with no call expression is refused", () => {
  test("a foreign tagged template", () => {
    const compiled = compile(`import { tag } from "./untrusted.ts"
export function f(): string { return tag\`hello \${1}\` }
`);
    expect(compiled.codes).toContain("SMITHERS1504");
    expect(compiled.rows.f?.failures).toEqual(["Panic"]);
  });

  test("constructing a subclass of a foreign class runs the base constructor", () => {
    const compiled = compile(`import { BoomBase } from "./untrusted.ts"
class Derived extends BoomBase {}
export function f(): Derived { return new Derived() }
`);
    expect(compiled.codes).toContain("SMITHERS1504");
    expect(compiled.rows.f?.failures).toEqual(["Panic"]);
  });

  test("the foreign base is found through a chain, not only one level up", () => {
    const compiled = compile(`import { BoomBase } from "./untrusted.ts"
class Mid extends BoomBase {}
class Leaf extends Mid {}
export function f(): Leaf { return new Leaf() }
`);
    expect(compiled.codes).toContain("SMITHERS1504");
  });

  /**
   * The rule is on the CONSTRUCTION, not on the `extends` clause. A clause runs
   * no constructor — it evaluates the base expression and sets a prototype — and
   * refusing it was measurably wrong: the corpus case
   * `17-durable/the-retired-vibelang-flows-specifier-is-not-compiler-owned`
   * declares a subclass of an unresolvable foreign `Action`, never constructs
   * it, and declares the module edge as its whole diagnostic set. This is the
   * over-correction guard for the two tests above.
   */
  test("declaring the subclass WITHOUT constructing it is not a foreign invocation", () => {
    const compiled = compile(`import { BoomBase } from "./untrusted.ts"
export class Derived extends BoomBase {}
`);
    expect(compiled.codes).toEqual([]);
  });

  test("an authored base class is untouched", () => {
    const compiled = compile(`class Base { constructor(readonly n: number) {} }
class Derived extends Base {}
export function f(): number { return new Derived(1).n }
`);
    expect(compiled.codes).toEqual([]);
  });

  test("a foreign decorator, invoked when the declaration is evaluated", () => {
    const compiled = compile(`import { boomDecorator } from "./untrusted.ts"
@boomDecorator
export class Decorated {}
`);
    expect(compiled.codes).toContain("SMITHERS1504");
  });

  test("a TRUSTED tag is still accepted — the refusal is about trust, not about the syntax", () => {
    const compiled = compile(`import { trustedTag } from "./trusted.ts"
export function f(): string { return trustedTag\`hello \${1}\` }
`);
    expect(compiled.codes).toEqual([]);
    expect(compiled.rows.f?.failures).toEqual([]);
  });

  test("a trusted tag still may not launder FOREIGN callable provenance through a substitution", () => {
    const compiled = compile(`import { trustedTag } from "./trusted.ts"
import { stringy } from "./untrusted.ts"
export function f(): string { return trustedTag\`hello \${stringy}\` }
`);
    expect(compiled.codes).toContain("SMITHERS1508");
  });
});

describe("ordinary, non-foreign programs are untouched", () => {
  const CLEAN: readonly { readonly id: string; readonly source: string }[] = [
    { id: "for…of over an array literal", source: `export function f(): number { let t = 0; for (const n of [1, 2, 3]) t += n; return t }` },
    {
      id: "for…of over a locally built iterable",
      source: `export function f(): number {
  const it: Iterable<number> = { [Symbol.iterator]: () => [1, 2].values() }
  let t = 0; for (const n of it) t += n; return t
}`,
    },
    { id: "array spread", source: `export function f(): number { const a = [1, 2, 3]; return [...a].length }` },
    { id: "spread into a call's arguments", source: `export function f(): number { const a = [1, 2]; return Math.max(...a) }` },
    { id: "object spread", source: `export function f(): number { const o = { a: 1 }; const c = { ...o }; return c.a }` },
    { id: "template interpolation", source: `export function f(n: number): string { return \`x\${n}\` }` },
    { id: "unary +", source: `export function f(s: string): number { return +s }` },
    { id: "yield*", source: `export function* f(): Generator<number> { yield* [1, 2, 3] }` },
    {
      id: "for await…of over an authored async iterable",
      source: `export async function f(src: AsyncIterable<number>): Promise<number> { let t = 0; for await (const n of src) t += n; return t }`,
    },
    {
      id: "a local tagged template",
      source: `function tag(strings: TemplateStringsArray, ...v: readonly unknown[]): string { return strings.raw.join("") + String(v.length) }
export function f(): string { return tag\`hello \${1}\` }`,
    },
    { id: "a computed property key", source: `export function f(k: string): number { const o: Record<string, number> = { a: 1 }; const { [k]: v } = o; return v ?? 0 }` },
    { id: "array destructuring", source: `export function f(): number { const [a] = [1, 2]; return a ?? 0 }` },
  ];

  for (const form of CLEAN) {
    test(form.id, () => {
      const compiled = compile(`${form.source}\n`);
      expect(compiled.codes).toEqual([]);
    });
  }
});

describe("a TRUSTED synchronous binding keeps its trust in every implicit position", () => {
  const TRUSTED: readonly { readonly id: string; readonly source: string }[] = [
    { id: "interpolating a trusted string", source: `export function f(): string { return \`x\${giveString()}\` }` },
    { id: "iterating a trusted string", source: `export function f(): number { let t = 0; for (const c of giveString()) t += c.length; return t }` },
    { id: "spreading a trusted string", source: `export function f(): number { return [...giveString()].length }` },
    { id: "coercing a trusted number", source: `export function f(): number { return +giveNumber() }` },
    { id: "a trusted void call", source: `export function f(): void { giveVoid() }` },
  ];

  for (const form of TRUSTED) {
    test(form.id, () => {
      const compiled = compile(`import { giveString, giveNumber, giveVoid } from "./trusted.ts"\n${form.source}\n`);
      expect(compiled.codes).toEqual([]);
      expect(compiled.rows.f?.failures).toEqual([]);
    });
  }

  test("but a trusted binding's returned ITERABLE is still foreign, and iterating it runs its iterator", () => {
    const compiled = compile(`import { giveIterable } from "./trusted.ts"
export function f(): number { let t = 0; for (const n of giveIterable()) t += n; return t }
`);
    expect(compiled.codes).toContain("SMITHERS1506");
    expect(compiled.rows.f?.failures).toEqual(["Panic"]);
  });
});

describe("@throws {never} cannot describe a rejection channel", () => {
  const REFUSED: readonly { readonly id: string; readonly source: string }[] = [
    { id: "an awaited trusted async function", source: `export async function f(): Promise<string> { return await giveAsync() }` },
    { id: "an awaited trusted Promise-returning function", source: `export async function f(): Promise<string> { return await givePromise() }` },
    { id: "an un-awaited trusted async function", source: `export function f(): Promise<string> { return giveAsync() }` },
    { id: "a trusted PromiseLike-returning function", source: `export async function f(): Promise<string> { return await givePromiseLike() }` },
    { id: "a trusted async arrow const", source: `export async function f(): Promise<string> { return await asyncArrow() }` },
    // A UNION with a Promise constituent and a structural THENABLE both reject
    // and neither is named `Promise`, so the narrow "is this a Promise type"
    // question that drives LOWERING answers no for both. The trust question is
    // asked through a deliberately wider predicate for exactly this reason.
    { id: "a trusted string | Promise<string>", source: `export async function f(): Promise<string> { return await giveUnionPromise() }` },
    { id: "a trusted structural thenable", source: `export async function f(): Promise<string> { return await giveThenable() }` },
  ];

  for (const form of REFUSED) {
    test(form.id, () => {
      const compiled = compile(
        `import { giveAsync, givePromise, givePromiseLike, asyncArrow, giveUnionPromise, giveThenable } from "./trusted.ts"\n${form.source}\n`,
      );
      expect(compiled.codes).toContain("SMITHERS1502");
      expect(compiled.rows.f?.failures).toEqual(["Panic"]);
    });
  }

  test("the UNTRUSTED async spelling still charges exactly the Panic it always did", () => {
    const compiled = compile(`import { untrustedAsync } from "./trusted.ts"
export async function f(): Promise<string> { return await untrustedAsync() }
`);
    expect(compiled.codes).not.toContain("SMITHERS1502");
    expect(compiled.rows.f?.failures).toEqual(["Panic"]);
  });

  test("the UNTRUSTED Promise-returning spelling is unchanged too", () => {
    const compiled = compile(`import { untrustedPromise } from "./trusted.ts"
export async function f(): Promise<string> { return await untrustedPromise() }
`);
    expect(compiled.codes).not.toContain("SMITHERS1502");
    expect(compiled.rows.f?.failures).toEqual(["Panic"]);
  });

  test("@throws {T} on an async binding still declares its channel — only {never} is refused", () => {
    const compiled = compile(`import { declaredAsync } from "./trusted.ts"
export async function f(): Promise<string> { return await declaredAsync() }
`);
    expect(compiled.codes).not.toContain("SMITHERS1502");
    expect(compiled.rows.f?.failures).toEqual(["Panic", "TypeError"]);
  });
});

describe("a trust claim belongs to the resolved signature, not to the symbol", () => {
  const REFUSED: readonly { readonly id: string; readonly source: string }[] = [
    { id: "a function overload set", source: `export function f(): string { return readValue("x") }` },
    { id: "a declare function overload set", source: `export function f(): string { return ambient("x") }` },
    { id: "a static method overload set", source: `export function f(): string { return Box.make("x") }` },
    { id: "an interface method overload set", source: `export function f(): string { return api.read("x") }` },
  ];

  for (const form of REFUSED) {
    test(`${form.id}: resolving to the UNMARKED overload is not trusted`, () => {
      const compiled = compile(
        `import { readValue, ambient, Box, api } from "./overloads.ts"\n${form.source}\n`,
      );
      expect(compiled.codes).toContain("SMITHERS1101");
      expect(compiled.rows.f?.failures).toEqual(["Panic"]);
    });
  }

  const ACCEPTED: readonly { readonly id: string; readonly source: string }[] = [
    { id: "a function overload set", source: `export function f(): string { return readValue(1) }` },
    { id: "a declare function overload set", source: `export function f(): string { return ambient(1) }` },
    { id: "a static method overload set", source: `export function f(): string { return Box.make(1) }` },
    { id: "an interface method overload set", source: `export function f(): string { return api.read(1) }` },
  ];

  for (const form of ACCEPTED) {
    test(`${form.id}: resolving to the MARKED overload is still trusted`, () => {
      const compiled = compile(
        `import { readValue, ambient, Box, api } from "./overloads.ts"\n${form.source}\n`,
      );
      expect(compiled.codes).toEqual([]);
      expect(compiled.rows.f?.failures).toEqual([]);
    });
  }

  test("the no-marker control is refused, which is what proves the marker conferred the trust", () => {
    const compiled = compile(`import { plain } from "./overloads.ts"
export function f(): string { return plain("x") }
`);
    expect(compiled.rows.f?.failures).toEqual(["Panic"]);
  });

  test("two contradictory @throws tags refuse in BOTH orders, not only one", () => {
    const first = compile(`import { neverFirst } from "./overloads.ts"
export function f(): string { return neverFirst() }
`);
    const second = compile(`import { declaredFirst } from "./overloads.ts"
export function f(): string { return declaredFirst() }
`);
    expect(first.codes).toContain("SMITHERS1502");
    expect(second.codes).toContain("SMITHERS1502");
    expect(first.rows.f?.failures).toEqual(["Panic"]);
    expect(second.rows.f?.failures).toEqual(["Panic"]);
  });

  test("two IDENTICAL @throws tags are redundant, not contradictory, and still trust", () => {
    const compiled = compile(`import { neverTwice } from "./overloads.ts"
export function f(): string { return neverTwice() }
`);
    expect(compiled.codes).toEqual([]);
    expect(compiled.rows.f?.failures).toEqual([]);
  });
});

/**
 * A selecting operator carries the provenance of the operand it yields.
 *
 * `foreignValueOrigin` gates ALL foreign analysis — `foreignPolicy` returns
 * `undefined` outright when it finds no origin — and its operator table knew the
 * ternary and the comma but not `??`, `||` and `&&`. Three hundred lines away,
 * the receiver walk for `Capability.context()` carried exactly the complete
 * table: one was taught, its sibling was not. Two characters were therefore
 * enough to escape every foreign rule at once —
 *
 *   function callIt(v: string): string { return (untrusted ?? trusted)(v) }
 *
 * checked `ok: true` with `failures: []`, `requirements: []` and no diagnostic
 * at all, ran, and let a raw host `Error` out of a checked function. `untrusted(v)`
 * was refused. The Go fork refused the `??` spelling too, so this was a live
 * backend divergence in which the reference was the wrong one.
 *
 * `(config.handler ?? defaultHandler)(x)` and `(table.get(k) ?? fallback)(x)` are
 * the idiomatic spellings of exactly this, which is why the table below folds
 * BOTH operands of `??`/`||`/`&&`: which one the expression yields is not
 * decidable here, and folding both is the closed direction. The two walks now
 * share one table so the next fix cannot land on only one of them.
 */
describe("a selecting operator carries its operands' foreign provenance", () => {
  const OPERATORS: readonly { readonly id: string; readonly callee: string }[] = [
    { id: "a bare reference", callee: `untrustedTag` },
    { id: "parenthesized", callee: `(untrustedTag)` },
    { id: "a comma", callee: `(0, untrustedTag)` },
    { id: "a ternary", callee: `(flag ? untrustedTag : untrustedTag)` },
    { id: "??", callee: `(untrustedTag ?? untrustedTag)` },
    { id: "||", callee: `(untrustedTag || untrustedTag)` },
    { id: "&&", callee: `(untrustedTag && untrustedTag)` },
    // The idiomatic spelling: a foreign value with a LOCAL fallback. Folding
    // only the operand that "wins" would miss it, so both are folded.
    { id: "?? with a local fallback on the right", callee: `(untrustedTag ?? localTag)` },
    { id: "?? with the local on the LEFT", callee: `(localTag ?? untrustedTag)` },
  ];

  for (const form of OPERATORS) {
    test(`${form.id} still reaches the foreign tag`, () => {
      const compiled = compile(`import { tag as untrustedTag } from "./untrusted.ts"
function localTag(strings: TemplateStringsArray, ...v: readonly unknown[]): string { return strings.raw.join("") + String(v.length) }
export function f(flag: boolean): string { return ${form.callee}\`x\` }
`);
      expect(compiled.codes).toContain("SMITHERS1504");
    });
  }

  test("the panic case survives ?? on a plain foreign call", () => {
    const compiled = compile(`import { stringy } from "./untrusted.ts"
declare const other: { toString(): string }
export function f(): string { return (stringy ?? other).toString() }
`);
    expect(compiled.codes).toContain("SMITHERS1101");
    expect(compiled.rows.f?.failures).toEqual(["Panic"]);
  });

  test("a foreign CONSTRUCTOR is still refused behind ??", () => {
    const compiled = compile(`import { BoomBase } from "./untrusted.ts"
export function f(): unknown { return new (BoomBase ?? BoomBase)() }
`);
    expect(compiled.codes).toContain("SMITHERS1504");
  });

  test("a foreign property read is still refused behind ??", () => {
    const compiled = compile(`import { spreadable } from "./untrusted.ts"
export function f(): number { return (spreadable ?? spreadable).a }
`);
    expect(compiled.codes).toContain("SMITHERS1506");
  });

  // The negative half: the same three operators over values that are not
  // foreign at all must stay completely clean, or the rule merely widened.
  for (const form of [
    { id: "?? over two locals", source: `export function f(a: string | undefined, b: string): string { return a ?? b }` },
    { id: "|| over two locals", source: `export function f(a: string, b: string): string { return a || b }` },
    { id: "&& over two locals", source: `export function f(a: string, b: string): string { return a && b }` },
    {
      id: "?? selecting between two LOCAL callables",
      source: `const g = (): string => "g"
const h: (() => string) | undefined = undefined
export function f(): string { return (h ?? g)() }`,
    },
  ]) {
    test(`${form.id} stays clean`, () => {
      expect(compile(`${form.source}\n`).codes).toEqual([]);
    });
  }

  /**
   * A trusted foreign callee selected at RUNTIME is refused by SMITHERS1507 —
   * the POC cannot emit an expression-order-safe lowering for a callee it cannot
   * name — and that was already true of the ternary and the comma before `??`
   * joined the table. The point of sharing one table is that the five spellings
   * answer alike; a direct or parenthesized reference is still clean, because
   * nothing about it is selected at runtime.
   */
  test("a trusted foreign callee answers the same in every selecting spelling", () => {
    const head = `import { giveString } from "./trusted.ts"\n`;
    const spelling = (body: string) =>
      compile(`${head}export function f(flag: boolean): string { ${body} }\n`).codes;
    expect(spelling(`return giveString()`)).toEqual([]);
    expect(spelling(`return (giveString)()`)).toEqual([]);
    const ternary = spelling(`return (flag ? giveString : giveString)()`);
    expect(ternary).toEqual(["SMITHERS1507"]);
    for (const selected of [
      `return (giveString ?? giveString)()`,
      `return (giveString || giveString)()`,
      `return (giveString && giveString)()`,
      `return (0, giveString)()`,
    ]) {
      expect(spelling(selected)).toEqual(ternary);
    }
  });
});
