/**
 * Foreign provenance across the wrappers that change the TYPE and never the value.
 *
 * A value walk that knows some syntactic wrappers and not its siblings is the
 * third appearance of one defect. Round one: `foreignValueOrigin` knew the
 * ternary and the comma but not `??`/`||`/`&&`, and the fix factored the
 * operator table into `valueBranches` so both provenance walks read ONE table.
 * Round two: the Go fork's `foreignValueProvenance` knew no selecting operator
 * at all and was fixed the same way. This file is round three, and the drift is
 * in the other table.
 *
 * Eight walks in `semantic.ts` each spelled their own
 * `isParenthesizedExpression(e) || isAsExpression(e) || …` chain. When
 * TypeScript 4.9 added `satisfies`, three of the eight learned it and five did
 * not. `foreignValueOrigin` was one of the five, so
 *
 *     function readIt(): string {
 *       return (client satisfies { readonly dangerous: string }).dangerous
 *     }
 *
 * checked `ok: true` with `failures: []` and ZERO diagnostics, and threw
 * `Error: getter blew` at run time out of a function that says it cannot fail.
 * Ten such programs were measured, one per rule the laundering silenced:
 * SMITHERS1504 (foreign constructor, foreign tagged template), SMITHERS1506
 * (property read, element access, optional chain, `for…of`, spread, template
 * interpolation, `+`, computed key, `instanceof`, destructuring),
 * SMITHERS1507/SMITHERS1101 (foreign callee), SMITHERS1508 (a foreign callable
 * handed to a higher-order call, stored through a mutable binding, or returned)
 * and SMITHERS1509 (a callback handed to an untrusted host).
 *
 * `satisfies` is the purest laundering wrapper the grammar has: unlike `as` it
 * does not even change the expression's type, so nothing downstream — not the
 * checker, not a later rule, not the emitted TypeScript — can notice it was
 * there. The class was enumerated as 33 spellings x 25 probe files (19 foreign
 * use positions and 6 negative controls) = 825 cells: 288 fail-open before the
 * fix, 0 after, 0 diagnostics lost anywhere, and every negative control
 * unchanged.
 *
 * The fix is `typeOnlyWrapperOperand`: ONE table, called by every value walk,
 * exactly as `valueBranches` is THE ONE TABLE for selecting operators. This
 * file is written as an EQUALITY table for that reason — the assertion is not
 * "the `satisfies` spelling reports SMITHERS1506" but "every type-only wrapper
 * answers exactly what the direct spelling answers, at every position". A new
 * wrapper is a new row, and a row that passes without a corresponding edit is
 * evidence the table is total rather than that the case was remembered.
 *
 * The load-bearing half is the NEGATIVE half, and it is not symmetric with the
 * positive half by accident:
 *
 *   * An authored value through every one of these wrappers stays clean, in
 *     every position.
 *   * A TRUSTED foreign tag and a TRUSTED foreign callee stay usable through
 *     `satisfies` — including `satisfies` nested in `??`, `||`, `&&`, a ternary
 *     and a comma, and a `const` that holds one. `satisfies` does not change
 *     the type, so `getResolvedSignature` still resolves to the marked
 *     declaration and the `@throws {never}` claim still stands.
 *   * `as` and an explicit type ANNOTATION are the opposite case and are pinned
 *     as such: both replace the resolved declaration with a `.sm`-local type
 *     node, so both erase the marker and both refuse. That difference is the
 *     whole reason `satisfies` cannot be treated as "a cast that returns its
 *     operand" — the two are the same for provenance and opposite for trust.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAndCheckProject } from "./index.ts";

const workspace = mkdtempSync(join(tmpdir(), "smithers-type-only-wrappers-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");

/** Untrusted foreign values. Every member throws, so every escape is observable. */
writeFileSync(join(workspace, "untrusted.ts"), `/**
 * @module
 * Module-initialization trust only. Nothing below claims @throws {never}.
 * @throws {never}
 */

export const client = {
  get dangerous(): string { throw new Error("getter"); },
  m(): string { throw new Error("method"); },
};
export const otherClient = {
  get dangerous(): string { return "safe"; },
  m(): string { return "safe"; },
};
export class Ctor { constructor(readonly v: string) { throw new Error("ctor"); } }
export class OtherCtor { constructor(readonly v: string) { } }
export function tag(parts: TemplateStringsArray): string { throw new Error("tag"); }
export function otherTag(parts: TemplateStringsArray): string { return "x"; }
export function call(value: string): string { throw new Error("call"); }
export function otherCall(value: string): string { return value; }
export function receive(cb: () => void): void { cb(); }
export const iterable: Iterable<string> = {
  *[Symbol.iterator](): Iterator<string> { throw new Error("iterator"); },
};
export const otherIterable: Iterable<string> = { *[Symbol.iterator](): Iterator<string> { yield "a"; } };
export const coercible = { toString(): string { throw new Error("toString"); } };
export const otherCoercible = { toString(): string { return "s"; } };
export const keyed = { a: 1 };
export const otherKeyed = { a: 2 };
`);

