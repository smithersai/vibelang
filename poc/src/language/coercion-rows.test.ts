/**
 * Which POSITIONS coerce a value to a primitive, and which member each of them
 * actually runs.
 *
 * `specification/requirements.mdx` §Inference (Locked): "Calling a function with
 * unsatisfied requirements MUST add those capabilities to the caller's `R` row.
 * ... Requirement inference MUST be transitive through ordinary calls." A
 * `valueOf` that JavaScript invokes is an ordinary call with no call expression
 * to see, exactly as a getter is.
 *
 * The defect this file pins, and the shape it shares with its siblings:
 *
 *  1. `valueOf` had never been charged ANYWHERE. The implicit-invocation model
 *     charged `Symbol.toPrimitive` and `toString`, and the coercion protocol
 *     runs three members, not two. `+obj`, where `obj.valueOf()` reads a
 *     capability, published `valueOf: { requirements: ["Db"] }` beside
 *     `f: { requirements: [] }` — the callee's row computed correctly and was
 *     then dropped at the coercion — checked `ok: true` on BOTH backends, and
 *     panicked at run time with `capability 'Db' was not provided`.
 *
 *  2. And the authored half of the protocol knew only TWO positions, a template
 *     span and binary `+`, while the FOREIGN half of the very same protocol
 *     already had a table total over the grammar. So `-`, `~`, `++`/`--`, every
 *     arithmetic, relational, bitwise and compound-assignment operator,
 *     `==`/`!=`, `Number(x)`, `Math.*(x)`, a computed property key, `o[k]` and
 *     `k in o` were all silent. 43 spellings checked `ok: true` and panicked.
 *     The authored half now asks `implicitInvocationProtocol` — the same
 *     predicate — so the two halves cannot disagree about what a coercion
 *     position is and the answer is total by construction.
 *
 *  3. The neighbouring `enumeration` branch of that table had never been wired
 *     up at all: `{ ...box }` runs every own enumerable getter, and
 *     `const copy = { ...box }` published an empty row and panicked.
 *
 * The load-bearing half of this file is the NEGATIVE half. Coercion is
 * everywhere in ordinary code, so a rule this broad is far likelier to REFUSE
 * working programs than to miss one. Every charged row below is paired with the
 * legitimate program that must still compile at the row it must still record:
 * `+n` on a number, `+"3"`, a plain object whose `valueOf` reads nothing, an
 * ordinary template literal, an ordinary `JSON.stringify` of plain data, and —
 * the sharp ones — the four positions where the coerced member is NOT the one
 * the hint names.
 *
 * `THE_COERCION_WALK` is the reason this is modelled as ECMAScript's
 * `OrdinaryToPrimitive` and not flattened to "charge all three members". Both
 * of its fall-through rows were measured as run-time panics before being
 * written down, and both of its stop rows were measured as programs that run.
 */
import { describe, expect, test } from "bun:test";
import { analyzeProject } from "./index.ts";

const CAPABILITY = `import { Context } from "smthrs/context"

abstract class Db extends Context {
  abstract read(): string
}
`;

/** An object whose ONLY capability-reading member is `valueOf`. */
const VALUE_OF = `const obj = { valueOf(): number { return Db.context().read().length } }
`;

/** An object whose ONLY capability-reading member is `toString`. */
const TO_STRING = `const obj = { toString(): string { return Db.context().read() } }
`;

interface Measured {
  readonly codes: readonly string[];
  readonly rows: Record<string, { requirements: readonly string[]; failures: readonly string[] }>;
}

