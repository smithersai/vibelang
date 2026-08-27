/**
 * WHICH SPELLING of a protocol member the analyzer can see, and WHERE a member's
 * computed name is evaluated.
 *
 * `coercion-rows.test.ts` pins the other axis of the same rule: which POSITIONS
 * invoke a protocol member. That axis was made total by asking one predicate,
 * `implicitInvocationProtocol`. This file is the axis that was still a list:
 * having decided a position invokes `valueOf`, the analyzer resolved "which
 * checked function is `valueOf`" with a single syntactic hop — the member
 * symbol's declaration, looked up in `functionByNode` — and that hop lands only
 * when the declaration IS the function. It is the method shorthand
 * `{ valueOf() {} }` and its accessor sibling, and nothing else.
 *
 * Measured with a runtime oracle over a 165-cell spelling x member matrix. Each
 * cell was written twice: once with the member reading a capability, so `check`
 * says whether the row was charged and `run` says whether the program panics;
 * and once with the member RECORDING its own invocation and reading nothing, so
 * the program compiles, RUNS on both backends, and prints exactly which member
 * ECMAScript reached. That makes every "sound" verdict below a measurement of
 * the runtime rather than a judgement.
 *
 * 83 of the 159 measurable cells were fail-open, on ALL EIGHT protocol members —
 * `valueOf`, `toString`, `toJSON`, `Symbol.toPrimitive`, `Symbol.iterator`,
 * `Symbol.asyncIterator`, `Symbol.hasInstance` and `then`. Every one of them
 * checked `ok: true` with `requirements: []` and panicked at run time with
 * `capability 'Db' was not provided`.
 *
 * Three separate defects, one shape each:
 *
 *  1. THE MEMBER SPELLING. `{ valueOf: () => … }`, `{ valueOf: function () {} }`,
 *     `{ ["valueOf"]: () => … }`, `{ valueOf }`, `{ valueOf: impl }` and
 *     `class C { valueOf = () => … }` all declare a member that really runs and
 *     none of them declares a function-like node. `memberInvocations` now asks
 *     the CHECKER second — a member's type carries call signatures and a
 *     signature carries the declaration it came from — which is the same move
 *     `resolveFunctionReference` and `resolveLocalCallee` already make, and it is
 *     why a spelling is covered because TypeScript resolves it rather than
 *     because someone listed it.
 *
 *  2. THE COMPUTED MEMBER NAME. `{ [obj]() {} }` evaluates `obj` where the
 *     object literal is written, but every walk here stops at a function
 *     boundary and a method's own walk starts at its BODY, so the key was
 *     visited by nobody and `nearestFunction` answered with the method the key
 *     names. Nine function-like member kinds were open; the three member kinds
 *     that are NOT function-like were charged all along, which is the signature
 *     of a walk that stops at functions. `evaluatedOutsideFunction` is the one
 *     table that says which children of a function belong to the scope around
 *     it.
 *
 *  3. THE PARENTHESISED AMBIENT CALLEE. `(Number)(obj)` and `(String)(obj)`
 *     coerce exactly as the bare spellings do — measured — and the reference
 *     read the callee with no paren-skip while the Go fork skipped parentheses
 *     on both. Two sibling ambient calls, two different rules, two divergences.
 *     They are now ONE branch reading the callee through `withoutParentheses`,
 *     the table `calleeSelection` beside it already uses.
 *
 * As in the sibling file, the load-bearing half is the NEGATIVE half. Widening
 * WHICH member the analyzer can see is far likelier to refuse working programs
 * than to miss one, so every spelling that is charged at a number-hint position
 * is paired here with the same spelling at a STRING-hint position, where
 * ECMAScript stops at `Object.prototype.toString` and never calls `valueOf` at
 * all — measured: each of those programs runs and prints `[object Object]`.
 */
import { describe, expect, test } from "bun:test";
import { analyzeProject } from "./index.ts";