/** Trusted bindings, and the two constructor markers that resolve differently. */
writeFileSync(join(workspace, "trusted.ts"), `/**
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function giveString(value: string): string { return value; }
/** @throws {never} */
export function giveString2(value: string): string { return value; }
/** @throws {never} */
export function trustedTag(parts: TemplateStringsArray): string { return "t"; }
/** @throws {never} */
export function trustedTag2(parts: TemplateStringsArray): string { return "t2"; }

export class OwnLineMarked {
  /** @throws {never} */
  constructor(readonly v: string) { if (v === "bad") throw new Error("own-line"); }
}

export class SameLineMarked { /** @throws {never} */ constructor(readonly v: string) { if (v === "bad") throw new Error("same-line"); } }

export class Unmarked {
  constructor(readonly v: string) { if (v === "bad") throw new Error("unmarked"); }
}
`);

interface Measured {
  /** Diagnostic codes attributed to the line the spelling occupies, sorted. */
  readonly codes: readonly string[];
  readonly failures: readonly string[];
}

let sequence = 0;
/**
 * Compile ONE file holding one function per spelling, and attribute every
 * diagnostic to the single function whose line it lands on. One compile per
 * position keeps a 19 x 33 table affordable while still giving each cell its
 * own verdict.
 */
function measureTable(
  header: string,
  prelude: string,
  spellings: readonly (readonly [string, string])[],
  returnType = "string",
  asyncFunctions = false,
): Record<string, Measured> {
  sequence += 1;
  const lines: string[] = [];
  for (const line of header.replace(/\n+$/, "").split("\n")) lines.push(line);
  if (prelude) for (const line of prelude.split("\n")) lines.push(line);
  const byLine = new Map<number, string>();
  const byName = new Map<string, string>();
  spellings.forEach(([label, body], index) => {
    const name = `f${String(index).padStart(2, "0")}`;
    lines.push(`export ${asyncFunctions ? "async " : ""}function ${name}(c: boolean, v: string): ${returnType} { ${body} }`);
    byLine.set(lines.length, label);
    byName.set(label, name);
  });
  const fileName = join(workspace, `case-${sequence}.sm`);
  const checked = compileAndCheckProject([{ fileName, source: `${lines.join("\n")}\n` }], {
    rootDir: workspace,
    outDir: join(workspace, `out-${sequence}`),
    runtimeImport: RUNTIME,
  });
  const file = Object.values(checked.result.files)[0];
  const rows = (file?.analysis.rows ?? {}) as Record<string, { failures: readonly string[] }>;
  const codes = new Map<string, string[]>(spellings.map(([label]) => [label, []]));
  for (const diagnostic of checked.result.diagnostics) {
    if (diagnostic.severity !== "error") continue;
    const label = byLine.get(diagnostic.line);
    // A diagnostic on the module header or on the prelude belongs to no cell and
    // would otherwise be silently attributed to one.
    expect(label, `unattributed ${diagnostic.code} at line ${diagnostic.line}`).toBeDefined();
    codes.get(label!)!.push(diagnostic.code);
  }
  const measured: Record<string, Measured> = {};
  for (const [label] of spellings) {
    measured[label] = {
      codes: [...codes.get(label)!].sort(),
      failures: [...(rows[byName.get(label)!]?.failures ?? [])].sort(),
    };
  }
  return measured;
}

/**
 * A spelling of a foreign value `X` whose runtime value IS `X`.
 *
 * `L` is a LOCAL alternate. The selector rows need it: pairing the wrapped
 * foreign value with a second FOREIGN operand lets the branch fold reach
 * provenance through the other operand, which hides a laundered one. With a
 * local alternate the only route to a diagnostic is through the wrapper.
 */
type Spelling = (X: string, T: string, L: string) => string;