function measure(source: string): Measured {
  const analysis = analyzeProject([{ fileName: "main.sm", source }], { rootDir: "/virtual/coercion-rows" });
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
 * Every position that coerces, each reaching the capability through ONE
 * spelling, so the whole table is one assertion: `f.requirements` is `["Db"]`.
 *
 * Add a row here before adding an operator anywhere. A row that already passes
 * is the evidence that the model is total over the grammar rather than a list
 * somebody remembered to extend — which is precisely how this class reopened.
 *
 * Several of these spellings are ALSO refused by the stock type check (`obj - 1`
 * is TS2362), which is why the codes are not asserted empty here. That
 * refusal is incidental and is not a rule: it disappears the moment the operand
 * is laundered through a cast, and the row has to be right either way. The rows
 * that ARE clean are pinned by name in the negative tables below.
 */
const COERCION_POSITIONS: readonly { readonly id: string; readonly source: string }[] = [
  // --- unary ---
  { id: "unary plus", source: VALUE_OF + `export function f(): number { return +obj }` },
  { id: "unary minus", source: VALUE_OF + `export function f(): number { return -obj }` },
  { id: "bitwise not", source: VALUE_OF + `export function f(): number { return ~obj }` },
  // --- arithmetic ---
  { id: "subtraction", source: VALUE_OF + `export function f(): number { return obj - 1 }` },
  { id: "multiplication", source: VALUE_OF + `export function f(): number { return obj * 2 }` },
  { id: "division", source: VALUE_OF + `export function f(): number { return obj / 2 }` },
  { id: "remainder", source: VALUE_OF + `export function f(): number { return obj % 2 }` },
  { id: "exponentiation", source: VALUE_OF + `export function f(): number { return obj ** 2 }` },
  { id: "an arithmetic RIGHT operand", source: VALUE_OF + `export function f(): number { return 1 - obj }` },
  // --- relational ---
  { id: "less-than", source: VALUE_OF + `export function f(): boolean { return obj < 1 }` },
  { id: "greater-than-or-equal", source: VALUE_OF + `export function f(): boolean { return obj >= 1 }` },
  // --- bitwise and shift ---
  { id: "bitwise and", source: VALUE_OF + `export function f(): number { return obj & 1 }` },
  { id: "bitwise or", source: VALUE_OF + `export function f(): number { return obj | 1 }` },
  { id: "bitwise xor", source: VALUE_OF + `export function f(): number { return obj ^ 1 }` },
  { id: "left shift", source: VALUE_OF + `export function f(): number { return obj << 1 }` },
  { id: "unsigned right shift", source: VALUE_OF + `export function f(): number { return obj >>> 1 }` },
  // --- loose equality against a primitive ---
  { id: "loose equality", source: VALUE_OF + `export function f(): boolean { return obj == 1 }` },
  { id: "loose inequality", source: VALUE_OF + `export function f(): boolean { return obj != 1 }` },
  { id: "loose equality reaching toString", source: TO_STRING + `export function f(): boolean { return obj == "x" }` },
  // --- `+`, with a number and with a string on the other side ---
  { id: "plus with a number", source: VALUE_OF + `export function f(): number { return obj + 1 }` },
  { id: "plus with a string on the left", source: VALUE_OF + `export function f(): string { return "v " + obj }` },
  { id: "plus with a string on the right", source: VALUE_OF + `export function f(): string { return obj + "" }` },
  { id: "plus reaching toString", source: TO_STRING + `export function f(): string { return "v " + obj }` },
  // --- compound assignment and update ---
  { id: "a numeric compound assignment", source: VALUE_OF +
    `export function f(): number { let n = 0; n += obj as unknown as number; return n }` },
  { id: "a string compound assignment", source: TO_STRING +
    `export function f(): string { let s = ""; s += obj; return s }` },
  { id: "a shift compound assignment", source: VALUE_OF +
    `export function f(): number { let n = 1; n <<= obj as unknown as number; return n }` },
  // --- ambient conversions ---
  { id: "Number(x)", source: VALUE_OF + `export function f(): number { return Number(obj) }` },
  { id: "Math.abs(x)", source: VALUE_OF +
    `export function f(): number { return Math.abs(obj as unknown as number) }` },
  { id: "Math.max(x, y)", source: VALUE_OF +
    `export function f(): number { return Math.max(obj as unknown as number, 0) }` },
  { id: "String(x) reaching toString", source: TO_STRING + `export function f(): string { return String(obj) }` },
  { id: "JSON.stringify reaching toJSON", source:
    `const obj = { toJSON(): string { return Db.context().read() } }
export function f(): string { return JSON.stringify(obj) }` },
  // --- key positions, all ToPropertyKey ---
  { id: "an element-access key", source: TO_STRING +
    `const table: Record<string, number> = { a: 1 }
export function f(): number { return table[obj as unknown as string] ?? 0 }` },
  { id: "an element-access key being written", source: TO_STRING +
    `const table: Record<string, number> = {}
export function f(): number { table[obj as unknown as string] = 1; return 1 }` },
  { id: "an object-literal computed key", source: TO_STRING +
    `export function f(): number { const o = { [obj as unknown as string]: 1 }; return Object.keys(o).length }` },
  { id: "the left operand of `in`", source: TO_STRING +
    `const table: Record<string, number> = { a: 1 }
export function f(): boolean { return (obj as unknown as string) in table }` },
  // --- the value reaching the position indirectly ---
  { id: "a parenthesized operand", source: VALUE_OF + `export function f(): number { return +(obj) }` },
  { id: "an operand laundered through a cast", source: VALUE_OF +
    `export function f(): number { return +(obj as unknown as number) }` },
  { id: "an operand reached through a const alias", source: VALUE_OF +
    `const alias = obj
export function f(): number { return +alias }` },
  { id: "an operand reached through an object property", source: VALUE_OF +
    `const holder = { inner: obj }
export function f(): number { return +holder.inner }` },
  { id: "an operand reached through a ternary", source: VALUE_OF +
    `export function f(flag: boolean): number { return +(flag ? obj : obj) }` },
  // --- where the member is declared ---
  { id: "a valueOf declared on the class itself", source:
    `class Holder { valueOf(): number { return Db.context().read().length } }
const obj = new Holder()
export function f(): number { return +obj }` },
  { id: "a valueOf INHERITED from a base class", source:
    `class Base { valueOf(): number { return Db.context().read().length } }
class Derived extends Base {}
const obj = new Derived()
export function f(): number { return +obj }` },
  { id: "a valueOf copied off a prototype object by spread", source:
    `const base = { valueOf(): number { return Db.context().read().length } }
const obj = { ...base }
export function f(): number { return +obj }` },
  // --- Symbol.toPrimitive, at each hint ---
  { id: "Symbol.toPrimitive under a number hint", source:
    `const obj = { [Symbol.toPrimitive](hint: string): number { return Db.context().read().length } }
export function f(): number { return +obj }` },
  { id: "Symbol.toPrimitive under a string hint", source:
    `const obj = { [Symbol.toPrimitive](hint: string): string { return Db.context().read() } }
export function f(): string { return \`\${obj}\` }` },
  { id: "Symbol.toPrimitive under a default hint", source:
    `const obj = { [Symbol.toPrimitive](hint: string): number { return Db.context().read().length } }
export function f(): boolean { return obj == 1 }` },
  // --- `instanceof` invokes a member too, but a DIFFERENT one ---
  { id: "the right operand of instanceof runs Symbol.hasInstance", source:
    `const obj = { [Symbol.hasInstance](x: unknown): boolean { return Db.context().read() === "y" } }
export function f(x: unknown): boolean { return x instanceof obj }` },
  // --- the two positions that were already modelled, which must not regress ---
  { id: "a template substitution reaching toString", source: TO_STRING +
    `export function f(): string { return \`\${obj}\` }` },
  { id: "a template substitution reaching an inherited toString", source:
    `class Base { toString(): string { return Db.context().read() } }
class Derived extends Base {}
const obj = new Derived()
export function f(): string { return \`\${obj}\` }` },
];

describe("every coercion position charges the member it runs", () => {
  for (const position of COERCION_POSITIONS) {
    test(position.id, () => {
      expect(measure(CAPABILITY + position.source).rows.f?.requirements).toEqual(["Db"]);
    });
  }
});

/**
 * Positions that LOOK like coercions and are not, and coercions over values
 * that carry no checked member.
 *
 * Every row must compile with ZERO diagnostics and record an EMPTY row. A rule
 * that reaches into arithmetic, comparison, keys and interpolation touches
 * essentially every program in the corpus, so this table is what stands between
 * the fix and a language nobody can write.
 */
const SOUND_POSITIONS: readonly { readonly id: string; readonly source: string }[] = [
  { id: "unary plus on a number", source: `export function f(n: number): number { return +n }` },
  { id: "unary plus on a string literal", source: `export function f(): number { return +"3" }` },
  { id: "a plain valueOf that reads nothing", source:
    `const obj = { valueOf(): number { return 7 } }
export function f(): number { return +obj }` },
  { id: "an ordinary template literal", source:
    `export function f(name: string): string { return \`hello \${name}\` }` },
  { id: "an ordinary JSON.stringify of plain data", source:
    `export function f(): string { return JSON.stringify({ a: 1, b: [2, 3] }) }` },
  { id: "arithmetic over numbers", source:
    `export function f(a: number, b: number): number { return a - b * 2 / 1 % 5 ** 1 }` },
  { id: "relational and equality over primitives", source:
    `export function f(a: number, b: number): boolean { return a < b || a >= b || a == b }` },
  { id: "bitwise operators over numbers", source:
    `export function f(a: number): number { return (a & 3) | (a ^ 1) | (a << 1) | (a >>> 1) | ~a }` },
  { id: "compound assignment over primitives", source:
    `export function f(): string { let n = 0; n += 2; n *= 3; let s = ""; s += n; return s }` },
  { id: "increment and decrement on a number", source:
    `export function f(): number { let n = 0; n++; ++n; n--; return n }` },
  { id: "a computed key that is already a string", source:
    `const table: Record<string, number> = { a: 1 }
export function f(k: string): number { return table[k] ?? 0 }` },
  { id: "Number and Math over primitives", source:
    `export function f(): number { return Number("3") + Math.abs(-4) + Math.max(1, 2) }` },
  { id: "string concatenation of strings", source:
    `export function f(a: string, b: string): string { return "x " + a + b }` },
  // --- positions that run NO user code at all ---
  { id: "strict equality, which never coerces", source: CAPABILITY + VALUE_OF +
    `export function f(): boolean { return (obj as unknown) === 1 }` },
  { id: "a condition, which is ToBoolean", source: CAPABILITY + VALUE_OF +
    `export function f(): number { if (obj) { return 1 } return 0 }` },
  { id: "Boolean(x), which is ToBoolean", source: CAPABILITY + VALUE_OF +
    `export function f(): boolean { return Boolean(obj) }` },
  { id: "a switch discriminant, which is strict equality", source: CAPABILITY + VALUE_OF +
    `export function f(): number { switch (obj as unknown as number) { case 1: return 1; default: return 0 } }` },
  { id: "instanceof does NOT run the right operand's toString", source: CAPABILITY +
    `class Foo { static toString(): string { return Db.context().read() } }
export function f(x: unknown): boolean { return x instanceof Foo }` },
  { id: "a tagged template substitution, which is handed over untouched", source: CAPABILITY + TO_STRING +
    `function tag(parts: TemplateStringsArray, ...vals: readonly unknown[]): string { return parts.join("") + String(vals.length) }
export function f(): string { return tag\`x\${obj}\` }` },
  // --- ambient identity, not spelling ---
  { id: "a local function named Number", source: CAPABILITY + VALUE_OF +
    `function Number(x: unknown): number { return 0 }
export function f(): number { return Number(obj) }` },
  { id: "a local function named String", source: CAPABILITY + TO_STRING +
    `function String(x: unknown): string { return "" }
export function f(): string { return String(obj) }` },
];

describe("a position that does not coerce records no row", () => {
  for (const position of SOUND_POSITIONS) {
    test(position.id, () => {
      // Rows that need a capability in scope carry `CAPABILITY` themselves; the
      // rest are deliberately written over primitives only.
      const measured = measure(position.source);
      expect(measured.codes).toEqual([]);
      expect(measured.rows.f?.requirements).toEqual([]);
    });
  }
});

/**
 * `OrdinaryToPrimitive`, one row per branch — the reason this is a WALK and not
 * a set of three members charged unconditionally.
 *
 * Flattening to "charge `Symbol.toPrimitive`, `valueOf` and `toString`" is
 * simpler and was measured to refuse four programs that run: an object whose
 * only capability-reading member is `valueOf`, interpolated or `String()`-ed or
 * used as a key, never calls `valueOf` at all — it prints `[object Object]`.
 * Shortening the walk the other way, to "the one member the hint names", was
 * measured to MISS two run-time panics. Both fall-through rows below were
 * observed panicking before they were written down.
 */
const THE_COERCION_WALK: readonly {
  readonly id: string;
  readonly source: string;
  readonly requirements: readonly string[];
}[] = [
  {
    id: "Symbol.toPrimitive shadows both others — they never run",
    requirements: [],
    source: `const obj = {
  [Symbol.toPrimitive](hint: string): number { return 1 },
  valueOf(): number { return Db.context().read().length },
  toString(): string { return Db.context().read() },
}
export function f(): number { return +obj }`,
  },
  {
    id: "a number hint STOPS at a valueOf that returns a primitive",
    requirements: [],
    source: `const obj = {
  valueOf(): number { return 1 },
  toString(): string { return Db.context().read() },
}
export function f(): number { return +obj }`,
  },
  {
    id: "a number hint FALLS THROUGH an absent valueOf into toString",
    requirements: ["Db"],
    source: TO_STRING + `export function f(): number { return +obj }`,
  },
  {
    id: "a string hint STOPS at a toString that returns a primitive",
    requirements: [],
    source: VALUE_OF + `export function f(): string { return \`\${obj}\` }`,
  },
  {
    id: "a string hint FALLS THROUGH a toString that returns an object into valueOf",
    requirements: ["Db"],
    source: `const obj = {
  toString(): object { return {} },
  valueOf(): number { return Db.context().read().length },
}
export function f(): string { return \`\${obj}\` }`,
  },
  {
    id: "String(x) walks with a string hint, so a valueOf-only object is untouched",
    requirements: [],
    source: VALUE_OF + `export function f(): string { return String(obj) }`,
  },
  {
    id: "Number(x) walks with a number hint, so the same object IS charged",
    requirements: ["Db"],
    source: VALUE_OF + `export function f(): number { return Number(obj) }`,
  },
];

describe("the coercion walk stops where ECMAScript stops", () => {
  for (const row of THE_COERCION_WALK) {
    test(row.id, () => {
      expect(measure(CAPABILITY + row.source).rows.f?.requirements).toEqual(row.requirements);
    });
  }
});

/**
 * The neighbouring `enumeration` branch of the same position table.
 *
 * `{ ...box }` copies every OWN ENUMERABLE property, running each of their
 * getters. A getter declared in a CLASS body lives on the prototype, is not an
 * own property, and must NOT be charged — measured, `{ ...new Box() }` produced
 * `{}` and never called the getter, so charging it would refuse a program that
 * runs.
 */
const ENUMERATION_POSITIONS: readonly {
  readonly id: string;
  readonly source: string;
  readonly requirements: readonly string[];
}[] = [
  {
    id: "an object spread runs an object-literal getter",
    requirements: ["Db"],
    source: `const box = { get size(): number { return Db.context().read().length } }
export function f(): number { const copy = { ...box }; return Object.keys(copy).length }`,
  },
  {
    id: "a rest binding runs every remaining own getter",
    requirements: ["Db"],
    source: `const box = { get size(): number { return Db.context().read().length } }
export function f(): number { const { ...rest } = box; return Object.keys(rest).length }`,
  },
  {
    id: "an object destructuring ASSIGNMENT runs them too",
    requirements: ["Db"],
    source: `const box = { get size(): number { return Db.context().read().length } }
export function f(): number { let rest: { size: number }; ({ ...rest } = box); return Object.keys(rest).length }`,
  },
  {
    id: "spreading a CLASS instance does not run its prototype getter",
    requirements: [],
    source: `class Box { get size(): number { return Db.context().read().length } }
const box = new Box()
export function f(): number { const copy = { ...box }; return Object.keys(copy).length }`,
  },
  {
    id: "spreading a plain object records no row",
    requirements: [],
    source: `const box = { a: 1, b: 2 }
export function f(): number { const copy = { ...box }; return Object.keys(copy).length }`,
  },
  {
    id: "spreading an array is iteration, not enumeration",
    requirements: [],
    source: `export function f(): number { const xs = [...[1, 2, 3]]; return xs.length }`,
  },
];

describe("an enumeration position charges the getters it runs", () => {
  for (const row of ENUMERATION_POSITIONS) {
    test(row.id, () => {
      expect(measure(CAPABILITY + row.source).rows.f?.requirements).toEqual(row.requirements);
    });
  }
});

/**
 * The other three channels at a coercion position.
 *
 * Only REQUIREMENTS travel through this edge, for the same reason they are the
 * only channel `accessorInvocations` carries: a coercion member cannot legally
 * hold a failure. Each row below is the measurement that says so — the
 * protocol method is refused at its own declaration, so there is no failure and
 * no must-consume obligation left at the coercion site to drop.
 *
 * That holds for a THROWING protocol method (SMITHERS1101) and for a
 * must-consume value coerced in place (SMITHERS1301). It does NOT hold for a
 * protocol method declared to return the compiler's `Result`; see the first
 * test below, which pins the gap rather than assuming it closed.
 */
describe("the failure and must-consume channels are closed at the protocol method", () => {
  /**
   * KNOWN GAP, measured rather than asserted away.
   *
   * This test read `import { Result } from "smthrs/result"` and expected
   * SMITHERS1104. `smthrs/result` is the compiler-owned LOWERING TARGET, not a
   * module an authored `.sm` imports from — the specifier does not resolve, and
   * the program's real diagnostics are SMITHERS1508/1510 for the unresolvable,
   * untrusted module. The 1104 came from somewhere else entirely: the channel
   * was recognized by the SPELLING of the type, so an unresolved import binding
   * named `Result` read as the compiler's `Result`. The test was green because
   * of that defect, and it is the only test in the suite that was.
   *
   * With identity resolved through the prelude's `__smithersResult` brand
   * (`semantic.ts`), the same program is still refused — SMITHERS1101 now, plus
   * the two module diagnostics — so nothing opened here. What the A/B measured
   * is that the describe block's premise above is FALSE for the compiler's own
   * `Result`: a `valueOf` declared to return one is charged nothing, on the
   * pre-change compiler and on this one alike (`[]` on both). The protocol
   * method is NOT refused at its own declaration for the Result channel; only
   * the throwing case is, by SMITHERS1101, and only because `valueOf(): number`
   * cannot represent the failure.
   *
   * That gap is pre-existing and belongs to whoever owns the coercion rules, so
   * it is pinned here rather than closed: both halves are asserted, so closing
   * it turns this red instead of letting it drift.
   */
  test("a valueOf that returns a Result is not yet refused where it is declared", () => {
    const authored = measure(`class Boom extends Error { readonly _tag = "Boom" as const }
const obj = { valueOf(): Result<number, Boom> { return null as never } }
export function f(): number { return +obj }`);
    expect(authored.codes).toEqual([]);

    // The retired import spelling is refused, and not for its return type.
    const retired = measure(`import { Result } from "smthrs/result"

class Boom extends Error { readonly _tag = "Boom" as const }
const obj = { valueOf(): Result<number, Boom> { return Result.ok(1) } }
export function f(): number { return +obj }`);
    expect(retired.codes).toContain("SMITHERS1508");
    expect(retired.codes).toContain("SMITHERS1510");
  });

  test("a valueOf that throws is refused where it is declared", () => {
    const measured = measure(`class Boom extends Error { readonly _tag = "Boom" as const }
const obj = { valueOf(): number { throw new Boom() } }
export function f(): number { return +obj }`);
    expect(measured.codes).toContain("SMITHERS1101");
  });

  test("a must-consume value coerced in place is still refused", () => {
    const measured = measure(`import { Result } from "smthrs/result"

class Boom extends Error { readonly _tag = "Boom" as const }
function fallible(): Result<number, Boom> { return Result.ok(1) }
export function f(): number { return +fallible() }`);
    expect(measured.codes).toContain("SMITHERS1301");
  });

  test("a TOP-LEVEL coercion has no row to charge and is refused", () => {
    const measured = measure(CAPABILITY + VALUE_OF + `export const v = +obj`);
    expect(measured.codes).toContain("SMITHERS2102");
  });

  test("a coercion inside a function charges that function, not the module", () => {
    const measured = measure(CAPABILITY + VALUE_OF + `export function f(): number { return +obj }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual(["Db"]);
  });
});