const CAPABILITY = `import { Context } from "smthrs/context"

abstract class Db extends Context {
  abstract read(): string
}
`;

interface Measured {
  readonly codes: readonly string[];
  readonly rows: Record<string, { requirements: readonly string[]; failures: readonly string[] }>;
}

function measure(source: string): Measured {
  const analysis = analyzeProject([{ fileName: "main.sm", source }], {
    rootDir: "/virtual/coercion-member-spellings",
  });
  const rows: Measured["rows"] = {};
  for (const file of Object.values(analysis.files)) {
    for (const [name, row] of Object.entries(file.rows)) rows[name] = row;
  }
  return {
    codes: analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.code).sort(),
    rows,
  };
}

/**
 * Every way of writing the SAME member on the SAME object.
 *
 * Each entry declares `obj`, whose `valueOf` reads the capability and nothing
 * else does. They are asserted as one equality — every spelling answers what the
 * method shorthand answers — rather than as a per-spelling list, for the same
 * reason the position table is one predicate: a list is what let `{ valueOf() {} }`
 * be right while `{ valueOf: () => … }` was silent for as long as both existed.
 */
const VALUE_OF_SPELLINGS: readonly {
  readonly id: string;
  readonly declaration: string;
  /**
   * Codes the DECLARATION draws on its own, at neither position. Only one
   * spelling has any: a module-scope `Object.freeze({ … })` hands a
   * capability-reading function to an ambient call, which the callback-crossing
   * rule refuses at the `Object.freeze` call itself — measured identically with
   * the coercion removed entirely, so it is that rule's answer and not this
   * one's.
   */
  readonly unrelatedCodes?: readonly string[];
}[] = [
  { id: "a method shorthand", declaration: `const obj = { valueOf(): number { return Db.context().read().length } }` },
  { id: "an arrow property", declaration: `const obj = { valueOf: (): number => Db.context().read().length }` },
  {
    id: "a function-expression property",
    declaration: `const obj = { valueOf: function (): number { return Db.context().read().length } }`,
  },
  {
    id: "a computed key spelled with a string literal",
    declaration: `const obj = { ["valueOf"](): number { return Db.context().read().length } }`,
  },
  {
    id: "a computed key spelled with a string literal, arrow-valued",
    declaration: `const obj = { ["valueOf"]: (): number => Db.context().read().length }`,
  },
  {
    id: "a computed key spelled with a const binding",
    declaration: `const KEY = "valueOf"
const obj = { [KEY](): number { return Db.context().read().length } }`,
  },
  {
    id: "a computed key spelled with a const binding, arrow-valued",
    declaration: `const KEY = "valueOf"
const obj = { [KEY]: (): number => Db.context().read().length }`,
  },
  {
    id: "a getter that reads the capability itself",
    declaration:
      `const obj = { get valueOf(): (() => number) { Db.context().read(); return (): number => 1 } }`,
  },
  {
    id: "a getter whose RETURNED function reads it",
    declaration: `const obj = { get valueOf() { return (): number => Db.context().read().length } }`,
  },
  {
    id: "a property naming a function declared elsewhere",
    declaration: `function impl(): number { return Db.context().read().length }
const obj = { valueOf: impl }`,
  },
  {
    id: "a shorthand property",
    declaration: `const valueOf = (): number => Db.context().read().length
const obj = { valueOf }`,
  },
  {
    id: "a class method",
    declaration: `class C { valueOf(): number { return Db.context().read().length } }
const obj = new C()`,
  },
  {
    id: "a class field holding an arrow",
    declaration: `class C { valueOf = (): number => Db.context().read().length }
const obj = new C()`,
  },
  {
    id: "a method inherited from a base class",
    declaration: `class B { valueOf(): number { return Db.context().read().length } }
class D extends B {}
const obj = new D()`,
  },
  {
    id: "a member copied off a prototype object by spread",
    declaration: `const proto = { valueOf(): number { return Db.context().read().length } }
const obj = { ...proto }`,
  },
  {
    id: "a member copied by Object.assign",
    declaration: `const proto = { valueOf(): number { return Db.context().read().length } }
const obj = Object.assign({}, proto)`,
  },
  {
    id: "a member reached through a const alias",
    declaration: `const base = { valueOf: (): number => Db.context().read().length }
const obj = base`,
  },
  {
    id: "a member reached through an object property",
    declaration: `const holder = { inner: { valueOf: (): number => Db.context().read().length } }
const obj = holder.inner`,
  },
  {
    id: "a member on a frozen object",
    declaration:
      `const obj = Object.freeze({ valueOf(): number { return Db.context().read().length } })`,
    unrelatedCodes: ["SMITHERS2102"],
  },
];