/** Wrappers whose verdict must equal the DIRECT spelling's. */
const TYPE_ONLY_WRAPPERS: readonly (readonly [string, Spelling])[] = [
  ["direct", (X) => X],
  ["parenthesised", (X) => `(${X})`],
  ["satisfies T", (X, T) => `(${X} satisfies ${T})`],
  ["satisfies unknown", (X) => `(${X} satisfies unknown)`],
  ["satisfies twice", (X, T) => `((${X} satisfies ${T}) satisfies unknown)`],
  ["satisfies over a parenthesis", (X, T) => `((${X}) satisfies ${T})`],
  ["a parenthesis over satisfies", (X, T) => `((${X} satisfies ${T}))`],
  ["as T", (X, T) => `(${X} as ${T})`],
  ["as unknown as T", (X, T) => `(${X} as unknown as ${T})`],
  ["an angle-bracket cast", (X, T) => `(<${T}>${X})`],
  ["satisfies then as", (X, T) => `((${X} satisfies ${T}) as ${T})`],
  ["as then satisfies", (X, T) => `((${X} as ${T}) satisfies ${T})`],
];

/** Statement-shaped spellings whose verdict must equal the DIRECT spelling's. */
const BINDING_WRAPPERS: readonly (readonly [string, (X: string, T: string, use: (e: string) => string) => string])[] = [
  ["a const that holds the satisfies", (X, T, use) => `const g = ${X} satisfies ${T}; ${use("g")}`],
  ["an annotated const that holds the satisfies", (X, T, use) => `const g: ${T} = ${X} satisfies ${T}; ${use("g")}`],
  ["an annotated const holding it directly", (X, T, use) => `const g: ${T} = ${X}; ${use("g")}`],
  ["a const holding it directly", (X, T, use) => `const g = ${X}; ${use("g")}`],
  ["two const hops over a satisfies", (X, T, use) => `const a = ${X} satisfies ${T}; const b = a; ${use("b")}`],
];

/** Wrappers whose verdict must equal the `(X) ?? local` spelling's. */
const SELECTOR_WRAPPERS: readonly (readonly [string, Spelling])[] = [
  ["a selection over the value", (X, T, L) => `((${X}) ?? ${L})`],
  ["satisfies in the ?? left operand", (X, T, L) => `((${X} satisfies ${T}) ?? ${L})`],
  ["satisfies in the && right operand", (X, T, L) => `(${L} && (${X} satisfies ${T}))`],
  ["satisfies in a || left operand", (X, T, L) => `((${X} satisfies ${T}) || ${L})`],
  ["satisfies in a ternary arm", (X, T, L) => `(c ? (${X} satisfies ${T}) : ${L})`],
  ["satisfies over the whole selection", (X, T, L) => `((${X} ?? ${L}) satisfies ${T})`],
  // A comma IS a selecting operator (its value is the right operand alone), so
  // it belongs here and not with the type-only wrappers: at a CALLEE position
  // every selecting spelling adds SMITHERS1507, because the POC cannot emit an
  // order-safe lowering for a callee it cannot name.
  ["satisfies inside a comma", (X, T, L) => `((${L}, (${X} satisfies ${T})))`],
];

interface Position {
  readonly id: string;
  readonly imports: string;
  readonly prelude: string;
  /** The type the foreign value satisfies. */
  readonly type: string;
  readonly value: string;
  readonly local: string;
  readonly body: (expression: string) => string;
  readonly returnType?: string;
}

const CLIENT_T = "{ readonly dangerous: string, m(): string }";
const CTOR_T = "new (v: string) => { readonly v: string }";
const TAG_T = "(parts: TemplateStringsArray) => string";
const CALL_T = "(value: string) => string";
const ITER_T = "Iterable<string>";
const COERCE_T = "{ toString(): string }";

const LOCAL_CLIENT = `const localClient = { get dangerous(): string { return "l" }, m(): string { return "l" } }`;
const LOCAL_CTOR = `class LocalCtor { constructor(readonly v: string) {} }`;
const LOCAL_TAG = `function localTag(parts: TemplateStringsArray): string { return "l" }`;
const LOCAL_CALL = `function localCall(value: string): string { return value }`;
const LOCAL_ITER = `const localIterable: Iterable<string> = ["l"]`;
const LOCAL_COERCE = `const localCoercible = { toString(): string { return "l" } }`;

const client = (id: string, body: Position["body"]): Position => ({
  id,
  imports: `import { client } from "./untrusted.ts"`,
  prelude: LOCAL_CLIENT,
  type: CLIENT_T,
  value: "client",
  local: "localClient",
  body,
});