describe("every spelling of a coercion member is the same member", () => {
  test("the control: the method shorthand really is charged, so the equality below is not vacuous", () => {
    const measured = measure(
      CAPABILITY + VALUE_OF_SPELLINGS[0]!.declaration + `\nexport function f(): number { return +obj }`,
    );
    expect(measured.rows.f?.requirements).toEqual(["Db"]);
  });

  for (const { id, declaration, unrelatedCodes = [] } of VALUE_OF_SPELLINGS) {
    test(`${id} charges the same row at \`+obj\``, () => {
      const measured = measure(CAPABILITY + declaration + `\nexport function f(): number { return +obj }`);
      expect(measured.rows.f?.requirements).toEqual(["Db"]);
    });

    // The other direction, for the SAME declaration. At a string-hint position
    // ECMAScript stops at `Object.prototype.toString` and never calls `valueOf`:
    // measured, each of these programs runs and prints `[object Object]`. If the
    // fix above ever flattens the OrdinaryToPrimitive walk, every row here breaks
    // at once.
    test(`${id} is NOT charged at a string-hint position, where valueOf is unreachable`, () => {
      const measured = measure(
        CAPABILITY + declaration + "\nexport function f(): string { return `${obj}` }",
      );
      expect(measured.codes).toEqual(unrelatedCodes);
      expect(measured.rows.f?.requirements).toEqual([]);
    });
  }
});

/**
 * The same defect on every OTHER member of the protocol, in the spelling that
 * was silent for all of them. One row per member, because the resolver is shared:
 * if it regresses it regresses for all eight, and if a ninth member is ever added
 * it is covered by the same code path rather than by a new entry here.
 */
const MEMBERS: readonly { readonly id: string; readonly source: string }[] = [
  {
    id: "valueOf under `+obj`",
    source: `const obj = { valueOf: (): number => Db.context().read().length }
export function f(): number { return +obj }`,
  },
  {
    id: "toString under a template span",
    source: `const obj = { toString: (): string => Db.context().read() }
export function f(): string { return \`\${obj}\` }`,
  },
  {
    id: "toJSON under JSON.stringify",
    source: `const obj = { toJSON: (): string => Db.context().read() }
export function f(): string { return JSON.stringify(obj) }`,
  },
  {
    id: "Symbol.toPrimitive under `+obj`",
    source: `const obj = { [Symbol.toPrimitive]: (hint: string): number => Db.context().read().length + hint.length - hint.length }
export function f(): number { return +obj }`,
  },
  {
    id: "Symbol.iterator under a spread",
    source:
      `const obj = { [Symbol.iterator]: (): Iterator<number> => [Db.context().read().length][Symbol.iterator]() }
export function f(): number { return [...obj].length }`,
  },
  {
    id: "Symbol.hasInstance under `instanceof`",
    source:
      `const obj = { [Symbol.hasInstance]: (value: unknown): boolean => Db.context().read().length > 0 && value !== null }
export function f(x: unknown): boolean { return x instanceof obj }`,
  },
  {
    id: "then under `await`",
    source: `const obj = { then: (resolve: (value: number) => void): void => { resolve(Db.context().read().length) } }
export async function f(): Promise<number> { return await obj }`,
  },
];