/** Every use position a laundered foreign value can reach. */
const POSITIONS: readonly Position[] = [
  client("a property read", (e) => `return ${e}.dangerous`),
  client("an element access", (e) => `return ${e}["dangerous"]`),
  client("an optional chain", (e) => `return ${e}?.dangerous ?? "none"`),
  client("a method call", (e) => `return ${e}.m()`),
  client("object destructuring", (e) => `const { dangerous } = ${e}; return dangerous`),
  {
    id: "a construction",
    imports: `import { Ctor } from "./untrusted.ts"`,
    prelude: LOCAL_CTOR,
    type: CTOR_T,
    value: "Ctor",
    local: "LocalCtor",
    body: (e) => `const o = new ${e}("a"); return o.v === "" ? "a" : "b"`,
  },
  {
    id: "an instanceof right operand",
    imports: `import { Ctor } from "./untrusted.ts"`,
    prelude: LOCAL_CTOR,
    type: CTOR_T,
    value: "Ctor",
    local: "LocalCtor",
    body: (e) => `return String(v instanceof (${e} as unknown as new () => object))`,
  },
  {
    id: "a tagged template",
    imports: `import { tag } from "./untrusted.ts"`,
    prelude: LOCAL_TAG,
    type: TAG_T,
    value: "tag",
    local: "localTag",
    body: (e) => "return " + e + "`x`",
  },
  {
    id: "a callee",
    imports: `import { call } from "./untrusted.ts"`,
    prelude: LOCAL_CALL,
    type: CALL_T,
    value: "call",
    local: "localCall",
    body: (e) => `return ${e}(v)`,
  },
  {
    id: "a callback handed to an untrusted host",
    imports: `import { receive } from "./untrusted.ts"`,
    prelude: `function localReceive(cb: () => void): void { cb() }`,
    type: "(cb: () => void) => void",
    value: "receive",
    local: "localReceive",
    body: (e) => `let seen = "n"; ${e}(() => { seen = "y" }); return seen`,
  },
  {
    id: "an array spread",
    imports: `import { iterable } from "./untrusted.ts"`,
    prelude: LOCAL_ITER,
    type: ITER_T,
    value: "iterable",
    local: "localIterable",
    body: (e) => `return [...${e}].join("")`,
  },
  {
    id: "a spread into arguments",
    imports: `import { iterable } from "./untrusted.ts"`,
    prelude: `${LOCAL_ITER}\nfunction joinAll(...parts: readonly string[]): string { return parts.join("") }`,
    type: ITER_T,
    value: "iterable",
    local: "localIterable",
    body: (e) => `return joinAll(...${e})`,
  },
  {
    id: "a for…of",
    imports: `import { iterable } from "./untrusted.ts"`,
    prelude: LOCAL_ITER,
    type: ITER_T,
    value: "iterable",
    local: "localIterable",
    body: (e) => `let out = ""; for (const s of ${e}) { out = out + s } return out`,
  },
  {
    id: "a template interpolation",
    imports: `import { coercible } from "./untrusted.ts"`,
    prelude: LOCAL_COERCE,
    type: COERCE_T,
    value: "coercible",
    local: "localCoercible",
    body: (e) => "return `v${" + e + "}`",
  },
  {
    id: "a + coercion",
    imports: `import { coercible } from "./untrusted.ts"`,
    prelude: LOCAL_COERCE,
    type: COERCE_T,
    value: "coercible",
    local: "localCoercible",
    body: (e) => `return ${e} + ""`,
  },
  {
    id: "a computed key",
    imports: `import { coercible } from "./untrusted.ts"`,
    prelude: LOCAL_COERCE,
    type: COERCE_T,
    value: "coercible",
    local: "localCoercible",
    body: (e) => `const o = { [${e} as unknown as string]: 1 }; return String(o.a ?? 0)`,
  },
  {
    id: "a higher-order argument",
    imports: `import { call } from "./untrusted.ts"`,
    prelude: `${LOCAL_CALL}\nfunction localHof(fn: (value: string) => string): string { return fn("x") }`,
    type: CALL_T,
    value: "call",
    local: "localCall",
    body: (e) => `return localHof(${e})`,
  },
  {
    id: "a mutable store",
    imports: `import { call } from "./untrusted.ts"`,
    prelude: LOCAL_CALL,
    type: CALL_T,
    value: "call",
    local: "localCall",
    body: (e) => `let held: (value: string) => string = localCall; held = ${e}; return held(v)`,
  },
  {
    id: "a return",
    imports: `import { call } from "./untrusted.ts"`,
    prelude: LOCAL_CALL,
    type: CALL_T,
    value: "call",
    local: "localCall",
    body: (e) => `return ${e}`,
    returnType: CALL_T,
  },
];