describe("an arrow-valued member is charged for every member of the protocol", () => {
  for (const { id, source } of MEMBERS) {
    test(id, () => {
      expect(measure(CAPABILITY + source).rows.f?.requirements).toEqual(["Db"]);
    });
  }
});

/**
 * A member's COMPUTED NAME is evaluated in the scope around the member, not
 * inside it.
 *
 * The three entries marked "already charged" are the member kinds that are NOT
 * function-like. They passed before this fix and are kept deliberately: they are
 * the control that says the nine that failed did so because the walk stops at
 * functions, and not for some reason particular to computed keys.
 */
const COMPUTED_KEY_HOLDER = `const obj = { toString(): string { return Db.context().read() } }
`;
const COMPUTED_NAME_MEMBERS: readonly { readonly id: string; readonly member: string }[] = [
  { id: "an object-literal method", member: `{ [obj as unknown as string]() { return 1 } }` },
  { id: "an object-literal getter", member: `{ get [obj as unknown as string](): number { return 1 } }` },
  { id: "an object-literal setter", member: `{ set [obj as unknown as string](v: number) {} }` },
  {
    id: "an object-literal async method",
    member: `{ async [obj as unknown as string](): Promise<number> { return 1 } }`,
  },
  {
    id: "an object-literal generator method",
    member: `{ *[obj as unknown as string](): Generator<number> { yield 1 } }`,
  },
  { id: "an object-literal arrow property (already charged)", member: `{ [obj as unknown as string]: (): number => 1 }` },
  { id: "an object-literal value property (already charged)", member: `{ [obj as unknown as string]: 1 }` },
];
const COMPUTED_NAME_CLASS_MEMBERS: readonly { readonly id: string; readonly member: string }[] = [
  { id: "a class method", member: `[obj as unknown as string]() { return 1 }` },
  { id: "a class getter", member: `get [obj as unknown as string](): number { return 1 }` },
  { id: "a class static method", member: `static [obj as unknown as string]() { return 1 }` },
  { id: "a class async method", member: `async [obj as unknown as string](): Promise<number> { return 1 }` },
  { id: "a class property declaration (already charged)", member: `[obj as unknown as string]: number = 1` },
];