function tableFor(position: Position): Record<string, Measured> {
  const spellings: (readonly [string, string])[] = [];
  for (const [label, build] of TYPE_ONLY_WRAPPERS) {
    spellings.push([label, position.body(build(position.value, position.type, position.local))]);
  }
  for (const [label, build] of BINDING_WRAPPERS) {
    spellings.push([label, build(position.value, position.type, (g) => position.body(g))]);
  }
  for (const [label, build] of SELECTOR_WRAPPERS) {
    spellings.push([label, position.body(build(position.value, position.type, position.local))]);
  }
  // `!` is deliberately NOT in the shared table (it is this language's Result
  // propagation boundary), so its two spellings are compared to each other and
  // not to `direct`.
  spellings.push(["a postfix boundary over the value", position.body(`(${position.value}!)`)]);
  spellings.push([
    "a postfix boundary over the satisfies",
    position.body(`((${position.value} satisfies ${position.type})!)`),
  ]);
  return measureTable(
    `${position.imports}\n`,
    position.prelude,
    spellings,
    position.returnType,
  );
}

describe("a type-only wrapper cannot launder foreign provenance", () => {
  for (const position of POSITIONS) {
    test(position.id, () => {
      const table = tableFor(position);
      const direct = table["direct"]!;

      // Guard: a vacuously clean baseline would make every equality below pass
      // while measuring nothing. The direct spelling must actually be refused.
      expect(direct.codes.length, `${position.id}: direct baseline is not refused`).toBeGreaterThan(0);

      for (const [label] of TYPE_ONLY_WRAPPERS) {
        expect(table[label]!.codes, `${position.id} / ${label}`).toEqual(direct.codes);
        expect(table[label]!.failures, `${position.id} / ${label} row`).toEqual(direct.failures);
      }
      for (const [label] of BINDING_WRAPPERS) {
        expect(table[label]!.codes, `${position.id} / ${label}`).toEqual(direct.codes);
        expect(table[label]!.failures, `${position.id} / ${label} row`).toEqual(direct.failures);
      }

      const selected = table["a selection over the value"]!;
      expect(selected.codes.length, `${position.id}: selector baseline is not refused`).toBeGreaterThan(0);
      for (const [label] of SELECTOR_WRAPPERS) {
        expect(table[label]!.codes, `${position.id} / ${label}`).toEqual(selected.codes);
      }

      const bang = table["a postfix boundary over the value"]!;
      expect(bang.codes.length, `${position.id}: postfix baseline is not refused`).toBeGreaterThan(0);
      expect(table["a postfix boundary over the satisfies"]!.codes, `${position.id} / postfix over satisfies`)
        .toEqual(bang.codes);
    });
  }
});

/**
 * The exact codes and rows for the ten programs that checked clean and threw a
 * raw host `Error` out of a function declared to return a plain type.
 *
 * Each was executed before the fix through `smithers run`, and each printed the
 * host's own message — `getter blew`, `ctor blew`, `tag blew`, `host blew up`,
 * `iter blew`, `toString blew` — with `exitCode 1`, while `smithers check`
 * reported `ok: true` and zero diagnostics.
 */