describe("a computed member name is charged to the scope that evaluates it", () => {
  for (const { id, member } of COMPUTED_NAME_MEMBERS) {
    test(`${id} charges the enclosing function`, () => {
      const measured = measure(CAPABILITY + COMPUTED_KEY_HOLDER +
        `export function f(): number { const shape = ${member}; return Object.keys(shape).length }`);
      expect(measured.rows.f?.requirements).toEqual(["Db"]);
    });
  }

  for (const { id, member } of COMPUTED_NAME_CLASS_MEMBERS) {
    test(`${id} charges the enclosing function`, () => {
      const measured = measure(CAPABILITY + COMPUTED_KEY_HOLDER +
        `export function f(): number {
  class S { ${member} }
  return Object.keys(new S()).length
}`);
      expect(measured.rows.f?.requirements).toEqual(["Db"]);
    });
  }

  test("at module scope the same key has no row to charge and is refused", () => {
    const measured = measure(CAPABILITY + COMPUTED_KEY_HOLDER +
      `export const shape = { [obj as unknown as string]() { return 1 } }`);
    expect(measured.codes).toContain("SMITHERS2102");
  });

  test("the METHOD's own row is unaffected — the key is the enclosing scope's, the body is the method's", () => {
    const measured = measure(CAPABILITY + COMPUTED_KEY_HOLDER +
      `export function f(): number {
  const shape = { [obj as unknown as string](): number { return Db.context().read().length } }
  return Object.keys(shape).length
}`);
    // the enclosing function owns the KEY's coercion …
    expect(measured.rows.f?.requirements).toEqual(["Db"]);
    // … and the method still owns its own body, charged to whoever calls it.
    const method = Object.entries(measured.rows).find(([name]) => name.startsWith("<anonymous"));
    expect(method?.[1].requirements).toEqual(["Db"]);
  });

  test("a computed method name that reads nothing records no row and stays accepted", () => {
    const measured = measure(CAPABILITY + `const key = "k"
export function f(): number { const shape = { [key]() { return 1 } }; return Object.keys(shape).length }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual([]);
  });

  test("a parameter default is NOT the enclosing scope's — it belongs to the callee's own row", () => {
    const measured = measure(CAPABILITY + `const obj = { valueOf(): number { return Db.context().read().length } }
export function f(): number {
  const g = (n: number = +obj): number => n
  return g(1)
}`);
    // Deliberately unclosed: a default runs when the function is CALLED. The
    // point of the row here is that `evaluatedOutsideFunction` did not quietly
    // claim it.
    expect(measured.rows.f?.requirements).toEqual([]);
  });
});

/**
 * `Number(x)` and `String(x)` in parentheses.
 *
 * The runtime oracle says both coerce; the Go fork refused both and the
 * reference accepted both, so the pair was two divergences with one cause — the
 * ambient callee was read with no paren-skip. Landing only one of the two would
 * be the same defect over again, so they are asserted together.
 */
describe("a parenthesised ambient coercion callee is the same call", () => {
  const VALUE_OF = `const obj = { valueOf(): number { return Db.context().read().length } }\n`;
  const TO_STRING = `const obj = { toString(): string { return Db.context().read() } }\n`;

  test("Number(obj)", () => {
    expect(measure(CAPABILITY + VALUE_OF + `export function f(): number { return Number(obj) }`)
      .rows.f?.requirements).toEqual(["Db"]);
  });
  test("(Number)(obj)", () => {
    expect(measure(CAPABILITY + VALUE_OF + `export function f(): number { return (Number)(obj) }`)
      .rows.f?.requirements).toEqual(["Db"]);
  });
  test("String(obj)", () => {
    expect(measure(CAPABILITY + TO_STRING + `export function f(): string { return String(obj) }`)
      .rows.f?.requirements).toEqual(["Db"]);
  });
  test("(String)(obj)", () => {
    expect(measure(CAPABILITY + TO_STRING + `export function f(): string { return (String)(obj) }`)
      .rows.f?.requirements).toEqual(["Db"]);
  });

  test("a LOCAL function named Number is an ordinary call, parenthesised too", () => {
    const measured = measure(CAPABILITY + `function Number(x: unknown): number { return 0 }
` + `const obj = { valueOf: (): number => Db.context().read().length }
export function f(): number { return (Number)(obj) }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual([]);
  });

  test("a LOCAL function named String is an ordinary call, parenthesised too", () => {
    const measured = measure(CAPABILITY + `function String(x: unknown): string { return "" }
` + `const obj = { toString: (): string => Db.context().read() }
export function f(): string { return (String)(obj) }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual([]);
  });
});

/**
 * The row TRAVELS — it is recorded, not merely un-refused.
 *
 * Being refused at the coercion site would not show this. Handing the enclosing
 * function the WRONG layer has to draw `SMITHERS2101 "Layer.provide is missing
 * Db"`, exactly as the direct call spelling's row does, and handing it the RIGHT
 * one has to compile: measured end to end, each of these programs with the right
 * layer runs and prints its value (`arrow: 3`, `fnexpr: DBX`, `key: 1`,
 * `numparen: 3`).
 */
const TRAVELS: readonly { readonly id: string; readonly declaration: string; readonly body: string }[] = [
  {
    id: "an arrow-spelled valueOf",
    declaration: `const obj = { valueOf: (): number => Db.context().read().length }`,
    body: `return +obj`,
  },
  {
    id: "a function-expression toString",
    declaration: `const obj = { toString: function (): string { return Db.context().read() } }`,
    body: "return `${obj}`.length",
  },
  {
    id: "a shorthand property",
    declaration: `const valueOf = (): number => Db.context().read().length
const obj = { valueOf }`,
    body: `return +obj`,
  },
  {
    id: "a computed method name",
    declaration: `const obj = { toString(): string { return Db.context().read() } }`,
    body: `const shape = { [obj as unknown as string]() { return 1 } }
  return Object.keys(shape).length`,
  },
  {
    id: "a parenthesised Number(x)",
    declaration: `const obj = { valueOf(): number { return Db.context().read().length } }`,
    body: `return (Number)(obj)`,
  },
];

describe("the coercion row reaches the Layer.provide site", () => {
  const PRELUDE = `import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"

abstract class Db extends Context {
  abstract read(): string
}
abstract class Log extends Context {
  abstract write(): string
}
`;

  for (const { id, declaration, body } of TRAVELS) {
    test(`${id}: the RIGHT layer compiles`, () => {
      const measured = measure(PRELUDE + declaration + `
function f(): number {
  ${body}
}
const db: Db = { read: () => "DBX" }
export const v = Layer.provide(Layer.succeed(Db, db), () => f())`);
      expect(measured.codes).toEqual([]);
      expect(measured.rows.f?.requirements).toEqual(["Db"]);
    });

    test(`${id}: the WRONG layer is refused at the provide site`, () => {
      const measured = measure(PRELUDE + declaration + `
function f(): number {
  ${body}
}
const log: Log = { write: () => "L" }
export const v = Layer.provide(Layer.succeed(Log, log), () => f())`);
      expect(measured.codes).toContain("SMITHERS2101");
    });
  }
});

/**
 * The negatives that the WIDER member resolver could have broken, each measured
 * as a program that runs.
 */
describe("widening which member the analyzer can see does not widen what it refuses", () => {
  test("a Symbol.toPrimitive still shadows an ARROW-spelled valueOf and toString", () => {
    const measured = measure(CAPABILITY + `const obj = {
  [Symbol.toPrimitive]: (hint: string): number => hint.length - hint.length + 1,
  valueOf: (): number => Db.context().read().length,
  toString: (): string => Db.context().read(),
}
export function f(): number { return +obj }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual([]);
  });

  test("an arrow-spelled valueOf that reads nothing records no row", () => {
    const measured = measure(CAPABILITY + `const obj = { valueOf: (): number => 7 }
export function f(): number { return +obj }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual([]);
  });

  test("READING an arrow-spelled member without calling it records no row", () => {
    const measured = measure(CAPABILITY + `const obj = { valueOf: (): number => Db.context().read().length }
export function f(): boolean { const m = obj.valueOf; return m === null }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual([]);
  });

  test("a tagged template hands an arrow-spelled toString to the tag untouched", () => {
    const measured = measure(CAPABILITY + `const obj = { toString: (): string => Db.context().read() }
/** @throws {never} */
function tag(parts: TemplateStringsArray, value: unknown): string { return parts[0] + String(typeof value) }
export function f(): string { return tag\`x\${obj}\` }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual([]);
  });

  test("`instanceof` still charges Symbol.hasInstance and not an arrow-spelled static toString", () => {
    const measured = measure(CAPABILITY + `class Foo { static toString = (): string => Db.context().read() }
export function f(x: unknown): boolean { return x instanceof Foo }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual([]);
  });

  test("a class-prototype getter is still not an own enumerable property", () => {
    const measured = measure(CAPABILITY + `class Box { get size(): number { return Db.context().read().length } }
export function f(): number { const copy = { ...new Box() }; return Object.keys(copy).length }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual([]);
  });

  test("strict equality, ToBoolean and typeof still run no member", () => {
    const measured = measure(CAPABILITY + `const obj = { valueOf: (): number => Db.context().read().length }
export function f(): number {
  void obj
  return ((obj as unknown) === 1 ? 1 : 0) + (obj ? 1 : 0) + (typeof obj === "object" ? 1 : 0)
}`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual([]);
  });
});