describe("the measured runtime escapes are refused", () => {
  const ESCAPES: readonly (readonly [string, string, string, readonly string[]])[] = [
    [
      "a property read behind satisfies",
      `import { client } from "./untrusted.ts"`,
      `return (client satisfies { readonly dangerous: string, m(): string }).dangerous`,
      ["SMITHERS1101", "SMITHERS1506"],
    ],
    [
      "a construction behind satisfies",
      `import { Ctor } from "./untrusted.ts"`,
      `const o = new (Ctor satisfies new (v: string) => { readonly v: string })("a"); return o.v`,
      ["SMITHERS1101", "SMITHERS1504", "SMITHERS1506"],
    ],
    [
      "a tagged template behind satisfies",
      `import { tag } from "./untrusted.ts"`,
      "return (tag satisfies (parts: TemplateStringsArray) => string)`x`",
      ["SMITHERS1101", "SMITHERS1504"],
    ],
    [
      "a callee behind satisfies",
      `import { call } from "./untrusted.ts"`,
      `return (call satisfies (value: string) => string)(v)`,
      ["SMITHERS1101"],
    ],
    [
      "an iteration behind satisfies",
      `import { iterable } from "./untrusted.ts"`,
      `let out = ""; for (const s of (iterable satisfies Iterable<string>)) { out = out + s } return out`,
      ["SMITHERS1101", "SMITHERS1506"],
    ],
    [
      "a coercion behind satisfies",
      `import { coercible } from "./untrusted.ts"`,
      "return `v${(coercible satisfies { toString(): string })}`",
      ["SMITHERS1101", "SMITHERS1506"],
    ],
    [
      "an object-literal property holding a satisfies",
      `import { client } from "./untrusted.ts"`,
      `const holder = { pick: client satisfies { readonly dangerous: string, m(): string } }; return holder.pick.dangerous`,
      ["SMITHERS1101", "SMITHERS1506"],
    ],
    [
      "an element access behind satisfies unknown",
      `import { client } from "./untrusted.ts"`,
      `return (client satisfies unknown)["dangerous"]`,
      ["SMITHERS1101", "SMITHERS1506"],
    ],
  ];

  for (const [id, imports, body, codes] of ESCAPES) {
    test(id, () => {
      const table = measureTable(`${imports}\n`, "", [["escape", body]]);
      expect(table["escape"]!.codes).toEqual([...codes].sort());
      expect(table["escape"]!.failures).toEqual(["Panic"]);
    });
  }

  /**
   * `await` is deliberately NOT in the shared table — it removes a Promise
   * layer, which is a real change of value — so `foreignValueOrigin` walks it in
   * its own branch. Both nestings were fail-open before the fix and both now
   * answer exactly what `(await client).dangerous` answers, which is how the two
   * are shown to COMPOSE rather than one masking the other.
   */
  test("an await composes with a satisfies in both nestings", () => {
    const T = "{ readonly dangerous: string, m(): string }";
    const table = measureTable(
      `import { client } from "./untrusted.ts"\n`,
      "",
      [
        ["await, direct", `return (await client).dangerous`],
        ["await over a satisfies", `return (await (client satisfies ${T})).dangerous`],
        ["satisfies over an await", `return ((await client) satisfies ${T}).dangerous`],
      ],
      "Promise<string>",
      true,
    );
    expect(table["await, direct"]!.codes.length).toBeGreaterThan(0);
    expect(table["await over a satisfies"]!.codes).toEqual(table["await, direct"]!.codes);
    expect(table["satisfies over an await"]!.codes).toEqual(table["await, direct"]!.codes);
  });

  /**
   * A generic type argument and an annotated parameter are not themselves
   * laundering wrappers — `identity(client)` and `useIt(client)` were already
   * refused — but a `satisfies` in the argument defeated both, and a
   * `satisfies` in an annotated RETURN defeated the return rule as well.
   */
  test("a satisfies inside a generic argument, a parameter and a return", () => {
    const table = measureTable(
      `import { client } from "./untrusted.ts"\n`,
      `function identity<T>(value: T): T { return value }
function useIt(p: { readonly dangerous: string }): string { return p.dangerous }`,
      [
        ["generic argument", `return identity(client satisfies { readonly dangerous: string, m(): string }).dangerous`],
        ["generic argument, direct", `return identity(client).dangerous`],
        ["annotated parameter", `return useIt(client satisfies { readonly dangerous: string, m(): string })`],
        ["annotated parameter, direct", `return useIt(client)`],
      ],
    );
    expect(table["generic argument"]!.codes).toEqual(table["generic argument, direct"]!.codes);
    expect(table["annotated parameter"]!.codes).toEqual(table["annotated parameter, direct"]!.codes);
    expect(table["annotated parameter, direct"]!.codes.length).toBeGreaterThan(0);
  });

  test("a satisfies in an annotated return is refused like the direct return", () => {
    const table = measureTable(
      `import { client } from "./untrusted.ts"\n`,
      "",
      [
        ["annotated return, satisfies", `return client satisfies { readonly dangerous: string, m(): string }`],
        ["annotated return, direct", `return client`],
      ],
      "{ readonly dangerous: string }",
    );
    expect(table["annotated return, direct"]!.codes.length).toBeGreaterThan(0);
    expect(table["annotated return, satisfies"]!.codes).toEqual(table["annotated return, direct"]!.codes);
  });
});

/**
 * BOTH DIRECTIONS. Everything below is a program the language is supposed to
 * accept, and every one of them travels through the same wrappers.
 */
describe("legitimate programs through the same wrappers still compile", () => {
  const AUTHORED: readonly (readonly [string, string, string, string])[] = [
    ["an authored callable", `function localCall(value: string): string { return value }`, "localCall", CALL_T],
    ["an authored object", `const box = { p: "a", m(): string { return "m" } }`, "box", "{ readonly p: string, m(): string }"],
    ["an authored class", `class LocalCtor { constructor(readonly v: string) {} }`, "LocalCtor", CTOR_T],
  ];

  for (const [id, prelude, value, type] of AUTHORED) {
    test(`${id} stays clean through every type-only wrapper`, () => {
      const use = value === "LocalCtor"
        ? (e: string) => `const o = new ${e}("a"); return o.v`
        : value === "box"
          ? (e: string) => `return ${e}.p`
          : (e: string) => `return ${e}(v)`;
      const spellings: (readonly [string, string])[] = TYPE_ONLY_WRAPPERS
        .map(([label, build]) => [label, use(build(value, type, value))] as const);
      spellings.push(["as const over a literal", `const t = [${value}] as const; ${use("t[0]")}`]);
      spellings.push(["an annotated const", `const g: ${type} = ${value}; ${use("g")}`]);
      spellings.push(["a satisfies statement", `${value} satisfies ${type}; ${use(value)}`]);
      const table = measureTable(`// authored only\n`, prelude, spellings);
      for (const [label] of spellings) {
        expect(table[label]!.codes, `${id} / ${label}`).toEqual([]);
        expect(table[label]!.failures, `${id} / ${label} row`).toEqual([]);
      }
    });
  }

  /**
   * A TRUSTED foreign binding through `satisfies` stays usable, and that is not
   * an accident of the walk: `satisfies` does not change the expression's type,
   * so `getResolvedSignature` still resolves to the marked declaration and the
   * `@throws {never}` claim still stands. `as` and an explicit annotation do
   * change it, and both refuse — the difference is pinned below rather than
   * assumed.
   */
  test("a trusted foreign tag stays usable through satisfies in every spelling", () => {
    const table = measureTable(
      `import { trustedTag, trustedTag2 } from "./trusted.ts"\n`,
      `function localTag(parts: TemplateStringsArray): string { return "l" }`,
      [
        ["direct", "return trustedTag`x`"],
        ["parenthesised", "return (trustedTag)`x`"],
        ["satisfies", "return (trustedTag satisfies " + TAG_T + ")`x`"],
        ["satisfies unknown", "return (trustedTag satisfies unknown)`x`"],
        ["satisfies twice", "return ((trustedTag satisfies " + TAG_T + ") satisfies unknown)`x`"],
        ["satisfies in ??", "return ((trustedTag satisfies " + TAG_T + ") ?? trustedTag2)`x`"],
        ["satisfies in ||", "return ((trustedTag satisfies " + TAG_T + ") || trustedTag2)`x`"],
        ["satisfies in &&", "return (trustedTag2 && (trustedTag satisfies " + TAG_T + "))`x`"],
        ["satisfies in a ternary", "return (c ? (trustedTag satisfies " + TAG_T + ") : trustedTag2)`x`"],
        ["satisfies in a comma", "return ((trustedTag2, (trustedTag satisfies " + TAG_T + ")))`x`"],
        ["satisfies against a local", "return ((trustedTag satisfies " + TAG_T + ") ?? localTag)`x`"],
        ["a const holding the satisfies", "const g = trustedTag satisfies " + TAG_T + "; return g`x`"],
        ["two const hops", "const a = trustedTag satisfies " + TAG_T + "; const b = a; return b`x`"],
      ],
    );
    for (const label of Object.keys(table)) {
      expect(table[label]!.codes, `trusted tag / ${label}`).toEqual([]);
      expect(table[label]!.failures, `trusted tag / ${label} row`).toEqual([]);
    }
  });

  test("a trusted foreign callee stays usable through satisfies", () => {
    const table = measureTable(
      `import { giveString } from "./trusted.ts"\n`,
      "",
      [
        ["direct", `return giveString(v)`],
        ["satisfies", `return (giveString satisfies ${CALL_T})(v)`],
        ["satisfies unknown", `return (giveString satisfies unknown)(v)`],
        ["a const holding the satisfies", `const g = giveString satisfies ${CALL_T}; return g(v)`],
      ],
    );
    for (const label of Object.keys(table)) {
      expect(table[label]!.codes, `trusted callee / ${label}`).toEqual([]);
    }
  });

  /**
   * `satisfies` and `as` are the same for PROVENANCE and opposite for TRUST.
   * `as` replaces the declaration `getResolvedSignature` resolves to with a
   * `.sm`-local type node, which erases the `@throws {never}` marker; the same
   * is true of an explicit type annotation on a `const`. Both refuse, and both
   * refused before this change. If `satisfies` were ever implemented as "an
   * `as` that keeps the operand's type", this test is what would fail.
   */
  test("as and an annotation erase a trust marker where satisfies does not", () => {
    const table = measureTable(
      `import { trustedTag } from "./trusted.ts"\n`,
      "",
      [
        ["satisfies keeps the marker", "return (trustedTag satisfies " + TAG_T + ")`x`"],
        ["as erases it", "return (trustedTag as " + TAG_T + ")`x`"],
        ["an annotated const erases it", "const g: " + TAG_T + " = trustedTag; return g`x`"],
        ["satisfies then as erases it", "return ((trustedTag satisfies " + TAG_T + ") as " + TAG_T + ")`x`"],
      ],
    );
    expect(table["satisfies keeps the marker"]!.codes).toEqual([]);
    expect(table["as erases it"]!.codes).toEqual(["SMITHERS1101", "SMITHERS1504"]);
    expect(table["an annotated const erases it"]!.codes).toEqual(["SMITHERS1101", "SMITHERS1504"]);
    // Composing the two answers what the `as` half answers, not what the
    // `satisfies` half answers: the erasure is the fail-closed direction.
    expect(table["satisfies then as erases it"]!.codes).toEqual(table["as erases it"]!.codes);
  });
});

/**
 * A `@throws {never}` CONSTRUCTOR is honoured — when TypeScript attaches the
 * marker to the constructor at all.
 *
 * This was reported as a divergence in which the reference refused a trusted
 * constructor the Go fork accepted, with the reference judged wrong. Measured,
 * it is the other way round, and the deciding fact is in TypeScript's parser:
 * a leading JSDoc block written on the SAME LINE as a class member is not
 * attached to that member. `constructorDeclaration.jsDoc` is `undefined` and
 * `ts.getJSDocTags(constructorDeclaration)` is `[]`, so there is no marker for
 * `foreignPolicyFromDeclaration` to honour and the constructor is unannotated —
 * which is exactly what the reference reports.
 *
 * Put the same marker on its OWN LINE and the reference accepts, which is the
 * evidence that it honours a constructor-level marker. The Go fork accepts BOTH
 * spellings, and the same-line one runs and throws `Error: same-line ctor blew`
 * out of a function declared `: string` — so on that cell the fork is the
 * fail-open and the reference is right.
 */
describe("a @throws {never} constructor is honoured where the checker can resolve it", () => {
  test("the marker is honoured on its own line and absent on the same line", () => {
    const table = measureTable(
      `import { OwnLineMarked, SameLineMarked, Unmarked } from "./trusted.ts"\n`,
      "",
      [
        ["own-line marker", `const o = new OwnLineMarked("a"); return c ? "made" : "made"`],
        ["same-line marker", `const o = new SameLineMarked("a"); return c ? "made" : "made"`],
        ["no marker", `const o = new Unmarked("a"); return c ? "made" : "made"`],
      ],
    );
    // A trusted construction is accepted: the marker removes the panic case.
    expect(table["own-line marker"]!.codes).toEqual([]);
    expect(table["own-line marker"]!.failures).toEqual([]);
    // TypeScript attaches no JSDoc to a same-line member, so this constructor
    // carries no claim and is refused exactly like an unmarked one.
    expect(table["same-line marker"]!.codes).toEqual(table["no marker"]!.codes);
    expect(table["no marker"]!.codes).toContain("SMITHERS1504");
  });

  test("a type-only wrapper does not change the constructor verdict either way", () => {
    const table = measureTable(
      `import { OwnLineMarked, Unmarked } from "./trusted.ts"\n`,
      "",
      [
        ["trusted, direct", `const o = new OwnLineMarked("a"); return c ? "made" : "made"`],
        ["trusted, satisfies", `const o = new (OwnLineMarked satisfies ${CTOR_T})("a"); return c ? "made" : "made"`],
        ["untrusted, direct", `const o = new Unmarked("a"); return c ? "made" : "made"`],
        ["untrusted, satisfies", `const o = new (Unmarked satisfies ${CTOR_T})("a"); return c ? "made" : "made"`],
      ],
    );
    expect(table["trusted, satisfies"]!.codes).toEqual(table["trusted, direct"]!.codes);
    expect(table["untrusted, satisfies"]!.codes).toEqual(table["untrusted, direct"]!.codes);
    expect(table["untrusted, direct"]!.codes).toContain("SMITHERS1504");
  });
});
